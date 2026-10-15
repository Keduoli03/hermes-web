import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { bindHermesProject, prepareHermesProjectChat, controlHermesProjectRun, safeProjectError, hermesProjectModelError } from "./hermes-project-rpc.mjs";

async function fixture(handle = () => undefined) {
  const server = new WebSocketServer({ port: 0 });
  await new Promise(resolve => server.once("listening", resolve));
  const methods = [];
  const event = (socket, type, payload, session_id = "runtime-1") => socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type, session_id, payload } }));
  server.on("connection", (socket, request) => {
    assert.equal(new URL(request.url, "http://localhost").searchParams.get("token"), "server-secret");
    socket.on("message", async raw => {
      const frame = JSON.parse(raw); methods.push(frame);
      let result = await handle(socket, frame, event);
      if (result === false) return;
      result ??= frame.method === "session.active_list" ? { sessions: [] }
        : frame.method === "session.create" ? { session_id: "runtime-1", stored_session_id: "stored-1" }
        : frame.method === "session.resume" ? { session_id: "runtime-1", session_key: "stored-1", status: "idle" }
        : frame.method === "session.cwd.set" || (frame.method === "config.get" && frame.params.key === "project") ? { cwd: "/project", branch: "main" }
        : frame.method === "config.get" ? { value: "high" }
        : frame.method === "image.attach_bytes" ? { attached: true }
        : frame.method === "approval.respond" ? { resolved: true } : {};
      socket.send(JSON.stringify({ id: frame.id, result }));
    });
  });
  return { methods, options: { dashboardUrl: `http://127.0.0.1:${server.address().port}`, token: "server-secret" }, close: () => new Promise(resolve => server.close(resolve)) };
}
const input = { cwd: "/project", text: "Inspect this folder", model: "model-1", provider: "custom", thinking: "high" };
async function collect(stream) { return await new Response(stream).text(); }

test("official custom provider identities survive both new chat and resume unchanged", async () => {
  for (const provider of ["custom:api", "custom:fun-codex", "custom:自建api"]) {
    assert.equal(hermesProjectModelError({ model: "gpt-5.6-luna", provider }), null);
    for (const existing of [false, true]) {
      const f = await fixture((socket, frame, event) => {
        if (frame.method === "prompt.submit") event(socket, "message.complete", { text: "Done", status: "complete" });
      });
      try {
        await collect(await prepareHermesProjectChat({ ...input, model: "gpt-5.6-luna", provider, ...(existing ? { session_id: "stored-1" } : {}) }, f.options));
        if (existing) assert.equal(f.methods.find(frame => frame.method === "config.set" && frame.params.key === "model").params.value, `gpt-5.6-luna --session --provider ${provider}`);
        else assert.equal(f.methods.find(frame => frame.method === "session.create").params.provider, provider);
        assert.ok(f.methods.some(frame => frame.method === "prompt.submit"));
      } finally { await f.close(); }
    }
  }
});

test("provider identities cannot introduce flags or control characters", () => {
  for (const provider of ["--global", "api --global", "custom:api\n--global", "\u2014global", "custom:\u0000api"]) assert.match(hermesProjectModelError({ ...input, provider }), /提供商标识无效/);
});

test("selecting a new folder only probes project config; no empty session or global writes", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await bindHermesProject({ cwd: "/project" }, f.options), { cwd: "/project", branch: "main" });
    assert.deepEqual(f.methods.map(frame => frame.method), ["config.get"]);
  } finally { await f.close(); }
});

test("moving an existing project resumes the durable key and binds the runtime id", async () => {
  const f = await fixture();
  try {
    await bindHermesProject({ cwd: "/project", session_id: "stored-1" }, f.options);
    assert.equal(f.methods.find(frame => frame.method === "session.resume").params.session_id, "stored-1");
    assert.equal(f.methods.find(frame => frame.method === "session.cwd.set").params.session_id, "runtime-1");
  } finally { await f.close(); }
});

