const storageKey = "hermes-recent-projects";
const currentKey = "hermes-current-project";
export const recentProjectsChanged = "hermes-recent-projects-changed";

export function loadCurrentHermesProject(): string | null {
  try {
    const saved = localStorage.getItem(currentKey);
    return saved && saved.length <= 4096 ? saved : null;
  } catch { return null; }
}

export function loadRecentHermesProjects(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(saved) ? saved.filter((path): path is string => typeof path === "string" && path.length > 0 && path.length <= 4096).slice(0, 8) : [];
  } catch { return []; }
}

export function rememberHermesProject(cwd: string | null) {
  if (!cwd) {
    try { localStorage.removeItem(currentKey); } catch {}
    return;
  }
  const recent = [cwd, ...loadRecentHermesProjects().filter(path => path !== cwd)].slice(0, 8);
  try { localStorage.setItem(currentKey, cwd); localStorage.setItem(storageKey, JSON.stringify(recent)); } catch {}
  window.dispatchEvent(new CustomEvent(recentProjectsChanged, { detail: recent }));
}
