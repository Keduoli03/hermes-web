import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const originalUsername = process.env.PI_WEB_USERNAME;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, DELETE } = await jiti.import("./route.ts");
const { proxy } = await jiti.import("../../../proxy.ts");
const { recordAuthSuccess } = await import("../../../lib/auth-throttle.ts");

before(() => { process.env.PI_WEB_PASSWORD = "correct horse battery staple"; });
beforeEach(() => { delete process.env.PI_WEB_USERNAME; recordAuthSuccess(); });
after(() => {
  recordAuthSuccess();
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
  if (originalUsername === undefined) delete process.env.PI_WEB_USERNAME; else process.env.PI_WEB_USERNAME = originalUsername;
});

test("configured admin username is required and never disclosed before login", async () => {
  process.env.PI_WEB_USERNAME = "site-admin";
  const initial = await (await GET(request("GET"))).json();
  assert.equal(initial.usernameRequired, true);
  assert.equal(JSON.stringify(initial).includes("site-admin"), false);
  assert.equal((await POST(request("POST", { username: "wrong", password: "correct horse battery staple" }))).status, 401);
  recordAuthSuccess();
  assert.equal((await POST(request("POST", { password: "correct horse battery staple" }))).status, 401);
  recordAuthSuccess();
  const response = await POST(request("POST", { username: "site-admin", password: "correct horse battery staple" }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await GET(request("GET", undefined, { Cookie: cookie }))).json()).authenticated, true);
  process.env.PI_WEB_USERNAME = "another-admin";
  assert.equal((await (await GET(request("GET", undefined, { Cookie: cookie }))).json()).authenticated, false);
});

test("public reverse-proxy requests require login setup even with an internal loopback URL", async () => {
  const password=process.env.PI_WEB_PASSWORD,hosts=process.env.PI_WEB_ALLOWED_HOSTS,oauth=process.env.HERMES_WEB_OAUTH_CLIENT_ID;
  try {
    process.env.PI_WEB_PASSWORD=""; process.env.PI_WEB_ALLOWED_HOSTS="panel.test"; delete process.env.HERMES_WEB_OAUTH_CLIENT_ID;
    const headers={Host:"panel.test",Origin:"https://panel.test","x-forwarded-proto":"https","sec-fetch-site":"same-origin"};
    const page=new NextRequest("http://127.0.0.1:30141/",{headers});
    assert.equal(proxy(page).headers.get("location"),"https://panel.test/login");
    assert.equal(proxy(new NextRequest("http://127.0.0.1:30141/api/hermes/api/config",{headers})).status,401);
    const status=await (await GET(new NextRequest("http://127.0.0.1:30141/api/web-auth",{headers}))).json();
    assert.equal(status.authenticated,false); assert.equal(status.setupRequired,true);
  } finally {
    process.env.PI_WEB_PASSWORD=password;
    if(hosts===undefined)delete process.env.PI_WEB_ALLOWED_HOSTS;else process.env.PI_WEB_ALLOWED_HOSTS=hosts;
    if(oauth===undefined)delete process.env.HERMES_WEB_OAUTH_CLIENT_ID;else process.env.HERMES_WEB_OAUTH_CLIENT_ID=oauth;
  }
});

function request(method, body, headers = {}) {
  return new NextRequest("http://localhost/api/web-auth", {
    method,
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("logs in with one password and reports the signed session", async () => {
  let response = await POST(request("POST", { password: "wrong" }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.get("retry-after"), "1");

  recordAuthSuccess();
  response = await POST(request("POST", { password: "correct horse battery staple" }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^pi_web_session=v1\./);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);

  const cookiePair = cookie.split(";", 1)[0];
  response = await GET(request("GET", undefined, { Cookie: cookiePair }));
  assert.deepEqual(await response.json(), { enabled: true, authenticated: true, passwordEnabled: true, official: {enabled:false,ready:false}, account:null });
});

test("blocks further attempts after a failure, even with the right password", async () => {
  let response = await POST(request("POST", { password: "wrong" }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid password", retryAfterMs: 1000 });

  response = await POST(request("POST", { password: "correct horse battery staple" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);
  const body = await response.json();
  assert.equal(body.error, "Too many failed attempts");
  assert.ok(body.retryAfterMs > 0 && body.retryAfterMs <= 1000);
});

test("logout clears the session cookie", async () => {
  const response = await DELETE(request("DELETE"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /pi_web_session=;/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
});

test("rejects cross-origin login attempts", async () => {
  const response = await POST(request(
    "POST",
    { password: "correct horse battery staple" },
    { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  ));
  assert.equal(response.status, 403);
});
