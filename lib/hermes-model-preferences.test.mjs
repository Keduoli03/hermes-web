import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { loadHermesModelSelection, rememberHermesModelSelection, forgetHermesModelSelection, sessionHermesModelSelection } = await jiti.import("./hermes-model-preferences.ts");
const { hermesModelOptionsPath, hermesEndpointModels } = await jiti.import("./hermes-model-catalog.ts");

test("model picks survive reload, remain scoped to each chat, preserve provider and bound storage", () => {
  const saved = new Map(), original = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  try {
    assert.equal(loadHermesModelSelection(null), null);
    rememberHermesModelSelection(null, { model: "new-model", provider: "custom:中文" });
    rememberHermesModelSelection("session-a", { model: "shared", provider: "provider-a" });
    rememberHermesModelSelection("session-b", { model: "shared", provider: "provider-b" });
    assert.deepEqual(loadHermesModelSelection(null), { model: "new-model", provider: "custom:中文" });
    assert.equal(loadHermesModelSelection("session-a").provider, "provider-a");
    assert.equal(loadHermesModelSelection("session-b").provider, "provider-b");
    forgetHermesModelSelection("session-a");
    assert.equal(loadHermesModelSelection("session-a"),null,"After a completed run, use the actual persisted session route");
    assert.equal(loadHermesModelSelection("session-b").provider,"provider-b");
    for (let i = 0; i < 110; i++) rememberHermesModelSelection("session-" + i, { model: "model", provider: "provider" });
    assert.equal(JSON.parse([...saved.values()][0]).length, 100);
    saved.set("hermes-model-selections-v1", "broken");assert.equal(loadHermesModelSelection(null), null);
    globalThis.localStorage.getItem = () => { throw new Error("blocked"); };
    assert.equal(loadHermesModelSelection(null), null);
    assert.doesNotThrow(() => rememberHermesModelSelection(null, { model: "one", provider: "two" }));
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test("session routing uses actual provider metadata and falls back safely when older metadata is absent", () => {
  assert.deepEqual(sessionHermesModelSelection({ model: "shared", model_config: '{"provider":"custom:api"}', billing_provider: "billing-only" }), { model: "shared", provider: "custom:api" });
  assert.equal(sessionHermesModelSelection({ model: "old", model_config: "invalid", billing_provider: "fallback" }).provider, "fallback");
  assert.equal(sessionHermesModelSelection({}), null);
});

test("normal and refreshed catalogs use the explicit provider scope and merge discovered custom models", () => {
  assert.equal(hermesModelOptionsPath(), "/api/model/options?explicit_only=1");
  assert.equal(hermesModelOptionsPath(true), "/api/model/options?explicit_only=1&refresh=1");
  assert.deepEqual(hermesEndpointModels({ id: "api", model: "saved", models: ["saved", "cached"] }, [{ slug: "custom:api", name: "API", models: ["saved", "new"] }, { slug: "other", models: ["unrelated"] }]), ["saved", "cached", "new"]);
});
