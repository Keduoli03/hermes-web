import test from "node:test";
import assert from "node:assert/strict";
import { collectHermesArtifacts, artifactSource, artifactMediaUrl, artifactDocumentUrl, loadArtifactSessions, loadSessionArtifacts } from "./hermes-artifacts.ts";

test("document links resolve against their source using Hermes managed-file access", () => {
  assert.equal(artifactDocumentUrl("diagram.png", "/tmp/report.md"), "/api/hermes/api/files/stream?path=%2Ftmp%2Fdiagram.png");
  assert.equal(artifactDocumentUrl("diagram.png", "https://example.test/docs/report.md?sig=1"), "https://example.test/docs/diagram.png");
  assert.equal(artifactDocumentUrl("javascript:alert(1)", "/tmp/report.md"), "");
  assert.equal(artifactDocumentUrl("javascript:alert(1)", "https://example.test/report.md"), "");
  assert.equal(artifactDocumentUrl("#section", "/tmp/report.md"), "#section");
});

const session = { id: "s-1", title: "Media chat", cwd: "C:/projects/example" };
test("indexes Markdown media, quoted MEDIA tags, references and code with stable deduplication", () => {
  const messages = [
    { role: "user", content: "![upload](https://cdn.test/input.png)" },
    { role: "assistant", content: '![Artwork](https://cdn.test/output.png?signature=abc)\n\n**MEDIA: "/tmp/demo clip.mp4"**\n\n`MEDIA:C:\\files\\voice.mp3`\n\n![Reference][pic]\n\n[pic]: /tmp/reference.png\n\n```html index.html\n<h1>Hello</h1>\n```' },
    { role: "assistant", content: "![Again](https://cdn.test/output.png?signature=abc)" },
  ];
  const artifacts = collectHermesArtifacts(session, messages);
  assert.deepEqual(artifacts.map(row => row.kind), ["image", "video", "audio", "image", "code"]);
  assert.equal(artifacts[1].source, "/tmp/demo clip.mp4");
  assert.equal(artifacts[2].source, "C:\\files\\voice.mp3");
  assert.equal(artifacts[4].title, "index.html");
  assert.equal(artifacts[0].sessionTitle, "Media chat");
  assert.equal(artifacts[0].id, collectHermesArtifacts(session, [messages[1]])[0].id);
  assert.notEqual(artifacts[0].id, collectHermesArtifacts({ ...session, id: "s-2" }, [messages[1]])[0].id);
});

test("extracts explicit producer outputs and screenshots without indexing passive observed media", () => {
  const artifacts = collectHermesArtifacts(session, [
    { role: "tool", tool_name: "web_search", content: JSON.stringify({ images: ["https://cdn.test/ad.png"], path: "/tmp/passive.jpg" }) },
    { role: "tool", tool_name: "browser_snapshot", content: "Example MEDIA:/tmp/example.png" },
    { role: "tool", tool_name: "image_generate", content: JSON.stringify({ image: "https://cdn.test/new.png" }) },
    { role: "tool", tool_name: "video_generate", content: { video_url: "https://cdn.test/render?id=1" } },
    { role: "tool", tool_name: "export_document", content: { files_created: ["report.pdf"], output_path: "report.pdf" } },
    { role: "tool", tool_name: "browser_vision", content: { _multimodal: true, content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }], meta: { screenshot_path: "/tmp/screen.png" } } },
    { role: "tool", tool_name: "browser_snapshot", content: '<untrusted_tool_result source="browser_snapshot">\nExternal data\n\n{"screenshot_path":"/tmp/wrapped.png"}\n</untrusted_tool_result>' },
  ]);
  assert.deepEqual(artifacts.map(row => row.source), ["https://cdn.test/new.png", "https://cdn.test/render?id=1", "C:/projects/example/report.pdf", "/tmp/screen.png", "/tmp/wrapped.png"]);
  assert.equal(artifacts[1].kind, "video");
});

test("structured assistant images and unsafe URL rejection", () => {
  const artifacts = collectHermesArtifacts(session, [{ role: "assistant", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, { type: "text", text: "![Bad](javascript:alert)" }] }]);
  assert.equal(artifacts.length, 1);
  for (const path of ["javascript:alert(1)", "https://user:secret@cdn.test/a.png", "data:text/html;base64,AAAA", "blob:xxx", "a\u0000.png"]) assert.equal(artifactSource(path, session.cwd), null);
  assert.equal(artifactSource("file:///C:/A%20B/image.png"), "C:/A B/image.png");
  assert.equal(artifactSource("relative.png"), null);
  assert.equal(artifactMediaUrl("C:/A B/视频.mp4"), "/api/hermes/api/files/stream?path=C%3A%2FA+B%2F%E8%A7%86%E9%A2%91.mp4");
  assert.equal(artifactMediaUrl("/tmp/report.pdf", true), "/api/hermes/api/files/download?path=%2Ftmp%2Freport.pdf");
});

test("reads every session page, including archived sessions", async () => {
  const calls = [];
  const sessions = await loadArtifactSessions(async path => {
    const query = new URL(path, "http://fixture").searchParams;
    assert.equal(query.get("archived"), "include");
    const offset = Number(query.get("offset")); calls.push(offset);
    assert.equal(query.get("limit"), "100");
    return { total: 201, sessions: Array.from({ length: offset < 200 ? 100 : 1 }, (_, index) => ({ id: `session-${offset + index}` })) };
  });
  assert.equal(sessions.length, 201);
  assert.deepEqual(calls, [0, 100, 200]);
});

test("reads older and compacted messages page by page and deduplicates across pages", async () => {
  const calls = [];
  const artifacts = await loadSessionArtifacts(session, async path => {
    const query = new URL(path, "http://fixture").searchParams;
    assert.equal(query.get("include_compacted"), "true"); assert.equal(query.get("order"), "oldest");
    const offset = Number(query.get("offset")); calls.push(offset);
    const media = { role: "assistant", content: "MEDIA:/tmp/old.png" };
    assert.equal(query.get("limit"), "100");
    return { messages: offset === 0 ? [media, ...Array.from({ length: 99 }, () => ({ role: "user", content: "hello" }))] : [media, { role: "assistant", content: "MEDIA:/tmp/new.mp4" }] };
  });
  assert.deepEqual(calls, [0, 100]);
  assert.deepEqual(artifacts.map(row => row.kind), ["image", "video"]);
  await assert.rejects(loadSessionArtifacts(session, async () => { throw new Error("unavailable"); }), /unavailable/);
});
