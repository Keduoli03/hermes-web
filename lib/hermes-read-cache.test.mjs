import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHermesReadCache } from "./hermes-read-cache.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "hermes-metadata-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = 1000000;
  return { directory, now: () => clock, advance: ms => { clock += ms; }, cache: createHermesReadCache({ directory, now: () => clock }) };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("real Fetch responses with immutable headers can populate metadata snapshots", async t => {
  const f = await fixture(t);
  const upstream = await fetch('data:application/json,{"model":"real-fetch"}');
  assert.throws(() => upstream.headers.set("X-Test", "immutable"), /immutable/);
  const response = await f.cache.read("scope", "/api/model/options", async () => upstream);
  assert.equal(response.headers.get("X-Hermes-Cache"), "MISS");
  assert.deepEqual(await response.json(), { model: "real-fetch" });
  assert.equal((await f.cache.read("scope", "/api/model/options", () => assert.fail("must hit"))).headers.get("X-Hermes-Cache"), "HIT");
});

test("metadata cache deduplicates cold reads, restores from disk and isolates backend credentials/profile/query", async t => {
  const f = await fixture(t), gate = deferred(); let calls = 0;
  const load = async () => { calls++; await gate.promise; return Response.json({ models: ["one"] }); };
  const first = f.cache.read("backend-A-token", "/api/model/options?explicit_only=1&profile=one", load);
  const second = f.cache.read("backend-A-token", "/api/model/options?profile=one&explicit_only=1", load);
  gate.resolve();
  assert.deepEqual(await (await first).json(), await (await second).json());assert.equal(calls, 1);
  const restarted = createHermesReadCache(f);
  assert.equal((await restarted.read("backend-A-token", "/api/model/options?explicit_only=1&profile=one", load)).headers.get("X-Hermes-Cache"), "HIT");
  await restarted.read("backend-B-token", "/api/model/options?explicit_only=1&profile=one", load);
  await restarted.read("backend-A-token", "/api/model/options?explicit_only=1&profile=two", load);
  await restarted.read("backend-A-token", "/api/model/options?include_unconfigured=1&profile=one", load);
  assert.equal(calls, 4);
  assert.ok(!(await readdir(f.directory)).some(path => path.includes("token")));
});

