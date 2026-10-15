import test from "node:test";
import assert from "node:assert/strict";
import { discoverHermesModels } from "./hermes-model-discovery.mjs";

const noDashboard = async () => { throw new Error("Unexpected Dashboard call"); };

test("normalizes pasted completion URLs, falls back past an HTML root and retains model metadata", async () => {
  const urls = [];
  const result = await discoverHermesModels({ base_url: " https://fixture.test/chat/completions/ " }, noDashboard, async (url, init) => {
    urls.push(url);
    assert.equal(init.method, undefined);
    assert.equal(init.redirect, "error");
    return urls.length === 1 ? new Response("<html>site</html>") : Response.json({ data: [{ id: "alias", canonical_model: "canonical", reasoning_effort: "high" }, { id: "alias" }] });
  });
  assert.deepEqual(urls, ["https://fixture.test/models", "https://fixture.test/v1/models"]);
  assert.equal(result.ok, true);
  assert.equal(result.resolved_base_url, "https://fixture.test/v1");
  assert.deepEqual(result.model_details, [{ id: "alias", canonical_model: "canonical", reasoning_effort: "high" }]);
});

test("reads a saved key server-side and uses Anthropic model-list headers without a generation request", async () => {
  const reads = [];
  const result = await discoverHermesModels({ id: "saved", base_url: "https://fixture.test/v1", api_mode: "anthropic_messages" }, async (path, body) => {
    reads.push({ path, body });
    if (path.endsWith("custom-endpoints")) return { endpoints: [{ id: "saved", base_url: "https://fixture.test/v1", has_api_key: true }] };
    if (path.startsWith("/api/config")) return { providers: { saved: { key_env: "SAVED_KEY" } } };
    assert.deepEqual(body, { key: "SAVED_KEY" });
    return { value: "fixture-secret" };
  }, async (url, init) => {
    assert.equal(url, "https://fixture.test/v1/models");
    assert.equal(init.headers["x-api-key"], "fixture-secret");
    assert.equal(init.headers["anthropic-version"], "2023-06-01");
    return Response.json({ data: [{ id: "claude-fixture" }] });
  });
  assert.equal(result.ok, true);
  assert.equal(reads.length, 3);
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
});

test("does not read or forward a saved credential to a changed URL", async () => {
  let calls = 0;
  const result = await discoverHermesModels({ id: "saved", base_url: "https://other.test" }, async () => {
    calls++;
    return { endpoints: [{ id: "saved", base_url: "https://fixture.test", has_api_key: true }] };
  }, async () => { throw new Error("Must not fetch"); });
  assert.equal(result.code, "changed_url");
  assert.equal(calls, 1);
});

test("newly entered keys override saved keys and auth rejection remains distinct", async () => {
  const result = await discoverHermesModels({ id: "saved", api_key: "new-key", base_url: "https://fixture.test" }, noDashboard, async (_, init) => {
    assert.equal(init.headers.Authorization, "Bearer new-key");
    return new Response("do not expose upstream body", { status: 401 });
  });
  assert.equal(result.code, "authentication");
  assert.equal(JSON.stringify(result).includes("do not expose"), false);
});

test("distinguishes empty JSON, HTML, missing path and invalid addresses", async () => {
  for (const [response, code] of [[() => Response.json({ data: [] }), "empty"], [() => new Response("<html>"), "not_json"], [() => new Response(null, { status: 404 }), "http"]]) {
    assert.equal((await discoverHermesModels({ base_url: "https://fixture.test/v1" }, noDashboard, async () => response())).code, code);
  }
  assert.equal((await discoverHermesModels({ base_url: "file:///tmp/key" }, noDashboard)).code, "invalid_url");
});
