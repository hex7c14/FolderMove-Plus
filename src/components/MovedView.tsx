import { RotateCcw, ArrowRight, Package, FolderInput } from "lucide-react";
import type { MoveRecord } from "../types";
import { Avatar } from "./Avatar";
import { formatBytes, formatDateTime } from "../lib/format";

interface Props {
  records: MoveRecord[];
  onRestore: (r: MoveRecord) => void;
  busyId: string | null;
}

export function MovedView({ records, onRestore, busyId }: Props) {
  if (records.length === 0) {
    return (
      <Empty
        icon={<FolderInput size={30} className="ink-soft" />}
        title="还没有移动过软件"
        desc="在「软件列表」中选择目标盘把软件搬走，移动记录会出现在这里，可随时还原。"
      />
    );
  }
  const totalFreed = records.reduce((s, r) => s + r.size_bytes, 0);
  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center gap-2 text-sm ink-secondary">
        <Package size={16} className="text-brand-500 dark:text-brand-400" />
        共 {records.length} 个已移动 · 累计释放 C 盘约
        <span className="font-semibold text-brand-700 dark:text-brand-400">{formatBytes(totalFreed)}</span>
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
                  <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{formatBytes(r.size_bytes)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs ink-soft flex-wrap">
                  <code className="ink-secondary">{r.original_path}</code>
                  <ArrowRight size={12} className="ink-soft" />
                  <code className="text-brand-600 dark:text-brand-400">{r.new_path}</code>
                </div>
                <div className="mt-1 text-[11px] ink-soft">
                  移动于 {formatDateTime(r.moved_at)}
                </div>
              </div>
              <button
                onClick={() => onRestore(r)}
                disabled={busy}
                className="btn-subtle shrink-0"
                title="把软件还原回原位置"
              >
                <RotateCcw size={15} className={busy ? "animate-spin" : ""} />
                {busy ? "还原中" : "还原"}
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
      <div className="w-16 h-16 rounded-2xl bg-panel-soft dark:bg-white/5 flex items-center justify-center mb-4">
        {icon}
      </div>
      <div className="font-medium ink-primary">{title}</div>
      <div className="mt-1 text-sm ink-soft max-w-sm">{desc}</div>
    </div>
  );
}
