import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dismiss20Regular,
  ArrowRight20Regular,
  HardDrive20Regular,
  Warning20Filled,
  CheckmarkCircle20Filled,
  SpinnerIos20Regular,
  Folder20Regular,
  ShieldError20Regular,
  WarningShield20Filled,
  ArrowClockwise20Regular,
  ChevronRight20Regular,
  Add20Regular,
  Save20Regular,
  Edit20Regular,
  Settings20Regular,
  PlugDisconnected20Regular,
  ArrowLeft20Regular,
} from "@fluentui/react-icons";
import type { AppInfo, DriveInfo, FolderEntry, MoveRecord, MoveRequest, ProcInfo } from "../types";
import { Avatar } from "./Avatar";
import { formatBytes, driveDisplay } from "../lib/format";
import { api } from "../lib/api";

interface Props {
  app: AppInfo;
  drives: DriveInfo[];
  onSubmit: (req: MoveRequest) => Promise<MoveRecord>;
  onDone: () => void;
  onClose: () => void;
}

/** 对话框多步骤：
 *   1. "drive"   = 选目标盘符
 *   2. "mode"    = 默认/高级 模式选择
 *   3. "pickdir" = 内嵌文件管理器选目录 (仅高级模式)
 *   4. "confirm" = 确认 & 残留进程检测 + 提交移动
 */
type Step = "drive" | "mode" | "pickdir" | "confirm";
type Mode = "default" | "advanced" | null;

const DEFAULT_SUBFOLDER = "FolderMove-Plus";

