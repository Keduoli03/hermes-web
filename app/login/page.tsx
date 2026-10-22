"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LogIn } from "lucide-react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { safeLoginDestination } from "@/lib/login-destination";
import { HermesAvatar } from "@/components/HermesAvatar";

function safeDestination(): string {
  const destination = new URLSearchParams(window.location.search).get("next");
  return safeLoginDestination(destination, window.location.origin);
}

function LoginForm() {
  const { t } = useI18n();
  const { ht } = useHermesI18n();
  const [status, setStatus] = useState<{enabled: boolean; passwordEnabled: boolean; usernameRequired?: boolean; setupRequired?:boolean; official: {enabled: boolean; ready: boolean}} | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    if (new URLSearchParams(window.location.search).has("auth_error")) setError(ht("官方登录未完成，请重试并确认账号有权访问此面板。"));
    fetch("/api/web-auth", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Auth status unavailable");
      setStatus(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError(ht("无法读取登录配置，请刷新重试。")); });
    return () => controller.abort();
  }, [ht]);

  const failureMessage = async (response: Response): Promise<string> => {
    if (response.status === 401) return status?.usernameRequired ? ht("账号或密码不正确") : t("auth.invalidPassword");
    if (response.status !== 429) return t("auth.loginFailed");
    const seconds = Number(response.headers.get("retry-after"));
    return t("auth.tooManyAttempts", { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 1 });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/web-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(status?.usernameRequired ? { username } : {}) }),
      });
      if (!response.ok) {
        setError(await failureMessage(response));
        return;
      }
      window.location.replace(safeDestination());
    } catch {
      setError(t("auth.loginFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="web-login-page">
      <div className="web-login-shell">
        <header className="web-login-brand">
          <HermesAvatar size={52} priority />
          <div>
            <h1>Hermes Web</h1>
            <p>{ht("登录后访问你的 Hermes 面板。")}</p>
          </div>
        </header>
        {!status && <p role="status">{ht("正在读取登录方式…")}</p>}
        {status && !status.enabled && <div className="web-login-official"><p>{ht(status.setupRequired ? "请先在服务器配置管理员账号密码或官方账号登录。" : "未启用登录验证")}</p>{!status.setupRequired && <Link href="/">{ht("返回面板")}</Link>}</div>}
        {status?.official.enabled && <div className="web-login-official">
          {status.official.ready ? <a className="web-login-official-button" href={`/api/web-auth/official/start?next=${encodeURIComponent(typeof window === "undefined" ? "/" : safeDestination())}`}><LogIn size={17} aria-hidden="true" />{ht("使用 Nous 官方账号登录")}<ArrowRight size={16} aria-hidden="true" /></a> : <p role="status">{ht("官方登录配置尚未完成，请联系面板管理员。")}</p>}
        </div>}
        {status?.passwordEnabled && <form className="web-login-form" onSubmit={submit}>
          {status.official.enabled && <p className="web-login-alternative">{ht(status.usernameRequired ? "或使用管理员账号" : "或使用面板密码")}</p>}
          {status.usernameRequired && <div className="web-login-composer"><label className="web-login-label" htmlFor="web-login-username">{ht("账号")}</label><input id="web-login-username" placeholder={ht("账号")} autoComplete="username" autoFocus required disabled={busy} value={username} onChange={event => setUsername(event.target.value)}/></div>}
          <div className="web-login-composer">
            <label className="web-login-label" htmlFor="web-login-password">{t("auth.password")}</label>
            <input
              id="web-login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("auth.password")}
              autoComplete="current-password"
              autoFocus={!status.usernameRequired}
              required
              disabled={busy}
            />
            <button type="submit" disabled={busy || !password || Boolean(status.usernameRequired && !username)}>
              <ArrowRight size={14} aria-hidden="true" />
              {busy ? t("auth.loggingIn") : t("auth.logIn")}
            </button>
          </div>
        </form>}
        <p className="web-login-error" role="alert" aria-live="polite">{error}</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <I18nProvider initialLocale="zh-CN" storageKey="hermes-web-locale"><LoginForm /></I18nProvider>;
}
