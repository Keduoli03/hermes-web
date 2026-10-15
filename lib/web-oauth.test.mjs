import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, SignJWT } from "jose";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";
import { createOfficialSession, officialSession, revokeOfficialSession, storeLoginFlow } from "./web-oauth-store.mjs";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { startOfficialLogin, completeOfficialLogin, verifyOfficialToken, officialLoginConfig, OAUTH_FLOW_COOKIE } = await jiti.import("./web-oauth.ts");
const { isValidWebSessionToken, isWebAuthEnabled } = await jiti.import("./web-auth.ts");
const { proxy } = await jiti.import("../proxy.ts");
const authRoute = await jiti.import("../app/api/web-auth/route.ts");
const startRoute = await jiti.import("../app/api/web-auth/official/start/route.ts");
const callbackRoute = await jiti.import("../app/api/web-auth/official/callback/route.ts");
const { proxyHermesApiRequest } = await import("./hermes-api-proxy.mjs");
const { projectRequestDenied } = await jiti.import("./hermes-project-request.ts");
const { publicKey, privateKey } = await generateKeyPair("RS256");
const getKey = async () => publicKey;
const envNames = ["HERMES_WEB_DATA_DIR", "HERMES_WEB_OAUTH_CLIENT_ID", "HERMES_WEB_PUBLIC_URL", "HERMES_WEB_OAUTH_ALLOWED_USERS", "PI_WEB_PASSWORD", "PI_WEB_ALLOWED_HOSTS"];
const original = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const authDirectory = mkdtempSync(join(tmpdir(), "hermes-auth-test-"));
beforeEach(() => {
  process.env.HERMES_WEB_DATA_DIR = authDirectory;
  process.env.HERMES_WEB_OAUTH_CLIENT_ID = "agent:fixture-instance";
  process.env.HERMES_WEB_PUBLIC_URL = "http://localhost";
  process.env.HERMES_WEB_OAUTH_ALLOWED_USERS = "fixture-owner";
  process.env.PI_WEB_PASSWORD = "";
  process.env.PI_WEB_ALLOWED_HOSTS = "panel.example";
});
after(() => { for (const name of envNames) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } rmSync(authDirectory, { recursive: true, force: true }); });

const now = () => Math.floor(Date.now() / 1000);
async function jwt(overrides = {}, key = privateKey) {
  return new SignJWT({ sub: "fixture-owner", iss: "https://portal.nousresearch.com", aud: "agent:fixture-instance", iat: now(), exp: now() + 600, agent_instance_id: "fixture-instance", oauth_contract_version: 1, ...overrides }).setProtectedHeader({ alg: "RS256" }).sign(key);
}
function request(path, headers = {}, method = "GET") {
  return new NextRequest(`http://localhost${path}`, { method, headers: { host: "localhost", ...headers } });
}
const stateOf = flow => new URL(flow.url).searchParams.get("state");

test("requires HTTPS remotely, exact origin configuration and a valid instance client", () => {
  assert.equal(officialLoginConfig().redirectUri, "http://localhost/api/web-auth/official/callback");
  for (const value of ["http://panel.example", "https://user:secret@panel.example", "https://panel.example/nested", "https://panel.example/?x=1", "https://panel.example/#x", "file:///tmp/test"]) {
    process.env.HERMES_WEB_PUBLIC_URL = value;
    assert.throws(() => officialLoginConfig(), value);
  }
  process.env.HERMES_WEB_PUBLIC_URL = "https://panel.example";
  assert.equal(officialLoginConfig().secure, true);
  process.env.HERMES_WEB_OAUTH_CLIENT_ID = "malformed";
  assert.throws(() => officialLoginConfig());
  assert.equal(isWebAuthEnabled(), true, "invalid config must not disable the gate");
  assert.equal(proxy(request("/api/files/test")).status, 401);
});

