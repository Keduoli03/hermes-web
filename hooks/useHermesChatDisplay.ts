"use client";

import { useSyncExternalStore } from "react";

type Preferences = { showReasoning: boolean; collapseReasoning: boolean; toolDetails: boolean; direction: "auto" | "ltr" | "rtl"; bubbleTransparency: number };
const defaults: Preferences = { showReasoning: true, collapseReasoning: true, toolDetails: false, direction: "auto", bubbleTransparency: 0 };
const key = "hermes-chat-display-v1";
let state: Preferences | null = null;
const listeners = new Set<() => void>();
function read(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    return { showReasoning: typeof stored.showReasoning === "boolean" ? stored.showReasoning : true, collapseReasoning: typeof stored.collapseReasoning === "boolean" ? stored.collapseReasoning : true, toolDetails: stored.toolDetails === true, direction: ["ltr", "rtl"].includes(stored.direction) ? stored.direction : "auto", bubbleTransparency: typeof stored.bubbleTransparency === "number" && Number.isFinite(stored.bubbleTransparency) ? Math.max(0, Math.min(100, stored.bubbleTransparency)) : 0 };
  } catch { return defaults; }
}
function snapshot() { return state ??= read(); }
function storage(event: StorageEvent) { if (event.key === key || event.key === null) { state = read(); listeners.forEach(listener => listener()); } }
function subscribe(listener: () => void) { if (!listeners.size) window.addEventListener("storage", storage); listeners.add(listener); return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener("storage", storage); }; }
export function useHermesChatDisplay() {
  const preferences = useSyncExternalStore(subscribe, snapshot, () => defaults);
  function set<K extends keyof Preferences>(name: K, value: Preferences[K]) { state = { ...snapshot(), [name]: value }; try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Keep page preferences when storage is blocked. */ } listeners.forEach(listener => listener()); }
  return { ...preferences, set };
}
