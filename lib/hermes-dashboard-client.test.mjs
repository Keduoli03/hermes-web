import test from "node:test";
import assert from "node:assert/strict";
import { buildHermesDashboardUrl, getHermesDashboardHeaders } from "./hermes-dashboard-client.ts";

test("builds same-host dashboard URLs and preserves query parameters", () => {
  const url = buildHermesDashboardUrl("/api/sessions", "limit=10&order=recent", "http://127.0.0.1:8649");
  assert.equal(url, "http://127.0.0.1:8649/api/sessions?limit=10&order=recent");
});

test("supports the OpenAI-compatible v1 runs API route", () => {
  assert.equal(buildHermesDashboardUrl("/v1/runs/r1/events", "after=2", "http://127.0.0.1:8649"), "http://127.0.0.1:8649/v1/runs/r1/events?after=2");
});

test("rejects absolute and traversal paths", () => {
  assert.throws(() => buildHermesDashboardUrl("https://attacker.invalid/api/status", "", "http://127.0.0.1:8649"), /relative API path/);
  assert.throws(() => buildHermesDashboardUrl("/api/../env", "", "http://127.0.0.1:8649"), /unsafe API path/);
  assert.throws(() => buildHermesDashboardUrl("/admin/secrets", "", "http://127.0.0.1:8649"), /relative API path/);
});

test("keeps the dashboard session token server-side in the dedicated header", () => {
  const headers = getHermesDashboardHeaders("secret-for-test");
  assert.equal(headers.get("X-Hermes-Session-Token"), "secret-for-test");
  assert.equal(headers.has("Authorization"), false);
});

test("requires an explicitly configured dashboard token", () => {
  assert.throws(() => getHermesDashboardHeaders(""), /not configured/);
});
