/**
 * 语言包登记处——**唯一需要手动维护的 i18n 配置**。
 *
 * 新增一门语言：
 *   1. `src/i18n/locales/<code>.json`（照抄 `zh-CN.json` 的结构）
 *   2. `src/i18n/types.ts` 的 `Locale` 联合类型里加上这个 code
 *   3. 本文件 import 进来并加进 `resources`
 * 类型检查、语言下拉框、日期/数字格式化都会自动跟上。
 */
import type { Locale } from "./types";

import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
import zhTW from "./locales/zh-TW.json";
import jaJP from "./locales/ja-JP.json";

/**
 * 注意这层 `translation` 命名空间不能省：
 * i18next 的资源结构是 `resources[语言][命名空间]`，默认命名空间是 `translation`。
 * 少一层的话所有 `t("nav.apps")` 都会查不到，界面直接显示 key 本身。
 * （我们只有一个命名空间，就用默认的这个。）
 */
export const resources = {
  "zh-CN": { translation: zhCN },
  "en-US": { translation: enUS },
  "zh-TW": { translation: zhTW },
  "ja-JP": { translation: jaJP },
} satisfies Record<Locale, { translation: unknown }>;

/**
 * 以源语言（简体中文）为准推导出的 key 结构。
 * `src/i18n/i18next.d.ts` 用它把 `t()` 的入参收紧：写错 key 编译期就报错。
 */
export type TranslationSchema = typeof zhCN;
