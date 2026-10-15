import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @typedef {{state: string, verifier: string, destination: string, clientId: string, origin: string, expiresAt: number}} LoginFlow */
/** @typedef {{userId: string, clientId: string, expiresAt: number}} OfficialSession */
function directory(kind) {
  const path = join(process.env.HERMES_WEB_DATA_DIR || join(homedir(), ".hermes-web"), "auth", kind);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}
function filename(kind, id) {
  return join(directory(kind), createHash("sha256").update(id).digest("hex") + ".json");
}
function remove(path) { try { unlinkSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; } }
function read(kind, id) {
  try { return JSON.parse(readFileSync(filename(kind, id), "utf8")); }
  catch { return undefined; }
}
function save(kind, id, value, limit) {
  const dir = directory(kind);
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const path = join(dir, name);
    try {
      const entry = JSON.parse(readFileSync(path, "utf8"));
      if (!Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= Date.now()) remove(path);
      else count++;
    } catch { remove(path); }
  }
  if (count >= limit) throw new Error("Too many authentication records");
  // Publish complete records atomically; readers never cache revocation state.
  const target = filename(kind, id), temporary = target + "." + randomBytes(8).toString("hex");
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    renameSync(temporary, target);
  } finally { remove(temporary); }
}

export function isOfficialLoginEnabled() {
  // Incomplete configuration must still engage the gate, never fall back to anonymous.
  return Boolean(process.env.HERMES_WEB_OAUTH_CLIENT_ID?.trim());
}

/** @param {LoginFlow} flow */
export function storeLoginFlow(flow) {
  const id = randomBytes(32).toString("base64url");
  save("flows", id, flow, 512);
  return id;
}

/** @param {string | undefined} id */
export function takeLoginFlow(id) {
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return;
  const path = filename("flows", id), claimed = path + "." + randomBytes(8).toString("hex");
  // Rename is a one-use claim across Node processes sharing the same data dir.
  try { renameSync(path, claimed); } catch { return; }
  try { const flow = JSON.parse(readFileSync(claimed, "utf8")); return flow.expiresAt > Date.now() ? flow : undefined; }
  finally { remove(claimed); }
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
  const id = `nous.${randomBytes(32).toString("base64url")}`;
  save("sessions", id, session, 4096);
  return id;
}

/** @param {string | undefined} token */
export function officialSession(token, now = Date.now()) {
  if (!token || !/^nous\.[A-Za-z0-9_-]{43}$/.test(token)) return;
  const session = read("sessions", token);
  if (!session) return;
  if (!Number.isSafeInteger(session.expiresAt) || typeof session.userId !== "string" || session.expiresAt <= now || session.clientId !== process.env.HERMES_WEB_OAUTH_CLIENT_ID?.trim() || !isOfficialUserAllowed(session.userId)) {
    try { remove(filename("sessions", token)); } catch { /* Invalid records never authenticate even on read-only storage. */ }
    return;
  }
  return session;
}

/** @param {string | undefined} token */
export function revokeOfficialSession(token) {
  if (token && /^nous\.[A-Za-z0-9_-]{43}$/.test(token)) remove(filename("sessions", token));
}
