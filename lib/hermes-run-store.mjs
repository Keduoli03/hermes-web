const runs = globalThis.__hermesRecoverableRuns ??= new Map();
const encoder = new TextEncoder();
const terminal = new Set(["run.completed", "run.failed", "run.interrupted", "run.cancelled"]);

export async function retainHermesRun(stream, metadata = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const first = metadata.run_id ? null : await reader.read();
  if (first?.done) throw new Error("Hermes did not start a run");
  const initial = metadata.run_id ? `data: ${JSON.stringify({ event: "run.started", run_id: metadata.run_id, session_id: metadata.session_id })}\n\n` : decoder.decode(first.value, { stream: true });
  const event = JSON.parse(initial.split("\n").find(line => line.startsWith("data: ")).slice(6));
  const record = { ...metadata, run_id: event.run_id, session_id: event.session_id, text: "", reasoning: "", tools: [], approval: null, clarify: null, status: "running", events: [], eventBytes: 0, sequence: 0, subscribers: new Set(), ended: false, updatedAt: Date.now(), publish: () => {} };
  runs.set(record.run_id, record);
  function publish(data) {
    record.updatedAt = Date.now();
    if (data.session_id) record.session_id = data.session_id;
    if (data.event === "message.delta") record.text += data.delta ?? "";
    if (data.event === "reasoning.available") record.reasoning = data.text ?? "";
    if (data.event === "tool.started") { record.tools.push(data.tool); record.tools = record.tools.slice(-100); }
    if (data.event === "approval.request") record.approval = data.approval;
    if (data.event === "clarify.request") record.clarify = data.clarify;
    if (data.event === "request.cancel") {
      if (record.approval?.request_id === data.request_id) record.approval = null;
      if (record.clarify?.request_id === data.request_id) record.clarify = null;
    }
    if (terminal.has(data.event)) { record.status = data.event; record.approval = null; record.clarify = null; record.error = data.error; if (data.output) record.text = data.output; }
    const frame = { id: ++record.sequence, data, bytes: JSON.stringify(data).length * 2 };
    record.events.push(frame);
    record.eventBytes += frame.bytes;
    while (record.events.length > 1 && (record.events.length > 512 || record.eventBytes > 4 * 1024 * 1024)) record.eventBytes -= record.events.shift().bytes;
    for (const listener of record.subscribers) listener(frame);
    if (record.text.length + record.reasoning.length > 8 * 1024 * 1024 && data.event !== "run.failed") throw new Error("Hermes run output exceeds the recovery buffer");
  }
  record.publish = publish;
  let buffer = initial;
  const consume = () => {
    const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (data) publish(JSON.parse(data));
    }
  };
  consume();
  const expiry = setTimeout(() => {
    if (record.ended) return;
    publish({ event: "run.failed", error: "运行时间过长，已请求停止。" });
    void Promise.resolve().then(() => metadata.onExpire?.()).catch(() => {}).finally(() => reader.cancel().catch(() => {}));
  }, 30 * 60 * 1000);
  expiry.unref?.();
  void (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); if (buffer.trim()) { buffer += "\n\n"; consume(); } break; }
        buffer += decoder.decode(chunk.value, { stream: true }); consume();
      }
      if (!terminal.has(record.status)) publish({ event: "run.failed", error: "Hermes 会话连接已断开。", run_id: record.run_id, session_id: record.session_id });
    } catch (error) {
      publish({ event: "run.failed", error: error instanceof Error ? error.message : "Hermes run failed" });
      await reader.cancel().catch(() => {});
    } finally {
      clearTimeout(expiry);
      record.ended = true;
      for (const listener of record.subscribers) listener(null);
      record.subscribers.clear();
      const timer = setTimeout(() => runs.delete(record.run_id), 30 * 60 * 1000); timer.unref?.();
    }
  })();
  if (runs.size > 128) for (const [id, old] of runs) { if (old.ended) runs.delete(id); if (runs.size <= 128) break; }
  return record.run_id;
}

export function hermesRunSnapshot(record) {
  const { run_id, session_id, text, reasoning, tools, approval, clarify, status, sequence, error, cwd } = record;
  return { run_id, session_id, text, reasoning, tools, approval, clarify, status, sequence, error, cwd };
}
export function listHermesRuns() { return [...runs.values()].map(hermesRunSnapshot); }
export function resolveHermesRunRequest(runId, requestId) {
  const record = runs.get(runId);
  if (record?.approval?.request_id === requestId) record.approval = null;
  if (record?.clarify?.request_id === requestId) record.clarify = null;
  if (record && requestId && !record.ended) record.publish({ event: "request.cancel", request_id: requestId, run_id: runId, session_id: record.session_id });
}
export function attachHermesRun(runId, after = 0, signal) {
  const record = runs.get(runId);
  if (!record) return null;
  let detach = () => {};
  return new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => { if (closed) return; closed = true; detach(); controller.close(); };
      const send = frame => {
        if (closed) return;
        if (!frame) { close(); return; }
        controller.enqueue(encoder.encode(`id: ${frame.id}\ndata: ${JSON.stringify(frame.data)}\n\n`));
      };
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n")); }, 15000);
      detach = () => { clearInterval(heartbeat); record.subscribers.delete(send); signal?.removeEventListener("abort", close); };
      if (!after || after > record.sequence || after < (record.events[0]?.id ?? 1) - 1) {
        send({ id: record.sequence, data: { event: "run.snapshot", ...hermesRunSnapshot(record) } });
      } else for (const frame of record.events) if (frame.id > after) send(frame);
      if (record.ended) close(); else record.subscribers.add(send);
      signal?.addEventListener("abort", close, { once: true });
      if (signal?.aborted) close();
    },
    cancel() { detach(); },
  });
}
