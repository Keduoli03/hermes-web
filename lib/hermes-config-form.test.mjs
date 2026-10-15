import test from "node:test";
import assert from "node:assert/strict";
import { configFieldValue, configDocument, updateConfigField, configPatch } from "./hermes-config-form.ts";
import { isWebConfigField, isConfigFieldApplicable } from "./hermes-settings-fields.ts";

test("web forms exclude other client preferences and reveal only selected runtime fields", () => {
  for (const key of ["desktop.repo_scan_enabled", "desktop.electron_flags", "bot_desktop.enabled", "display.show_reasoning", "updates.non_interactive_local_changes", "voice.auto_tts", "terminal.font_family"]) assert.equal(isWebConfigField(key), false, key);
  for (const key of ["terminal.cwd", "terminal.backend", "terminal.docker_image", "tts.provider", "stt.enabled", "memory.provider"]) assert.equal(isWebConfigField(key), true, key);
  const state = { "terminal.backend": "local", "tts.provider": "edge", "stt.provider": "openai" };
  const value = key => state[key];
  assert.equal(isConfigFieldApplicable("terminal.docker_image", value), false);
  assert.equal(isConfigFieldApplicable("terminal.modal_image", value), false);
  state["terminal.backend"] = "docker";
  assert.equal(isConfigFieldApplicable("terminal.docker_image", value), true);
  assert.equal(isConfigFieldApplicable("tts.edge.voice", value), true);
  assert.equal(isConfigFieldApplicable("tts.openai.model", value), false);
  assert.equal(isConfigFieldApplicable("stt.openai.model", value), true);
  assert.equal(isConfigFieldApplicable("stt.local.model", value), false);
  const source = "desktop:\n  repo_scan_enabled: true\nterminal:\n  backend: docker\n  docker_image: private-image\n";
  const next = updateConfigField(source, "terminal.backend", "local");
  assert.equal(configFieldValue(next, "desktop.repo_scan_enabled"), true);
  assert.equal(configFieldValue(next, "terminal.docker_image"), "private-image");
  assert.deepEqual(configPatch(next, ["terminal.backend"]), { terminal: { backend: "local" } });
});

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
