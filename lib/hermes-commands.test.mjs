import test from "node:test";
import assert from "node:assert/strict";
import { runHermesCommand, HERMES_COMMANDS } from "./hermes-commands.ts";

const actions = (calls, overrides = {}) => ({
  busy: false, hasSession: true,
  compact: async () => { calls.push("compact"); return true; },
  rename: async title => { calls.push(["name", title]); },
  copy: async () => { calls.push("copy"); }, info: () => { calls.push("session"); }, ...overrides,
});
test("Hermes commands dispatch local operations and never turn unsupported Pi commands into prompts", async () => {
  const calls = [], api = actions(calls);
  for (const command of ["/compact", "/name A new title", "/copy", "/session"]) assert.deepEqual(await runHermesCommand(command, api), { handled: true });
  assert.deepEqual(calls, ["compact", ["name", "A new title"], "copy", "session"]);
  for (const command of ["/reload", "/clone", "/auto-compact", "/unimplemented"]) {
    const result = await runHermesCommand(command, api);
    assert.equal(result.handled, true); assert.ok(result.error);
  }
  assert.equal(calls.length, 4);
  assert.deepEqual(await runHermesCommand("/tmp/example.txt please inspect", api), { handled: false });
  assert.equal(HERMES_COMMANDS.some(command => command.name === "reload"), false);
});
test("invalid arguments, missing sessions, busy operations and failed effects retain command input", async () => {
  const calls = [];
  for (const [command, options] of [["/compact focus", {}], ["/name", {}], ["/name "+"x".repeat(201), {}], ["/compact", {busy:true}], ["/session", {hasSession:false}]]) {
    assert.ok((await runHermesCommand(command, actions(calls, options))).error);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await runHermesCommand("/copy", actions(calls, {busy:true})), {handled:true});
  assert.ok((await runHermesCommand("/compact", actions(calls, {compact:async()=>false}))).error);
  assert.equal((await runHermesCommand("/name New", actions(calls, {rename:async()=>{throw new Error("save failed");}}))).error, "save failed");
});
