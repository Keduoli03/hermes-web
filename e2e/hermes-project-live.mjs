// Read-only live probe: config.get project does not create a session or prompt.
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { createWebSessionToken } from "../lib/web-auth.ts";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const origin = process.env.HERMES_TEST_URL ?? "http://127.0.0.1:30142";
const response = await fetch(`${origin}/api/hermes-session/project`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: `pi_web_session=${createWebSessionToken(process.env.PI_WEB_PASSWORD)}` },
  body: JSON.stringify({ cwd: process.cwd() }),
});
const data = await response.json();
assert.equal(response.status, 200, data.error || "Project validation failed");
assert.equal(data.cwd.toLowerCase(), process.cwd().toLowerCase());
assert.equal(typeof data.branch, "string");
console.log("Live project directory confirmed by Hermes; no session created and no inference sent.");

// A nonexistent cwd makes this an admission-only check: native chat cannot start.
for (const provider of ["custom:api", "custom:fun-codex", "custom:自建api"]) {
  const check = await fetch(`${origin}/api/hermes-session/chat`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: `pi_web_session=${createWebSessionToken(process.env.PI_WEB_PASSWORD)}` },
    body: JSON.stringify({ cwd: join(tmpdir(), `hermes-admission-${randomUUID()}`), text: "Admission check only", model: "gpt-5.6-luna", provider, thinking: "auto" }),
  });
  const result = await check.json();
  assert.equal(result.error, "项目文件夹不存在或无法访问。", "valid custom provider must reach cwd validation without creating a session");
}
console.log("Live route accepts official custom provider identities; stopped at nonexistent-folder validation, no inference sent.");
