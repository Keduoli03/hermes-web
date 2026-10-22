import test from "node:test";
import "./__fixtures__/web-auth-env.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfficialSession,revokeOfficialSession } from "./web-oauth-store.mjs";
import { resolveHermesConnection, invalidateHermesConnection, fetchConnectedHermes, HermesConnectionError } from "./hermes-connection.mjs";
import { proxyHermesApiRequest } from "./hermes-api-proxy.mjs";
import { createWebSessionToken } from "./web-auth.ts";

async function fixture(action) {
  const names = ["HERMES_DASHBOARD_URL", "HERMES_DASHBOARD_SESSION_TOKEN", "PI_WEB_PASSWORD", "PI_WEB_ALLOWED_HOSTS"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let current = "automatic-local-token-one", handshakes = 0, writes = 0, gated = false;
  const calls = [];
  const server = createServer(async (req, res) => {
    calls.push({ path: req.url, headers: req.headers });
    if (req.url === "/") { handshakes++; if(gated){res.statusCode=302;res.setHeader("Location","https://portal.nousresearch.com/login?private=fixture-secret");res.end();return;}res.setHeader("Content-Type", "text/html"); res.end(`<script>window.__HERMES_SESSION_TOKEN__=${JSON.stringify(current)};</script>`); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-hermes-session-token"] !== current) { res.statusCode = 401; res.end('{"error":"Unauthorized"}'); return; }
    if (req.method === "PUT") writes++;
    res.end(JSON.stringify(req.url === "/api/config/schema" ? { fields: {} } : { ok: true }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.HERMES_DASHBOARD_URL = origin; delete process.env.HERMES_DASHBOARD_SESSION_TOKEN;
  process.env.PI_WEB_PASSWORD = "fixture-web-password"; process.env.PI_WEB_ALLOWED_HOSTS = "panel.test";
  invalidateHermesConnection();
  try { await action({ origin, calls, gate:()=>{gated=true;}, rotate: () => { current = "automatic-local-token-two"; }, stats: () => ({ handshakes, writes }) }); }
  finally { invalidateHermesConnection(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}
function request(authenticated, method = "GET") {
  return new Request("https://panel.test/api/hermes/api/config", { method, headers: { Host: "panel.test", Origin: "https://panel.test", ...(authenticated ? { Cookie: `pi_web_session=${typeof authenticated === "string" ? authenticated : createWebSessionToken("fixture-web-password")}` } : {}), ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) }, ...(method === "PUT" ? { body: '{"config":{"agent":{"max_turns":10}}}' } : {}) });
}
test("authenticated management connects through the official local handshake without manual credentials", async () => fixture(async f => {
  assert.equal((await proxyHermesApiRequest(request(false), ["api", "config"])).status, 401);
  assert.equal(f.calls.length, 0, "login must precede backend discovery");
  const responses = await Promise.all(Array.from({ length: 4 }, () => proxyHermesApiRequest(request(true), ["api", "config"])));
  for (const response of responses) { assert.equal(response.status, 200); assert.equal((await response.json()).ok, true); assert.equal(response.headers.has("X-Hermes-Session-Token"), false); }
  assert.equal(f.stats().handshakes, 1);
  assert.equal(f.calls[0].headers.cookie, undefined);
  assert.equal(f.calls[0].headers.authorization, undefined);
  assert.equal(JSON.stringify(await (await proxyHermesApiRequest(request(true), ["api", "config"])).json()).includes("automatic-local-token"), false);
}));
test("backend token rotation triggers one fresh handshake and only one successful mutation", async () => fixture(async f => {
  await resolveHermesConnection(); f.rotate();
  const response = await proxyHermesApiRequest(request(true, "PUT"), ["api", "config"]);
  assert.equal(response.status, 200);
  assert.deepEqual(f.stats(), { handshakes: 2, writes: 1 });
  assert.equal(f.calls.at(-1).headers["x-hermes-session-token"], "automatic-local-token-two");
}));
test("verified official account sessions use the same automatic connection and logout closes access",async()=>fixture(async f=>{
  const names=["HERMES_WEB_DATA_DIR","HERMES_WEB_OAUTH_CLIENT_ID","HERMES_WEB_OAUTH_ALLOWED_USERS"],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const dir=await mkdtemp(join(tmpdir(),"hermes-official-connect-"));
  try {
    process.env.HERMES_WEB_DATA_DIR=dir;process.env.HERMES_WEB_OAUTH_CLIENT_ID="agent:fixture";process.env.HERMES_WEB_OAUTH_ALLOWED_USERS="fixture-owner";
    const session=createOfficialSession({userId:"fixture-owner",clientId:"agent:fixture",expiresAt:Date.now()+60000});
    assert.equal((await proxyHermesApiRequest(request(session),["api","config"])).status,200);
    assert.equal(f.stats().handshakes,1);revokeOfficialSession(session);
    assert.equal((await proxyHermesApiRequest(request(session),["api","config"])).status,401);
  } finally {for(const[name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}await rm(dir,{recursive:true,force:true});}
}));
test("automatic discovery refuses remote origins, redirects, executable script values and oversized pages", async () => fixture(async () => {
  process.env.HERMES_DASHBOARD_URL = "https://remote.test";
  let calls = 0;
  await assert.rejects(resolveHermesConnection({ fetchImpl: async () => { calls++; return Response.json({}); } }), /远程/);
  assert.equal(calls, 0);
  process.env.HERMES_DASHBOARD_URL = "http://127.0.0.1:8648";
  for (const html of ['<script>window.__HERMES_SESSION_TOKEN__=getSecret()</script>', "x".repeat(2 * 1024 * 1024 + 1)]) {
    invalidateHermesConnection();
    await assert.rejects(resolveHermesConnection({ fetchImpl: async (_url, options) => { assert.equal(options.redirect, "manual"); return new Response(html, { headers: { "Content-Type": "text/html" } }); } }), /无法自动连接/);
  }
  invalidateHermesConnection();
  await assert.rejects(resolveHermesConnection({ fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://remote.test" } }) }), /无法自动连接/);
}));
test("public Dashboard login redirects are diagnosed without following or disclosing the login URL",async()=>fixture(async f=>{
  f.gate();
  const isRedirect=error=>error instanceof HermesConnectionError && error.code==="dashboard_redirect" && error.message.includes("私有 Dashboard") && !/portal\.nousresearch|fixture-secret/.test(error.message);
  await assert.rejects(resolveHermesConnection(),isRedirect);
  await assert.rejects(resolveHermesConnection(),isRedirect);
  assert.equal(f.calls.length,1,"failure cache must preserve the diagnostic without reconnecting");
  assert.equal(f.calls[0].headers.cookie,undefined);
  assert.equal(f.calls[0].headers.authorization,undefined);
}));
test("missing handshake and network failure have distinct safe diagnostics",async()=>fixture(async()=>{
  await assert.rejects(resolveHermesConnection({fetchImpl:async()=>new Response("<html>Sign in</html>",{headers:{"Content-Type":"text/html"}})}),error=>error.code==="handshake_unavailable");
  invalidateHermesConnection();
  await assert.rejects(resolveHermesConnection({fetchImpl:async()=>{throw new Error("secret upstream URL or credentials");}}),error=>error.code==="dashboard_unreachable" && !error.message.includes("secret"));
}));
test("explicit credentials remain authoritative on refresh and rejection does not fall back to scraping",async()=>fixture(async f=>{
  process.env.HERMES_DASHBOARD_SESSION_TOKEN="operator-configured-token";
  const result=await resolveHermesConnection({refresh:true,fetchImpl:async()=>{throw new Error("must not discover");}});
  assert.equal(result.token,"operator-configured-token");
  const response=await fetchConnectedHermes("/api/config/schema");
  assert.equal(response.status,401);await response.body.cancel();
  assert.equal(f.stats().handshakes,0);assert.equal(f.calls.length,1);
}));
test("management redirects are rejected with no credential forwarding to another origin",async()=>fixture(async()=>{
  process.env.HERMES_DASHBOARD_SESSION_TOKEN="operator-configured-token";
  let calls=0;
  await assert.rejects(fetchConnectedHermes("/api/config/schema",{fetchImpl:async(_url,options)=>{
    calls++;assert.equal(options.redirect,"manual");
    return new Response(null,{status:302,headers:{Location:"https://other.test/private"}});
  }}),error=>error.code==="dashboard_redirect");
  assert.equal(calls,1);
}));
test("explicit credentials remain supported, cannot escape the origin and retry resets failed discovery", async () => fixture(async () => {
  process.env.HERMES_DASHBOARD_SESSION_TOKEN = "explicit-server-token";
  const resolved = await resolveHermesConnection({ fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(resolved.token, "explicit-server-token");
  await assert.rejects(fetchConnectedHermes("https://other.test/api/config"), /Invalid/);
  delete process.env.HERMES_DASHBOARD_SESSION_TOKEN; invalidateHermesConnection();
  let attempts = 0;
  const failing = async () => { attempts++; throw new Error("private backend details"); };
  await assert.rejects(resolveHermesConnection({ fetchImpl: failing }), error => !error.message.includes("private"));
  await assert.rejects(resolveHermesConnection({ fetchImpl: failing }));
  assert.equal(attempts, 1);
  invalidateHermesConnection(); await resolveHermesConnection();
}));
