const SAFE_API_PATH = /^\/(?:api|v1|health)(?:\/[A-Za-z0-9_./{}-]*)?$/;

export function buildHermesDashboardUrl(path: string, query = "", baseUrl = process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:8648"): string {
  if (!path.startsWith("/") || path.startsWith("//") || !SAFE_API_PATH.test(path)) {
    throw new Error("Hermes dashboard path must be a relative API path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Hermes dashboard path contains an unsafe API path segment");
  }
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("Hermes dashboard URL must use HTTP or HTTPS");
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("Hermes dashboard URL cannot contain credentials, query, or fragment");
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error("Hermes dashboard path escaped configured origin");
  }
  if (query) {
    const params = new URLSearchParams(query);
    for (const [key, value] of params) url.searchParams.append(key, value);
  }
  return url.toString();
}

export function getHermesDashboardHeaders(token = process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? ""): Headers {
  const value = token.trim();
  if (!value) throw new Error("Hermes dashboard session token is not configured");
  return new Headers({
    Accept: "application/json",
    "X-Hermes-Session-Token": value,
  });
}

export function getHermesProfileSessionToken(profile?: string | null): string {
  const normalized = profile?.trim();
  const safeProfile = normalized?.replace(/[^A-Za-z0-9_]/g, "_");
  const suffix = safeProfile && safeProfile !== "default" ? `_${safeProfile}` : "";
  const profileToken = suffix ? process.env[`HERMES_DASHBOARD_SESSION_TOKEN${suffix}`] : undefined;
  return profileToken?.trim() || process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim() || "";
}

export async function fetchHermesDashboard(path: string, options: {
  query?: string;
  method?: string;
  body?: BodyInit | null;
  signal?: AbortSignal;
  headers?: HeadersInit;
  profile?: string | null;
} = {}): Promise<Response> {
  const url = buildHermesDashboardUrl(path, options.query ?? "");
  const token = getHermesProfileSessionToken(options.profile);
  const headers = getHermesDashboardHeaders(token);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  if (options.body !== undefined && options.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    signal: options.signal,
    cache: "no-store",
    redirect: "error",
  });
}

