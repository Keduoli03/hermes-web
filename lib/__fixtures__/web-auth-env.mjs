import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

const previous = process.env.HERMES_WEB_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), "hermes-panel-auth-test-"));
process.env.HERMES_WEB_DATA_DIR = directory;
after(() => {
  if (previous === undefined) delete process.env.HERMES_WEB_DATA_DIR;
  else process.env.HERMES_WEB_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
});
