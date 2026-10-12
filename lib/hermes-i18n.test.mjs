import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fields = JSON.parse(readFileSync(new URL("./i18n/hermes/fields.json", import.meta.url)));
const ui = JSON.parse(readFileSync(new URL("./i18n/hermes/ui.json", import.meta.url)));
const en = JSON.parse(readFileSync(new URL("./i18n/hermes/ui-en.json", import.meta.url)));
test("Hermes UI catalog has unique ids and translates the key navigation and editors", () => {
  assert.equal(new Set(Object.values(ui)).size, Object.keys(ui).length);
  for (const label of ["定时任务", "技能", "持久记忆", "上下文与压缩", "保存提供商", "更多"]) {
    assert.ok(ui[label], label);
    assert.ok(en[label], label);
  }
});
test("desktop memory labels and descriptions are imported with matching English copy", () => {
  assert.equal(fields["zh-CN"].fieldLabels["memory.provider"], "记忆提供方");
  assert.equal(fields["zh-CN"].fieldLabels["memory.memoryEnabled"], "持久记忆");
  assert.equal(fields.en.fieldLabels["memory.provider"], "Memory Provider");
  assert.ok(fields["zh-CN"].fieldDescriptions["memory.memoryEnabled"].includes("持久记忆"));
});
