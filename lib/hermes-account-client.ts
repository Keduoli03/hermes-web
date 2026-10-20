export type HermesAccountStatus = {
  enabled: boolean;
  authenticated: boolean;
  passwordEnabled: boolean;
  usernameRequired?: boolean;
  official: { enabled: boolean; ready: boolean };
  account?: string | null;
};

export function hermesLoginPath() {
  return `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

export async function signOutHermesWeb() {
  const response = await fetch("/api/web-auth", { method: "DELETE" });
  if (!response.ok) throw new Error("Logout failed");
  window.location.replace("/login");
}
