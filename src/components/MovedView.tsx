import { ArrowCounterclockwise20Regular, ArrowRight20Regular, Box20Regular, FolderArrowRight32Regular } from "@fluentui/react-icons";
import type { MoveRecord } from "../types";
import { Avatar } from "./Avatar";
import { useFormatters } from "../lib/useFormatters";
import { K, useTranslation } from "../i18n";

interface Props {
  records: MoveRecord[];
  onRestore: (r: MoveRecord) => void;
  busyId: string | null;
}

export function MovedView({ records, onRestore, busyId }: Props) {
  const { t } = useTranslation();
  const { bytes, dateTime } = useFormatters();

  // 注意：hook 必须在任何 return 之前调用，所以这里先算好再分支
  const totalFreed = records.reduce((s, r) => s + r.size_bytes, 0);

  if (records.length === 0) {
    return (
      <Empty
        icon={<FolderArrowRight32Regular className="ink-soft" />}
        title={t(K.moved.emptyTitle)}
        desc={t(K.moved.emptyDesc)}
      />
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center gap-2 text-sm ink-secondary">
        <Box20Regular className="text-brand-500 dark:text-brand-400" />
        {t(K.moved.summary, { count: records.length, size: bytes(totalFreed) })}
      </div>
      <div className="flex flex-col gap-2.5">
        {records.map((r) => {
          const busy = busyId === r.id;
          return (
            <div key={r.id} className="card p-4 flex items-center gap-4">
              <Avatar name={r.app_name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium ink-primary truncate">{r.app_name}</span>
                  <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{bytes(r.size_bytes)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs ink-soft flex-wrap">
                  <code className="ink-secondary">{r.original_path}</code>
                  <ArrowRight20Regular className="ink-soft" />
                  <code className="text-brand-600 dark:text-brand-400">{r.new_path}</code>
                </div>
                <div className="mt-1 text-[11px] ink-soft">
                  {t(K.moved.movedAt, { time: dateTime(r.moved_at) })}
                </div>
              </div>
              <button
                onClick={() => onRestore(r)}
                disabled={busy}
                className="btn-subtle shrink-0"
                title={t(K.moved.restoreTip)}
              >
                <ArrowCounterclockwise20Regular className={busy ? "animate-spin" : ""} />
                {busy ? t(K.moved.restoring) : t(K.moved.restore)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card p-12 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-lg bg-panel-soft dark:bg-white/5 flex items-center justify-center mb-4">
        {icon}
      </div>
      <div className="font-medium ink-primary">{title}</div>
      <div className="mt-1 text-sm ink-soft max-w-sm">{desc}</div>
    </div>
  );
}
