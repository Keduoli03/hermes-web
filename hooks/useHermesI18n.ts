"use client";

import { useCallback } from "react";
import { useI18n } from "./useI18n";
import { hermesUiIds } from "@/lib/i18n/hermes/messages";
import { interpolateMessage } from "@/lib/i18n/format";
import type { TranslationParams } from "@/lib/i18n/types";

export function useHermesI18n() {
  const i18n = useI18n();
  const { t } = i18n;
  const ht = useCallback((source: string, params?: TranslationParams) => {
    const key = hermesUiIds[source];
    return key ? t(key, params) : interpolateMessage(source, params);
  }, [t]);
  return { ...i18n, ht };
}
