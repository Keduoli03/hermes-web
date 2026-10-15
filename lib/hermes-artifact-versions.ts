import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HermesArtifact } from "./hermes-artifacts";

export type ArtifactVersion = { id: string; createdAt: string; size: number; title: string; contentType: string };
export function artifactVersionKey(namespace: string, artifact: HermesArtifact) {
  return createHash("sha256").update(JSON.stringify([namespace, artifact.sessionId, artifact.kind, artifact.source, artifact.title])).digest("hex");
}
function directory(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid version key");
  return join(process.env.HERMES_WEB_DATA_DIR || join(homedir(), ".hermes-web"), "artifact-versions", key);
}
export async function listArtifactVersions(key: string): Promise<ArtifactVersion[]> {
  let names: string[];
  try { names = await readdir(directory(key)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const versions = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
    const version = JSON.parse(await readFile(join(directory(key), name), "utf8")) as ArtifactVersion;
    if (version.id + ".json" !== name || !Number.isSafeInteger(version.size) || version.size < 0 || version.size > 32 * 1024 * 1024) throw new Error("Invalid version record");
    return version;
  }));
  return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveArtifactVersion(key: string, bytes: Uint8Array, title: string, contentType: string) {
  if (bytes.length > 32 * 1024 * 1024) throw new Error("产物超过版本存储上限（32 MB）。");
  const id = createHash("sha256").update(bytes).digest("hex");
  const previous = await listArtifactVersions(key);
  if (previous.some(version => version.id === id)) return previous.find(version => version.id === id)!;
  if (previous.length >= 20) throw new Error("此产物已保存 20 个版本。");
  const dir = directory(key); await mkdir(dir, { recursive: true, mode: 0o700 });
  const version: ArtifactVersion = { id, createdAt: new Date().toISOString(), size: bytes.length, title, contentType };
  const temporary = join(dir, randomUUID());
  try {
    await writeFile(temporary + ".bin", bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary + ".bin", join(dir, id + ".bin"));
    await writeFile(temporary + ".json", JSON.stringify(version), { mode: 0o600, flag: "wx" });
    await rename(temporary + ".json", join(dir, id + ".json"));
  } finally { await unlink(temporary + ".bin").catch(() => {}); await unlink(temporary + ".json").catch(() => {}); }
  return version;
}
export async function readArtifactVersion(key: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid version ID");
  const version = (await listArtifactVersions(key)).find(item => item.id === id);
  if (!version) throw new Error("Version not found");
  const bytes = await readFile(join(directory(key), id + ".bin"));
  if (createHash("sha256").update(bytes).digest("hex") !== id) throw new Error("Version checksum mismatch");
  return { version, bytes };
}
export async function deleteArtifactVersion(key: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid version ID");
  await unlink(join(directory(key), id + ".json"));
  await unlink(join(directory(key), id + ".bin")).catch(error => { if (error.code !== "ENOENT") throw error; });
}
