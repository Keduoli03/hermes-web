export type RunRecord = { runId: string; sessionId: string; project: boolean };
const key = "hermes-active-run";
export function rememberRun(run: RunRecord | null) {
  try { if (run) sessionStorage.setItem(key, JSON.stringify(run)); else sessionStorage.removeItem(key); } catch {}
}
export function rememberedRun(): RunRecord | null {
  try { const run = JSON.parse(sessionStorage.getItem(key) || "null"); return run && typeof run.runId === "string" && typeof run.sessionId === "string" && typeof run.project === "boolean" ? run : null; } catch { return null; }
}
export async function readHermesRun<T extends { event?: string }>(initial: Response, signal: AbortSignal, reconnect: (cursor: string) => Promise<Response>, onEvent: (event: T) => void, onRetry: () => void) {
  let response = initial, cursor = "", failures = 0;
  const seen = new Set<string>();
  while (!signal.aborted) {
    let terminal = false, received = false;
    try {
      if (!response.ok) throw new Error(`Hermes stream HTTP ${response.status}`);
      if (!response.body) throw new Error("Hermes 没有返回事件流");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      const consume = (frame: string) => {
        const lines = frame.split(/\r?\n/);
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data) return;
        const id = lines.find(line => line.startsWith("id:"))?.slice(3).trim();
        if (id && seen.has(id)) return;
        const event = JSON.parse(data) as T & { status?: string };
        onEvent(event); received = true;
        if (id) { cursor = id; seen.add(id); if (seen.size > 4096) seen.delete(seen.values().next().value!); }
        terminal = ["run.completed", "run.failed", "run.interrupted", "run.cancelled"].includes(event.event ?? "") || (event.event === "run.snapshot" && event.status !== "running");
      };
      try {
        while (!terminal && !signal.aborted) {
          const { done, value } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? "";
          for (const frame of frames) { consume(frame); if (terminal) break; }
          if (done) { if (buffer.trim()) consume(buffer); break; }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (terminal) return;
    } catch (error) { if (signal.aborted) throw error; if (response.status === 401 || response.status === 404) throw error; }
    if (signal.aborted) return;
    // A stream without event IDs cannot be replayed safely after partial output.
    if (received && !cursor) throw new Error("连接已断开，服务未提供事件恢复标识；请重新打开会话查看结果。");
    if (++failures > 5) throw new Error("连接恢复失败；重新打开会话可再次尝试恢复。");
    onRetry();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.min(500 * 2 ** (failures - 1), 8000));
      signal.addEventListener("abort", abort, { once: true });
    });
    try { response = await reconnect(cursor); } catch (error) { if (signal.aborted || failures >= 5) throw error; }
  }
}
