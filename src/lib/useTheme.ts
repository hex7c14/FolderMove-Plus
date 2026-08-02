import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "fm-plus-theme";
const mql =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function systemDark(): boolean {
  return mql ? mql.matches : false;
}

function applyDarkClass(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

/** 同步应用主题：读取 localStorage，默认跟随系统；并监听系统主题变化 */
export function initTheme() {
  const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
  const dark = stored === "system" ? systemDark() : stored === "dark";
  applyDarkClass(dark);
}

export function useTheme() {
  const [mode, setMode] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
  });
  const [dark, setDark] = useState<boolean>(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    return stored === "system" ? systemDark() : stored === "dark";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    const nextDark = mode === "system" ? systemDark() : mode === "dark";
    applyDarkClass(nextDark);
    setDark(nextDark);
  }, [mode]);

  // 监听系统主题变化（仅当 mode == "system" 时会被应用）
  useEffect(() => {
    if (!mql) return;
    const onChange = () => {
      if (mode === "system") {
        const nextDark = systemDark();
        applyDarkClass(nextDark);
        setDark(nextDark);
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  return { mode, dark, setMode };
}
