export async function hermesControl<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/hermes-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Hermes 操作失败。");
  return data;
}
export async function readHermesControl<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Hermes 操作失败。");
  return data;
}
