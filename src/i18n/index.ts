/**
 * i18n 初始化与语言切换。
 *
 * 设计要点：
 * - **同步初始化**：语言包直接打包进 bundle（Tauri 本地应用无需按需加载），
 *   所以首帧就有正确文案，不会出现英文闪现再变中文的问题。
 * - **持久化 key** 与主题一致，走 localStorage；默认跟随系统语言。
 * - 切换语言时同步更新 `<html lang>` 和窗口标题，方便无障碍工具与任务栏显示。
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { resources } from "./resources";
import { FALLBACK_LOCALE, LOCALE_STORAGE_KEY, SOURCE_LOCALE } from "./types";
import type { Locale, LocalePreference } from "./types";
import { detectSystemLocale, isLocale } from "./types";
import { K } from "./keys";

export { default as i18n } from "i18next";
export { Trans, useTranslation } from "react-i18next";
export * from "./types";
export * from "./keys";
export type { TranslationSchema } from "./resources";

/* -------------------------------------------------------------------------- */
/* 语言偏好读写                                                                */
/* -------------------------------------------------------------------------- */

/** 读取用户保存的语言偏好；未设置或非法则返回 "system" */
export function readLocalePreference(): LocalePreference {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === "system") return "system";
    return isLocale(raw) ? raw : "system";
  } catch {
    // localStorage 不可用（隐私模式等）时按跟随系统处理
    return "system";
  }
}

function writeLocalePreference(pref: LocalePreference) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, pref);
  } catch {
    /* 忽略：存不下也不影响本次会话 */
  }
}

/** 把偏好解析成实际生效的语言 */
export function resolvePreference(pref: LocalePreference): Locale {
  return pref === "system" ? detectSystemLocale() : pref;
}

/* -------------------------------------------------------------------------- */
/* 初始化                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 初始化 i18n。必须在 React 渲染之前调用（见 `main.tsx`）。
 * 返回实际生效的语言。
 */
export function initI18n(): Locale {
  const pref = readLocalePreference();
  const locale = resolvePreference(pref);

  assertResourceShape();

  if (!i18n.isInitialized) {
    // 注意：init 在语言包内联时是同步完成的
    void i18n.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: Object.keys(resources),
      // 关掉 "en-US" → "en" 的自动降级探测，我们的 key 与系统语言是一一对应的
      load: "currentOnly",
      // React 已经做了转义，这里再转义会把路径里的引号变成实体
      interpolation: { escapeValue: false },
      // 复数后缀：英文用 _one/_other，中日文只有 _other
      pluralSeparator: "_",
      debug: import.meta.env.DEV,
    });
  } else {
    void i18n.changeLanguage(locale);
  }

  // 语言切换时刷新 DOM 侧信息（title 由 useWindowTitle 负责，这里先兜住首帧）
  applyLocaleSideEffects(locale, pref);
  i18n.on("languageChanged", (lng) => {
    const next = isLocale(lng) ? lng : FALLBACK_LOCALE;
    applyLocaleSideEffects(next, readLocalePreference());
  });

  return locale;
}

/**
 * 自检：资源必须是 `resources[语言][命名空间]` 两层结构。
 * 少一层 `translation` 的话，所有 `t()` 都会查不到 key、界面直接显示 key 名，
 * 这种错误在类型层面看不出来（`satisfies Record<Locale, {translation: unknown}>` 放得过去），
 * 所以启动时显式喊一声。
 */
function assertResourceShape() {
  for (const [locale, value] of Object.entries(resources)) {
    const ns = (value as Record<string, unknown>)["translation"];
    if (!ns || typeof ns !== "object") {
      console.error(
        `[i18n] 语言包 ${locale} 缺少 "translation" 命名空间层，` +
          `请写成 resources["${locale}"] = { translation: xx }（见 src/i18n/resources.ts）`
      );
    }
  }
}

/** 语言变化时需要同步到 DOM / 窗口的副作用 */
function applyLocaleSideEffects(locale: Locale, pref: LocalePreference) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    // 让浏览器为当前语言挑选合适的字体（中日文字形不同）
    document.documentElement.dataset.locale = locale;
    document.documentElement.dataset.localePref = pref;
    document.title = i18n.t(K.app.title);
  }
}

/* -------------------------------------------------------------------------- */
/* 切换语言                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 切换语言。
 * @param pref 目标语言，或 "system" 表示跟随系统
 */
export async function changeLocale(pref: LocalePreference): Promise<void> {
  writeLocalePreference(pref);
  const next = resolvePreference(pref);
  if (i18n.resolvedLanguage !== next) {
    await i18n.changeLanguage(next);
  } else {
    // 语言没变，但偏好可能从 system → 具体语言，仍需刷新 dataset
    applyLocaleSideEffects(next, pref);
  }
}

/** 当前生效的语言（非 React 环境可用） */
export function currentLocale(): Locale {
  const lng = i18n.resolvedLanguage ?? i18n.language;
  return isLocale(lng) ? lng : SOURCE_LOCALE;
}

/** 当前语言对应的 BCP 47 标签，用于 Intl 格式化 */
export function currentIntlLocale(): string {
  return currentLocale();
}
