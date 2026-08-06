import { SpinnerIos20Regular, CheckmarkCircle24Filled } from "@fluentui/react-icons";
import type { ProgressPayload } from "../types";
import { formatBytes } from "../lib/format";

const PHASE_LABEL: Record<string, string> = {
  computing: "计算占用",
  copying: "复制文件",
  verifying: "校验完整性",
  linking: "创建链接",
  cleaning: "清理原文件",
  done: "完成",
};

export function ProgressOverlay({ progress }: { progress: ProgressPayload }) {
  const isDone = progress.phase === "done";
  const hasTotal = progress.total > 0 && progress.phase === "copying";
  const ratio = hasTotal && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop animate-fade-in">
      <div className="card w-[420px] p-7 animate-slide-up">
        <div className="flex items-center gap-3 mb-5">
          {isDone ? (
            <CheckmarkCircle24Filled className="text-emerald-500" />
          ) : (
            <SpinnerIos20Regular className="text-brand-600 dark:text-brand-400 animate-spin" />
          )}
          <div>
            <div className="font-semibold ink-primary">
              {isDone ? "操作完成" : PHASE_LABEL[progress.phase] ?? "处理中"}
            </div>
            <div className="text-xs ink-soft">
              {isDone ? "可以继续操作其他软件" : "请勿关闭软件或断电"}
            </div>
          </div>
        </div>

        {hasTotal ? (
          <div>
            <div className="h-2 rounded-full bg-panel-soft dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-300"
                style={{ width: `${ratio}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs ink-soft">
              <span>{formatBytes(progress.current)} / {formatBytes(progress.total)}</span>
              <span>{ratio}%</span>
            </div>
          </div>
        ) : (
          <div className="h-2 rounded-full bg-panel-soft dark:bg-white/10 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-brand-500 animate-shimmer"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #3b66ff 0%, #90b4ff 50%, #3b66ff 100%)",
                backgroundSize: "200% 100%",
              }}
            />
          </div>
        )}

        <div className="mt-4 text-sm ink-secondary truncate">{progress.message}</div>
      </div>
    </div>
  );
}
