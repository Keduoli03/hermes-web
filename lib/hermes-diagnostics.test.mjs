import "./__fixtures__/web-auth-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { createJiti } from "jiti";
import { diagnoseHermesConnections } from "./hermes-diagnostics.mjs";
import { invalidateHermesConnection } from "./hermes-connection.mjs";
import { hermesApiOrigin, hermesDashboardOrigin, configuredHermesToken } from "./hermes-server-config.mjs";

async function fixture(action) {
  const names = ["HERMES_DASHBOARD_URL", "HERMES_DASHBOARD_SESSION_TOKEN", "HERMES_API_SERVER_URL", "API_SERVER_KEY", "PI_WEB_PASSWORD"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const state = { api: 200, dashboard: 200, ws: true, calls: [], methods: [], secrets: ["fixture-dashboard-secret", "fixture-api-server-key"] };
  const server = createServer((req, res) => {
    state.calls.push(req.url);
    if (req.url === "/api/config/schema") {
      assert.equal(req.headers["x-hermes-session-token"], state.secrets[0]);
      assert.equal(req.headers.authorization, undefined);
      res.writeHead(state.dashboard, { "Content-Type": "application/json" });
      res.end('{"fields":{}}');
    } else {
      assert.equal(req.url, "/v1/models");
      assert.equal(req.headers.authorization, `Bearer ${state.secrets[1]}`);
      assert.equal(req.headers.cookie, undefined);
      res.writeHead(state.api, { "Content-Type": "application/json", Location: "https://other.test/private" });
      res.end('{"data":[]}');
    }
  });
  const ws = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    assert.equal(new URL(req.url, "http://localhost").searchParams.get("token"), state.secrets[0]);
    if (!state.ws) { socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"); return; }
    ws.handleUpgrade(req, socket, head, client => ws.emit("connection", client));
  });
  ws.on("connection", client => client.on("message", raw => {
    const frame = JSON.parse(raw); state.methods.push(frame.method);
    assert.equal(frame.method, "gateway.ping", "diagnostics must never create or run a session");
    client.send(JSON.stringify({ id: frame.id, result: { ok: true } }));
  }));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  process.env.HERMES_DASHBOARD_URL = process.env.HERMES_API_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.HERMES_DASHBOARD_SESSION_TOKEN = state.secrets[0];
  process.env.API_SERVER_KEY = state.secrets[1];
  process.env.PI_WEB_PASSWORD = "fixture-panel-password";
  try { await action(state); }
  finally {
    invalidateHermesConnection();
    for (const client of ws.clients) client.terminate();
    await new Promise(resolve => ws.close(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
}

test("diagnostics separately verify Dashboard HTTP, API authentication and a real read-only WebSocket RPC", async () => fixture(async state => {
  const result = await diagnoseHermesConnections();
  assert.equal(result.connected, true);
  for (const key of ["dashboard", "api", "project"]) assert.equal(result[key].connected, true);
  assert.equal(result.local, true);
  assert.equal(result.automatic, false);
  assert.deepEqual(state.methods, ["gateway.ping"]);
  for (const secret of state.secrets) assert.equal(JSON.stringify(result).includes(secret), false);
}));

test("a working management API cannot hide a failed chat API or WebSocket", async () => fixture(async state => {
  state.api = 401; state.ws = false;
  const result = await diagnoseHermesConnections();
  assert.equal(result.connected, false);
  assert.equal(result.dashboard.connected, true);
  assert.equal(result.api.code, "api_auth_rejected");
  assert.equal(result.project.code, "project_unavailable");
}));

test("missing keys, redirects and invalid configuration produce safe capability errors", async () => fixture(async state => {
  process.env.API_SERVER_KEY = "";
  assert.equal((await diagnoseHermesConnections()).api.code, "api_key_missing");
  process.env.API_SERVER_KEY = state.secrets[1]; state.api = 302;
  assert.equal((await diagnoseHermesConnections()).api.code, "api_redirect");
  process.env.HERMES_API_SERVER_URL = "https://user:private-secret@host.test/nested";
  const result = await diagnoseHermesConnections();
  assert.equal(result.api.code, "api_config_invalid");
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
}));

test("diagnostic routes authenticate before any backend probe", async () => fixture(async state => {
  const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
  const route = await jiti.import("../app/api/hermes-connection/route.ts");
  const request = new Request("http://localhost/api/hermes-connection", { headers: { Host: "localhost" } });
  assert.equal((await route.GET(request)).status, 401);
  assert.equal((await route.POST(request)).status, 401);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.methods, []);
}));

test("the shared configuration preserves profile credentials and rejects non-origin service URLs", () => {
  const names = ["HERMES_DASHBOARD_URL", "HERMES_API_SERVER_URL", "HERMES_DASHBOARD_SESSION_TOKEN_work"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.HERMES_DASHBOARD_SESSION_TOKEN_work = "profile-specific-token";
    assert.equal(configuredHermesToken("work"), "profile-specific-token");
    for (const value of ["file:///tmp", "https://user:secret@host.test", "https://host.test/nested", "https://host.test/?key=secret", "https://host.test/#secret"]) {
      process.env.HERMES_DASHBOARD_URL = process.env.HERMES_API_SERVER_URL = value;
      assert.throws(hermesDashboardOrigin);
      assert.throws(hermesApiOrigin);
    }
  } finally { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});
