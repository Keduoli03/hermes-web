import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { listHermesConversations, isHermesConversation } = await jiti.import("./hermes-conversations.ts");

test("home pagination excludes cron on the server and retains the filtered total", async () => {
  const original = globalThis.fetch;
  const offsets = [];
  globalThis.fetch = async url => {
    const query = new URL(url, "http://localhost");
    assert.equal(query.pathname, "/api/hermes/api/sessions");
    assert.equal(query.searchParams.get("exclude_sources"), "cron");
    assert.equal(query.searchParams.get("archived"), "include");
    assert.equal(query.searchParams.get("order"), "recent");
    assert.equal(query.searchParams.get("limit"), "50");
    offsets.push(query.searchParams.get("offset"));
    return Response.json({ sessions: [{ id: "ordinary", source: "web" }], total: 51 });
  };
  try {
    assert.equal((await listHermesConversations()).total, 51);
    assert.equal((await listHermesConversations(50)).sessions[0].id, "ordinary");
    assert.deepEqual(offsets, ["0", "50"]);
  } finally { globalThis.fetch = original; }
});

test("source determines conversation visibility, including pinned and archived cron", () => {
  assert.equal(isHermesConversation({ source: "cron", pinned: true, archived: true }), false);
  assert.equal(isHermesConversation({ source: "web", title: "Hermes版本更新检测 · Oct 22 09:02" }), true);
  assert.equal(isHermesConversation({}), true);
});