test("new project run binds cwd and attaches images before prompting, filters other sessions", async () => {
  const f = await fixture((socket, frame, event) => {
    if (frame.method === "prompt.submit") {
      event(socket, "message.delta", { text: "Wrong session" }, "child-runtime");
      event(socket, "message.delta", { text: "Answer" });
      event(socket, "reasoning.delta", { text: "Reason" });
      event(socket, "message.complete", { text: "Answer", status: "complete" });
    }
  });
  try {
    const output = await collect(await prepareHermesProjectChat({ ...input, images: [{ data: "YWJj", mimeType: "image/png", filename: "test.png" }] }, f.options));
    assert.deepEqual(f.methods.map(frame => frame.method), ["client.capabilities", "session.create", "session.cwd.set", "image.attach_bytes", "prompt.submit"]);
    assert.equal(f.methods[1].params.cwd, "/project"); assert.equal(f.methods[1].params.reasoning_effort, "high");
    assert.equal(f.methods.at(-1).params.session_id, "runtime-1");
    assert.match(output, /run.completed/); assert.match(output, /stored-1/); assert.match(output, /Reason/);
    assert.doesNotMatch(output, /runtime-1|Wrong session|server-secret/);
  } finally { await f.close(); }
});

test("resumed run switches model and reasoning only on returned runtime, auto uses profile default", async () => {
  const f = await fixture((socket, frame, event) => {
    if (frame.method === "prompt.submit") event(socket, "message.complete", { text: "Done", status: "complete" });
    if (frame.method === "config.get" && frame.params.key === "reasoning") return { value: "hide" };
  });
  try {
    await collect(await prepareHermesProjectChat({ ...input, session_id: "stored-1", thinking: "auto" }, f.options));
    const changes = f.methods.filter(frame => frame.method === "config.set");
    assert.equal(changes.length, 2);
    assert.ok(changes.every(frame => frame.params.session_id === "runtime-1"));
    assert.equal(changes[0].params.value, "model-1 --session --provider custom");
    assert.equal(changes[1].params.scope, "session"); assert.equal(changes[1].params.value, "medium");
  } finally { await f.close(); }
});

test("active external run is refused before transport rebind or cwd mutation", async () => {
  const f = await fixture((_socket, frame) => frame.method === "session.active_list" ? { sessions: [{ session_key: "stored-1", status: "streaming" }] } : undefined);
  try {
    await assert.rejects(prepareHermesProjectChat({ ...input, session_id: "stored-1" }, f.options), /正在运行/);
    assert.deepEqual(f.methods.map(frame => frame.method), ["client.capabilities", "session.active_list"]);
  } finally { await f.close(); }
});

test("cwd refusal prevents prompt; guarded model choice is not auto-confirmed", async () => {
  const f = await fixture((_socket, frame) => frame.method === "session.cwd.set" ? { cwd: "/other" } : undefined);
  try { await assert.rejects(prepareHermesProjectChat(input, f.options), /未绑定/); assert.equal(f.methods.some(frame => frame.method === "prompt.submit"), false); }
  finally { await f.close(); }
  const g = await fixture((_socket, frame) => frame.method === "config.set" ? { confirm_required: true, confirm_message: "Confirm price" } : undefined);
  try { await assert.rejects(prepareHermesProjectChat({ ...input, session_id: "stored-1" }, g.options), /Confirm price/); assert.equal(g.methods.some(frame => frame.method === "prompt.submit"), false); }
  finally { await g.close(); }
});

test("stop, approval and stream cancellation target this runtime; cancellation interrupts before disconnect", async () => {
  let interrupted;
  const received = new Promise(resolve => { interrupted = resolve; });
  const f = await fixture((_socket, frame) => { if (frame.method === "session.interrupt") interrupted(); });
  try {
    const stream = await prepareHermesProjectChat(input, f.options);
    const reader = stream.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const { run_id } = JSON.parse(first.slice(6));
    await controlHermesProjectRun(run_id, "approval", "once", "approval-1");
    await reader.cancel(); await received;
    const approval = f.methods.find(frame => frame.method === "approval.respond");
    assert.deepEqual(approval.params, { session_id: "runtime-1", choice: "once", request_id: "approval-1" });
    assert.equal(f.methods.find(frame => frame.method === "session.interrupt").params.session_id, "runtime-1");
    assert.equal(safeProjectError(new Error("failed server-secret"), "server-secret"), "failed [已隐藏]");
  } finally { await f.close(); }
});

