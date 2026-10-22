import { hermesApi } from "./hermes-client";
import type { RunRecord } from "./hermes-run-stream";

export type HermesChatInput = {
  text: string;
  cwd?: string | null;
  sessionId?: string | null;
  model: string;
  provider?: string;
  thinking: string;
  images?: { data: string; mimeType: string }[];
};
type RunTarget = Pick<RunRecord, "runId" | "project">;

export function createHermesChatClient(api = hermesApi, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function projectRequest<T>(action: "project" | "chat", body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetchImpl(`/api/hermes-session/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Hermes 项目操作失败。");
    return result as T;
  }
  function observe(run: RunTarget, signal: AbortSignal, cursor?: string): Promise<Response> {
    const init = { signal, headers: { Accept: "text/event-stream", ...(cursor ? { "Last-Event-ID": cursor } : {}) } };
    return run.project
      ? fetchImpl(`/api/hermes-session/chat?run_id=${encodeURIComponent(run.runId)}`, init)
      : api(`/v1/runs/${encodeURIComponent(run.runId)}/events`, init);
  }
  async function start(input: HermesChatInput, signal: AbortSignal, onStarted: (run: RunRecord) => void) {
    const { text, cwd, model, provider, thinking, images, sessionId } = input;
    if (cwd) {
      const response = await fetchImpl("/api/hermes-session/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ cwd, text, model, provider, thinking, ...(sessionId ? { session_id: sessionId } : {}),
          images: images?.map((image, index) => ({ data: image.data, mimeType: image.mimeType, filename: `attachment-${index}.${image.mimeType.split("/")[1] || "png"}` })),
        }),
      });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "运行失败"); }
      return { response, run: { runId: "", sessionId: sessionId ?? "", project: true } };
    }
    const content = images?.length ? [{ role: "user", content: [{ type: "text", text }, ...images.map(image => ({
      type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    }))] }] : text;
    const response = await api("/v1/runs", {
      method: "POST", signal, body: JSON.stringify({ input: content, model, ...(provider ? { provider } : {}),
        ...(thinking === "auto" ? {} : { model_options: { reasoning_effort: thinking === "off" ? "none" : thinking } }),
        ...(sessionId ? { session_id: sessionId } : {}),
      }),
    });
    const created = await response.json() as { run_id: string; session_id?: string };
    if (!created.run_id || typeof created.run_id !== "string") throw new Error("Hermes 未返回可确认的任务标识。");
    const run = { runId: created.run_id, sessionId: created.session_id ?? sessionId ?? created.run_id, project: false };
    // Persist the accepted run before opening its stream, so stream failure never resubmits the prompt.
    onStarted(run);
    return { response: await observe(run, signal), run };
  }
  async function stop(run: RunTarget) {
    if (run.project) await projectRequest("chat", { action: "stop", run_id: run.runId });
    else await api(`/v1/runs/${encodeURIComponent(run.runId)}/stop`, { method: "POST", body: "{}" });
  }
  async function approve(run: RunTarget, choice: "once" | "deny", requestId?: string) {
    if (run.project) await projectRequest("chat", { action: "approval", run_id: run.runId, choice, request_id: requestId });
    else await api(`/v1/runs/${encodeURIComponent(run.runId)}/approval`, {
      method: "POST", body: JSON.stringify({ choice, ...(requestId ? { request_id: requestId } : {}) }),
    });
  }
  return {
    start, observe, stop, approve,
    bindProject: <T>(body: unknown, signal?: AbortSignal) => projectRequest<T>("project", body, signal),
    clarify: (runId: string | null, requestId: string, answers: Record<string, string | null>) => projectRequest("chat", {
      action: "clarify", run_id: runId, request_id: requestId, answers,
    }),
  };
}

export const hermesChat = createHermesChatClient();