test("PKCE login exchanges code once, preserves local destination and issues an opaque session", async () => {
  const flow = startOfficialLogin("/?session=fixture");
  const other = startOfficialLogin("/");
  const url = new URL(flow.url);
  assert.equal(url.origin, "https://portal.nousresearch.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "agent_dashboard:access");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.notEqual(stateOf(flow), stateOf(other));
  const token = await jwt();
  let calls = 0;
  const fetchImpl = async (target, init) => {
    calls++;
    assert.equal(target, "https://portal.nousresearch.com/api/oauth/token");
    assert.equal(init.redirect, "error");
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("code"), "fixture-code");
    assert.equal(body.get("redirect_uri"), "http://localhost/api/web-auth/official/callback");
    assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), url.searchParams.get("code_challenge"));
    return Response.json({ access_token: token, token_type: "Bearer", refresh_token: "must-not-persist" });
  };
  const result = await completeOfficialLogin(flow.cookie, stateOf(flow), "fixture-code", fetchImpl, getKey);
  assert.match(result.token, /^nous\.[A-Za-z0-9_-]{43}$/);
  assert.equal(result.destination, "http://localhost/?session=fixture");
  assert.ok(result.maxAge > 0 && result.maxAge <= 600);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(officialSession(result.token)).includes("must-not-persist"), false);
  assert.equal(isValidWebSessionToken(result.token), true);
  await assert.rejects(completeOfficialLogin(flow.cookie, stateOf(flow), "fixture-code", fetchImpl, getKey));
  assert.equal(calls, 1);
  revokeOfficialSession(result.token);
  assert.equal(isValidWebSessionToken(result.token), false);
  const expires = Date.now() + 60_000;
  const expiring = createOfficialSession({userId:"fixture-owner",clientId:"agent:fixture-instance",expiresAt:expires});
  assert.equal(isValidWebSessionToken(expiring, undefined, expires), false);
});

test("missing cookies, mismatched state, expired flows and changed config never reach the token endpoint", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("must not fetch"); };
  const flow = startOfficialLogin("//evil.example");
  await assert.rejects(completeOfficialLogin(undefined, stateOf(flow), "code", fetchImpl, getKey));
  await assert.rejects(completeOfficialLogin(flow.cookie, "wrong", "code", fetchImpl, getKey));
  await assert.rejects(completeOfficialLogin(flow.cookie, stateOf(flow), "code", fetchImpl, getKey));
  const expired = storeLoginFlow({ state: "expired", verifier: "fixture", destination: "/", origin: "http://localhost", clientId: "agent:fixture-instance", expiresAt: Date.now() - 1 });
  await assert.rejects(completeOfficialLogin(expired, "expired", "code", fetchImpl, getKey));
  const changed = startOfficialLogin("/");
  process.env.HERMES_WEB_PUBLIC_URL = "https://panel.example";
  await assert.rejects(completeOfficialLogin(changed.cookie, stateOf(changed), "code", fetchImpl, getKey));
  assert.equal(calls, 0);
});