test("stale reads return immediately, share background revalidation and retain snapshot after upstream failure", async t => {
  const f = await fixture(t);
  await f.cache.read("scope", "/api/model/options", async () => Response.json({ model: "old" }));
  f.advance(61000); const gate = deferred(); let calls = 0;
  const load = async () => { calls++; await gate.promise; return Response.json({ model: "new" }); };
  const stale = await f.cache.read("scope", "/api/model/options", load);
  assert.equal(stale.headers.get("X-Hermes-Cache"), "STALE");assert.equal((await stale.json()).model, "old");
  await f.cache.read("scope", "/api/model/options", load);assert.equal(calls, 1);
  gate.resolve();
  for (let i = 0; i < 100; i++) {
    if ((await (await f.cache.read("scope", "/api/model/options", load)).json()).model === "new") break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal((await (await f.cache.read("scope", "/api/model/options", load)).json()).model, "new");
  const failed = await f.cache.read("scope", "/api/model/options?refresh=1", async () => Response.json({ error: "down" }, { status: 503 }));
  assert.equal(failed.status, 503);
  assert.equal((await (await f.cache.read("scope", "/api/model/options", load)).json()).model, "new");
});

test("mutation invalidation survives restart and blocks old in-flight results from repopulating cache", async t => {
  const f = await fixture(t), gate = deferred();let calls = 0;
  const pending = f.cache.read("scope", "/api/config/schema", async () => { await gate.promise; return Response.json({ value: "old" }); });
  await new Promise(resolve => setTimeout(resolve, 20));
  await f.cache.invalidate("scope");gate.resolve();await pending;
  const restarted = createHermesReadCache(f);
  const fresh = await restarted.read("scope", "/api/config/schema", async () => { calls++;return Response.json({ value: "new" }); });
  assert.equal((await fresh.json()).value, "new");assert.equal(calls, 1);
});

test("manual refresh replaces the normal snapshot without older reads winning the race", async t => {
  const f = await fixture(t), gate = deferred();
  const pending = f.cache.read("scope", "/api/model/options", async () => { await gate.promise;return Response.json({ model: "old" }); });
  await new Promise(resolve => setTimeout(resolve, 20));
  const fresh = await f.cache.read("scope", "/api/model/options?refresh=1", async () => Response.json({ model: "new" }));
  assert.equal(fresh.headers.get("X-Hermes-Cache"), "REFRESH");gate.resolve();await pending;
  assert.equal((await (await f.cache.read("scope", "/api/model/options", () => assert.fail("must hit refreshed snapshot"))).json()).model, "new");
});

test("config values, credentials, auth, sessions and live state always bypass metadata cache", async t => {
  const f = await fixture(t);let calls = 0;
  for (const path of ["/api/config", "/api/config/raw", "/api/env", "/api/providers/oauth", "/api/sessions", "/api/status", "/api/cron/jobs"]) {
    const load = async cached => { assert.equal(cached, false); calls++;return Response.json({ value: calls }); };
    await f.cache.read("scope", path, load);await f.cache.read("scope", path, load);
  }
  assert.equal(calls, 14);assert.deepEqual(await readdir(f.directory), []);
});

test("saved discovery metadata persists across browsers/restarts and is bound to URL, protocol and profile", async t => {
  const f = await fixture(t), endpoint = { id: "custom", base_url: "https://fixture.test/v1", model: "saved", models: ["saved"], api_mode: "chat_completions" };
  await f.cache.rememberDiscovery("scope", "current", endpoint, ["discovered"]);
  const restarted = createHermesReadCache(f);
  const read = async (row, profile = "current") => (await (await restarted.augmentEndpoints("scope", profile, Response.json({ endpoints: [row] }))).json()).endpoints[0].models;
  assert.deepEqual(await read(endpoint), ["saved", "discovered"]);
  assert.deepEqual(await read({ ...endpoint, base_url: "https://other.test/v1" }), ["saved"]);
  assert.deepEqual(await read({ ...endpoint, api_mode: "codex_responses" }), ["saved"]);
  assert.deepEqual(await read(endpoint, "work"), ["saved"]);
  await restarted.invalidate("scope", { preserveDiscovery: true });
  assert.deepEqual(await read(endpoint), ["saved", "discovered"], "Changing the default model retains discovered catalogs");
  await restarted.invalidate("scope");assert.deepEqual(await read(endpoint), ["saved"]);
  const oldRevision = await restarted.discoveryRevision("scope");
  await restarted.invalidate("scope");
  await restarted.rememberDiscovery("scope", "current", endpoint, ["stale-after-key-change"], oldRevision);
  assert.deepEqual(await read(endpoint), ["saved"]);
  const dirs = await readdir(f.directory);
  for (const file of await readdir(join(f.directory, dirs[0]))) if (file.endsWith(".json")) assert.ok(!(await readFile(join(f.directory, dirs[0], file), "utf8")).includes("api_key"));
});

test("unwritable cache paths and malformed snapshots fall back to upstream; expired snapshots are not served", async t => {
  const f = await fixture(t);let calls = 0;
  const load = async () => { calls++;return Response.json({ value: calls }); };
  await f.cache.read("scope", "/api/model/options", load);
  const scope = (await readdir(f.directory))[0], file = (await readdir(join(f.directory, scope))).find(name => name.endsWith(".json"));
  await writeFile(join(f.directory, scope, file), "broken");
  assert.equal((await createHermesReadCache(f).read("scope", "/api/model/options", load)).headers.get("X-Hermes-Cache"), "MISS");
  f.advance(3600001);
  assert.equal((await f.cache.read("scope", "/api/model/options", load)).headers.get("X-Hermes-Cache"), "MISS");
  const blocker = join(f.directory, "not-a-directory");await writeFile(blocker, "fixture");
  const unavailable = createHermesReadCache({ directory: blocker });
  assert.equal((await unavailable.read("scope", "/api/config/schema", load)).status, 200);
  await assert.doesNotReject(unavailable.invalidate("scope"));
  assert.equal((await unavailable.read("scope", "/api/config/schema", load)).status, 200);
});
