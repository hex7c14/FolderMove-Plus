import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckmarkCircle20Filled, Warning20Filled, Dismiss20Regular } from "@fluentui/react-icons";
import type {
  AppInfo,
  DriveInfo,
  MoveRecord,
  MoveRequest,
  ProgressPayload,
} from "./types";
import { api, onProgress } from "./lib/api";
import { describeError } from "./lib/errors";
import { useFormatters } from "./lib/useFormatters";
import { useWindowTitle } from "./lib/useWindowTitle";
import { K } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import type { Tab } from "./components/Sidebar";
import { AppList } from "./components/AppList";
import { MoveDialog } from "./components/MoveDialog";
import { ProgressOverlay } from "./components/ProgressOverlay";
import { MovedView } from "./components/MovedView";

interface Toast {
  type: "success" | "error";
  msg: string;
}

/** 各标签页的标题对应的文案 key（不加类型标注，保留字面量类型） */
const TAB_TITLE_KEYS = {
  apps: K.page.appsTitle,
  moved: K.page.movedTitle,
} as const;

export default function App() {
  const { t } = useTranslation();
  const { bytes } = useFormatters();
  // 窗口标题跟随语言（DOM + Tauri 原生窗口）
  useWindowTitle();
  const [tab, setTab] = useState<Tab>("apps");
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [moved, setMoved] = useState<MoveRecord[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [moveTarget, setMoveTarget] = useState<AppInfo | null>(null);
  const [busyRestoreId, setBusyRestoreId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const refreshDrives = useCallback(
    () => api.listDrives().then(setDrives).catch(() => {}),
    []
  );
  const refreshMoved = useCallback(
    () => api.listMoved().then(setMoved).catch(() => {}),
    []
  );
  const refreshApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      setApps(await api.scanApps());
    } catch (e) {
      setToast({ type: "error", msg: t(K.toast.scanFailed, { error: describeError(t, e) }) });
    } finally {
      setLoadingApps(false);
    }
  }, [t]);

  useEffect(() => {
    refreshDrives();
    refreshApps();
    refreshMoved();
  }, [refreshDrives, refreshApps, refreshMoved]);

  useEffect(() => {
    const un = onProgress((p) => setProgress(p));
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const startMove = useCallback(
    (req: MoveRequest): Promise<MoveRecord> => {
      const p = api.moveApp(req);
      p.then(async (rec) => {
        setProgress(null);
        await Promise.all([refreshApps(), refreshMoved(), refreshDrives()]);
        setToast({
          type: "success",
          msg: t(K.toast.moved, { name: rec.app_name, size: bytes(rec.size_bytes) }),
        });
      }).catch(() => {
        setProgress(null);
      });
      return p;
    },
    [refreshApps, refreshMoved, refreshDrives, t, bytes]
  );

  const startRestore = useCallback(
    async (r: MoveRecord) => {
      setBusyRestoreId(r.id);
      try {
        await api.restoreApp(r.id);
        setProgress(null);
        await Promise.all([refreshApps(), refreshMoved(), refreshDrives()]);
        setToast({ type: "success", msg: t(K.toast.restored, { name: r.app_name }) });
      } catch (e) {
        setProgress(null);
        setToast({ type: "error", msg: describeError(t, e) });
      } finally {
        setBusyRestoreId(null);
      }
    },
    [refreshApps, refreshMoved, refreshDrives, t]
  );

  const titleKey = TAB_TITLE_KEYS[tab];

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        tab={tab}
        setTab={setTab}
        movedCount={moved.length}
        drives={drives}
        moved={moved}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-7 py-4 border-b border-soft bg-panel-glass flex items-center">
          <h1 className="text-lg font-semibold ink-primary">{t(titleKey)}</h1>
        </header>

        <div className="flex-1 overflow-auto px-7 py-6">
          {tab === "apps" && (
            <AppList
              apps={apps}
              drives={drives}
              loading={loadingApps}
              onMove={(a) => setMoveTarget(a)}
              onRescan={refreshApps}
            />
          )}
          {tab === "moved" && (
            <MovedView
              records={moved}
              onRestore={startRestore}
              busyId={busyRestoreId}
            />
          )}
        </div>
      </main>

      {moveTarget && (
        <MoveDialog
          app={moveTarget}
          drives={drives}
          onSubmit={startMove}
          onDone={() => setMoveTarget(null)}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {progress && <ProgressOverlay progress={progress} />}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] animate-slide-up">
          <div
            className={`card flex items-center gap-2.5 pl-3.5 pr-4 py-3 ${
              toast.type === "success" ? "border-emerald-200" : "border-red-200"
            }`}
          >
            {toast.type === "success" ? (
              <CheckmarkCircle20Filled className="text-emerald-500" />
            ) : (
              <Warning20Filled className="text-red-500" />
            )}
            <span className="text-sm ink-primary max-w-xs">{toast.msg}</span>
            <button
              className="ml-1 ink-soft hover:ink-secondary"
              onClick={() => setToast(null)}
            >
              <Dismiss20Regular />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
