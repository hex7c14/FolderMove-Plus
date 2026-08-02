import type { DriveInfo } from "../types";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(b: number): string {
  if (!b || b <= 0) return "—";
  let v = b;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${UNITS[i]}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function driveDisplay(d: DriveInfo): string {
  const letter = d.letter.replace(/\\/g, "").replace(":", "");
  return d.label ? `${d.label} (${letter}:)` : `${letter}:`;
}

export function driveLetter(d: DriveInfo): string {
  return d.letter.replace(/\\/g, "").replace(":", "");
}

const PALETTE: [string, string][] = [
  ["#3b66ff", "#2948f5"],
  ["#7c3aed", "#5b21b6"],
  ["#db2777", "#9d174d"],
  ["#ea580c", "#c2410c"],
  ["#16a34a", "#15803d"],
  ["#0891b2", "#155e75"],
  ["#ca8a04", "#854d0e"],
  ["#4f46e5", "#3730a3"],
  ["#0d9488", "#115e59"],
  ["#dc2626", "#991b1b"],
  ["#2563eb", "#1e40af"],
  ["#9333ea", "#6b21a8"],
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
