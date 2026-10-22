import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createHermesChatClient } = await jiti.import("./hermes-chat-client.ts");
const input = { text: "Review this", model: "model-one", provider: "custom:work", thinking: "off", sessionId: "stored-one" };
const stream = () => new Response('data: {"event":"run.completed"}\n\n', { headers: { "Content-Type": "text/event-stream" } });

test("ordinary chat preserves provider, reasoning and images and records the run before observing it", async () => {
  const calls = [], accepted = [];
  const signal = new AbortController().signal;
  const client = createHermesChatClient(async (path, init) => {
    calls.push({ path, init });
    if (path === "/v1/runs") return Response.json({ run_id: "run-one" });
    assert.equal(accepted[0].runId, "run-one");
    return stream();
  }, () => { throw new Error("must not use project transport"); });
  const { run } = await client.start({ ...input, images: [{ data: "AAAA", mimeType: "image/png" }] }, signal, record => accepted.push(record));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.provider, "custom:work");
  assert.equal(body.model_options.reasoning_effort, "none");
  assert.equal(body.input[0].content[1].image_url.url, "data:image/png;base64,AAAA");
  assert.equal(body.session_id, "stored-one");
  assert.deepEqual(run, { runId: "run-one", sessionId: "stored-one", project: false });
  assert.equal(calls[0].init.signal, signal);
  await client.observe(run, signal, "17");
  assert.equal(calls.at(-1).init.headers["Last-Event-ID"], "17");
  await client.stop(run); await client.approve(run, "once", "approval-one");
  assert.equal(calls.filter(call => call.path === "/v1/runs").length, 1, "recovery and control must never resend a prompt");
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { choice: "once", request_id: "approval-one" });
});

test("project chat keeps native cwd, session identities and control payloads inside the project adapter", async () => {
  const calls = [], signal = new AbortController().signal;
  const client = createHermesChatClient(() => { throw new Error("must not use API Server"); }, async (path, init) => {
    calls.push({ path, init });
    return init?.method === "POST" && JSON.parse(init.body).text ? stream() : Response.json({ ok: true });
  });
  const { run } = await client.start({ ...input, cwd: "/project", images: [{ data: "AAAA", mimeType: "image/png", previewUrl: "blob:browser-only-preview" }] }, signal, () => {
    throw new Error("native identity arrives in the stream");
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.cwd, "/project");
  assert.equal(body.provider, "custom:work");
  assert.equal(body.thinking, "off");
  assert.equal(body.images[0].filename, "attachment-0.png");
  assert.equal(body.images[0].previewUrl, undefined);
  assert.equal(body.model_options, undefined);
  run.runId = "project-run";
  await client.observe(run, signal, "12");
  assert.equal(calls.at(-1).path, "/api/hermes-session/chat?run_id=project-run");
  await client.stop(run);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { action: "stop", run_id: "project-run" });
  await client.approve(run, "deny", "approval-two");
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { action: "approval", run_id: "project-run", choice: "deny", request_id: "approval-two" });
  await client.clarify(run.runId, "question-one", { answer: "yes" });
  assert.equal(JSON.parse(calls.at(-1).init.body).request_id, "question-one");
});

test("an accepted run remains recoverable when opening its initial event stream fails", async () => {
  let starts = 0, saved;
  const client = createHermesChatClient(async path => {
    if (path === "/v1/runs") { starts++; return Response.json({ run_id: "recover-me", session_id: "stored-me" }); }
    throw new Error("connection interrupted");
  });
  await assert.rejects(client.start(input, new AbortController().signal, run => { saved = run; }), /connection interrupted/);
  assert.equal(starts, 1);
  assert.equal(saved.runId, "recover-me");
});
