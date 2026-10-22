import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const policies = new Map([
  ["/api/model/options", 60000],
  ["/api/providers/custom-endpoints", 60000],
  ["/api/config/schema", 300000],
  ["/api/tools/toolsets", 60000],
]);
const maxAge = 3600000, maxBytes = 2 * 1024 * 1024;
const digest = value => createHash("sha256").update(value).digest("hex");
export const invalidatesHermesMetadata = path => ["/api/model/", "/api/providers/", "/api/env", "/api/config", "/api/tools/", "/api/profiles"].some(prefix => path.startsWith(prefix));

/** Private metadata only. Config values, credentials, auth, sessions and live state bypass this cache. */
export function createHermesReadCache({ directory = () => join(process.env.HERMES_WEB_DATA_DIR || join(homedir(), ".hermes-web"), "metadata-cache"), now = Date.now } = {}) {
  const memory = new Map(), pending = new Map(), latest = new Map(), disabled = new Set();
  const scopeDirectory = context => join(typeof directory === "function" ? directory() : directory, digest(context));
  async function generation(context, discovery = false) {
    try { return await readFile(join(scopeDirectory(context), discovery ? "discovery-generation" : "generation"), "utf8"); } catch { return "initial"; }
  }
  async function atomic(path, text) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, text, { mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async function load(context, key, epoch) {
    const path = join(scopeDirectory(context), digest(key) + ".json");
    let entry = memory.get(path);
    if (!entry) {
      try {
        if ((await stat(path)).size > maxBytes) return null;
        entry = JSON.parse(await readFile(path, "utf8"));
      } catch { return null; }
    }
    if (entry.generation !== epoch || !Number.isFinite(entry.savedAt) || entry.savedAt > now() || now() - entry.savedAt > maxAge || !("data" in entry)) return null;
    memory.delete(path); memory.set(path, entry);
    if (memory.size > 128) memory.delete(memory.keys().next().value);
    return entry;
  }
  async function save(context, key, data, epoch) {
    if (disabled.has(context)) return;
    const discovery = key.startsWith("discovered:");
    if (await generation(context, discovery) !== epoch) return;
    const dir = scopeDirectory(context), path = join(dir, digest(key) + ".json");
    const entry = { generation: epoch, savedAt: now(), data };
    const text = JSON.stringify(entry);
    if (Buffer.byteLength(text) > maxBytes) return;
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await atomic(path, text);
      if (await generation(context, discovery) !== epoch) return;
      memory.delete(path); memory.set(path, entry);
      if (memory.size > 128) memory.delete(memory.keys().next().value);
      const files = (await readdir(dir)).filter(name => name.endsWith(".json"));
      if (files.length > 128) {
        const ages = await Promise.all(files.map(async name => ({ name, time: (await stat(join(dir, name)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })));
        await Promise.all(ages.sort((a, b) => b.time - a.time).slice(128).map(row => unlink(join(dir, row.name)).catch(() => {})));
      }
    } catch { /* A read-only/full cache directory must not break the upstream request. */ }
  }
  const cachedResponse = (entry, state) => Response.json(entry.data, { headers: { "Cache-Control": "no-store", "X-Hermes-Cache": state, "X-Hermes-Cache-Age": String(Math.max(0, Math.floor((now() - entry.savedAt) / 1000))) } });
  async function read(context, path, loader) {
    const url = new URL(path, "http://hermes.internal"), lifetime = policies.get(url.pathname);
    if (!lifetime || disabled.has(context)) return loader(false);
    const refresh = ["1", "true"].includes(url.searchParams.get("refresh"));
    url.searchParams.delete("refresh"); url.searchParams.sort();
    const key = url.pathname + url.search, epoch = await generation(context);
    const entry = await load(context, key, epoch);
    const updateKey = scopeDirectory(context) + ":" + epoch + ":" + key;
    const pendingKey = updateKey + ":" + refresh;
    const update = () => {
      let work = pending.get(pendingKey);
      if (!work) {
        const ticket = Symbol(); latest.set(updateKey, ticket);
        work = (async () => {
          const response = await loader(true);
          if (response.status !== 200) return response;
          const text = await response.clone().text();
          if (Buffer.byteLength(text) <= maxBytes) {
            try { if (latest.get(updateKey) === ticket) await save(context, key, JSON.parse(text), epoch); } catch {}
          }
          const result = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
          result.headers.set("X-Hermes-Cache", refresh ? "REFRESH" : "MISS");
          return result;
        })();
        pending.set(pendingKey, work);
        void work.finally(() => {
          if (pending.get(pendingKey) === work) pending.delete(pendingKey);
          if (latest.get(updateKey) === ticket) latest.delete(updateKey);
        }).catch(() => {});
      }
      return work.then(response => response.clone());
    };
    if (entry && !refresh) {
      const stale = now() - entry.savedAt >= lifetime;
      if (stale) void update().catch(() => {});
      return cachedResponse(entry, stale ? "STALE" : "HIT");
    }
    return update();
  }
  async function invalidate(context, { preserveDiscovery = false } = {}) {
    const dir = scopeDirectory(context);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await atomic(join(dir, "generation"), randomUUID());
      if (!preserveDiscovery) await atomic(join(dir, "discovery-generation"), randomUUID());
    } catch { disabled.add(context); }
    for (const key of memory.keys()) if (key.startsWith(dir)) memory.delete(key);
  }
  const discoveryKey = (profile, endpoint) => "discovered:" + JSON.stringify([profile, endpoint.id, endpoint.base_url, endpoint.api_mode ?? ""]);
  async function rememberDiscovery(context, profile, endpoint, models, epoch) {
    if (!endpoint.id || !Array.isArray(models) || !models.length || models.length > 2000 || models.some(id => typeof id !== "string" || !id || id.length > 1024)) return;
    await save(context, discoveryKey(profile, endpoint), [...new Set(models)], epoch ?? await generation(context, true));
  }
  async function augmentEndpoints(context, profile, response) {
    if (response.status !== 200) return response;
    const data = await response.clone().json().catch(() => null);
    if (!Array.isArray(data?.endpoints)) return response;
    const epoch = await generation(context, true);
    data.endpoints = await Promise.all(data.endpoints.map(async endpoint => {
      const saved = await load(context, discoveryKey(profile, endpoint), epoch);
      return Array.isArray(saved?.data) ? { ...endpoint, models: [...new Set([endpoint.model, ...(endpoint.models ?? []), ...saved.data].filter(Boolean))] } : endpoint;
    }));
    return Response.json(data, { headers: response.headers });
  }
  return { read, invalidate, rememberDiscovery, augmentEndpoints, discoveryRevision: context => generation(context, true) };
}

export const hermesReadCache = globalThis.__hermesReadCache ??= createHermesReadCache();
