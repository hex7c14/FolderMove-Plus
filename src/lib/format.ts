import type { DriveInfo } from "../types";

/** 字节单位，顺序即进位顺序；label 由语言包提供 */
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
export type ByteUnit = (typeof BYTE_UNITS)[number];

/** 取字节单位的本地化写法（日文可用「バイト」等） */
export type ByteUnitLabel = (unit: ByteUnit) => string;

const defaultUnitLabel: ByteUnitLabel = (u) => u;

/* -------------------------------------------------------------------------- */
/* Intl 实例按 locale 缓存：格式化每帧都会调用，不能每次 new                    */
/* -------------------------------------------------------------------------- */

const numberFormatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}|${digits}`;
  let fmt = numberFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormatters.set(key, fmt);
  }
  return fmt;
}

const collators = new Map<string, Intl.Collator>();

function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    collators.set(locale, c);
  }
  return c;
}

/** 把字节数格式化成「1.24 GB」；单位走语言包，数字走 Intl（千分位/小数点随语言） */
export function formatBytes(
  b: number,
  locale = "en-US",
  unitLabel: ByteUnitLabel = defaultUnitLabel
): string {
  if (!b || b <= 0) return "—";
  let v = b;
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${numberFormatter(locale, digits).format(v)} ${unitLabel(BYTE_UNITS[i])}`;
}

/** 按当前语言格式化时间；非法输入原样返回 */
export function formatDateTime(iso: string, locale = "en-US"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d.toLocaleString();
  }
}

/** 按当前语言格式化整数（千分位符号随语言变化） */
export function formatNumber(n: number, locale = "en-US"): string {
  return numberFormatter(locale, 0).format(n);
}

export function driveDisplay(d: DriveInfo): string {
  const letter = d.letter.replace(/\\/g, "").replace(":", "");
  return d.label ? `${d.label} (${letter}:)` : `${letter}:`;
}

export function driveLetter(d: DriveInfo): string {
  return d.letter.replace(/\\/g, "").replace(":", "");
}

/** 按语言环境排序字符串（中文按拼音，日文按假名） */
export function localeCompare(a: string, b: string, locale = "en-US"): number {
  return collator(locale).compare(a, b);
}

/**
 * 字母头像的底色。
 *
 * 取 Fluent 的调色板色阶（Brand / Purple / Pink / Orange / Green / Teal /
 * Yellow / Red …），每个色相的浅色打底、同色相加深，而不是撞色渐变。
 * 之前用的是 Tailwind 的高饱和色 + 大跨度渐变，一屏十几个头像会很吵。
 */
const PALETTE: [string, string][] = [
  ["#2b88d8", "#0f6cbd"], // brand
  ["#8764b8", "#5c2e91"], // purple
  ["#e3008c", "#bf0077"], // pink
  ["#ca5010", "#8f3900"], // orange
  ["#107c10", "#0b5a0b"], // green
  ["#038387", "#026467"], // teal
  ["#8a6116", "#6b4a10"], // yellow
  ["#a4262c", "#7a1a1f"], // red
];

export function avatarColors(name: string): [string, string] {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function firstChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // 取首个非符号字符
  const m = trimmed.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : trimmed[0].toUpperCase();
}

export function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
