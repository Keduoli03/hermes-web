import { cachedHermesToken, fetchConnectedHermes } from "./hermes-connection.mjs";
import { hermesDashboardOrigin, configuredHermesToken } from "./hermes-server-config.mjs";

export function isSafeHermesApiSegment(segment: string): boolean {
  return Boolean(segment) && segment !== "." && segment !== ".." && /^[\p{L}\p{M}\p{N}_ .:{}@()+-]+$/u.test(segment);
}

export function buildHermesDashboardUrl(path: string, query = "", baseUrl = hermesDashboardOrigin()): string {
  if (!path.startsWith("/") || path.startsWith("//") || !["api", "v1", "health"].includes(path.split("/")[1])) {
    throw new Error("Hermes dashboard path must be a relative API path");
  }
  const segments = path.split("/");
  if (segments.slice(1).some((segment) => !isSafeHermesApiSegment(segment))) {
    throw new Error("Hermes dashboard path contains an unsafe API path segment");
  }
  const base = new URL(baseUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("Hermes dashboard URL must use HTTP or HTTPS");
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("Hermes dashboard URL cannot contain credentials, query, or fragment");
  }
  const url = new URL(`/${segments.slice(1).map(encodeURIComponent).join("/")}`, base);
  if (url.origin !== base.origin) {
    throw new Error("Hermes dashboard path escaped configured origin");
  }
  if (query) {
    const params = new URLSearchParams(query);
    for (const [key, value] of params) url.searchParams.append(key, value);
  }
  return url.toString();
}

export function getHermesDashboardHeaders(token = configuredHermesToken()): Headers {
  const value = token.trim();
  if (!value) throw new Error("Hermes dashboard session token is not configured");
  return new Headers({
    Accept: "application/json",
    "X-Hermes-Session-Token": value,
  });
}

export function getHermesProfileSessionToken(profile?: string | null): string {
  return cachedHermesToken(profile ?? undefined);
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
  const headers = new Headers({ Accept: "application/json" });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  if (options.body !== undefined && options.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetchConnectedHermes(new URL(url).pathname + new URL(url).search, {
    profile: options.profile ?? undefined,
    method: options.method ?? "GET",
    headers,
    body: options.body,
    signal: options.signal,
    cache: "no-store",
    redirect: "error",
  });
}

