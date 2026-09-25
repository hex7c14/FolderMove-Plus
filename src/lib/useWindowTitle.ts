/**
 * 把窗口标题同步成当前语言的 `app.title`。
 *
 * 两层：
 *   - 浏览器/DOM：`document.title`（index.html 里只放了语言中立的占位符）
 *   - Tauri 原生窗口：标题栏 / 任务栏显示的那个
 *
 * ⚠️ 原生窗口需要 `core:window:allow-set-title` 权限（见
 * `src-tauri/capabilities/default.json`）。`core:default` 只给了读标题的
 * `allow-title`，**没有**给 `set_title`；漏配的话调用会被 ACL 拒绝。
 *
 * 这里刻意不吞掉失败：原生标题属于锦上添花（失败也不该影响主流程），
 * 但静默失败过一次就很难查，所以只在开发模式下打一行警告。
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { K } from "../i18n";

export function useWindowTitle() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    const title = t(K.app.title) || "FolderMove-Plus";
    document.title = title;

    let cancelled = false;
    // 动态 import：纯浏览器里跑 `pnpm dev` 时没有 Tauri，不能因此报错
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (cancelled) return;
        return getCurrentWindow().setTitle(title);
      })
      .catch((e: unknown) => {
        if (import.meta.env.DEV) {
          console.warn(
            "[window] 设置原生窗口标题失败（多半是缺少 core:window:allow-set-title 权限）:",
            e
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t, locale]);
}
