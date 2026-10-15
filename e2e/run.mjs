import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

const origin = process.env.HERMES_TEST_URL || "http://127.0.0.1:30141";
const suites = (await readdir(new URL(".", import.meta.url)))
  .filter(name => /^hermes-.*\.mjs$/.test(name) && !/-live(?:-|\.)/.test(name))
  .sort();
const selected = process.argv.slice(2);
const requested = selected.length ? suites.filter(name => selected.some(filter => name.includes(filter))) : suites;
if (!requested.length) throw new Error("No matching fixture suites");
const health = await fetch(origin, { signal: AbortSignal.timeout(10000) }).catch(() => null);
if (!health?.ok) throw new Error(`Start the existing workspace dev server before testing: ${origin}`);
let failed = 0;
for (const name of requested) {
  console.log(`\nRunning ${name}`);
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ["--experimental-strip-types", `e2e/${name}`], { stdio: "inherit", env: { ...process.env, HERMES_TEST_URL: origin, HERMES_TEST_BROWSER: process.env.HERMES_TEST_BROWSER || "msedge" }, windowsHide: true });
    const timer = setTimeout(() => { console.error(`${name} exceeded 3 minutes`); child.kill(); }, 180000);
    child.on("error", error => { console.error(error.message); clearTimeout(timer); resolve(1); });
    child.on("exit", code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  if (code !== 0) failed++;
}
console.log(`\n${requested.length - failed}/${requested.length} fixture suites passed.`);
process.exitCode = failed ? 1 : 0;
