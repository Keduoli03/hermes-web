import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { indexedSessionArtifacts } from "./hermes-artifact-index.ts";

test("durable index reuses unchanged sessions, invalidates metadata, isolates backends and rebuilds corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hermes-index-"));
  let reads = 0;
  const session = { id: "one", title: "First", message_count: 2, last_active: 100 };
  const artifact = { id: "one:media:1", kind: "image", title: "image.png", sessionId: "one", sessionTitle: "First", language: "", content: "", source: "/tmp/image.png" };
  const load = async () => { reads++; return [artifact]; };
  const options = { directory, namespace: "backend-one", session, load, now: 1000 };
  try {
    assert.deepEqual(await indexedSessionArtifacts(options), [artifact]);
    assert.deepEqual(await indexedSessionArtifacts({ ...options, now: 2000 }), [artifact]);
    assert.equal(reads, 1, "disk survives requests without a transcript read");
    await indexedSessionArtifacts({ ...options, session: { ...session, last_active: 200 } });
    assert.equal(reads, 2);
    await indexedSessionArtifacts({ ...options, namespace: "backend-two" });
    assert.equal(reads, 3);
    await indexedSessionArtifacts({ ...options, force: true });
    assert.equal(reads, 4);
    const firstDir = join(directory, createHash("sha256").update("backend-one").digest("hex"));
    const files = await readdir(firstDir);
    await writeFile(join(firstDir, files[0]), "broken");
    await indexedSessionArtifacts(options);
    assert.equal(reads, 5);
    await indexedSessionArtifacts({ ...options, now: 86_401_001 });
    assert.equal(reads, 6, "TTL catches edits without metadata changes");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("parallel callers share indexing; failed refresh preserves the prior index; inline media is not persisted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hermes-index-"));
  let reads = 0;
  const options = { directory, namespace: "one", session: { id: "one", message_count: 1 }, now: 1000, load: async () => { reads++; await new Promise(resolve => setTimeout(resolve, 10)); return []; } };
  try {
    await Promise.all([indexedSessionArtifacts(options), indexedSessionArtifacts(options)]);
    assert.equal(reads, 1);
    await assert.rejects(indexedSessionArtifacts({ ...options, force: true, load: async () => { throw new Error("Unavailable"); } }));
    await indexedSessionArtifacts(options);
    assert.equal(reads, 1);
    await indexedSessionArtifacts({ ...options, now: 61_001 });
    assert.equal(reads, 2, "sessions without timestamps have a short fallback TTL");
    const inline = { id: "inline", kind: "image", source: "data:image/png;base64,AAAA" };
    let inlineReads = 0;
    const mediaOptions = { ...options, session: { id: "inline" }, load: async () => { inlineReads++; return [inline]; } };
    await indexedSessionArtifacts({ ...mediaOptions, load: async () => [] });
    await indexedSessionArtifacts({ ...mediaOptions, force: true });
    await indexedSessionArtifacts(mediaOptions);
    assert.equal(inlineReads, 2, "uncacheable refresh removes the previously cached record");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
