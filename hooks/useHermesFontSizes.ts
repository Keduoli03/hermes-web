"use client";

import { useSyncExternalStore } from "react";

type Sizes = { ui: number; code: number };
const defaults: Sizes = { ui: 14, code: 13 };
const keys = { ui: "hermes-ui-font-size", code: "hermes-code-font-size" };
let sizes: Sizes | null = null;
const listeners = new Set<() => void>();
function clamp(kind: keyof Sizes, value: unknown) {
  const parsed = value === null ? defaults[kind] : Number(value);
  return Number.isFinite(parsed) ? Math.max(kind === "ui" ? 12 : 10, Math.min(kind === "ui" ? 20 : 22, Math.round(parsed))) : defaults[kind];
}
function apply(next: Sizes) {
  document.documentElement.style.setProperty("--hermes-ui-font-offset", `${next.ui - 14}px`);
  document.documentElement.style.setProperty("--hermes-code-font-size", `${next.code}px`);
}
function read(): Sizes {
  const next = { ...defaults };
  for (const kind of ["ui", "code"] as const) {
    try { next[kind] = clamp(kind, localStorage.getItem(keys[kind])); } catch { /* Keep defaults when storage is blocked. */ }
  }
  return next;
}
function snapshot() {
  if (!sizes) { sizes = read(); apply(sizes); }
  return sizes;
}
function onStorage(event: StorageEvent) {
  if (event.key !== null && !Object.values(keys).includes(event.key)) return;
  sizes = read(); apply(sizes); listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener("storage", onStorage); };
}
export function useHermesFontSizes() {
  const value = useSyncExternalStore(subscribe, snapshot, () => defaults);
  function setSize(kind: keyof Sizes, size: number) {
    sizes = { ...snapshot(), [kind]: clamp(kind, size) }; apply(sizes);
    try { localStorage.setItem(keys[kind], String(sizes[kind])); } catch { /* Apply without persistence. */ }
    listeners.forEach(listener => listener());
  }
  return { ...value, setSize };
}
