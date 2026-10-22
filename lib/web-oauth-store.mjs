import { randomBytes } from "node:crypto";
import { saveAuthRecord, claimAuthRecord, createPanelSession, readPanelSession, revokePanelSession } from "./web-auth-store.mjs";

/** @typedef {{state: string, verifier: string, destination: string, clientId: string, origin: string, expiresAt: number}} LoginFlow */
/** @typedef {{userId: string, clientId: string, expiresAt: number}} OfficialSession */

export function isOfficialLoginEnabled() {
  // Incomplete configuration must still engage the gate, never fall back to anonymous.
  return Boolean(process.env.HERMES_WEB_OAUTH_CLIENT_ID?.trim());
}

/** @param {LoginFlow} flow */
export function storeLoginFlow(flow) {
  const id = randomBytes(32).toString("base64url");
  saveAuthRecord("flows", id, flow, 512);
  return id;
}

/** @param {string | undefined} id */
export function takeLoginFlow(id) {
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return;
  const flow = claimAuthRecord("flows", id);
  return flow?.expiresAt > Date.now() ? flow : undefined;
}

/** @param {string} userId */
export function isOfficialUserAllowed(userId) {
  const users = process.env.HERMES_WEB_OAUTH_ALLOWED_USERS?.split(",").map(user => user.trim()).filter(Boolean);
  // Without an additional allow-list, Portal's instance/organization permission applies.
  return !users?.length || users.includes(userId);
}

/** @param {OfficialSession} session */
export function createOfficialSession(session) {
  if (!Number.isSafeInteger(session.expiresAt) || typeof session.userId !== "string" || typeof session.clientId !== "string" || session.expiresAt <= Date.now() || !isOfficialUserAllowed(session.userId)) throw new Error("Account not allowed");
  return createPanelSession({ ...session, method: "official" });
}

/** @param {string | undefined} token */
export function officialSession(token, now = Date.now()) {
  const session = readPanelSession(token, now);
  if (!session || (session.method !== "official" && !token?.startsWith("nous."))) return;
  if (!Number.isSafeInteger(session.expiresAt) || typeof session.userId !== "string" || session.expiresAt <= now || session.clientId !== process.env.HERMES_WEB_OAUTH_CLIENT_ID?.trim() || !isOfficialUserAllowed(session.userId)) {
    try { revokePanelSession(token); } catch { /* Invalid records never authenticate even on read-only storage. */ }
    return;
  }
  return session;
}

/** @param {string | undefined} token */
export function revokeOfficialSession(token) {
  if (officialSession(token)) revokePanelSession(token);
}
