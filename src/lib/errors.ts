/**
 * 后端错误的解析与本地化。
 *
 * Rust 侧的命令统一返回 `Result<T, AppError>`，`AppError` 会被序列化成
 * `{ code, params }`（例如 `{ code: "insufficientSpace", params: { needed: 1, available: 2 } }`）。
 * 这里把它翻译成当前语言的句子；遇到无法识别的形状就退化成「原样展示」，
 * 保证任何情况下都不会因为一条错误信息把界面搞崩。
 */
import type { ParseKeys, TFunction } from "i18next";

import { ERROR_KEY_PREFIX, K } from "../i18n/keys";
import {
  isErrorCode,
  isProgressMessageCode,
  isProgressPhase,
  isReasonCode,
} from "../i18n/codes";
import type { StructuredError } from "../i18n/codes";

/** `t()` 接受的 key 类型（由 `src/i18n/i18next.d.ts` 的类型增强推导） */
type TranslatableKey = ParseKeys;

/**
 * 统一的取词助手：这些 key 都是运行时拼出来的（错误码 / 原因码），
 * 无法静态校验，所以在这里集中做一次类型收敛，业务代码不必到处 `as`。
 */
function tr(
  t: TFunction,
  key: TranslatableKey,
  params?: Record<string, string | number>
): string {
  // options 被放宽成 never，返回值可能是 TFunctionDetailedResult，
  // 这里先转 unknown 再收敛成 string（我们从不传 returnDetails）
  return t(key, (params ?? {}) as never) as unknown as string;
}

/** 把任意 thrown 值整理成可读文本（无法识别时返回兜底文案） */
function rawText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 尝试把 thrown 值解析成结构化错误。
 * 兼容三种形态：
 *   1. `{ code, params }`（当前后端）
 *   2. `'{"code":"sameDrive"}'`（错误对象被当成字符串传来）
 *   3. 普通字符串 / Error（旧后端、系统错误）→ 返回 null
 */
export function parseStructuredError(value: unknown): StructuredError | null {
  if (typeof value === "object" && value !== null && !(value instanceof Error)) {
    const maybe = value as { code?: unknown; params?: unknown };
    if (typeof maybe.code === "string") {
      return {
        code: maybe.code,
        params: (maybe.params ?? null) as StructuredError["params"],
      };
    }
    return null;
  }

  const text = typeof value === "string" ? value.trim() : "";
  if (text.startsWith("{") && text.includes('"code"')) {
    try {
      const parsed = JSON.parse(text) as { code?: unknown; params?: unknown };
      if (typeof parsed.code === "string") {
        return {
          code: parsed.code,
          params: (parsed.params ?? null) as StructuredError["params"],
        };
      }
    } catch {
      /* 不是 JSON，按普通字符串处理 */
    }
  }
  return null;
}

/**
 * 把任意 thrown 值翻译成当前语言的错误文案。
 *
 * @example
 *   try { await api.moveApp(req) } catch (e) { showError(describeError(t, e)) }
 */
export function describeError(t: TFunction, error: unknown): string {
  const structured = parseStructuredError(error);
  if (structured) {
    // 已知错误码 → 翻译；未知错误码 → 回退到 error.other（把 code 显示出来，方便排查）
    if (isErrorCode(structured.code)) {
      const key = `${ERROR_KEY_PREFIX}.${structured.code}` as TranslatableKey;
      return tr(t, key, structured.params ?? undefined);
    }
    return tr(
      t,
      `${ERROR_KEY_PREFIX}.other` as TranslatableKey,
      { detail: rawText(error) }
    );
  }
  return rawText(error);
}

/**
 * 把后端回传的「原因码」渲染成文案。
 * 未知码按纯文本原样展示，兼容旧版后端。
 */
export function describeReason(t: TFunction, code: string | null | undefined): string | null {
  if (!code) return null;
  if (!isReasonCode(code)) return code;
  return tr(t, K.reason[code] as TranslatableKey);
}

/** 进度阶段 label：`progress.phase.copying` */
export function describeProgressPhase(t: TFunction, phase: string): string {
  if (!isProgressPhase(phase)) return tr(t, K.progress.fallbackPhase);
  return tr(t, K.progress.phase[phase] as TranslatableKey);
}

/** 进度明细文案：后端给的是消息码 + 参数 */
export function describeProgressMessage(
  t: TFunction,
  code: string,
  params: Record<string, string | number> | null | undefined
): string {
  if (!isProgressMessageCode(code)) return "";
  return tr(t, K.progressMessage[code] as TranslatableKey, params ?? undefined);
}
