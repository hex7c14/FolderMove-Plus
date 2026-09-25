/**
 * 把「当前语言」与「格式化函数」绑在一起的小 hook。
 *
 * 组件里不再需要关心 locale：语言一变，`useTranslation` 触发重渲染，
 * 这里返回的函数自然就是新语言的格式化结果。
 *
 * @example
 *   const { bytes, dateTime, number } = useFormatters();
 *   <span>{bytes(rec.size_bytes)}</span>
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { K } from "../i18n";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  localeCompare,
} from "./format";
import type { ByteUnit, ByteUnitLabel } from "./format";

/**
 * 字节单位 → 文案 key 的**显式**映射。
 *
 * 注意不要写成 `` t(`${K.units}.${unit}`) ``：`K.units` 是一个对象，
 * 模板字符串会把它插值成 "[object Object]"，拼出 `"[object Object].GB"` 这种
 * 永远查不到的 key（i18next 查不到就会把 key 原样返回，界面直接显示
 * `78.2 [object Object].GB`）。对象命名空间只能**逐项取值**：
 * `K.units.GB` 才是字符串 `"units.GB"`。
 */
const UNIT_KEYS: Record<ByteUnit, string> = {
  B: K.units.B,
  KB: K.units.KB,
  MB: K.units.MB,
  GB: K.units.GB,
  TB: K.units.TB,
  PB: K.units.PB,
};

export function useFormatters() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return useMemo(() => {
    const unitLabel: ByteUnitLabel = (unit) => t(UNIT_KEYS[unit] as never);
    return {
      locale,
      /** 1.24 GB —— 单位跟随语言包 */
      bytes: (b: number) => formatBytes(b, locale, unitLabel),
      /** 本地化的日期时间 */
      dateTime: (iso: string) => formatDateTime(iso, locale),
      /** 本地化的整数（千分位） */
      number: (n: number) => formatNumber(n, locale),
      /** 本地化的字符串排序 */
      compare: (a: string, b: string) => localeCompare(a, b, locale),
    };
  }, [locale, t]);
}
