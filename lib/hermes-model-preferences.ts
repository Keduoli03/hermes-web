export type HermesModelSelection = { model: string; provider: string };
const storageKey = "hermes-model-selections-v1";
type SavedSelection = HermesModelSelection & { scope: string | null };

function validSelection(value: unknown): value is HermesModelSelection {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.model === "string" && row.model.length > 0 && row.model.length <= 1024 &&
    typeof row.provider === "string" && row.provider.length <= 256;
}

function readSelections(): SavedSelection[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(data) ? data.filter((row): row is SavedSelection => validSelection(row) && "scope" in row &&
      (row.scope === null || typeof row.scope === "string" && row.scope.length <= 256)).slice(0, 100) : [];
  } catch { return []; }
}

export function loadHermesModelSelection(scope: string | null): HermesModelSelection | null {
  const row = readSelections().find(row => row.scope === scope);
  return row ? { model: row.model, provider: row.provider } : null;
}

export function rememberHermesModelSelection(scope: string | null, selection: HermesModelSelection) {
  if (!validSelection(selection)) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([{ ...selection, scope }, ...readSelections().filter(row => row.scope !== scope)].slice(0, 100)));
  } catch {}
}

export function forgetHermesModelSelection(scope: string) {
  try { localStorage.setItem(storageKey, JSON.stringify(readSelections().filter(row => row.scope !== scope))); } catch {}
}

export function sessionHermesModelSelection(session: { model?: string; model_config?: string | Record<string, unknown> | null; billing_provider?: string }): HermesModelSelection | null {
  if (!session.model) return null;
  let config: Record<string, unknown> = {};
  try { config = typeof session.model_config === "string" ? JSON.parse(session.model_config) : session.model_config ?? {}; } catch {}
  return { model: session.model, provider: typeof config?.provider === "string" ? config.provider : session.billing_provider ?? "" };
}
