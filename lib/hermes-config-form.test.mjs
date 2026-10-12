import test from "node:test";
import assert from "node:assert/strict";
import { configFieldValue, configDocument, updateConfigField, configPatch } from "./hermes-config-form.ts";

test("form model updates preserve provider routing, unknown fields and comments", () => {
  const source = "# user config\nmodel:\n  default: old # selected model\n  provider: local-provider\n  base_url: http://localhost:9999/v1\nextra:\n  untouched: true\n";
  const next = updateConfigField(source, "model", "new");
  assert.match(next, /# user config/);
  assert.match(next, /# selected model/);
  assert.equal(configFieldValue(next, "model"), "new");
  assert.equal(configFieldValue(next, "model.provider"), "local-provider");
  assert.equal(configFieldValue(next, "extra.untouched"), true);
  assert.deepEqual(configPatch(next, ["model"]), { model: "new" });
});

test("nested structured values remain data, preserving false, zero and null", () => {
  const source = "memory:\n  memory_enabled: false\n  memory_char_limit: 0\n  provider: null\nsettings:\n  choices: [one, two]\n  options: {enabled: true}\n";
  assert.equal(configFieldValue(source, "memory.memory_enabled", true), false);
  assert.equal(configFieldValue(source, "memory.memory_char_limit", 2200), 0);
  assert.equal(configFieldValue(source, "memory.provider", "fallback"), null);
  assert.deepEqual(configFieldValue(source, "settings.choices"), ["one", "two"]);
  assert.deepEqual(configFieldValue(source, "settings.options"), { enabled: true });
  const next = updateConfigField(source, "settings.options", { enabled: false, names: ["test"] });
  assert.deepEqual(configPatch(next, ["settings.options"]), { settings: { options: { enabled: false, names: ["test"] } } });
});

test("context window migration preserves a scalar model", () => {
  const next = updateConfigField("model: test-model\n", "model_context_length", 64000);
  assert.equal(configFieldValue(next, "model"), "test-model");
  assert.equal(configFieldValue(next, "model_context_length"), 64000);
  assert.deepEqual(configPatch(next, ["model_context_length"]), { model_context_length: 64000 });
});

test("invalid YAML and prototype paths are refused before saving", () => {
  for (const source of ["a: [", "- list", "a: 1\na: 2\n"]) assert.throws(() => configDocument(source));
  assert.throws(() => updateConfigField("{}", "__proto__.polluted", true));
  assert.throws(() => configPatch("{}", ["constructor.prototype.polluted"]));
  assert.equal({}.polluted, undefined);
});