test("HTTP request abort interrupts the native run and closes its stream", async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const reader = (await prepareHermesProjectChat(input, { ...f.options, signal: controller.signal })).getReader();
    await reader.read(); controller.abort();
    while (!(await reader.read()).done) {}
    assert.ok(f.methods.some(frame => frame.method === "session.interrupt" && frame.params.session_id === "runtime-1"));
  } finally { await f.close(); }
});

test("concurrent project mutations are refused and stale approvals are not reported as resolved", async () => {
  const f = await fixture((_socket, frame) => frame.method === "approval.respond" ? { resolved: false } : undefined);
  try {
    const reader = (await prepareHermesProjectChat({ ...input, session_id: "stored-1" }, f.options)).getReader();
    const { run_id } = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
    await assert.rejects(bindHermesProject({ session_id: "stored-1", cwd: "/project" }, f.options), /正在操作/);
    await assert.rejects(controlHermesProjectRun(run_id, "approval", "once", "stale"), /已失效/);
    await reader.cancel();
  } finally { await f.close(); }
});

test("model ids cannot introduce native global flags, including Unicode dashes", async () => {
  for (const model of ["--global", "model --global", "\u2014global", "model\n--global"]) {
    await assert.rejects(prepareHermesProjectChat({ ...input, model }, { dashboardUrl: "http://127.0.0.1:1", token: "server-secret" }), /标识无效/);
  }
});

test("automatic compaction updates the durable conversation id without adopting a child session", async () => {
  const f = await fixture((socket, frame, event) => {
    if (frame.method === "prompt.submit") {
      event(socket, "session.info", { stored_session_id: "wrong-child" }, "child-runtime");
      event(socket, "session.info", { stored_session_id: "stored-continuation" });
      event(socket, "message.complete", { text: "Done", status: "complete" });
    }
  });
  try {
    const output = await collect(await prepareHermesProjectChat(input, f.options));
    const events = output.trim().split("\n\n").map(frame => JSON.parse(frame.slice(6)));
    assert.equal(events.find(event => event.event === "session.updated").session_id, "stored-continuation");
    assert.equal(events.at(-1).session_id, "stored-continuation");
    assert.doesNotMatch(output, /wrong-child|child-runtime/);
  } finally { await f.close(); }
});

test("legacy clarify stays live until answered and stale requests cannot be answered twice", async () => {
  const f = await fixture((socket, frame, event) => {
    if (frame.method === "prompt.submit") event(socket, "clarify.request", { request_id: "legacy-q", question: "Which branch?", choices: ["main", "dev"] });
    if (frame.method === "clarify.respond") { event(socket, "message.complete", { text: "Answered", status: "complete" }); return { status: "ok" }; }
  });
  try {
    const reader = (await prepareHermesProjectChat(input, f.options)).getReader();
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
    const question = new TextDecoder().decode((await reader.read()).value);
    assert.match(question, /clarify.request/);
    await controlHermesProjectRun(first.run_id, "clarify", { question: "main" }, "legacy-q");
    assert.match(new TextDecoder().decode((await reader.read()).value), /Answered/);
    await assert.rejects(controlHermesProjectRun(first.run_id, "clarify", { question: "main" }, "legacy-q"));
    assert.equal(f.methods.find(frame => frame.method === "clarify.respond").params.answer, "main");
  } finally { await f.close(); }
});

test("modern clarify is answered on its owner socket as a JSON-RPC response", async () => {
  let responded;
  const answer = new Promise(resolve => { responded = resolve; });
  const f = await fixture((socket, frame, event) => {
    if (frame.method === "prompt.submit") socket.send(JSON.stringify({ jsonrpc: "2.0", id: "srq-123456789abc", method: "clarify", params: { session_id: "runtime-1", questions: [{ qid: "q1", question: "Choose", choices: ["A", "B"], multi_select: true }] } }));
    if (frame.id === "srq-123456789abc" && frame.result) { responded(frame.result); event(socket, "message.complete", { text: "Done" }); return false; }
  });
  try {
    const reader = (await prepareHermesProjectChat(input, f.options)).getReader();
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
    assert.match(new TextDecoder().decode((await reader.read()).value), /server_request/);
    await controlHermesProjectRun(first.run_id, "clarify", { q1: '["A","B"]' }, "srq-123456789abc");
    assert.deepEqual(await answer, { answers: { q1: '["A","B"]' } });
    await reader.read();
  } finally { await f.close(); }
});
