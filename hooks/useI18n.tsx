"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "@/lib/i18n/registry";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";
import { hermesChineseMessages, hermesEnglishMessages } from "@/lib/i18n/hermes/messages";

const LOCALE_STORAGE_KEY = "pi-locale";
const defaultLocale: Locale = "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(getSupportedLocales().flatMap((id) => {
    const plugin = getLocalePlugin(id);
    return plugin ? [[id, { ...(id === "en" ? hermesEnglishMessages : hermesChineseMessages), ...plugin.messages }]] : [];
  }));
}

function readInitialLocale(fallback?: Locale, storageKey = LOCALE_STORAGE_KEY): Locale {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "en" || stored === "zh-CN" || stored === "zh-TW") return stored;
  } catch {
    // 隐私模式或存储不可用时继续使用浏览器语言。
  }
  return fallback ?? resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
}

/**
 * 提供 Pi Web 的界面语言状态和翻译能力。
 * @param props React 子节点
 * @returns 包含语言上下文的 React 节点
 */
export function I18nProvider({ children, initialLocale, storageKey = LOCALE_STORAGE_KEY }: { children: React.ReactNode; initialLocale?: Locale; storageKey?: string }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? defaultLocale);
  const [hydrated, setHydrated] = useState(false);
  const supportedLocales = useMemo(
    () => getSupportedLocales().map((id) => getLocalePlugin(id)).filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
    [],
  );
  const messages = useMemo(() => getMessages(), []);

  useEffect(() => {
    const next = readInitialLocale(initialLocale, storageKey);
    setLocaleState(next);
    document.documentElement.lang = next;
    setHydrated(true);
  }, [initialLocale, storageKey]);

  const setLocale = useCallback((next: Locale) => {
    if (!getLocalePlugin(next)) return;
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // 存储失败不影响当前页面内的语言切换。
    }
  }, [storageKey]);

  const t = useCallback((key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params), [locale, messages]);
  const value = useMemo(() => ({ locale: hydrated ? locale : initialLocale ?? defaultLocale, setLocale, t, supportedLocales }), [hydrated, locale, initialLocale, setLocale, t, supportedLocales]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 获取当前组件树中的国际化能力。
 * @returns 当前 locale、翻译函数、语言切换函数和支持的语言列表
 * @throws 当组件不在 I18nProvider 内时抛出异常
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
