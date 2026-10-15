import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ArtifactSession, HermesArtifact } from "./hermes-artifacts.ts";

const version = 1;
const maxBytes = 20 * 1024 * 1024;
type RecordEntry = { version: number; fingerprint: string; savedAt: number; artifacts: HermesArtifact[] };
const state = globalThis as typeof globalThis & { hermesArtifactLoads?: Map<string, Promise<HermesArtifact[]>> };
const loads = state.hermesArtifactLoads ??= new Map();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function artifactIndexDirectory() {
  return join(process.env.HERMES_WEB_DATA_DIR || join(homedir(), ".hermes-web"), "artifacts");
}

/** The backend's session metadata, never browser-supplied cache validators. */
export function artifactFingerprint(session: ArtifactSession) {
  return digest(JSON.stringify([session.id, session.title, session.preview, session.cwd, session.last_active, session.updated_at, session.message_count]));
}

export async function indexedSessionArtifacts(options: {
  directory?: string; namespace: string; session: ArtifactSession; force?: boolean;
  load: () => Promise<HermesArtifact[]>; now?: number;
}): Promise<HermesArtifact[]> {
  const { session, namespace, load, force = false, now = Date.now() } = options;
  const directory = join(options.directory ?? artifactIndexDirectory(), digest(namespace));
  const path = join(directory, `${digest(session.id)}.json`);
  const fingerprint = artifactFingerprint(session);
  const key = `${path}:${fingerprint}:${force}`;
  const pending = loads.get(key);
  if (pending) return pending;
  const promise = (async () => {
    if (!force) {
      try {
        if ((await stat(path)).size <= maxBytes) {
          const cached: RecordEntry = JSON.parse(await readFile(path, "utf8"));
          // A TTL also catches transcript edits that do not update session metadata.
          const ttl = session.last_active != null || session.updated_at != null ? 86_400_000 : 60_000;
          if (cached.version === version && cached.fingerprint === fingerprint && now >= cached.savedAt && now - cached.savedAt < ttl && Array.isArray(cached.artifacts)) return cached.artifacts;
        }
      } catch { /* Missing or corrupt indexes are rebuilt from the original transcript. */ }
    }
    const artifacts = await load();
    // Do not persist media bytes. Sessions containing inline media remain uncached.
    if (artifacts.some(item => item.source.startsWith("data:"))) {
      await rm(path, { force: true }).catch(() => {});
      return artifacts;
    }
    const contents = JSON.stringify({ version, fingerprint, savedAt: now, artifacts });
    if (Buffer.byteLength(contents) > maxBytes) {
      await rm(path, { force: true }).catch(() => {});
      return artifacts;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } catch { /* Read-only deployments still support browsing, without persistence. */ }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
    return artifacts;
  })();
  loads.set(key, promise);
  try { return await promise; }
  finally { if (loads.get(key) === promise) loads.delete(key); }
}
