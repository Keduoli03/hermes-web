import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

const registry = globalThis.__hermesProjectRuns ??= new Map();
const owners = globalThis.__hermesProjectOwners ??= new Set();
const busyStatuses = new Set(["working", "streaming", "starting", "resuming", "queued", "running", "waiting"]);

export function hermesProjectModelError(input) {
  // Native model-switch parsing splits on whitespace. Preserve official identities
  // such as custom:api, including Unicode names, while refusing flag injection.
  const token = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/^[\-\u2012-\u2015]|[\s"'\\\p{C}]/u.test(value);
  if (!token(input.model, 512)) return "模型标识无效，请重新选择模型。";
  if (input.provider !== undefined && input.provider !== "" && !token(input.provider, 200)) return "提供商标识无效，请重新选择模型。";
  return null;
}

function claimSession(sessionId) {
  if (!sessionId) return () => {};
  if (owners.has(sessionId)) throw new Error("会话正在操作中，请稍后重试。");
  owners.add(sessionId);
  return () => owners.delete(sessionId);
}

export function safeProjectError(error, token = "") {
  const message = error instanceof Error ? error.message : "Hermes 项目操作失败。";
  return token ? message.split(token).join("[已隐藏]") : message;
}

export async function connectHermesRpc({ dashboardUrl, token, signal }, onEvent = () => {}) {
  const url = new URL("/api/ws", dashboardUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Hermes 服务地址无效。");
  const origin = url.origin;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  const socket = new WebSocket(url, { origin, maxPayload: 32 * 1024 * 1024 });
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  let onClose = () => {};
  const fail = () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("Hermes 会话连接已断开。"));
    }
    pending.clear();
  };
  socket.on("message", raw => {
    for (const line of raw.toString().split("\n")) {
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      if (frame.method === "event") { onEvent(frame.params); continue; }
      if (frame.method && typeof frame.id === "string") {
        if (["clarify", "approval"].includes(frame.method)) onEvent({ type: `${frame.method}.request`, session_id: frame.params?.session_id, payload: { ...frame.params, request_id: frame.id, server_request: true } });
        else socket.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: 4404, message: "This client cannot answer this window request." } }));
        continue;
      }
      const call = pending.get(frame.id);
      if (!call) continue;
      pending.delete(frame.id); clearTimeout(call.timer);
      if (frame.error) call.reject(Object.assign(new Error(safeProjectError(new Error(frame.error.message || "Hermes 操作失败。"), token)), { code: frame.error.code }));
      else call.resolve(frame.result);
    }
  });
  socket.on("error", fail);
  socket.on("close", () => { closed = true; fail(); onClose(); });
  const abort = () => socket.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.terminate(); reject(new Error("连接 Hermes 会话服务超时。")); }, 10000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", () => { clearTimeout(timer); reject(new Error("无法连接 Hermes 会话服务。")); });
      socket.once("close", () => { clearTimeout(timer); reject(new Error("Hermes 会话服务拒绝了连接。")); });
    });
    if (signal?.aborted) throw new Error("操作已取消。");
  } catch (error) { signal?.removeEventListener("abort", abort); socket.close(); throw error; }
  signal?.removeEventListener("abort", abort);
  return {
    respond(id, result) {
      if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("Hermes 会话连接已断开。");
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    },
    rpc(method, params, timeout = 30000) {
      if (closed || socket.readyState !== WebSocket.OPEN || (signal?.aborted && method !== "session.interrupt")) return Promise.reject(new Error("Hermes 会话连接已断开。"));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Hermes 会话操作超时。")); }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    },
    onClose(callback) { onClose = callback; if (closed) callback(); },
    close() { signal?.removeEventListener("abort", abort); fail(); socket.close(); },
  };
}

async function resume(client, sessionId) {
  // Read liveness before resume can rebind another client's transport.
  const active = await client.rpc("session.active_list", {});
  if (active.sessions?.some(item => item.session_key === sessionId && busyStatuses.has(item.status))) {
    throw new Error("会话正在运行，请等待完成后再操作项目文件夹。");
  }
  const session = await client.rpc("session.resume", { session_id: sessionId, lazy: true, omit_messages: true, inline_images: false, close_on_disconnect: true });
  if (!session.session_id || session.running || busyStatuses.has(session.status)) throw new Error("会话正在运行，请稍后重试。");
  return session;
}