test("JWT verification rejects wrong issuer/audience/signature/expiry/subject and unauthorized accounts", async () => {
  for (const overrides of [
    { iss: "https://evil.example" }, { aud: "agent:other" }, { exp: now() - 1 },
    { sub: "" }, { sub: "another-user" }, { iat: now() + 3600 },
    { agent_instance_id: "other" }, { oauth_contract_version: 999 },
  ]) await assert.rejects(verifyOfficialToken(await jwt(overrides), "agent:fixture-instance", getKey), JSON.stringify(overrides));
  const impostor = await generateKeyPair("RS256");
  await assert.rejects(verifyOfficialToken(await jwt({}, impostor.privateKey), "agent:fixture-instance", getKey));
  const missingSubject = await new SignJWT({ iss: "https://portal.nousresearch.com", aud: "agent:fixture-instance", iat: now(), exp: now() + 60 }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
  await assert.rejects(verifyOfficialToken(missingSubject, "agent:fixture-instance", getKey));
  const forged = await new SignJWT({ sub: "fixture-owner" }).setProtectedHeader({alg:"HS256"}).sign(new Uint8Array(32));
  await assert.rejects(verifyOfficialToken(forged, "agent:fixture-instance", getKey));
});

test("official sessions gate APIs, expose only account identity and are revoked by logout", async () => {
  const session = await verifyOfficialToken(await jwt(), "agent:fixture-instance", getKey);
  const token = createOfficialSession(session);
  const headers = { cookie: `pi_web_session=${token}` };
  assert.equal(proxy(request("/api/files/test", headers)).status, 200);
  assert.equal(projectRequestDenied(request("/api/hermes-session/project", headers)), null);
  assert.equal(projectRequestDenied(request("/api/hermes-session/project")).status, 401);
  assert.equal((await proxyHermesApiRequest(request("/api/hermes/api/config"), ["api","config"])).status, 401);
  assert.equal((await proxyHermesApiRequest(request("/api/hermes/api/config", headers), [".."])).status, 400, "valid login passes authentication before path validation");
  const status = await (await authRoute.GET(request("/api/web-auth", headers))).json();
  assert.deepEqual(status, { enabled:true, authenticated:true, passwordEnabled:false, official:{enabled:true,ready:true}, account:"fixture-owner" });
  const logout = await authRoute.DELETE(request("/api/web-auth", headers, "DELETE"));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(isValidWebSessionToken(token), false);
  assert.equal(proxy(request("/api/files/test", headers)).status, 401);
});

test("allow-list and instance changes invalidate existing sessions; password remains independent", () => {
  const token = createOfficialSession({ userId:"fixture-owner", clientId:"agent:fixture-instance", expiresAt:Date.now()+60_000 });
  process.env.HERMES_WEB_OAUTH_ALLOWED_USERS = "someone-else";
  assert.equal(isValidWebSessionToken(token), false);
  process.env.PI_WEB_PASSWORD = "backup-password";
  const authorization = `Basic ${Buffer.from("pi:backup-password").toString("base64")}`;
  assert.equal(proxy(request("/api/files/test", {authorization})).status, 200);
  process.env.HERMES_WEB_OAUTH_ALLOWED_USERS = "fixture-owner";
  const token2 = createOfficialSession({ userId:"fixture-owner", clientId:"agent:fixture-instance", expiresAt:Date.now()+60_000 });
  process.env.HERMES_WEB_OAUTH_CLIENT_ID = "agent:another";
  assert.equal(isValidWebSessionToken(token2), false);
  assert.throws(() => createOfficialSession({ userId:"fixture-owner", clientId:"agent:another", expiresAt:Date.now()-1 }));
});

test("routes constrain callback exemption, origin, cookies, redirects and error details", async () => {
  assert.equal(proxy(request("/api/web-auth/official/callback?error=access_denied", {"sec-fetch-site":"cross-site"})).status, 200);
  assert.equal(proxy(request("/api/web-auth/official/unknown")).status, 401);
  assert.equal(proxy(request("/api/web-auth/official/start", {"sec-fetch-site":"cross-site"})).status, 403);
  const response = await startRoute.GET(request("/api/web-auth/official/start?next=%2F%2Fevil.example"));
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get("location")).origin, "https://portal.nousresearch.com");
  assert.match(response.headers.get("set-cookie"), new RegExp(`^${OAUTH_FLOW_COOKIE}=`));
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Lax/i);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const failure = await callbackRoute.GET(request("/api/web-auth/official/callback?error=sensitive-detail&error_description=private", {cookie,"sec-fetch-site":"cross-site"}));
  assert.equal(failure.status, 303);
  assert.equal(failure.headers.get("location"), "http://localhost/login?auth_error=official");
  assert.equal(failure.headers.get("referrer-policy"), "no-referrer");
  assert.match(failure.headers.get("set-cookie"), /Max-Age=0/);
  const foreign = await startRoute.GET(new NextRequest("https://panel.example/api/web-auth/official/start", {headers:{host:"panel.example"}}));
  assert.equal(foreign.status, 400);
});
