import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { safeLoginDestination } from "./login-destination";
import { createOfficialSession, isOfficialLoginEnabled, isOfficialUserAllowed, storeLoginFlow, takeLoginFlow } from "./web-oauth-store.mjs";

export const NOUS_PORTAL = "https://portal.nousresearch.com";
export const OAUTH_FLOW_COOKIE = "hermes_web_oauth_flow";
const remoteKeys = createRemoteJWKSet(new URL(`${NOUS_PORTAL}/.well-known/jwks.json`), { timeoutDuration: 10_000, cacheMaxAge: 300_000 });

export function officialLoginConfig() {
  const clientId = process.env.HERMES_WEB_OAUTH_CLIENT_ID?.trim() ?? "";
  if (!/^agent:[A-Za-z0-9_-]+$/.test(clientId)) throw new Error("Official OAuth client ID is missing or invalid");
  const url = new URL(process.env.HERMES_WEB_PUBLIC_URL ?? "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Public URL must be an HTTPS origin (HTTP is allowed on loopback only)");
  return { clientId, origin: url.origin, redirectUri: `${url.origin}/api/web-auth/official/callback`, secure: url.protocol === "https:" };
}

export function officialLoginStatus() {
  if (!isOfficialLoginEnabled()) return { enabled: false, ready: false };
  try { officialLoginConfig(); return { enabled: true, ready: true }; }
  catch { return { enabled: true, ready: false }; }
}

export function isOfficialAuthOrigin(request: Request, origin: string): boolean {
  // Bind the flow to the configured authority, without trusting forwarded Host headers.
  const expected = new URL(origin);
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return host.toLowerCase() === expected.host.toLowerCase();
}

export function startOfficialLogin(destination: string | null) {
  const config = officialLoginConfig();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const cookie = storeLoginFlow({ state, verifier, destination: safeLoginDestination(destination, config.origin), clientId: config.clientId, origin: config.origin, expiresAt: Date.now() + 600_000 });
  const url = new URL(`${NOUS_PORTAL}/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: "agent_dashboard:access", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), cookie, secure: config.secure };
}

export async function verifyOfficialToken(token: string, clientId: string, getKey: JWTVerifyGetKey = remoteKeys) {
  const { payload } = await jwtVerify(token, getKey, { algorithms: ["RS256"], issuer: NOUS_PORTAL, audience: clientId, requiredClaims: ["exp", "iat", "aud", "iss", "sub"], clockTolerance: 0 });
  if (!payload.sub || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.iat! > Math.floor(Date.now() / 1000) + 30) throw new Error("Invalid account claims");
  if (payload.agent_instance_id !== undefined && payload.agent_instance_id !== clientId.slice("agent:".length)) throw new Error("Wrong instance");
  if (payload.oauth_contract_version !== undefined && payload.oauth_contract_version !== 1) throw new Error("Unsupported OAuth contract");
  if (!isOfficialUserAllowed(payload.sub)) throw new Error("Account not allowed");
  return { userId: payload.sub, clientId, expiresAt: Math.min(payload.exp! * 1000, Date.now() + 8 * 60 * 60 * 1000) };
}

export async function completeOfficialLogin(cookie: string | undefined, state: string | null, code: string | null, fetchImpl: typeof fetch = fetch, getKey: JWTVerifyGetKey = remoteKeys) {
  const flow = takeLoginFlow(cookie);
  const config = officialLoginConfig();
  if (!flow || !state || !code || code.length > 4096 || flow.state.length !== state.length || !timingSafeEqual(Buffer.from(flow.state), Buffer.from(state)) || flow.clientId !== config.clientId || flow.origin !== config.origin) throw new Error("Login expired or invalid");
  const response = await fetchImpl(`${NOUS_PORTAL}/api/oauth/token`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri, client_id: config.clientId, code_verifier: flow.verifier }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Portal rejected login");
  const data = await response.json();
  if (typeof data.access_token !== "string" || (data.token_type && String(data.token_type).toLowerCase() !== "bearer")) throw new Error("Invalid Portal response");
  const session = await verifyOfficialToken(data.access_token, config.clientId, getKey);
  // Tokens (including refresh tokens) never reach the browser or survive this exchange.
  return { token: createOfficialSession(session), destination: flow.destination, maxAge: Math.floor((session.expiresAt - Date.now()) / 1000), secure: config.secure };
}
