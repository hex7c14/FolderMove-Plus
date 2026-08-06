import { useEffect, useMemo, useState } from "react";
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
} from "@fluentui/react-icons";
import type { AppInfo, DriveInfo, MoveRecord, MoveRequest, ProcInfo } from "../types";
import { Avatar } from "./Avatar";
import { formatBytes, driveDisplay, driveLetter } from "../lib/format";
import { api } from "../lib/api";

interface Props {
  app: AppInfo;
  drives: DriveInfo[];
  onSubmit: (req: MoveRequest) => Promise<MoveRecord>;
  onDone: () => void;
  onClose: () => void;
}

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

  const [driveLetterSel, setDriveLetterSel] = useState<string>(
    candidates[0]?.letter ?? ""
  );
  const [subfolder, setSubfolder] = useState("FolderMove-Plus");
  const [size, setSize] = useState<number>(app.estimated_size_bytes);
  const [computing, setComputing] = useState(app.estimated_size_bytes === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 残留进程检测状态
  // procs: null=未检测；[]=已检测无进程；非空=检测到残留进程
  const [procs, setProcs] = useState<ProcInfo[] | null>(null);
  const [procStage, setProcStage] = useState<"idle" | "checking" | "killing">("idle");
  const [killFailed, setKillFailed] = useState<{ pid: number; reason: string }[]>([]);

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

  const selectedDrive = candidates.find((d) => d.letter === driveLetterSel) ?? candidates[0];
  const targetRoot = selectedDrive ? `${selectedDrive.letter}${subfolder}` : "";
  const basename = app.install_location.split(/[/\\]/).filter(Boolean).pop() ?? "App";
  const newPath = targetRoot ? `${targetRoot}\\${basename}` : "";

  const free = selectedDrive?.free_bytes ?? 0;
  const sufficient = !computing && size > 0 ? free >= size : free > 0;
  const willFit = !computing && (size === 0 || free >= size + size / 20);

  const busy = submitting || procStage === "checking" || procStage === "killing";

  // 实际提交移动
  const doMove = async () => {
    if (!selectedDrive) return;
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

  // 点击"确认移动"：先检测残留进程
  const submit = async () => {
    if (!selectedDrive || busy) return;
    setError(null);
    setKillFailed([]);
    setProcStage("checking");
    setProcs(null);
    try {
      const list = await api.checkProcesses(app.install_location);
      setProcs(list);
      setProcStage("idle");
      // 无残留进程，直接移动
      if (list.length === 0) {
        await doMove();
      }
    } catch (e) {
      setProcStage("idle");
      setError(`进程检测失败：${e}`);
    }
  };

  // 用户确认后结束残留进程并继续移动
  const killAndMove = async () => {
    if (!procs || procs.length === 0 || busy) return;
    setProcStage("killing");
    setKillFailed([]);
    try {
      const res = await api.killProcesses(procs.map((p) => p.pid));
      setKillFailed(res.failed);
      // 等待进程真正退出
      await new Promise((r) => setTimeout(r, 600));
      // 重新检测
      const remain = await api.checkProcesses(app.install_location);
      setProcs(remain);
      setProcStage("idle");
      if (remain.length === 0) {
        await doMove();
      } else if (res.failed.length > 0) {
        setError(`部分进程无法结束：${res.failed.map((f) => `PID ${f.pid} (${f.reason})`).join("、")}`);
      }
    } catch (e) {
      setProcStage("idle");
      setError(`结束进程失败：${e}`);
    }
  };

  // 重新检测残留进程
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

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center backdrop animate-fade-in" onClick={onClose}>
      <div
        className="card w-[560px] max-w-[92vw] p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-5">
          <Avatar name={app.display_name} size={48} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold ink-primary truncate">{app.display_name}</div>
            <div className="text-xs ink-soft truncate">{app.publisher ?? "未知发布者"}</div>
          </div>
          <button className="btn-ghost -mr-2 -mt-1" onClick={onClose} disabled={submitting}>
            <Dismiss20Regular />
          </button>
        </div>

        {/* 当前 -> 新位置 */}
        <div className="rounded-lg bg-panel-soft dark:bg-white/5 p-3 mb-5">
          <div className="text-[11px] uppercase tracking-wide ink-soft mb-1">迁移路径</div>
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <code className="ink-secondary">{app.install_location}</code>
            <ArrowRight20Regular className="text-brand-500 dark:text-brand-400" />
            <code className="text-brand-700 dark:text-brand-400 font-medium">{newPath || "—"}</code>
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
          </div>
        </div>

        {/* 目标盘选择 */}
        <div className="mb-2 text-sm font-medium ink-primary">选择目标盘</div>
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
                    <HardDrive20Regular className={active ? "text-brand-600 dark:text-brand-400" : "ink-soft"} />
                    <span className="font-medium ink-primary">{driveDisplay(d)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-panel-soft dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{
                        width: `${Math.min(100, Math.round((d.free_bytes / Math.max(1, d.total_bytes)) * 100))}%`,
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

        {/* 目标文件夹名 */}
        <div className="mb-5">
          <label className="text-sm font-medium ink-primary">目标文件夹</label>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm ink-soft">{selectedDrive?.letter}</span>
            <input
              className="field"
              value={subfolder}
              onChange={(e) => setSubfolder(e.target.value.replace(/[\\/:*?"<>|]/g, ""))}
              placeholder="FolderMove-Plus"
              disabled={submitting}
            />
          </div>
        </div>

        {/* 高风险提示 */}
        {app.risk_level === "high" && (
          <div className="rounded-lg p-3 mb-4 bg-red-50 text-red-700 border border-red-200 text-sm flex gap-2 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
            <ShieldError20Regular className="shrink-0 mt-0.5" />
            <span>
              <strong>高风险警告：</strong>
              {app.risk_reason ?? "此目录涉及系统关键路径，移动后可能导致系统或软件异常。"}
              请务必先创建还原点并完全退出相关软件。
            </span>
          </div>
        )}

        {/* 残留进程检测 */}
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
                  获得您的允许后将强制结束它们。
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
                    <code className="ink-soft truncate ml-auto" title={p.exePath}>
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
              <button className="btn-ghost !py-1.5 !text-xs" onClick={recheck} disabled={busy}>
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

        {error && (
          <div className="rounded-lg p-3 mb-4 bg-red-50 text-red-700 border border-red-200 text-sm flex gap-2 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30">
            <Warning20Filled className="shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 border-t border-soft -mx-6 -mb-6 px-6 py-3 mt-1">
          <Folder20Regular className="ink-soft" />
          <span className="text-xs ink-soft mr-auto">
            通过 NTFS Junction 迁移，路径不变，软件照常运行
          </span>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={busy || !selectedDrive || candidates.length === 0 || !willFit || !!(procs && procs.length > 0)}
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
                确认移动 <ArrowRight20Regular />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
