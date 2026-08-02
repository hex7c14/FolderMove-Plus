import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import type {
  AppInfo,
  DriveInfo,
  MoveRecord,
  MoveRequest,
  ProgressPayload,
} from "./types";
import { api, onProgress } from "./lib/api";
import { Sidebar, type Tab } from "./components/Sidebar";
import { AppList } from "./components/AppList";
import { MoveDialog } from "./components/MoveDialog";
import { ProgressOverlay } from "./components/ProgressOverlay";
import { MovedView } from "./components/MovedView";
import { AboutView } from "./components/AboutView";

interface Toast {
  type: "success" | "error";
  msg: string;
}

export default function App() {
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
      setToast({ type: "error", msg: `扫描失败：${e}` });
    } finally {
      setLoadingApps(false);
    }
  }, []);

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
        setToast({ type: "success", msg: `已移动「${rec.app_name}」，释放 ${fmt(rec.size_bytes)}` });
      }).catch(() => {
        setProgress(null);
      });
      return p;
    },
    [refreshApps, refreshMoved, refreshDrives]
  );

  const startRestore = useCallback(
    async (r: MoveRecord) => {
      setBusyRestoreId(r.id);
      try {
        await api.restoreApp(r.id);
        setProgress(null);
        await Promise.all([refreshApps(), refreshMoved(), refreshDrives()]);
        setToast({ type: "success", msg: `已还原「${r.app_name}」` });
      } catch (e) {
        setProgress(null);
        setToast({ type: "error", msg: String(e) });
      } finally {
        setBusyRestoreId(null);
      }
    },
    [refreshApps, refreshMoved, refreshDrives]
  );

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
        <header className="px-7 py-5 border-b border-soft bg-panel-glass flex items-center">
          <div>
            <h1 className="text-lg font-semibold ink-primary">{TITLES[tab].t}</h1>
            <p className="text-xs ink-soft mt-0.5">{TITLES[tab].s}</p>
          </div>
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
          {tab === "about" && <AboutView />}
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
              <CheckCircle2 size={18} className="text-emerald-500" />
            ) : (
              <AlertTriangle size={18} className="text-red-500" />
            )}
            <span className="text-sm ink-primary max-w-xs">{toast.msg}</span>
            <button
              className="ml-1 ink-soft hover:ink-secondary"
              onClick={() => setToast(null)}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const TITLES: Record<Tab, { t: string; s: string }> = {
  apps: { t: "软件列表", s: "选择要搬到其他盘的软件" },
  moved: { t: "已移动", s: "随时还原到原位置" },
  about: { t: "关于 FolderMove-Plus", s: "工作原理与使用须知" },
};

function fmt(b: number): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
