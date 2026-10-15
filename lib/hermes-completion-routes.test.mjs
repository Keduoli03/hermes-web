import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { WebSocketServer } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebSessionToken } from "./web-auth.ts";
import { collectHermesArtifacts } from "./hermes-artifacts.ts";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const control = await jiti.import("../app/api/hermes-control/route.ts");
const versions = await jiti.import("../app/api/hermes-artifacts/versions/route.ts");
const request = (path, method = "GET", body, authenticated = true) => new Request(`http://localhost${path}`, { method, headers: { host: "localhost", ...(authenticated ? { cookie: `pi_web_session=${createWebSessionToken("fixture-password")}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("management RPC routes authenticate, constrain methods and preserve official plugin payloads", async () => {
  const previous = { password: process.env.PI_WEB_PASSWORD, url: process.env.HERMES_DASHBOARD_URL, token: process.env.HERMES_DASHBOARD_SESSION_TOKEN };
  process.env.PI_WEB_PASSWORD = "fixture-password"; process.env.HERMES_DASHBOARD_SESSION_TOKEN = "fixture-server-token";
  const server = new WebSocketServer({ port: 0 }); await new Promise(resolve => server.once("listening", resolve));
  process.env.HERMES_DASHBOARD_URL = `http://127.0.0.1:${server.address().port}`;
  const calls = [];
  server.on("connection", socket => socket.on("message", raw => {
    const frame = JSON.parse(raw); calls.push(frame);
    socket.send(JSON.stringify({ id: frame.id, result: frame.params.action === "list" ? { plugins: [] } : { ok: true } }));
  }));
  try {
    assert.equal((await control.GET(request("/api/hermes-control?module=plugins", "GET", undefined, false))).status, 401);
    assert.equal((await control.POST(request("/api/hermes-control", "POST", { module: "plugins", action: "shell" }))).status, 400);
    assert.equal(calls.length, 0);
    assert.deepEqual(await (await control.GET(request("/api/hermes-control?module=plugins"))).json(), { plugins: [] });
    assert.equal((await control.POST(request("/api/hermes-control", "POST", { module: "plugins", action: "toggle", name: "fixture", key: "fixture/provider", enable: false }))).status, 200);
    assert.deepEqual(calls.at(-1).params, { action: "toggle", name: "fixture", key: "fixture/provider", enable: false });
    assert.equal((await control.POST(request("/api/hermes-control", "POST", { module: "subagents", action: "interrupt", run_id: "missing", subagent_id: "child-1" }))).status, 502);
    assert.equal(calls.length, 2, "a missing owner must never open a new management connection");
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries({ PI_WEB_PASSWORD: previous.password, HERMES_DASHBOARD_URL: previous.url, HERMES_DASHBOARD_SESSION_TOKEN: previous.token })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("version routes resolve authoritative artifacts, reject forged ids and never overwrite Hermes files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-version-routes-"));
  const previous = { password: process.env.PI_WEB_PASSWORD, token: process.env.HERMES_DASHBOARD_SESSION_TOKEN, dir: process.env.HERMES_WEB_DATA_DIR, fetch: globalThis.fetch };
  process.env.PI_WEB_PASSWORD = "fixture-password"; process.env.HERMES_DASHBOARD_SESSION_TOKEN = "fixture-server-token"; process.env.HERMES_WEB_DATA_DIR = dir;
  const session = { id: "fixture-session", title: "Fixture", cwd: "/project" }, messages = [{ role: "assistant", content: "```text snapshot.txt\nOriginal bytes\n```" }];
  const artifact = collectHermesArtifacts(session, messages)[0], calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    assert.equal(new Headers(init.headers).get("X-Hermes-Session-Token"), "fixture-server-token");
    return Response.json(String(url).includes("/messages") ? { messages } : session);
  };
  const params = { session_id: session.id, artifact_id: artifact.id };
  const query = new URLSearchParams(params).toString();
  try {
    assert.equal((await versions.POST(request("/api/hermes-artifacts/versions", "POST", params, false))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await versions.POST(request("/api/hermes-artifacts/versions", "POST", { ...params, artifact_id: "forged", path: "/etc/passwd" }))).status, 400);
    const saved = await (await versions.POST(request("/api/hermes-artifacts/versions", "POST", params))).json();
    assert.match(saved.id, /^[a-f0-9]{64}$/);
    assert.equal((await (await versions.GET(request(`/api/hermes-artifacts/versions?${query}`))).json()).versions.length, 1);
    const download = await versions.GET(request(`/api/hermes-artifacts/versions?${query}&version=${saved.id}`));
    assert.equal(await download.text(), "Original bytes");
    assert.equal(download.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(download.headers.get("Content-Disposition"), /^attachment/);
    assert.equal((await versions.DELETE(request("/api/hermes-artifacts/versions", "DELETE", { ...params, version: saved.id }))).status, 200);
    assert.equal(calls.every(call => !call.method || call.method === "GET"), true);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of Object.entries({ PI_WEB_PASSWORD: previous.password, HERMES_DASHBOARD_SESSION_TOKEN: previous.token, HERMES_WEB_DATA_DIR: previous.dir })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
