import test from "node:test";
import assert from "node:assert/strict";
import { createWebSessionToken } from "./web-auth.ts";
import { proxyHermesApiRequest } from "./hermes-api-proxy.mjs";

const envKeys = ["PI_WEB_PASSWORD", "API_SERVER_KEY", "HERMES_API_SERVER_URL", "HERMES_DASHBOARD_URL", "HERMES_DASHBOARD_SESSION_TOKEN", "PI_WEB_ALLOWED_HOSTS"];
const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
test.before(() => {
  process.env.PI_WEB_PASSWORD = "test-web-password";
  process.env.API_SERVER_KEY = "server-only-api-key-test";
  process.env.HERMES_API_SERVER_URL = "http://127.0.0.1:8642";
  process.env.HERMES_DASHBOARD_SESSION_TOKEN = "server-only-dashboard-token-test";
  process.env.HERMES_DASHBOARD_URL = "http://127.0.0.1:8648";
  process.env.PI_WEB_ALLOWED_HOSTS = "demo.blueke.top";
});
test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
function req(path, { method = "GET", body, accept = "application/json", cookie = createWebSessionToken("test-web-password") } = {}) {
  return new Request(new URL(path, "https://demo.blueke.top"), {
    method,
    headers: {
      Host: "demo.blueke.top",
      accept,
      ...(cookie ? { cookie: `pi_web_session=${cookie}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("denies unauthenticated requests before Hermes", async () => {
  let called = false;
  const response = await proxyHermesApiRequest(req("/api/hermes/api/status", { cookie: "bad" }), ["api", "status"], async () => {
    called = true;
    return new Response();
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("forwards API path/query with server key and strips credential headers", async () => {
  let forwarded;
  const response = await proxyHermesApiRequest(req("/api/hermes/v1/models?limit=10"), ["v1", "models"], async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response(JSON.stringify({ data: [] }));
  });
  assert.equal(forwarded.url, "http://127.0.0.1:8642/v1/models?limit=10");
  assert.equal(new Headers(forwarded.init.headers).get("Authorization"), "Bearer server-only-api-key-test");
  assert.equal(new Headers(forwarded.init.headers).has("cookie"), false);
  assert.equal(response.headers.has("Authorization"), false);
  assert.deepEqual(await response.json(), { data: [] });
});

test("proxies public Dashboard status and API server health without credentials", async () => {
  let calls = 0;
  const fetcher = async (url, init) => {
    calls += 1;
    if (String(url).endsWith("/health")) assert.equal(new Headers(init.headers).get("Authorization"), "Bearer server-only-api-key-test");
    else {
      assert.equal(new Headers(init.headers).has("Authorization"), false);
      assert.equal(new Headers(init.headers).has("X-Hermes-Session-Token"), false);
    }
    return new Response(JSON.stringify({ status: "ok" }));
  };
  const status = await proxyHermesApiRequest(req("/api/hermes/api/status"), ["api", "status"], fetcher);
  const health = await proxyHermesApiRequest(req("/api/hermes/health"), ["health"], fetcher);
  assert.equal(status.status, 200);
  assert.equal(health.status, 200);
  assert.equal(calls, 2);
});

test("proxies authenticated Hermes Dashboard API calls with server-only Dashboard token", async () => {
  let forwarded;
  const response = await proxyHermesApiRequest(req("/api/hermes/api/cron/jobs?profile=default"), ["api", "cron", "jobs"], async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response(JSON.stringify({ jobs: [] }));
  });
  assert.equal(forwarded.url, "http://127.0.0.1:8648/api/cron/jobs?profile=default");
  assert.equal(new Headers(forwarded.init.headers).get("X-Hermes-Session-Token"), "server-only-dashboard-token-test");
  assert.equal(new Headers(forwarded.init.headers).has("cookie"), false);
  assert.equal(response.headers.has("X-Hermes-Session-Token"), false);
  assert.deepEqual(await response.json(), { jobs: [] });
});

test("preserves authorized run creation method and body", async () => {
  let forwarded;
  const payload = { input: "hi", model: "hermes-agent" };
  const response = await proxyHermesApiRequest(req("/api/hermes/v1/runs", { method: "POST", body: payload }), ["v1", "runs"], async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response(JSON.stringify({ run_id: "run_test", status: "started" }), { status: 202 });
  });
  assert.equal(response.status, 202);
  assert.equal(forwarded.url, "http://127.0.0.1:8642/v1/runs");
  assert.equal(forwarded.init.method, "POST");
  assert.deepEqual(JSON.parse(Buffer.from(forwarded.init.body).toString()), payload);
});

test("preserves Dashboard DELETE body for credential removal", async () => {
  let forwarded;
  const response = await proxyHermesApiRequest(req("/api/hermes/api/env", { method: "DELETE", body: { key: "OPENROUTER_API_KEY" } }), ["api", "env"], async (url, init) => {
    forwarded = { url: String(url), init };
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded.init.method, "DELETE");
  assert.deepEqual(JSON.parse(Buffer.from(forwarded.init.body).toString()), { key: "OPENROUTER_API_KEY" });
  assert.equal(new Headers(forwarded.init.headers).get("X-Hermes-Session-Token"), "server-only-dashboard-token-test");
});

test("rejects traversal, profile/model overrides, and unsupported methods", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response(); };
  assert.equal((await proxyHermesApiRequest(req("/api/hermes/v1/models?profile=other"), ["v1", "models"], fetcher)).status, 400);
  assert.equal((await proxyHermesApiRequest(req("/api/hermes/v1/models"), ["v1", "..", "env"], fetcher)).status, 400);
  const bad = {
    method: "TRACE",
    url: "https://demo.blueke.top/x",
    headers: new Headers({ cookie: `pi_web_session=${createWebSessionToken("test-web-password")}` }),
  };
  assert.equal((await proxyHermesApiRequest(bad, ["v1", "models"], fetcher)).status, 405);
  assert.equal(called, false);
});

test("preserves SSE streaming and prevents API key leakage", async () => {
  let forwarded;
  const request = req("/api/hermes/v1/runs/r1/events", { accept: "text/event-stream" });
  const upstream = new Response("event: run.started\\ndata: {}\\n\\n", { headers: { "content-type": "text/event-stream" } });
  const response = await proxyHermesApiRequest(request, ["v1", "runs", "r1", "events"], async (url, init) => {
    forwarded = { url: String(url), init };
    return upstream;
  });
  assert.equal(forwarded.init.headers.get("Accept"), "text/event-stream");
  assert.equal(forwarded.url, "http://127.0.0.1:8642/v1/runs/r1/events");
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.has("Authorization"), false);
  assert.match(await response.text(), /run.started/);
});

test("password-free local development still rejects cross-site and remote requests", async () => {
  const previous = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "";
  let calls = 0;
  const upstream = async () => { calls++; return Response.json({ version: "test" }); };
  try {
    const local = new Request("http://127.0.0.1:30142/api/hermes/api/status", { headers: { host: "127.0.0.1:30142", origin: "http://127.0.0.1:30142", "sec-fetch-site": "same-origin" } });
    assert.equal((await proxyHermesApiRequest(local, ["api", "status"], upstream)).status, 200);
    const crossSite = new Request(local.url, { headers: { host: "127.0.0.1:30142", origin: "https://other.example", "sec-fetch-site": "cross-site" } });
    assert.equal((await proxyHermesApiRequest(crossSite, ["api", "status"], upstream)).status, 401);
    assert.equal((await proxyHermesApiRequest(req("/api/hermes/api/status", { cookie: "" }), ["api", "status"], upstream)).status, 401);
    assert.equal(calls, 1);
  } finally { process.env.PI_WEB_PASSWORD = previous; }
});
