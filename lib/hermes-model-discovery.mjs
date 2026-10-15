const modes = new Set(["", "chat_completions", "codex_responses", "anthropic_messages"]);

function baseUrl(value) {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("invalid_url");
  url.pathname = url.pathname.replace(/\/(?:models|chat\/completions|responses|messages)\/?$/i, "").replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

function modelEntries(data) {
  const rows = Array.isArray(data) ? data : data?.data ?? data?.models;
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  return rows.flatMap(row => {
    const id = typeof row === "string" ? row.trim() : typeof row?.id === "string" ? row.id.trim() : typeof row?.name === "string" ? row.name.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, ...(typeof row?.canonical_model === "string" ? { canonical_model: row.canonical_model } : {}), ...(typeof row?.reasoning_effort === "string" ? { reasoning_effort: row.reasoning_effort } : {}) }];
  });
}

/** Dashboard reads and credentials stay on the server; discovery never sends a chat prompt. */
export async function discoverHermesModels(body, dashboard, fetchImpl = fetch, signal) {
  let base;
  try { base = baseUrl(body.base_url ?? ""); } catch { return { ok: false, code: "invalid_url", models: [] }; }
  const mode = body.api_mode ?? "";
  if (!modes.has(mode)) return { ok: false, code: "invalid_protocol", models: [] };
  let key = typeof body.api_key === "string" ? body.api_key.trim() : "";
  if (!key && body.id) {
    const { endpoints = [] } = await dashboard("/api/providers/custom-endpoints");
    const saved = endpoints.find(row => row.id === body.id);
    if (!saved) return { ok: false, code: "missing_provider", models: [] };
    // Never forward a saved credential to an edited destination.
    if (baseUrl(saved.base_url) !== base && saved.has_api_key) return { ok: false, code: "changed_url", models: [] };
    if (saved.has_api_key) {
      const config = await dashboard("/api/config?include_defaults=false");
      const provider = config.providers?.[body.id] ?? config.custom_providers?.find?.(row => row.name === saved.name) ?? (saved.is_current ? config.model : undefined);
      const raw = typeof provider?.api_key === "string" ? provider.api_key.trim() : "";
      const reference = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw || saved.api_key_preview || "");
      const env = provider?.key_env || reference?.[1];
      if (env) key = (await dashboard("/api/env/reveal", { key: env })).value ?? "";
      else if (raw && !raw.includes("*") && !raw.includes("…")) key = raw;
      if (!key) return { ok: false, code: "missing_key", models: [] };
    }
  }
  const headers = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (mode === "anthropic_messages" || mode === "") {
    headers["anthropic-version"] = "2023-06-01";
    if (key) headers["x-api-key"] = key;
  }
  const alternate = /\/v1$/i.test(base) ? base.slice(0, -3) : `${base}/v1`;
  let failure = { ok: false, code: "network", models: [] };
  for (const candidate of [base, alternate]) {
    try {
      const response = await fetchImpl(`${candidate}/models`, { headers, cache: "no-store", redirect: "error", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]) });
      if ([401, 403].includes(response.status)) return { ok: false, code: "authentication", status: response.status, models: [] };
      if (!response.ok) {
        failure = { ok: false, code: "http", status: response.status, models: [] };
        if (response.status !== 404 && response.status !== 405) return failure;
        continue;
      }
      const data = await response.json().catch(() => null);
      const entries = modelEntries(data);
      if (entries.length) return { ok: true, models: entries.map(row => row.id), model_details: entries, resolved_base_url: candidate };
      failure = { ok: false, code: data === null ? "not_json" : "empty", models: [] };
    } catch {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    }
  }
  return failure;
}
