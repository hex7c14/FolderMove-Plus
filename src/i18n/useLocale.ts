/**
 * React 侧的语言状态 hook。
 *
 * `useTranslation()` 已经会在语言切换时触发重渲染；
 * 这里额外把「用户偏好」也暴露出来，供设置里的下拉框使用。
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { changeLocale, readLocalePreference } from "./index";
import { FALLBACK_LOCALE, LOCALES, isLocale } from "./types";
import type { Locale, LocaleMeta, LocalePreference } from "./types";

interface UseLocaleResult {
  /** 当前实际生效的语言 */
  locale: Locale;
  /** 用户偏好（可能是 "system"） */
  preference: LocalePreference;
  /** 切换语言 / 偏好 */
  setPreference: (pref: LocalePreference) => void;
  /** 全部受支持的语言，供下拉框渲染 */
  locales: readonly LocaleMeta[];
}

export function useLocale(): UseLocaleResult {
  const { i18n } = useTranslation();
  const [preference, setPreferenceState] = useState<LocalePreference>(readLocalePreference);

  // i18n.resolvedLanguage 变化时 useTranslation 会触发重渲染，这里直接读取即可
  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const locale: Locale = isLocale(resolved) ? resolved : FALLBACK_LOCALE;

  const setPreference = useCallback((pref: LocalePreference) => {
    setPreferenceState(pref);
    void changeLocale(pref);
  }, []);

  return { locale, preference, setPreference, locales: LOCALES };
}
