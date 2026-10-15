// Exercise the real Next discovery route using a local model-list fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const requests = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url });
  if (request.url === "/v1/models") {
    if (request.headers.authorization !== "Bearer fixture-key") { response.writeHead(401); response.end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
  } else { response.setHeader("Content-Type", "text/html"); response.end("<html>Website</html>"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const local = `http://127.0.0.1:${server.address().port}`;
const headers = { "Content-Type": "application/json", Cookie: `pi_web_session=${createWebSessionToken(process.env.PI_WEB_PASSWORD)}` };
try {
  const response = await fetch(`${origin}/api/hermes/api/providers/custom-endpoints/discover`, { method: "POST", headers, body: JSON.stringify({ base_url: local, api_key: "fixture-key", api_mode: "codex_responses" }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.resolved_base_url, `${local}/v1`);
  assert.deepEqual(data.models, ["fixture-model"]);
  assert.equal(requests.every(row => row.method === "GET" && row.url.endsWith("/models")), true);
  assert.equal(JSON.stringify(data).includes("fixture-key"), false);
  console.log("PASS: real Next route, HTML-root fallback, model enumeration without generation, and credential isolation.");
  if (process.env.HERMES_TEST_SAVED_MODELS === "1") {
    const saved = await fetch(`${origin}/api/hermes/api/providers/custom-endpoints`, { headers });
    assert.equal(saved.status, 200);
    const { endpoints = [] } = await saved.json();
    const endpoint = endpoints.find(row => row.has_api_key);
    if (endpoint) {
      const check = await fetch(`${origin}/api/hermes/api/providers/custom-endpoints/discover`, { method: "POST", headers, body: JSON.stringify({ id: endpoint.id, base_url: endpoint.base_url, api_mode: endpoint.api_mode ?? "" }) });
      assert.equal(check.status, 200);
      const result = await check.json();
      console.log(`Saved provider read-only discovery: ${result.ok ? `PASS (${result.models.length} models)` : `unavailable (${result.code})`}. No configuration writes or chat requests.`);
    } else console.log("No saved credential-backed custom endpoint to check.");
  }
} finally { await new Promise(resolve => server.close(resolve)); }
