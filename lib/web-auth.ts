import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isOfficialLoginEnabled, officialSession } from "./web-oauth-store.mjs";
import { createPanelSession, readPanelSession, revokePanelSession } from "./web-auth-store.mjs";

export const PI_WEB_AUTH_USERNAME = "pi";
export function isWebUsernameRequired(): boolean { return Boolean(process.env.PI_WEB_USERNAME?.trim()); }
export function getWebAuthUsername(): string { return process.env.PI_WEB_USERNAME?.trim() || PI_WEB_AUTH_USERNAME; }
export function isValidWebUsername(value: unknown): boolean {
  return !isWebUsernameRequired() || typeof value === "string" && secretsEqual(value, getWebAuthUsername());
}
export const PI_WEB_SESSION_COOKIE = "pi_web_session";
export const PI_WEB_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function isWebAuthEnabled(password = process.env.PI_WEB_PASSWORD): boolean {
  return isWebPasswordEnabled(password) || isOfficialLoginEnabled();
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

export function isWebPasswordEnabled(
  password: string | undefined = process.env.PI_WEB_PASSWORD,
): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidWebPassword(
  suppliedPassword: string,
  password = process.env.PI_WEB_PASSWORD,
): boolean {
  return isWebPasswordEnabled(password) && secretsEqual(suppliedPassword, password);
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password = process.env.PI_WEB_PASSWORD,
): boolean {
  if (!isWebPasswordEnabled(password) || !authorization) return false;

  const match = /^Basic\s+(\S+)$/i.exec(authorization);
  if (!match) return false;

  let credentials: string;
  try {
    const decoded = Buffer.from(match[1], "base64");
    if (decoded.toString("base64") !== match[1]) return false;
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return false;
  }

  const separator = credentials.indexOf(":");
  if (separator === -1) return false;

  const username = credentials.slice(0, separator);
  const suppliedPassword = credentials.slice(separator + 1);
  const usernameMatches = secretsEqual(username, getWebAuthUsername());
  const passwordMatches = isValidWebPassword(suppliedPassword, password);
  return usernameMatches && passwordMatches;
}

function passwordIdentity(password: string, salt: string): string {
  const owner = isWebUsernameRequired() ? `${getWebAuthUsername()}:` : "";
  return createHmac("sha256", password).update(`hermes-web-password:${salt}:${owner}`, "utf8").digest("hex");
}

export function createWebSessionToken(
  password: string,
  now = Date.now(),
): string {
  if (!isWebPasswordEnabled(password)) throw new Error("Password authentication is disabled");
  const salt = randomBytes(16).toString("hex");
  return createPanelSession({ method: "password", salt, identity: passwordIdentity(password, salt), expiresAt: now + PI_WEB_SESSION_MAX_AGE * 1000 });
}

export function isValidWebSessionToken(
  token: string | undefined,
  password = process.env.PI_WEB_PASSWORD,
  now = Date.now(),
): boolean {
  const session = readPanelSession(token, now);
  if (!session) return false;
  if (session.method === "official" || token?.startsWith("nous.")) return Boolean(officialSession(token, now));
  return session.method === "password" && isWebPasswordEnabled(password)
    && typeof session.salt === "string" && /^[a-f0-9]{32}$/.test(session.salt)
    && typeof session.identity === "string" && secretsEqual(session.identity, passwordIdentity(password, session.salt));
}

export function revokeWebSessionToken(token: string | undefined): void { revokePanelSession(token); }
