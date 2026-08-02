import { FolderInput, ListChecks, Info, HardDrive } from "lucide-react";
import type { DriveInfo, MoveRecord } from "../types";
import { formatBytes, pct, driveLetter } from "../lib/format";

export type Tab = "apps" | "moved" | "about";

interface Props {
  tab: Tab;
  setTab: (t: Tab) => void;
  movedCount: number;
  drives: DriveInfo[];
  moved: MoveRecord[];
}

export function Sidebar({ tab, setTab, movedCount, drives, moved }: Props) {
  const items = [
    { id: "apps" as const, label: "软件列表", Icon: ListChecks },
    { id: "moved" as const, label: "已移动", Icon: FolderInput, badge: movedCount },
    { id: "about" as const, label: "关于", Icon: Info },
  ];

  // 仅显示固定盘，C 盘置顶
  const fixedDrives = drives
    .filter((d) => d.drive_type === "Fixed")
    .sort((a, b) => {
      const aC = a.letter.toLowerCase().startsWith("c") ? 0 : 1;
      const bC = b.letter.toLowerCase().startsWith("c") ? 0 : 1;
      return aC - bC || a.letter.localeCompare(b.letter);
    });

  return (
    <aside className="w-60 shrink-0 h-full flex flex-col bg-panel-glass border-r border-soft">
      <div className="px-5 py-5 flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shadow-soft"
          style={{ background: "linear-gradient(135deg,#3b66ff,#2948f5)" }}
        >
          <FolderInput size={22} className="text-white" />
        </div>
        <div>
          <div className="font-semibold ink-primary leading-tight">FolderMove-Plus</div>
          <div className="text-xs ink-soft">软件搬家 · 释放 C 盘</div>
        </div>
      </div>

      <nav className="px-3 py-2 flex flex-col gap-1">
        {items.map((it) => {
          const active = tab === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active
                  ? "bg-brand-50 text-brand-700 font-medium dark:bg-brand-500/15 dark:text-brand-300"
                  : "ink-secondary hover:bg-panel-soft dark:hover:bg-white/10"
              }`}
            >
              <it.Icon
                size={18}
                className={active ? "text-brand-600 dark:text-brand-400" : "ink-soft"}
              />
              <span className="flex-1 text-left">{it.label}</span>
              {"badge" in it && it.badge ? (
                <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">{it.badge}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-4 flex flex-col gap-2">
        {fixedDrives.length === 0 ? (
          <div className="text-[11px] ink-soft text-center py-2">未检测到磁盘</div>
        ) : (
          fixedDrives.map((d) => (
            <DriveBar key={d.letter} d={d} moved={moved} />
          ))
        )}
      </div>
    </aside>
  );
}

function DriveBar({ d, moved }: { d: DriveInfo; moved: MoveRecord[] }) {
  const letter = driveLetter(d).toUpperCase();
  const used = d.total_bytes - d.free_bytes;
  const p = pct(used, d.total_bytes);

  // 颜色按使用率：>85% 红，>70% 橙，否则绿
  const color = p > 85 ? "#dc2626" : p > 70 ? "#ea580c" : "#16a34a";

  // 统计已搬到本盘的占用（仅对非 C 盘有意义，C 盘展示的是原始占用）
  const movedToHere = moved
    .filter((r) => r.target_drive.replace(/\\/g, "").toUpperCase().startsWith(letter))
    .reduce((s, r) => s + r.size_bytes, 0);

  // 已搬入占目标盘总容量的比例
  const movedPct = d.total_bytes > 0 ? Math.min(100, Math.round((movedToHere / d.total_bytes) * 100)) : 0;

  const isC = letter === "C";

  return (
    <div className="rounded-lg bg-panel-soft dark:bg-white/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <HardDrive size={14} className="ink-soft" />
        <span className="text-xs font-medium ink-secondary">{letter} 盘</span>
        <span className="ml-auto text-xs ink-soft">{p}%</span>
      </div>
      <div className="relative h-2 rounded-full border-base overflow-hidden bg-panel dark:bg-white/10">
        {/* 总使用率 */}
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${p}%`, background: color }}
        />
        {/* 已搬入的占比叠加层（半透明白条纹，区分「搬过来的」） */}
        {!isC && movedPct > 0 && (
          <div
            className="absolute top-0 h-full bg-white/35 backdrop-grayscale"
            style={{
              left: `${Math.max(0, p - movedPct)}%`,
              width: `${movedPct}%`,
            }}
            title={`已搬入 ${formatBytes(movedToHere)}`}
          />
        )}
      </div>
      <div className="mt-1.5 text-[11px] ink-soft flex items-center gap-1 flex-wrap">
        <span>剩余 {formatBytes(d.free_bytes)}</span>
        <span className="opacity-50">/</span>
        <span>共 {formatBytes(d.total_bytes)}</span>
      </div>
      {!isC && movedToHere > 0 && (
        <div className="mt-0.5 text-[10px] text-brand-600 dark:text-brand-400 font-medium">
          ↪ 已搬入 {formatBytes(movedToHere)}
        </div>
      )}
    </div>
  );
}
