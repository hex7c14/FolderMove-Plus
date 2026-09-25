/**
 * i18next 的类型增强。
 *
 * 作用：让 `t("...")` 拥有 key 自动补全，并且在写错 key 时直接编译报错。
 * 以**源语言（简体中文）**的 key 结构作为权威定义——新增文案先写进
 * `locales/zh-CN.json`，其它语言包再跟上。
 *
 * 如果某个 key 在其它语言里漏了，运行时会自动回退到中文，不会白屏。
 */
import type { TranslationSchema } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: TranslationSchema;
    };
    // 我们的文案里大量出现 {{path}} / {{size}} 这类插值，
    // 不做 key 层面的强校验，避免把合法写法误判成错误。
    strictKeyChecks: false;
  }
}
