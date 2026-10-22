import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { searchHermesSessions, matchesHermesSearch } = await jiti.import("./hermes-search.ts");

test("search uses the native global FTS API, keeps archived hits and preserves cancellation", async () => {
  const original = globalThis.fetch, controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    const query = new URL(url, "http://localhost");
    assert.equal(query.pathname, "/api/hermes/api/sessions/search");
    assert.equal(query.searchParams.get("q"), "historical keyword");
    assert.equal(query.searchParams.get("limit"), "100");
    assert.equal(query.searchParams.get("exclude_sources"), "cron");
    assert.equal(init.signal, controller.signal);
    return Response.json({results:[
      {session_id:"archived-id",title:"Older chat",archived:true,snippet:"<img src=x onerror=alert(1)> historical keyword"},
      {id:"archived-id",title:"Duplicate"}, {session_id:"../../escape"},
      {id:"cron-id",source:"cron",title:"Older chat",archived:true,pinned:true},
    ]});
  };
  try {
    const hits = await searchHermesSessions(" historical keyword ", 1000, controller.signal);
    assert.equal(hits.length, 1); assert.equal(hits[0].archived, true);
    assert.equal(hits[0].id, "archived-id");
    assert.match(hits[0].snippet, /^<img/);
  } finally { globalThis.fetch = original; }
});
test("malformed search responses are errors and query matches are literal, not regular expressions", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({sessions:[]});
  try { await assert.rejects(searchHermesSessions("needle", 20, new AbortController().signal), /无效结果/); }
  finally { globalThis.fetch = original; }
  assert.equal(matchesHermesSearch("Earlier conversation: 中文 Needle", "中文 needle*"), true);
  assert.equal(matchesHermesSearch("a.b", "a.b"), true);
  assert.equal(matchesHermesSearch("axb", "a.b"), false);
  assert.equal(matchesHermesSearch("anything", ""), false);
});
