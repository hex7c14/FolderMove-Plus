import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { driveDisplay } from "../lib/format";
import { useFormatters } from "../lib/useFormatters";
import { describeError, describeReason } from "../lib/errors";
import { api } from "../lib/api";
import { K, useTranslation } from "../i18n";

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

/**
 * 默认模式在目标盘创建的文件夹名。
 * 故意**不翻译**：这是一个真实目录名，翻成中文路径（D:\软件搬家）对
 * 英文用户和在命令行里找文件的人都不友好，也和 get_default_target 保持一致。
 */
const DEFAULT_SUBFOLDER = "FolderMove-Plus";

/** 「新建文件夹」时预填的名字，同样是真实目录名，不翻译 */
const DEFAULT_NEW_FOLDER_NAME = "New folder";

export function MoveDialog({ app, drives, onSubmit, onDone, onClose }: Props) {
  const { t } = useTranslation();
  const { bytes } = useFormatters();

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
  // "高级"模式下用户选择的存放目录 (完整绝对路径)
  const [selectedPath, setSelectedPath] = useState<string>("");

  // ====== 内嵌文件管理器 (pickdir 步骤) ======
  // 当前浏览的路径（驱动器根目录起步）
  const [browsePath, setBrowsePath] = useState<string>("");
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  // 后端错误保持原始值，渲染时再按当前语言翻译（切语言也能跟着变）
  const [fsError, setFsError] = useState<unknown>(null);
  // 新建文件夹弹框状态：
  const [creating, setCreating] = useState(false);
  const [creatingName, setCreatingName] = useState("");
  // 重命名状态：
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ====== 大小 / 残留进程 ======
  const [size, setSize] = useState<number>(app.estimated_size_bytes);
  const [computing, setComputing] = useState(app.estimated_size_bytes === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [procs, setProcs] = useState<ProcInfo[] | null>(null);
  const [procStage, setProcStage] = useState<"idle" | "checking" | "killing">("idle");
  const [killFailed, setKillFailed] = useState<{ pid: number; reason: string }[]>([]);

  const selectedDrive = candidates.find((d) => d.letter === driveLetterSel) ?? candidates[0];

  /**
   * 新建文件夹时输入框里的默认名。
   *
   * 用不翻译的 "New folder" 而不是 t(K.dialog.newFolder)：
   * 那是个**真实会落盘的目录名**。「新建文件夹」逐字翻译成英文会得到
   * "New folder"，而中文界面下又变成「新建文件夹」——同一台机器换语言
   * 建出来的目录名就不一样了，很难排查。固定成一个词更省事。
   */
  const newFolderDefaultName = () => DEFAULT_NEW_FOLDER_NAME;

  // ====== 默认模式下自动计算 targetRoot（固定落在 FolderMove-Plus）======
  const defaultTargetRoot = selectedDrive
    ? `${selectedDrive.letter}${DEFAULT_SUBFOLDER}`
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
        setFsError(e);
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
  // 从 pickdir 步骤下一步：**不覆盖用户已选的 selectedPath**
  // - 如果用户已手动点击/新建选中了目录（selectedPath 有值），直接进 confirm
  // - 如果用户没有点选但点了下一步（说明想把"当前浏览目录"作为目标），才套用 browsePath
  //   —— 原来底部的「选当前目录」按钮去掉了，这个兜底行为正好顶替它的作用
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
    setCreatingName(newFolderDefaultName());
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
    setCreatingName("");
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
      setFsError(e);
    } finally {
      setCreating(false);
      setCreatingName("");
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
      setFsError(e);
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
      setError(e);
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
      setError({
        code: "other",
        params: { detail: t(K.toast.procCheckFailed, { error: describeError(t, e) }) },
      });
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
        const list = res.failed
          .map((f) => t(K.toast.procEntry, { pid: f.pid, reason: f.reason }))
          .join(t(K.toast.pidListSeparator));
        setError({
          code: "other",
          params: { detail: t(K.toast.procKillPartial, { list }) },
        });
      }
    } catch (e) {
      setProcStage("idle");
      setError({
        code: "other",
        params: { detail: t(K.toast.procKillFailed, { error: describeError(t, e) }) },
      });
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
      setError({
        code: "other",
        params: { detail: t(K.toast.procCheckFailed, { error: describeError(t, e) }) },
      });
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

  const errorText = error ? describeError(t, error) : null;
  const fsErrorText = fsError ? describeError(t, fsError) : null;
  const riskReason = describeReason(t, app.risk_reason);

  /** 底部「开始搬家」按钮的文案：随进程检测阶段变化 */
  const submitButtonLabel = () => {
    if (procStage === "checking") {
      return (
        <>
          <SpinnerIos20Regular className="animate-spin" /> {t(K.dialog.processing.checking)}
        </>
      );
    }
    if (procStage === "killing") {
      return (
        <>
          <SpinnerIos20Regular className="animate-spin" /> {t(K.dialog.processing.killing)}
        </>
      );
    }
    if (submitting) {
      return (
        <>
          <SpinnerIos20Regular className="animate-spin" /> {t(K.dialog.processing.moving)}
        </>
      );
    }
    return (
      <>
        {t(K.dialog.startMove)} <ArrowRight20Regular />
      </>
    );
  };

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
          <Avatar name={app.display_name} size={48} icon={app.icon} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold ink-primary truncate">
              {app.display_name}
            </div>
            <div className="text-xs ink-soft truncate">
              {app.publisher ?? t(K.dialog.unknownPublisher)}
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
              {t(K.dialog.pathOverview)}
            </div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <code className="ink-secondary">{app.install_location}</code>
              <ArrowRight20Regular className="text-brand-500 dark:text-brand-400" />
              <code className="text-brand-700 dark:text-brand-400 font-medium">
                {newPath || t(K.common.empty)}
              </code>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="ink-soft">
                {t(K.dialog.appSize)}
                {computing ? (
                  <span className="ink-soft inline-flex items-center gap-1">
                    <SpinnerIos20Regular className="animate-spin" /> {t(K.dialog.computing)}
                  </span>
                ) : (
                  <span className="font-medium ink-primary">{bytes(size)}</span>
                )}
              </span>
              <span className="ink-soft">
                {t(K.dialog.mode)}
                <span className="font-medium ink-primary">
                  {mode === "advanced" ? t(K.dialog.modeAdvanced) : t(K.dialog.modeDefault)}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* ================ Step 1：选择目标盘 ================ */}
        {step === "drive" && (
          <>
            <div className="mb-2 text-sm font-medium ink-primary">{t(K.dialog.stepDriveTitle)}</div>
            {candidates.length === 0 ? (
              <div className="card p-4 text-sm text-amber-700 bg-amber-50 border-amber-200 mb-4 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                {t(K.dialog.stepDriveEmpty)}
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
                        {t(K.dialog.driveFree, { size: bytes(d.free_bytes) })}
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
            <div className="mb-2 text-sm font-medium ink-primary">{t(K.dialog.stepModeTitle)}</div>
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
                  <span className="font-semibold ink-primary">{t(K.dialog.modeDefaultName)}</span>
                </div>
                <div className="text-xs ink-soft leading-relaxed">
                  {t(K.dialog.modeDefaultDesc)}
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
                  <span className="font-semibold ink-primary">{t(K.dialog.modeAdvancedName)}</span>
                </div>
                <div className="text-xs ink-soft leading-relaxed">
                  {t(K.dialog.modeAdvancedDesc)}
                </div>
              </button>
            </div>
          </>
        )}

        {/* ================ Step 3：内嵌文件管理器 ================ */}
        {step === "pickdir" && (
          <>
            <div className="mb-2 text-sm font-medium ink-primary flex items-center gap-2">
              {t(K.dialog.stepPickdirTitle)}
              <span className="ml-auto text-[11px] font-normal ink-soft">
                {t(K.dialog.pickdirHint, { name: basename })}
              </span>
            </div>

            {/* 面包屑 + 工具栏 */}
            <div className="flex items-center gap-1.5 mb-2">
              <button
                className="btn-ghost !px-2 !py-1.5 disabled:opacity-40"
                onClick={goBack}
                disabled={!parentPath}
                title={t(K.dialog.goUp)}
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
                title={t(K.dialog.newFolder)}
              >
                <Add20Regular />
                {t(K.dialog.newFolder)}
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
                  {t(K.common.create)}
                </button>
                <button className="btn-ghost !py-1.5" onClick={cancelCreating}>
                  {t(K.common.cancel)}
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
                  <SpinnerIos20Regular className="animate-spin" /> {t(K.common.loading)}
                </div>
              ) : fsErrorText ? (
                <div className="h-full min-h-[260px] flex flex-col items-center justify-center gap-2 text-sm text-amber-700 dark:text-amber-300 px-6 text-center">
                  <Warning20Filled />
                  <div>
                    {t(K.dialog.loadError)}<span className="break-all">{fsErrorText}</span>
                  </div>
                  <button
                    className="btn-ghost !py-1.5 mt-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadFolders(browsePath);
                    }}
                  >
                    <ArrowClockwise20Regular />
                    {t(K.common.retry)}
                  </button>
                </div>
              ) : folders.length === 0 ? (
                <div className="h-full min-h-[260px] flex flex-col items-center justify-center gap-1 ink-soft text-sm">
                  <Folder20Regular className="w-8 h-8 opacity-50" />
                  <div>{t(K.dialog.noSubfolders)}</div>
                  <div className="text-xs">
                    {t(K.dialog.noSubfoldersHint)}
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
                                {t(K.dialog.selected)}
                              </span>
                            )}
                            <button
                              className="btn-ghost !p-1.5 opacity-0 group-hover:opacity-100 transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRenaming(f);
                              }}
                              title={t(K.dialog.rename)}
                            >
                              <Edit20Regular className="w-4 h-4" />
                            </button>
                            <button
                              className="btn-ghost !p-1.5 opacity-0 group-hover:opacity-100 transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                enterFolder(f);
                              }}
                              title={t(K.dialog.openFolder)}
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

            {fsErrorText && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {fsErrorText}
              </div>
            )}
          </>
        )}

        {/* ================ Step 4：确认页 & 提交 / 错误区 ================ */}
        {step === "confirm" && (
          <>
            {/* 高风险提示 */}
            {app.risk_level === "high" && (
              <div className="rounded-lg p-3 mb-4 bg-red-50 text-red-700 border border-red-200 text-sm flex gap-2 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
                <ShieldError20Regular className="shrink-0 mt-0.5" />
                <span>
                  <strong>{t(K.dialog.highRiskTitle)}</strong>
                  {riskReason ?? t(K.dialog.highRiskFallback)}
                  {t(K.dialog.highRiskSuffix)}
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
                    ? t(K.dialog.spaceEnough, { size: bytes(size) })
                    : t(K.dialog.spaceNotEnough, { free: bytes(free), size: bytes(size) })}
                </span>
              </div>
            )}

            {/* 进程检测状态 */}
            {procStage === "checking" && (
              <div className="rounded-lg p-3 mb-4 bg-panel-soft dark:bg-white/5 ink-secondary border border-soft text-sm flex items-center gap-2">
                <SpinnerIos20Regular className="animate-spin" />
                {t(K.dialog.checkingProcs)}
              </div>
            )}

            {procStage === "killing" && (
              <div className="rounded-lg p-3 mb-4 bg-amber-50 text-amber-700 border border-amber-200 text-sm flex items-center gap-2 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                <SpinnerIos20Regular className="animate-spin" />
                {t(K.dialog.killingProcs)}
              </div>
            )}

            {procs && procs.length > 0 && procStage === "idle" && (
              <div className="rounded-lg p-3 mb-4 bg-amber-50 border border-amber-200 text-sm dark:bg-amber-500/10 dark:border-amber-500/30">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                  <WarningShield20Filled className="shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      {t(K.dialog.procsFound, { count: procs.length })}
                    </div>
                    <div className="text-xs mt-0.5 opacity-90">
                      {t(K.dialog.procsFoundHint)}
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
                    {t(K.dialog.procsKillFailed)}
                    {killFailed
                      .map((f) => t(K.toast.procEntry, { pid: f.pid, reason: f.reason }))
                      .join(t(K.toast.pidListSeparator))}
                  </div>
                )}
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    className="btn-primary !py-1.5 !text-xs"
                    onClick={killAndMove}
                    disabled={busy}
                  >
                    <WarningShield20Filled />
                    {t(K.dialog.procsKillAndContinue)}
                  </button>
                  <button
                    className="btn-ghost !py-1.5 !text-xs"
                    onClick={recheck}
                    disabled={busy}
                  >
                    <ArrowClockwise20Regular />
                    {t(K.dialog.procsRecheck)}
                  </button>
                </div>
              </div>
            )}

            {procs && procs.length === 0 && procStage === "idle" && !submitting && (
              <div className="rounded-lg p-3 mb-4 bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm flex items-center gap-2 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                <CheckmarkCircle20Filled />
                {t(K.dialog.procsNone)}
              </div>
            )}

            {errorText && (
              <div className="rounded-lg p-3 mb-4 bg-red-50 text-red-700 border border-red-200 text-sm flex gap-2 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
                <Warning20Filled className="shrink-0 mt-0.5" />
                <span className="break-all">{errorText}</span>
              </div>
            )}
          </>
        )}

        {/* ========== 底部按钮条 ========== */}
        {/* 按钮统一靠右：以前左边有个「通过 NTFS Junction 迁移」的说明，已去掉，
            用 ml-auto 占位保持右对齐 */}
        <div className="flex items-center gap-2 pt-3 border-t border-soft -mx-6 -mb-6 px-6 py-3 mt-1">
          <div className="mr-auto" />

          {step !== "drive" && (
            <button className="btn-ghost" onClick={goBackStep} disabled={busy}>
              <ArrowLeft20Regular />
              {t(K.common.back)}
            </button>
          )}

          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            {t(K.common.cancel)}
          </button>

          {/* 各步骤下一步 / 提交 */}
          {step === "drive" && (
            <button
              className="btn-primary"
              onClick={goFromDrive}
              disabled={!selectedDrive || candidates.length === 0}
            >
              {t(K.common.next)} <ArrowRight20Regular />
            </button>
          )}

          {step === "mode" && mode === "default" && (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={busy || !willFit || !!(procs && procs.length > 0)}
              title={procs && procs.length > 0 ? t(K.dialog.procsPendingTip) : undefined}
            >
              {submitButtonLabel()}
            </button>
          )}

          {step === "mode" && mode === "advanced" && (
            <button
              className="btn-primary"
              onClick={() => pickMode("advanced") /* 再次触发以确认选择 */}
              disabled={!selectedDrive}
            >
              {t(K.dialog.openFileManager)} <ArrowRight20Regular />
            </button>
          )}

          {step === "pickdir" && (
            <button
              className="btn-primary"
              onClick={goFromPickdir}
              disabled={busy || !browsePath}
            >
              {t(K.common.next)} <ArrowRight20Regular />
            </button>
          )}

          {step === "confirm" && (
            <button
              className="btn-primary"
              onClick={submit}
              disabled={!canSubmit}
              title={procs && procs.length > 0 ? t(K.dialog.procsPendingTip) : undefined}
            >
              {submitButtonLabel()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 顶部步骤条（视觉上 4 步：选盘 → 方式 → (文件管理器) → 确认）
 *
 * 布局要点：连接线**永远跟着「它右边那一步」一起渲染**。
 * 之前是分开判断的，占位步（默认方式下没有「选目录」）被隐藏时
 * 它的连接线却留了下来，导致「选盘 ⇢ 方式」之间凭空多出一条线段，
 * 而「方式 ⇢ 确认」之间没有，两个间距看起来就不一样宽。
 * 这里把两者绑成一个不可分割的整体（片段里同时给 key，避免 React 告警）。
 *
 * 导出是为了能在 `scripts/verify-stepbar.tsx` 里做渲染级验证。
 */
export function StepBar({ step, mode }: { step: Step; mode: Mode }) {
  const { t } = useTranslation();

  /** 中间那一步：只有高级方式才真正存在，否则是占位步 */
  const showPickdir = mode === "advanced";

  const items: { key: Step; label: string }[] = [
    { key: "drive", label: t(K.dialog.step.drive) },
    { key: "mode", label: t(K.dialog.step.mode) },
    ...(showPickdir ? [{ key: "pickdir" as const, label: t(K.dialog.step.pickdir) }] : []),
    { key: "confirm", label: t(K.dialog.step.confirm) },
  ];

  /** 1 = 当前步，2 = 已完成，0 = 还没到 */
  const stepIndex = (k: Step): 0 | 1 | 2 => {
    if (k === step) return 1;
    const order: Step[] = ["drive", "mode", "pickdir", "confirm"];
    const myIdx = order.indexOf(k);
    const curIdx = order.indexOf(step);
    if (myIdx < 0 || curIdx < 0) return 0;
    return myIdx < curIdx ? 2 : 0;
  };

  return (
    <div className="mt-2 flex items-center gap-1.5">
      {items.map((it, i) => {
        const status = stepIndex(it.key);
        return (
          <Fragment key={it.key}>
            {/* 连接线：画在每一步的左边，和这一步共存亡 */}
            {i > 0 && (
              <span
                className={`w-5 h-px shrink-0 ${
                  status === 2 || status === 1 ? "bg-brand-400" : "bg-ink-200 dark:bg-white/15"
                }`}
              />
            )}
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap ${
                status === 2
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : status === 1
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
          </Fragment>
        );
      })}
    </div>
  );
}