export async function bindHermesProject({ session_id, cwd }, options) {
  const release = claimSession(session_id);
  let client;
  try {
    client = await connectHermesRpc(options);
    if (!session_id) {
      const info = await client.rpc("config.get", { key: "project", cwd });
      if (!info.cwd) throw new Error("Hermes 未确认项目文件夹。");
      return { cwd: info.cwd, branch: info.branch ?? "" };
    }
    const session = await resume(client, session_id);
    const info = await client.rpc("session.cwd.set", { session_id: session.session_id, cwd });
    if (!info.cwd) throw new Error("Hermes 未确认项目文件夹。");
    return { cwd: info.cwd, branch: info.branch ?? "" };
  } finally { client?.close(); release(); }
}

// A project run owns one native connection. Runtime ids never replace durable ids.
export async function prepareHermesProjectChat(input, options) {
  const modelError = hermesProjectModelError(input);
  if (modelError) throw new Error(modelError);
  if (registry.size >= 32) throw new Error("当前运行会话过多，请稍后重试。");
  const release = claimSession(input.session_id);
  const runId = randomUUID();
  let runtimeId, storedId, emit = () => {}, finish = () => {}, started = false, settled = false;
  let reasoning = "";
  const requests = new Map();
  let client;
  try { client = await connectHermesRpc(options, event => {
    if (!started || settled || event?.session_id !== runtimeId) return;
    const payload = event.payload ?? {};
    const send = data => emit({ ...data, run_id: runId, session_id: storedId });
    if (event.type === "session.info") {
      if (typeof payload.stored_session_id === "string" && /^[A-Za-z0-9_.-]{1,160}$/.test(payload.stored_session_id) && payload.stored_session_id !== storedId) {
        storedId = payload.stored_session_id;
        send({ event: "session.updated" });
      }
    } else if (event.type === "message.delta") send({ event: "message.delta", delta: payload.text ?? "" });
    else if (event.type === "reasoning.delta") { reasoning += payload.text ?? ""; send({ event: "reasoning.available", text: reasoning }); }
    else if (event.type === "reasoning.available") { reasoning = payload.text ?? reasoning; send({ event: "reasoning.available", text: reasoning }); }
    else if (event.type === "tool.start") send({ event: "tool.started", tool: payload.name, preview: payload.context });
    else if (event.type === "approval.request") { requests.set(payload.request_id, { kind: "approval", ...payload }); send({ event: "approval.request", approval: payload }); }
    else if (event.type === "clarify.request") {
      requests.set(payload.request_id, { kind: "clarify", ...payload });
      send({ event: "clarify.request", clarify: payload });
    } else if (event.type === "request.cancel" || event.type === "clarify.expire") {
      requests.delete(payload.id || payload.request_id);
      send({ event: "request.cancel", request_id: payload.id || payload.request_id });
    } else if (event.type.startsWith("subagent.")) {
      send({ event: event.type, subagent: payload });
    } else if (event.type === "message.complete") {
      settled = true;
      if (payload.reasoning) send({ event: "reasoning.available", text: payload.reasoning });
      send({ event: payload.status === "error" ? "run.failed" : payload.status === "interrupted" ? "run.interrupted" : "run.completed", output: payload.text, error: payload.error });
      finish();
    }
  }); } catch (error) { release(); throw error; }
  async function stop() {
    if (runtimeId && started && !settled) {
      try {
        const result = await client.rpc("session.interrupt", { session_id: runtimeId });
        if (result.interrupted === false) throw new Error("Hermes 未确认停止，请刷新会话检查结果。");
      } catch (error) { if (!settled) throw error; }
    }
  }
  const cancel = () => stop().catch(() => {}).finally(() => finish());
  let timer, heartbeat;
  const cleanup = () => {
    clearTimeout(timer); clearInterval(heartbeat);
    options.signal?.removeEventListener("abort", cancel);
    registry.delete(runId); client.close(); release();
  };
  try {
    await client.rpc("client.capabilities", { server_requests: true }).catch(error => { if (![ -32601, 4004 ].includes(error.code) && !/unknown method|method not found/i.test(error.message)) throw error; });
    const effort = input.thinking === "auto" ? undefined : input.thinking === "off" ? "none" : input.thinking;
    const session = input.session_id ? await resume(client, input.session_id) : await client.rpc("session.create", {
      cwd: input.cwd, model: input.model, provider: input.provider || undefined,
      reasoning_effort: effort, close_on_disconnect: true,
    });
    runtimeId = session.session_id;
    storedId = session.stored_session_id || session.session_key || session.resumed;
    if (!runtimeId || !storedId) throw new Error("Hermes 未返回有效的会话标识。");
    const bound = await client.rpc("session.cwd.set", { session_id: runtimeId, cwd: input.cwd });
    const canonical = path => String(path).replaceAll("\\", "/").replace(/\/$/, "");
    const expected = canonical(input.cwd), actual = canonical(bound.cwd);
    if (/^[A-Za-z]:/.test(expected) ? expected.toLowerCase() !== actual.toLowerCase() : expected !== actual) throw new Error("Hermes 未绑定所选的项目文件夹。");
    if (input.session_id) {
      // config.set falls back to global writes without a valid runtime id.
      // Hermes splits flags on whitespace; shell-style quotes are literal here.
      const value = `${input.model} --session${input.provider ? ` --provider ${input.provider}` : ""}`;
      const result = await client.rpc("config.set", { session_id: runtimeId, key: "model", value });
      if (result.confirm_required) throw new Error(result.confirm_message || "该模型需要在官方客户端确认后使用。");
      const defaultReasoning = effort ? null : await client.rpc("config.get", { key: "reasoning" });
      const defaultEffort = String(defaultReasoning?.value ?? "medium").toLowerCase();
      const inherited = ["none", "false", "disabled"].includes(defaultEffort) ? "none" : ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(defaultEffort) ? defaultEffort : "medium";
      await client.rpc("config.set", { session_id: runtimeId, scope: "session", key: "reasoning", value: effort || inherited });
    }
    for (const image of input.images ?? []) {
      const result = await client.rpc("image.attach_bytes", { session_id: runtimeId, content_base64: `data:${image.mimeType};base64,${image.data}`, filename: image.filename });
      if (!result.attached) throw new Error("Hermes 未接受图片附件。");
    }
    if (options.signal?.aborted) throw new Error("操作已取消。");
    let consumerCancelled = false;
    return new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        emit = data => { if (!closed && !consumerCancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); };
        finish = () => { if (closed) return; closed = true; cleanup(); if (!consumerCancelled) controller.close(); };
        registry.set(runId, { stop, rpc: (method, params) => client.rpc(method, { ...params, session_id: runtimeId }), clarify: async (answers, requestId) => {
          const request = requests.get(requestId);
          if (!request || request.kind !== "clarify") throw new Error("此问题已失效，请刷新会话。");
          if (request.server_request) client.respond(requestId, Object.keys(answers).length ? { answers, ...(request.questions ? {} : { answer: answers.question ?? "" }) } : {});
          else {
            const result = await client.rpc("clarify.respond", { session_id: runtimeId, request_id: requestId, answer: answers.question ?? Object.values(answers)[0] ?? "" }).catch(error => { if (settled) return { status: "ok" }; throw error; });
            if (result.status !== "ok") throw new Error("此问题已失效，请刷新会话。");
          }
          requests.delete(requestId);
        }, approve: async (choice, requestId) => {
          const request = requests.get(requestId);
          if (request?.server_request) { client.respond(requestId, { choice }); requests.delete(requestId); return; }
          const result = await client.rpc("approval.respond", { session_id: runtimeId, choice, request_id: requestId });
          if (!result.resolved) throw new Error("此确认请求已失效，请刷新会话。");
        } });
        options.signal?.addEventListener("abort", cancel, { once: true });
        client.onClose(() => {
          if (!settled && !closed) emit({ event: "run.failed", error: "Hermes 会话连接已断开，请重新打开会话检查结果。" });
          finish();
        });
        if (closed) return;
        heartbeat = setInterval(() => { if (!closed && !consumerCancelled) controller.enqueue(encoder.encode(": heartbeat\n\n")); }, 15000);
        timer = setTimeout(() => { emit({ event: "run.failed", error: "运行时间过长，已请求停止。" }); cancel(); }, 30 * 60 * 1000);
        emit({ event: "run.started", run_id: runId, session_id: storedId });
        started = true;
        void client.rpc("prompt.submit", { session_id: runtimeId, text: input.text }).catch(error => {
          if (!closed) emit({ event: "run.failed", error: safeProjectError(error, options.token) });
          cancel();
        });
        if (options.signal?.aborted) cancel();
      },
      cancel() { consumerCancelled = true; return cancel(); },
    });
  } catch (error) { cleanup(); throw error; }
}

export async function controlHermesProjectRun(runId, action, choice, requestId) {
  const run = registry.get(runId);
  if (!run) throw new Error("运行已结束，请刷新会话。");
  if (action === "stop") await run.stop();
  else if (action === "clarify") await run.clarify(choice, requestId);
  else await run.approve(choice, requestId);
  return { ok: true };
}

export async function queryHermesProjectRun(runId, method, params = {}) {
  const run = registry.get(runId);
  if (!run) throw new Error("运行已结束，请刷新会话。");
  return run.rpc(method, params);
}
