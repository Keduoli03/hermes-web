// Use Hermes' documented loopback SPA/desktop handshake. Never inspect process memory.
import { readFile, writeFile } from "node:fs/promises";
const address = process.argv[2];
if (!address) throw new Error("Usage: node bin/connect-hermes-local.mjs http://127.0.0.1:PORT");
const base = new URL(address);
if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) throw new Error("Only a local loopback Hermes backend is supported");
const response = await fetch(base, { redirect: "error" });
const html = await response.text();
const token = html.match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*("[^"\r\n]+")/);
if (!response.ok || !token) throw new Error("Hermes did not expose the supported local handshake; authenticate through its configured provider");
const sessionToken = JSON.parse(token[1]);
const check = await fetch(new URL("/api/config/schema", base), { headers: { "X-Hermes-Session-Token": sessionToken }, redirect: "error" });
if (!check.ok) throw new Error(`Hermes schema check failed (${check.status})`);
const schema = await check.json();
let source = await readFile(".env.local", "utf8").catch(() => "");
for (const [key, value] of Object.entries({ HERMES_DASHBOARD_URL: base.origin, HERMES_DASHBOARD_SESSION_TOKEN: sessionToken })) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  source = pattern.test(source) ? source.replace(pattern, `${key}=${value}`) : `${source.trimEnd()}\n${key}=${value}\n`;
}
await writeFile(".env.local", source);
console.log(`Connected to local Hermes at ${base.origin}; ${Object.keys(schema.fields ?? {}).length} config fields. Credentials saved only in ignored .env.local.`);