export function MoveDialog({ app, drives, onSubmit, onDone, onClose }: Props) {
  const candidates = useMemo(
    () =>
      drives.filter(
        (d) =>
          d.drive_type === "Fixed" &&
          !d.letter.toLowerCase().startsWith(app.source_drive[0]?.toLowerCase() ?? "c")
      ),
    [drives, app.source_drive]
  );

  // ====== 步骤与状态 ======
  const [step, setStep] = useState<Step>("drive");
  const [driveLetterSel, setDriveLetterSel] = useState<string>(
    candidates[0]?.letter ?? ""
  );
  const [mode, setMode] = useState<Mode>(null);
  // "默认"模式下的子文件夹名
  const [subfolder, setSubfolder] = useState(DEFAULT_SUBFOLDER);
  // "高级"模式下用户选择的存放目录 (完整绝对路径)
  const [selectedPath, setSelectedPath] = useState<string>("");

  // ====== 内嵌文件管理器 (pickdir 步骤) ======
  // 当前浏览的路径（驱动器根目录起步）
  const [browsePath, setBrowsePath] = useState<string>("");
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  // 新建文件夹弹框状态：
  const [creating, setCreating] = useState(false);
  const [creatingName, setCreatingName] = useState("新建文件夹");
  // 重命名状态：
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ====== 大小 / 残留进程 ======
  const [size, setSize] = useState<number>(app.estimated_size_bytes);
  const [computing, setComputing] = useState(app.estimated_size_bytes === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [procs, setProcs] = useState<ProcInfo[] | null>(null);
  const [procStage, setProcStage] = useState<"idle" | "checking" | "killing">("idle");
  const [killFailed, setKillFailed] = useState<{ pid: number; reason: string }[]>([]);

  const selectedDrive = candidates.find((d) => d.letter === driveLetterSel) ?? candidates[0];

  // ====== 默认模式下自动计算 targetRoot ======
  const defaultTargetRoot = selectedDrive
    ? `${selectedDrive.letter}${subfolder}`
    : "";
  // ====== 综合 targetRoot：根据模式决定 ======
  const targetRoot =
    mode === "advanced"
      ? selectedPath
      : defaultTargetRoot;

  const basename = app.install_location.split(/[/\\]/).filter(Boolean).pop() ?? "App";
  const newPath = targetRoot ? `${targetRoot}\\${basename}` : "";

  const free = selectedDrive?.free_bytes ?? 0;
  const willFit = !computing && (size === 0 || free >= size + size / 20);

  const busy = submitting || procStage === "checking" || procStage === "killing";

  // 若注册表未给大小，则实时计算
  useEffect(() => {
    if (app.estimated_size_bytes > 0) return;
    let alive = true;
    setComputing(true);
    api
      .computeSize(app.install_location)
      .then((s) => alive && (setSize(s), setComputing(false)))
      .catch(() => alive && setComputing(false));
    return () => {
      alive = false;
    };
  }, [app.estimated_size_bytes, app.install_location]);

  // ====== 进入 "选盘符" 之后：根据模式前进 ======
  const goFromDrive = () => {
    if (!selectedDrive) return;
    setError(null);
    setMode(null);
    setSelectedPath("");
    setSubfolder(DEFAULT_SUBFOLDER);
    setStep("mode");
  };

  // ====== 模式选择 ======
  const pickMode = (m: Mode) => {
    if (!selectedDrive) return;
    setMode(m);
    setError(null);
    if (m === "default") {
      // 默认模式直接去 confirm 步骤
      setStep("confirm");
    } else if (m === "advanced") {
      // 高级模式：进入文件管理器，起始路径 = 目标盘根
      const root = selectedDrive.letter;
      setBrowsePath(root);
      setSelectedPath("");
      setStep("pickdir");
      // 立刻加载子文件夹
      loadFolders(root);
    }
  };

  // ====== 内嵌文件管理器：加载子文件夹 ======
  const loadFolders = (dir: string) => {
    setLoadingFolders(true);
    setFsError(null);
    api
      .listFolders(dir)
      .then((list) => {
        setFolders(list);
      })
      .catch((e) => {
        setFolders([]);
        setFsError(String(e));
      })
      .finally(() => setLoadingFolders(false));
  };

  // 当 browsePath 变更时重新加载
  useEffect(() => {
    if (step !== "pickdir") return;
    if (!browsePath) return;
    loadFolders(browsePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsePath, step]);

  // ====== 文件管理器：路径分段（面包屑） ======
  const crumbs = useMemo(() => {
    if (!browsePath) return [];
    // Windows 盘符分段：D:\a\b\c -> [D:\, D:\a\, D:\a\b\, D:\a\b\c]
    const parts: string[] = [];
    const norm = browsePath.replace(/\//g, "\\").replace(/\\+$/, "");
    const chunks = norm.split("\\").filter(Boolean);
    for (let i = 0; i < chunks.length; i++) {
      parts.push(chunks.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : ""));
    }
    return parts;
  }, [browsePath]);

  const parentPath = useMemo(() => {
    if (!browsePath) return null;
    const norm = browsePath.replace(/\//g, "\\").replace(/\\+$/, "");
    // 根目录（如 D:\）没有父目录
    if (/^[A-Za-z]:\\?$/.test(norm)) return null;
    const last = norm.lastIndexOf("\\");
    if (last < 0) return null;
    const parent = norm.slice(0, last);
    // 如果 parent 就是盘符（如 D:），要加反斜杠变成 D:\
    return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
  }, [browsePath]);

  // ====== 文件管理器：选择 & 进入 ======
  const enterFolder = (entry: FolderEntry) => {
    setRenamingPath(null);
    setBrowsePath(entry.path);
  };
  const goBack = () => {
    if (parentPath) {
      setRenamingPath(null);
      setBrowsePath(parentPath);
    }
  };
  const chooseCurrentDir = () => {
    setSelectedPath(browsePath);
    setError(null);
    setStep("confirm");
  };
  // 从 pickdir 步骤下一步：**不覆盖用户已选的 selectedPath**
  // - 如果用户已手动点击/新建选中了目录（selectedPath 有值），直接进 confirm
  // - 如果用户没有点选但点了下一步（说明想把"当前浏览目录"作为目标），才套用 browsePath
  const goFromPickdir = () => {
    if (!selectedPath) {
      setSelectedPath(browsePath);
    }
    setError(null);
    setStep("confirm");
  };

  // ====== 新建文件夹 ======
  const startCreating = () => {
    setCreating(true);
    setCreatingName("新建文件夹");
    // 延迟聚焦 input
    setTimeout(() => {
      const input = document.getElementById("create-folder-input") as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
    }, 20);
  };
  const cancelCreating = () => {
    setCreating(false);
    setCreatingName("新建文件夹");
  };
  const commitCreate = async () => {
    if (!browsePath) return;
    const name = creatingName.trim();
    if (!name) return;
    try {
      const newPath = await api.createFolder(browsePath, name);
      // 创建成功：刷列表并选中刚创建的目录
      loadFolders(browsePath);
      setSelectedPath(newPath);
    } catch (e) {
      setFsError(String(e));
    } finally {
      setCreating(false);
      setCreatingName("新建文件夹");
    }
  };

  // ====== 重命名文件夹 ======
  const startRenaming = (entry: FolderEntry) => {
    setRenamingPath(entry.path);
    setRenamingName(entry.name);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 20);
  };
  const cancelRenaming = () => {
    setRenamingPath(null);
    setRenamingName("");
  };
  const commitRename = async () => {
    if (!renamingPath) return;
    const name = renamingName.trim();
    if (!name) return;
    try {
      const np = await api.renameFolder(renamingPath, name);
      // 如果重命名的就是当前选中的目标，同步更新
      if (selectedPath === renamingPath) {
        setSelectedPath(np);
      }
      loadFolders(browsePath);
    } catch (e) {
      setFsError(String(e));
    } finally {
      cancelRenaming();
    }
  };

  // ====== 实际提交移动 ======
  const doMove = async () => {
    if (!targetRoot) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        app_name: app.display_name,
        original_path: app.install_location,
        target_root: targetRoot,
      });
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ====== 点击"确认移动"：先检测残留进程 ======
  const submit = async () => {
    if (!targetRoot || busy) return;
    setError(null);
    setKillFailed([]);
    setProcStage("checking");
    setProcs(null);
    try {
      const list = await api.checkProcesses(app.install_location);
      setProcs(list);
      setProcStage("idle");
      if (list.length === 0) {
        await doMove();
      }
    } catch (e) {
      setProcStage("idle");
      setError(`进程检测失败：${e}`);
    }
  };

  const killAndMove = async () => {
    if (!procs || procs.length === 0 || busy) return;
    setProcStage("killing");
    setKillFailed([]);
    try {
      const res = await api.killProcesses(procs.map((p) => p.pid));
      setKillFailed(res.failed);
      await new Promise((r) => setTimeout(r, 600));
      const remain = await api.checkProcesses(app.install_location);
      setProcs(remain);
      setProcStage("idle");
      if (remain.length === 0) {
        await doMove();
      } else if (res.failed.length > 0) {
        setError(
          `部分进程无法结束：${res.failed.map((f) => `PID ${f.pid} (${f.reason})`).join("、")}`
        );
      }
    } catch (e) {
      setProcStage("idle");
      setError(`结束进程失败：${e}`);
    }
  };

  const recheck = async () => {
    setProcStage("checking");
    setKillFailed([]);
    try {
      const list = await api.checkProcesses(app.install_location);
      setProcs(list);
      setProcStage("idle");
    } catch (e) {
      setProcStage("idle");
      setError(`进程检测失败：${e}`);
    }
  };

  // ====== 后退操作 ======
  const goBackStep = () => {
    if (busy) return;
    setError(null);
    if (step === "confirm") {
      // confirm 的上一步取决于模式
      if (mode === "advanced") {
        setStep("pickdir");
      } else {
        setStep("mode");
      }
    } else if (step === "pickdir") {
      setStep("mode");
    } else if (step === "mode") {
      setStep("drive");
    }
  };

  // ====== 渲染辅助 ======
  const canSubmit =
    !!targetRoot &&
    !busy &&
    willFit &&
    !(procs && procs.length > 0);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className={`card max-w-[92vw] p-6 animate-slide-up ${
          step === "pickdir" ? "w-[780px]" : "w-[580px]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部：标题 + 关闭 */}
        <div className="flex items-start gap-3 mb-5">
          <Avatar name={app.display_name} size={48} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold ink-primary truncate">
              {app.display_name}
              <span className="ml-2 text-xs font-normal ink-soft">· 软件搬家</span>
            </div>
            <div className="text-xs ink-soft truncate">
              {app.publisher ?? "未知发布者"}
            </div>
            {/* 步骤条 */}
            <StepBar step={step} mode={mode} />
          </div>
          <button
            className="btn-ghost -mr-2 -mt-1"
            onClick={onClose}
            disabled={submitting}
          >
            <Dismiss20Regular />
          </button>
        </div>

        {/* 迁移路径概览 (从 mode 步骤开始才展示) */}
        {step !== "drive" && (
          <div className="rounded-lg bg-panel-soft dark:bg-white/5 p-3 mb-5">
            <div className="text-[11px] uppercase tracking-wide ink-soft mb-1">
              迁移路径
            </div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <code className="ink-secondary">{app.install_location}</code>
              <ArrowRight20Regular className="text-brand-500 dark:text-brand-400" />
              <code className="text-brand-700 dark:text-brand-400 font-medium">
                {newPath || "—"}
              </code>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="ink-soft">
                软件大小：
                {computing ? (
                  <span className="ink-soft inline-flex items-center gap-1">
                    <SpinnerIos20Regular className="animate-spin" /> 计算中
                  </span>
                ) : (
                  <span className="font-medium ink-primary">{formatBytes(size)}</span>
                )}
              </span>
              <span className="ink-soft">
                模式：
                <span className="font-medium ink-primary">
                  {mode === "advanced" ? "高级（自选目录）" : "默认"}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* ================ Step 1：选择目标盘 ================ */}
        {step === "drive" && (
          <>
            <div className="mb-2 text-sm font-medium ink-primary">第 1 步：选择目标盘</div>
            {candidates.length === 0 ? (
              <div className="card p-4 text-sm text-amber-700 bg-amber-50 border-amber-200 mb-4 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                没有检测到其他可用的固定盘，请先接入目标磁盘。
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {candidates.map((d) => {
                  const active = d.letter === selectedDrive?.letter;
                  return (
                    <button
                      key={d.letter}
                      onClick={() => setDriveLetterSel(d.letter)}
                      className={`text-left rounded-lg border p-3 transition ${
                        active
                          ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100 dark:bg-brand-500/15 dark:ring-brand-500/20"
                          : "border-base hover:border-brand-300 bg-panel dark:bg-panel-glass"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <HardDrive20Regular
                          className={
                            active ? "text-brand-600 dark:text-brand-400" : "ink-soft"
                          }
                        />
                        <span className="font-medium ink-primary">{driveDisplay(d)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-panel-soft dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((d.free_bytes / Math.max(1, d.total_bytes)) * 100)
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] ink-soft">
                        可用 {formatBytes(d.free_bytes)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ================ Step 2：默认 / 高级 ================ */}
        {step === "mode" && (
          <>
            <div className="mb-2 text-sm font-medium ink-primary">第 2 步：选择方式</div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => pickMode("default")}
                className={`text-left rounded-lg border p-4 transition ${
                  mode === "default"
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100 dark:bg-brand-500/15 dark:ring-brand-500/20"
                    : "border-base hover:border-brand-300 bg-panel dark:bg-panel-glass"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <PlugDisconnected20Regular className="text-brand-600 dark:text-brand-400" />
                  <span className="font-semibold ink-primary">默认方式</span>
                </div>
                <div className="text-xs ink-soft leading-relaxed">
                  在目标盘根创建 <code className="font-mono">FolderMove-Plus</code> 文件夹，
                  软件直接搬入其中。一步到位，99% 情况都够用。
                </div>
              </button>

              <button
                onClick={() => pickMode("advanced")}
                className={`text-left rounded-lg border p-4 transition ${
                  mode === "advanced"
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100 dark:bg-brand-500/15 dark:ring-brand-500/20"
                    : "border-base hover:border-brand-300 bg-panel dark:bg-panel-glass"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Settings20Regular className="text-brand-600 dark:text-brand-400" />
                  <span className="font-semibold ink-primary">高级方式</span>
                </div>
                <div className="text-xs ink-soft leading-relaxed">
                  打开内嵌文件管理器，手动选择要存放的具体目录。
                  支持新建文件夹、重命名，满足精细的目录组织需求。
                </div>
              </button>
            </div>

            {mode === "default" && (
              <div className="mb-5">
                <label className="text-sm font-medium ink-primary mb-1.5 block">
                  存放文件夹名（可选）
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm ink-soft">{selectedDrive?.letter}</span>
                  <input
                    className="field"
                    value={subfolder}
                    onChange={(e) =>
                      setSubfolder(e.target.value.replace(/[\\/:*?"<>|]/g, ""))
                    }
                    placeholder={DEFAULT_SUBFOLDER}
                    disabled={busy}
                  />
                </div>
                <div className="mt-1 text-[11px] ink-soft">
                  软件会搬入：<code className="font-mono">{defaultTargetRoot}\{basename}</code>
                </div>
              </div>
            )}
          </>
        )}

        {/* ================ Step 3：内嵌文件管理器 ================ */}
        {step === "pickdir" && (
          <>
            <div className="mb-2 text-sm font-medium ink-primary flex items-center gap-2">
              第 3 步：选择存放目录
              <span className="ml-auto text-[11px] font-normal ink-soft">
                选中后将在该目录下创建 <code className="font-mono">{basename}</code>
              </span>
            </div>

            {/* 面包屑 + 工具栏 */}
            <div className="flex items-center gap-1.5 mb-2">
              <button
                className="btn-ghost !px-2 !py-1.5 disabled:opacity-40"
                onClick={goBack}
                disabled={!parentPath}
                title="向上一级"
              >
                <ArrowLeft20Regular />
              </button>
              <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto py-1 rounded-lg bg-panel-soft dark:bg-white/5 px-2">
                {crumbs.map((c, i) => {
                  const isLast = i === crumbs.length - 1;
                  const name =
                    i === 0
                      ? c.replace(/\\$/, "") // 盘符 D:\ 显示为 D:
                      : c.split("\\").filter(Boolean).pop() ?? c;
                  return (
                    <div key={c} className="flex items-center shrink-0">
                      {i > 0 && <ChevronRight20Regular className="ink-soft w-3 h-3 mx-0.5" />}
                      <button
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          isLast
                            ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 font-medium"
                            : "ink-secondary hover:bg-white/60 dark:hover:bg-white/10"
                        }`}
                        onClick={() => setBrowsePath(c)}
                      >
                        {name}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                className="btn-primary !px-2.5 !py-1.5"
                onClick={startCreating}
                disabled={loadingFolders || !browsePath || creating}
                title="新建文件夹"
              >
                <Add20Regular />
                新建文件夹
              </button>
            </div>

            {/* 新建文件夹 行内编辑器 */}
            {creating && (
              <div className="rounded-lg border border-brand-300 bg-brand-50 dark:bg-brand-500/10 dark:border-brand-500/40 p-2.5 mb-2 flex items-center gap-2">
                <Folder20Regular className="text-brand-600 dark:text-brand-400 shrink-0" />
                <input
                  id="create-folder-input"
                  className="field !py-1.5 flex-1"
                  value={creatingName}
                  onChange={(e) =>
                    setCreatingName(e.target.value.replace(/[\\/:*?"<>|]/g, ""))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitCreate();
                    if (e.key === "Escape") cancelCreating();
                  }}
                />
                <button className="btn-primary !py-1.5 !px-3" onClick={() => void commitCreate()}>
                  <Save20Regular />
                  创建
                </button>
                <button className="btn-ghost !py-1.5" onClick={cancelCreating}>
                  取消
                </button>
              </div>
            )}

            {/* 目录列表区 */}
            <div
              className="rounded-lg border border-soft bg-panel dark:bg-panel-glass min-h-[260px] max-h-[340px] overflow-y-auto"
              onClick={() => {
                if (renamingPath) cancelRenaming();
                if (creating) cancelCreating();
              }}
            >
              {loadingFolders ? (
                <div className="h-full min-h-[260px] flex items-center justify-center gap-2 ink-soft text-sm">
                  <SpinnerIos20Regular className="animate-spin" /> 正在加载文件夹…
                </div>
              ) : fsError ? (
                <div className="h-full min-h-[260px] flex flex-col items-center justify-center gap-2 text-sm text-amber-700 dark:text-amber-300 px-6 text-center">
                  <Warning20Filled />
                  <div>
                    无法读取目录：<span className="break-all">{fsError}</span>
                  </div>
                  <button
                    className="btn-ghost !py-1.5 mt-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadFolders(browsePath);
                    }}
                  >
                    <ArrowClockwise20Regular />
                    重试
                  </button>
                </div>
              ) : folders.length === 0 ? (
                <div className="h-full min-h-[260px] flex flex-col items-center justify-center gap-1 ink-soft text-sm">
                  <Folder20Regular className="w-8 h-8 opacity-50" />
                  <div>该目录没有子文件夹</div>
                  <div className="text-xs">
                    可以直接把"当前目录"作为存放位置，或点上方"新建文件夹"
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-soft">
                  {folders.map((f) => {
                    const selected = selectedPath === f.path;
                    const renaming = renamingPath === f.path;
                    return (
                      <li
                        key={f.path}
                        className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition ${
                          selected
                            ? "bg-brand-50 dark:bg-brand-500/15"
                            : "hover:bg-panel-soft dark:hover:bg-white/5"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          // 如果在重命名状态，点击不做跳转
                          if (renaming) return;
                          setSelectedPath(f.path);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (renaming) return;
                          enterFolder(f);
                        }}
                      >
                        <Folder20Regular
                          className={
                            selected
                              ? "text-brand-600 dark:text-brand-400"
                              : "text-amber-500 dark:text-amber-400"
                          }
                        />

                        {renaming ? (
                          <input
                            ref={renameInputRef}
                            className="field !py-1 flex-1 min-w-0"
                            value={renamingName}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setRenamingName(
                                e.target.value.replace(/[\\/:*?"<>|]/g, "")
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitRename();
                              if (e.key === "Escape") cancelRenaming();
                            }}
                            onBlur={() => void commitRename()}
                          />
                        ) : (
                          <span
                            className={`flex-1 min-w-0 truncate text-sm ${
                              selected ? "font-medium text-brand-700 dark:text-brand-300" : "ink-primary"
                            }`}
                          >
                            {f.name}
                          </span>
                        )}

                        {/* 未重命名时显示操作按钮 */}
                        {!renaming && (
                          <>
                            {selected && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                已选中
                              </span>
                            )}
                            <button
                              className="btn-ghost !p-1.5 opacity-0 group-hover:opacity-100 transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRenaming(f);
                              }}
                              title="重命名"
                            >
                              <Edit20Regular className="w-4 h-4" />
                            </button>
                            <button
                              className="btn-ghost !p-1.5 opacity-0 group-hover:opacity-100 transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                enterFolder(f);
                              }}
                              title="打开文件夹"
                            >
                              <ChevronRight20Regular className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {fsError && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {fsError}
              </div>
            )}

            {/* 已选择的路径提示 */}
            <div className="mt-3 rounded-lg bg-panel-soft dark:bg-white/5 p-2.5 flex items-center gap-2 text-sm">
              <CheckmarkCircle20Filled
                className={
                  selectedPath
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "ink-soft opacity-40"
                }
              />
              <div className="flex-1 min-w-0">
                {selectedPath ? (
                  <>
                    <div className="text-xs ink-soft">选择的目录</div>
                    <code className="ink-primary font-medium break-all">{selectedPath}</code>
                    <div className="text-[11px] ink-soft mt-0.5">
                      最终路径：<span className="font-medium">{newPath}</span>
                    </div>
                  </>
                ) : (
                  <div className="ink-soft text-xs">
                    未选择。双击文件夹进入浏览，点击选中要存放的位置，再点"下一步"继续。
                  </div>
                )}
              </div>
              <button
                className="btn-ghost !py-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  chooseCurrentDir();
                }}
              >
                选"当前目录"
              </button>
            </div>
          </>
        )}

        {/* ================ Step 4：确认页 & 提交 / 错误区 ================ */}
        {(step === "confirm" || step === "mode") && mode === "default" ? null : null}

        {step === "confirm" && (
          <>
            {/* 高风险提示 */}
            {app.risk_level === "high" && (
              <div className="rounded-lg p-3 mb-4 bg-red-50 text-red-700 border border-red-200 text-sm flex gap-2 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
                <ShieldError20Regular className="shrink-0 mt-0.5" />
                <span>
                  <strong>高风险警告：</strong>
                  {app.risk_reason ??
                    "此目录涉及系统关键路径，移动后可能导致系统或软件异常。"}
                  请务必先创建还原点并完全退出相关软件。
                </span>
              </div>
            )}

            {/* 空间提示 */}
            {selectedDrive && !computing && size > 0 && (
              <div
                className={`rounded-lg p-3 mb-4 flex items-center gap-2 text-sm ${
                  willFit
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
                    : "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30"
                }`}
              >
                {willFit ? <CheckmarkCircle20Filled /> : <Warning20Filled />}
                <span>
                  {willFit
                    ? `空间充足，移动后预计释放 ${formatBytes(size)}`
                    : `目标盘可用空间不足（${formatBytes(free)} < ${formatBytes(size)}）`}
                </span>
              </div>
            )}

            {/* 进程检测状态 */}
            {procStage === "checking" && (
              <div className="rounded-lg p-3 mb-4 bg-panel-soft dark:bg-white/5 ink-secondary border border-soft text-sm flex items-center gap-2">
                <SpinnerIos20Regular className="animate-spin" />
                正在检测残留进程…
              </div>
            )}

            {procStage === "killing" && (
              <div className="rounded-lg p-3 mb-4 bg-amber-50 text-amber-700 border border-amber-200 text-sm flex items-center gap-2 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                <SpinnerIos20Regular className="animate-spin" />
                正在结束残留进程…
              </div>
            )}

            {procs && procs.length > 0 && procStage === "idle" && (
              <div className="rounded-lg p-3 mb-4 bg-amber-50 border border-amber-200 text-sm dark:bg-amber-500/10 dark:border-amber-500/30">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                  <WarningShield20Filled className="shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      检测到 {procs.length} 个残留进程仍占用该目录
                    </div>
                    <div className="text-xs mt-0.5 opacity-90">
                      若您已确认关闭软件，这些可能是未完全退出的残留进程。
                    </div>
                  </div>
                </div>
                <ul className="mt-2 space-y-1">
                  {procs.map((p) => (
                    <li
                      key={p.pid}
                      className="flex items-center gap-2 text-xs bg-panel dark:bg-white/10 ink-primary rounded px-2 py-1"
                    >
                      <span className="font-mono ink-soft">PID {p.pid}</span>
                      <span className="font-medium truncate">{p.name}</span>
                      {p.exePath && (
                        <code
                          className="ink-soft truncate ml-auto"
                          title={p.exePath}
                        >
                          {p.exePath}
                        </code>
                      )}
                    </li>
                  ))}
                </ul>
                {killFailed.length > 0 && (
                  <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                    未能结束：{killFailed.map((f) => `PID ${f.pid}`).join("、")}
                  </div>
                )}
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    className="btn-primary !py-1.5 !text-xs"
                    onClick={killAndMove}
                    disabled={busy}
                  >
                    <WarningShield20Filled />
                    结束残留进程并继续
                  </button>
                  <button
                    className="btn-ghost !py-1.5 !text-xs"
                    onClick={recheck}
                    disabled={busy}
                  >
                    <ArrowClockwise20Regular />
                    重新检测
                  </button>
                </div>
              </div>
            )}

            {procs && procs.length === 0 && procStage === "idle" && !submitting && (
              <div className="rounded-lg p-3 mb-4 bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm flex items-center gap-2 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                <CheckmarkCircle20Filled />
                未检测到残留进程，可以安全移动
              </div>
            )}

            {error && (
              <div className="rounded-lg p-3 mb-4 bg-red-50 text-red-700 border border-red-200 text-sm flex gap-2 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
                <Warning20Filled className="shrink-0 mt-0.5" />
                <span className="break-all">{error}</span>
              </div>
            )}
          </>
        )}

        {/* ========== 底部按钮条 ========== */}
        <div className="flex items-center gap-2 pt-3 border-t border-soft -mx-6 -mb-6 px-6 py-3 mt-1">
          <Folder20Regular className="ink-soft" />
          <span className="text-xs ink-soft mr-auto">
            通过 NTFS Junction 迁移，路径不变，软件照常运行
          </span>

          {step !== "drive" && (
            <button className="btn-ghost" onClick={goBackStep} disabled={busy}>
              <ArrowLeft20Regular />
              上一步
            </button>
          )}

          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>

          {/* 各步骤下一步 / 提交 */}
          {step === "drive" && (
            <button
              className="btn-primary"
              onClick={goFromDrive}
              disabled={!selectedDrive || candidates.length === 0}
            >
              下一步 <ArrowRight20Regular />
            </button>
          )}

          {step === "mode" && mode === "default" && (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={busy || !willFit || !!(procs && procs.length > 0)}
              title={procs && procs.length > 0 ? "请先处理残留进程" : undefined}
            >
              {procStage === "checking" ? (
                <>
                  <SpinnerIos20Regular className="animate-spin" /> 检测进程
                </>
              ) : procStage === "killing" ? (
                <>
                  <SpinnerIos20Regular className="animate-spin" /> 结束进程
                </>
              ) : submitting ? (
                <>
                  <SpinnerIos20Regular className="animate-spin" /> 移动中
                </>
              ) : (
                <>
                  开始搬家 <ArrowRight20Regular />
                </>
              )}
            </button>
          )}

          {step === "mode" && mode === "advanced" && (
            <button
              className="btn-primary"
              onClick={() => pickMode("advanced") /* 再次触发以确认选择 */}
              disabled={!selectedDrive}
            >
              打开文件管理器 <ArrowRight20Regular />
            </button>
          )}

          {step === "pickdir" && (
            <button
              className="btn-primary"
              onClick={goFromPickdir}
              disabled={busy || !browsePath}
            >
              下一步 <ArrowRight20Regular />
            </button>
          )}

          {step === "confirm" && (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={!canSubmit}
              title={procs && procs.length > 0 ? "请先处理残留进程" : undefined}
            >
              {procStage === "checking" ? (
                <>
                  <SpinnerIos20Regular className="animate-spin" /> 检测进程
                </>
              ) : procStage === "killing" ? (
                <>
                  <SpinnerIos20Regular className="animate-spin" /> 结束进程
                </>
              ) : submitting ? (
                <>
                  <SpinnerIos20Regular className="animate-spin" /> 移动中
                </>
              ) : (
                <>
                  开始搬家 <ArrowRight20Regular />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 顶部步骤条（视觉上 4 步：选盘 → 方式 → (文件管理器) → 确认） */
function StepBar({ step, mode }: { step: Step; mode: Mode }) {
  const items: { key: Step | "pickdir_placeholder"; label: string; optional?: boolean }[] = [
    { key: "drive", label: "选盘" },
    { key: "mode", label: "方式" },
    ...(mode === "advanced"
      ? ([{ key: "pickdir" as const, label: "选目录" }] as const)
      : ([{ key: "pickdir_placeholder" as const, label: "选目录", optional: true }] as const)),
    { key: "confirm", label: "确认" },
  ];

  const stepIndex = (k: Step | "pickdir_placeholder") => {
    // 实际"当前步的逻辑位置"要兼容 "mode" 在默认模式下直接跳到 confirm
    if (k === "pickdir_placeholder") {
      // 占位步（默认模式没有这一步）：不算入
      return 99;
    }
    if (k === step) return 1;
    // 已完成的：如果 step 在它之后，就认为它完成
    const order: Step[] = ["drive", "mode", "pickdir", "confirm"];
    const curIdx = order.indexOf(step);
    const myIdx = order.indexOf(k as Step);
    if (myIdx < 0 || curIdx < 0) return 0;
    if (myIdx < curIdx) return 2; // 完成
    return 0; // 未到
  };

  return (
    <div className="mt-2 flex items-center gap-1">
      {items.map((it, i) => {
        const status = stepIndex(it.key);
        const isCurrent = it.key === step;
        const hidden = it.optional && mode !== "advanced";
        if (hidden) return null;
        return (
          <>
            {i > 0 && !(items[i - 1]?.optional && mode !== "advanced") && (
              <div
                className={`w-6 h-px ${
                  status === 2 || isCurrent
                    ? "bg-brand-400"
                    : "bg-soft"
                }`}
              />
            )}
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${
                status === 2
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : isCurrent
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 font-medium"
                  : "bg-panel-soft dark:bg-white/5 ink-soft"
              }`}
            >
              {status === 2 ? (
                <CheckmarkCircle20Filled className="w-3 h-3" />
              ) : (
                <span className="w-3 h-3 rounded-full border border-current/50 inline-block" />
              )}
              {it.label}
            </div>
          </>
        );
      })}
    </div>
  );
}
