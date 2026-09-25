import { SpinnerIos20Regular, CheckmarkCircle24Filled } from "@fluentui/react-icons";
import type { ProgressPayload } from "../types";
import { useFormatters } from "../lib/useFormatters";
import { describeProgressMessage, describeProgressPhase } from "../lib/errors";
import { K, useTranslation } from "../i18n";

export function ProgressOverlay({ progress }: { progress: ProgressPayload }) {
  const { t } = useTranslation();
  const { bytes } = useFormatters();
  const isDone = progress.phase === "done";
  const hasTotal = progress.total > 0 && progress.phase === "copying";
  const ratio = hasTotal && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  // 阶段标题：优先用阶段码，未知阶段回退到通用文案
  const phaseLabel = describeProgressPhase(t, progress.phase);

  // 明细文案：后端给的是消息码 + 参数，按当前语言翻译
  const detail = describeProgressMessage(
    t,
    progress.messageCode,
    progress.messageParams
  );

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
              {isDone ? t(K.progress.done) : phaseLabel}
            </div>
            <div className="text-xs ink-soft">
              {isDone ? t(K.progress.doneHint) : t(K.progress.runningHint)}
            </div>
          </div>
        </div>

        {hasTotal ? (
          <div>
            <div className="h-2 rounded-full bg-panel-soft dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${ratio}%`, backgroundColor: "var(--accent)" }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs ink-soft">
              <span>{bytes(progress.current)} / {bytes(progress.total)}</span>
              <span>{ratio}%</span>
            </div>
          </div>
        ) : (
          <div className="h-2 rounded-full bg-panel-soft dark:bg-white/10 overflow-hidden">
            <div
              className="h-full w-1/3 rounded-full animate-shimmer"
              style={{
                // 颜色跟随主题的强调色，跟随主题切换
                backgroundImage:
                  "linear-gradient(90deg, var(--accent) 0%, var(--accent-hover) 50%, var(--accent) 100%)",
                backgroundSize: "200% 100%",
              }}
            />
          </div>
        )}

        <div className="mt-4 text-sm ink-secondary truncate">{detail}</div>
      </div>
    </div>
  );
}
