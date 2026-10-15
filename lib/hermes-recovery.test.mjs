import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { retainHermesRun, attachHermesRun, listHermesRuns, resolveHermesRunRequest } from "./hermes-run-store.mjs";
import { readHermesRun } from "./hermes-run-stream.ts";
import { fromHermesProjectPath, toHermesProjectPath, mapHermesProjectReferences } from "./hermes-project-paths.ts";
import { saveArtifactVersion, readArtifactVersion, listArtifactVersions, artifactVersionKey } from "./hermes-artifact-versions.ts";
import { createOfficialSession, revokeOfficialSession, storeLoginFlow } from "./web-oauth-store.mjs";

test("disconnecting the browser does not cancel the producer; cursor replay and snapshots converge", async () => {
  let producer, cancelled = false;
  const stream = new ReadableStream({ start(controller) { producer = controller; }, cancel() { cancelled = true; } });
  const send = data => producer.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  send({ event: "run.started", run_id: "recovery-test", session_id: "stored-test" });
  const id = await retainHermesRun(stream);
  const browser = attachHermesRun(id).getReader();
  await browser.read(); await browser.cancel();
  assert.equal(cancelled, false);
  send({ event: "message.delta", delta: "Hello " });
  send({ event: "clarify.request", clarify: { request_id: "q1", question: "Choose" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listHermesRuns().find(run => run.run_id === id).clarify.request_id, "q1");
  resolveHermesRunRequest(id, "q1");
  send({ event: "message.delta", delta: "again" });
  send({ event: "run.completed", output: "Hello again" }); producer.close();
  await new Promise(resolve => setImmediate(resolve));
  const replay = await new Response(attachHermesRun(id, 1)).text();
  assert.match(replay, /Hello /); assert.match(replay, /run.completed/);
  const snapshot = await new Response(attachHermesRun(id)).text();
  assert.match(snapshot, /Hello again/); assert.match(snapshot, /"clarify":null/);
  assert.equal(attachHermesRun("missing"), null);
});

test("client reconnect deduplicates replay, preserves cursor and handles terminal snapshots", async () => {
  const events = [], cursors = [];
  await readHermesRun(new Response('id: 1\ndata: {"event":"message.delta","delta":"A"}\n\n'), new AbortController().signal, async cursor => {
    cursors.push(cursor);
    return new Response('id: 1\ndata: {"event":"message.delta","delta":"A"}\n\nid: 2\ndata: {"event":"run.completed","output":"AB"}\n\n');
  }, event => events.push(event), () => {});
  assert.deepEqual(cursors, ["1"]);
  assert.deepEqual(events.map(event => event.event), ["message.delta", "run.completed"]);
  await readHermesRun(new Response('id: 3\ndata: {"event":"run.snapshot","status":"run.completed","text":"Done"}\n\n'), new AbortController().signal, () => { throw new Error("must not reconnect"); }, () => {}, () => {});
});

test("directory mappings translate Windows/local paths at boundaries and reject escapes", () => {
  const previous = process.env.HERMES_PROJECT_PATH_MAP;
  const local = resolve("mapped-workspace"), nested = join(local, "nested");
  try {
    process.env.HERMES_PROJECT_PATH_MAP = JSON.stringify([{ local, remote: "/srv/work" }, { local: nested, remote: "/srv/special" }]);
    assert.equal(toHermesProjectPath(join(local, "one")), "/srv/work/one");
    assert.equal(toHermesProjectPath(join(nested, "two")), "/srv/special/two");
    assert.equal(fromHermesProjectPath("/srv/work/one"), join(local, "one"));
    assert.equal(mapHermesProjectReferences(`@${local}/a.txt ${local}-other`, local), `@/srv/work/a.txt ${local}-other`);
    assert.throws(() => fromHermesProjectPath("/srv/work/../../etc"));
    assert.throws(() => fromHermesProjectPath("/srv/work-other"));
    assert.throws(() => toHermesProjectPath(resolve("outside")));
    process.env.HERMES_PROJECT_PATH_MAP = "{}"; assert.throws(() => toHermesProjectPath(local));
  } finally { if (previous === undefined) delete process.env.HERMES_PROJECT_PATH_MAP; else process.env.HERMES_PROJECT_PATH_MAP = previous; }
});

test("official sessions survive process restart; revocation and one-use flows work across processes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-auth-durable-"));
  const previous = process.env.HERMES_WEB_DATA_DIR;
  process.env.HERMES_WEB_DATA_DIR = dir;
  const session = { userId: "test-user", clientId: "agent:test", expiresAt: Date.now() + 60000 };
  const token = createOfficialSession(session);
  const flow = storeLoginFlow({ state: "test", verifier: "private", origin: "http://localhost", destination: "/", clientId: "agent:test", expiresAt: Date.now() + 60000 });
  const child = code => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, HERMES_WEB_OAUTH_CLIENT_ID: "agent:test", HERMES_WEB_OAUTH_ALLOWED_USERS: "test-user" } });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  try {
    assert.equal(child(`import {officialSession} from './lib/web-oauth-store.mjs'; process.stdout.write(JSON.stringify(Boolean(officialSession(${JSON.stringify(token)}))));`), true);
    assert.equal(child(`import {takeLoginFlow} from './lib/web-oauth-store.mjs'; process.stdout.write(JSON.stringify(Boolean(takeLoginFlow(${JSON.stringify(flow)}))));`), true);
    assert.equal(child(`import {takeLoginFlow} from './lib/web-oauth-store.mjs'; process.stdout.write(JSON.stringify(Boolean(takeLoginFlow(${JSON.stringify(flow)}))));`), false);
    revokeOfficialSession(token);
    assert.equal(child(`import {officialSession} from './lib/web-oauth-store.mjs'; process.stdout.write(JSON.stringify(Boolean(officialSession(${JSON.stringify(token)}))));`), false);
  } finally { if (previous === undefined) delete process.env.HERMES_WEB_DATA_DIR; else process.env.HERMES_WEB_DATA_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});

test("artifact versions preserve bytes independently of the source, deduplicate content and isolate backends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hermes-versions-")), previous = process.env.HERMES_WEB_DATA_DIR;
  process.env.HERMES_WEB_DATA_DIR = dir;
  const artifact = { sessionId: "one", kind: "file", source: "/workspace/a.txt", title: "a.txt" };
  const key = artifactVersionKey("backend-one", artifact);
  try {
    const first = await saveArtifactVersion(key, new TextEncoder().encode("v1"), "a.txt", "text/plain");
    const second = await saveArtifactVersion(key, new TextEncoder().encode("v2"), "a.txt", "text/plain");
    assert.notEqual(first.id, second.id);
    assert.equal((await saveArtifactVersion(key, new TextEncoder().encode("v1"), "a.txt", "text/plain")).id, first.id);
    assert.equal((await listArtifactVersions(key)).length, 2);
    assert.equal((await readArtifactVersion(key, first.id)).bytes.toString(), "v1");
    assert.equal((await listArtifactVersions(artifactVersionKey("backend-two", artifact))).length, 0);
    await assert.rejects(readArtifactVersion(key, "../escape"));
  } finally { if (previous === undefined) delete process.env.HERMES_WEB_DATA_DIR; else process.env.HERMES_WEB_DATA_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
