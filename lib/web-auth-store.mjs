import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function directory(kind) {
  const path = join(process.env.HERMES_WEB_DATA_DIR || join(homedir(), ".hermes-web"), "auth", kind);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}
function filename(kind, id) {
  return join(directory(kind), createHash("sha256").update(id).digest("hex") + ".json");
}
function remove(path) {
  try { unlinkSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
export function readAuthRecord(kind, id) {
  try { return JSON.parse(readFileSync(filename(kind, id), "utf8")); }
  catch { return undefined; }
}
export function removeAuthRecord(kind, id) { remove(filename(kind, id)); }
export function saveAuthRecord(kind, id, value, limit) {
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
  const target = filename(kind, id), temporary = target + "." + randomBytes(8).toString("hex");
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    renameSync(temporary, target);
  } finally { remove(temporary); }
}
export function claimAuthRecord(kind, id) {
  const path = filename(kind, id), claimed = path + "." + randomBytes(8).toString("hex");
  // Atomic rename makes login flows single-use across processes.
  try { renameSync(path, claimed); } catch { return; }
  try { return JSON.parse(readFileSync(claimed, "utf8")); }
  finally { remove(claimed); }
}

export function createPanelSession(session) {
  const id = `web.${randomBytes(32).toString("base64url")}`;
  saveAuthRecord("sessions", id, session, 4096);
  return id;
}
export function readPanelSession(token, now = Date.now()) {
  // Existing official-account sessions remain valid through their original expiry.
  if (!token || !/^(web|nous)\.[A-Za-z0-9_-]{43}$/.test(token)) return;
  const session = readAuthRecord("sessions", token);
  if (!session) return;
  if (!Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) {
    try { revokePanelSession(token); } catch { /* Expired records never authenticate on read-only storage. */ }
    return;
  }
  return session;
}
export function revokePanelSession(token) {
  if (token && /^(web|nous)\.[A-Za-z0-9_-]{43}$/.test(token)) removeAuthRecord("sessions", token);
}
