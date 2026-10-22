import "./__fixtures__/web-auth-env.mjs";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import { authenticateWebRequest, webRequestDenied } from "./web-request-auth.mjs";
import { createWebSessionToken, revokeWebSessionToken } from "./web-auth.ts";
import { recordAuthSuccess } from "./auth-throttle.ts";
import { proxyHermesApiRequest } from "./hermes-api-proxy.mjs";

const names = ["PI_WEB_PASSWORD", "PI_WEB_USERNAME", "PI_WEB_ALLOWED_HOSTS", "HERMES_DASHBOARD_SESSION_TOKEN", "HERMES_WEB_OAUTH_CLIENT_ID"];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { proxy } = await jiti.import("../proxy.ts");
const { projectRequestDenied } = await jiti.import("./hermes-project-request.ts");
beforeEach(() => {
  process.env.PI_WEB_PASSWORD = "fixture-auth-password";
  process.env.HERMES_DASHBOARD_SESSION_TOKEN = "fixture-dashboard-secret";
  delete process.env.PI_WEB_USERNAME;
  delete process.env.HERMES_WEB_OAUTH_CLIENT_ID;
  recordAuthSuccess();
});
after(() => {
  recordAuthSuccess();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
const basic = password => `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
const request = headers => new NextRequest("http://localhost/api/hermes/api/config", { headers: { Host: "localhost", ...headers } });

test("Basic authentication has the same result at the entrance, project guard and management proxy", async () => {
  const req = request({ Authorization: basic(process.env.PI_WEB_PASSWORD) });
  assert.equal(proxy(req).status, 200);
  assert.equal(projectRequestDenied(req), null);
  const response = await proxyHermesApiRequest(req, ["api", "config"], async (_url, init) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.get("x-hermes-session-token"), "fixture-dashboard-secret");
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
});

test("route checks throttle Basic guesses even when called without the Next proxy", async () => {
  assert.equal(webRequestDenied(request({ Authorization: basic("wrong") })).status, 401);
  assert.equal(projectRequestDenied(request({ Authorization: basic(process.env.PI_WEB_PASSWORD) })).status, 429);
  assert.equal((await proxyHermesApiRequest(request({ Authorization: basic(process.env.PI_WEB_PASSWORD) }), ["api", "config"])).status, 429);
  const cookie = `pi_web_session=${createWebSessionToken(process.env.PI_WEB_PASSWORD)}`;
  assert.equal(webRequestDenied(request({ Cookie: cookie, Authorization: basic("wrong") })), null);
  assert.equal(webRequestDenied(request({ Cookie: cookie, Origin: "https://other.test", "sec-fetch-site": "cross-site" })).status, 403);
});

test("password sessions survive process restart and revocation is visible to another process", () => {
  const token = createWebSessionToken(process.env.PI_WEB_PASSWORD);
  const source = `import { isValidWebSessionToken } from ${JSON.stringify(new URL("./web-auth.ts", import.meta.url).href)}; process.stdout.write(String(isValidWebSessionToken(process.env.AUTH_TEST_TOKEN)));`;
  const verify = () => spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
    env: { ...process.env, AUTH_TEST_TOKEN: token }, encoding: "utf8", windowsHide: true,
  });
  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, "true");
  revokeWebSessionToken(token);
  assert.equal(verify().stdout, "false");
  assert.equal(authenticateWebRequest(request({ Cookie: `pi_web_session=${token}` })).authenticated, false);
});

test("password-free loopback development keeps the login page available without a redirect loop", () => {
  process.env.PI_WEB_PASSWORD = "";
  const req = new NextRequest("http://localhost/login", { headers: { Host: "localhost" } });
  assert.equal(authenticateWebRequest(req, false).method, "development");
  assert.equal(proxy(req).status, 200);
});
