/**
 * i18n 基础类型与语言元数据。
 *
 * 新增语言只需两步：
 *   1. 在 `locales/` 下新增 `<code>.json`（结构照抄 `zh-CN.json`）
 *   2. 在 `resources.ts` 里 import 并登记
 * 其余（类型推导、下拉框、日期/数字格式化）会自动生效。
 */

/** 支持的界面语言（BCP 47） */
export type Locale = "zh-CN" | "en-US" | "zh-TW" | "ja-JP";

/** 语言下拉框里的展示项 */
export interface LocaleMeta {
  /** BCP 47 语言标签 */
  code: Locale;
  /** 该语言自己的名字（永远用母语书写，不能翻译） */
  nativeName: string;
  /** 中文名，便于在中文界面的设置里辨认 */
  chineseName: string;
}

/**
 * 全部支持的语言。
 * 顺序即语言下拉框的展示顺序，第一项为**源语言**（文案的第一手来源）。
 */
export const LOCALES: readonly LocaleMeta[] = [
  { code: "zh-CN", nativeName: "简体中文", chineseName: "简体中文" },
  { code: "en-US", nativeName: "English", chineseName: "英语" },
  { code: "zh-TW", nativeName: "繁體中文", chineseName: "繁体中文" },
  { code: "ja-JP", nativeName: "日本語", chineseName: "日语" },
];

/** 源语言：新增文案先写在这里，其它语言以它为基准翻译 */
export const SOURCE_LOCALE: Locale = "zh-CN";

/** 兜底语言：某个 key 在目标语言里缺失时回退到这里 */
export const FALLBACK_LOCALE: Locale = "zh-CN";

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

/** 语言偏好持久化用的 localStorage key */
export const LOCALE_STORAGE_KEY = "fm-plus-locale";

/** 语言偏好取值：跟随系统，或指定某个语言 */
export type LocalePreference = "system" | Locale;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);
}

/**
 * 把系统/浏览器给出的语言标签归一化到我们支持的语言。
 * 例："zh-Hans-CN" → "zh-CN"，"zh-Hant-TW" → "zh-TW"，"en-GB" → "en-US"。
 * 无法识别时返回 null，由调用方决定兜底到哪个语言。
 */
export function normalizeLocaleTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const raw = tag.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/_/g, "-");

  // 完全匹配
  const exact = LOCALE_CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;

  const [lang] = lower.split("-");

  // 中文分简繁：Hant / TW / HK / MO 归到繁体，其余归到简体
  if (lang === "zh") {
    const isTraditional =
      lower.includes("hant") ||
      /-(tw|hk|mo)\b/.test(lower) ||
      lower === "zh-tw" ||
      lower === "zh-hk" ||
      lower === "zh-mo";
    return isTraditional ? "zh-TW" : "zh-CN";
  }

  // 其余按主语言匹配第一个已支持的同语种
  return LOCALE_CODES.find((c) => c.toLowerCase().split("-")[0] === lang) ?? null;
}

/** 读取系统语言对应的受支持语言，读不到则返回兜底语言 */
export function detectSystemLocale(): Locale {
  if (typeof navigator === "undefined") return FALLBACK_LOCALE;
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  for (const tag of candidates) {
    const hit = normalizeLocaleTag(tag);
    if (hit) return hit;
  }
  return FALLBACK_LOCALE;
}
