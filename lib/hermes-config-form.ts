import { isMap, isNode, parseDocument } from "yaml";

export type ConfigFieldSchema = { type?: string; category?: string; description?: string; options?: unknown[]; min?: number; max?: number };
export type ConfigSchema = { fields: Record<string, ConfigFieldSchema>; category_order?: string[] };
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export function fieldPath(key: string): string[] {
  const path = key.split(".");
  if (path.some((part) => !part || forbidden.has(part))) throw new Error("无效配置字段");
  return path;
}
export function configDocument(source: string) {
  const document = parseDocument(source || "{}", { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length) throw new Error(`YAML 格式错误：${document.errors[0].message}`);
  if (!isMap(document.contents)) throw new Error("配置必须为 YAML 键值对象。");
  return document;
}
export function configFieldValue(source: string, key: string, fallback?: unknown): unknown {
  return configFieldFromDocument(configDocument(source), key, fallback);
}
export function configFieldFromDocument(document: ReturnType<typeof configDocument>, key: string, fallback?: unknown): unknown {
  const model = document.get("model", true);
  if (key === "model") return (isMap(model) ? model.get("default") ?? model.get("name") : document.get("model")) ?? fallback;
  if (key === "model_context_length") return isMap(model) ? model.get("context_length") ?? fallback : fallback;
  const value = document.getIn(fieldPath(key));
  return value === undefined ? fallback : isNode(value) ? value.toJSON() : value;
}
export function updateConfigField(source: string, key: string, value: unknown): string {
  const document = configDocument(source);
  if (key === "model" && isMap(document.get("model", true))) document.setIn(["model", "default"], value);
  else if (key === "model_context_length") {
    const model = document.get("model");
    if (!isMap(document.get("model", true))) document.set("model", document.createNode({ ...(typeof model === "string" ? { default: model } : {}) }));
    document.setIn(["model", "context_length"], value);
  } else document.setIn(fieldPath(key), value);
  return document.toString({ lineWidth: 0 });
}
export function getObjectField(object: Record<string, unknown>, key: string): unknown {
  return fieldPath(key).reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, object);
}
export function configPatch(source: string, changed: Iterable<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of changed) {
    const path = fieldPath(key); let current = result;
    for (const part of path.slice(0, -1)) current = (current[part] ??= {}) as Record<string, unknown>;
    current[path.at(-1)!] = configFieldValue(source, key);
  }
  return result;
}
