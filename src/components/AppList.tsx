import { useMemo, useState } from "react";
import { Search16Regular, ArrowRight16Regular, ArrowClockwise16Regular, Link16Regular, Prohibited16Regular, ShieldError16Regular, ShieldCheckmark16Regular, Shield16Regular } from "@fluentui/react-icons";
import type { AppInfo, DriveInfo } from "../types";
import { Avatar } from "./Avatar";
import { formatBytes, driveLetter } from "../lib/format";

interface Props {
  apps: AppInfo[];
  drives: DriveInfo[];
  loading: boolean;
  onMove: (app: AppInfo) => void;
  onRescan: () => void;
}

type RiskFilter = "all" | "low" | "medium" | "high";

export function AppList({ apps, loading, onMove, onRescan }: Props) {
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [sortBy, setSortBy] = useState<"size" | "name">("size");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = apps.filter((a) => {
      if (riskFilter !== "all" && a.risk_level !== riskFilter) return false;
      if (q) {
        const hay = `${a.display_name} ${a.publisher ?? ""} ${a.install_location}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "size") return b.estimated_size_bytes - a.estimated_size_bytes;
      return a.display_name.localeCompare(b.display_name, "zh");
    });
    return list;
  }, [apps, query, riskFilter, sortBy]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search16Regular className="absolute left-3 top-1/2 -translate-y-1/2 ink-soft" />
          <input
            className="field pl-9"
            placeholder="搜索软件名、发布者或路径…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="field w-auto py-1.5 text-xs"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
            title="按风险评级筛选"
          >
            <option value="all">全部风险</option>
            <option value="low">仅低风险</option>
            <option value="medium">仅中风险</option>
            <option value="high">仅高风险</option>
          </select>
          <select
            className="field w-auto py-1.5 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "size" | "name")}
          >
            <option value="size">按大小排序</option>
            <option value="name">按名称排序</option>
          </select>
          <button className="btn-ghost" onClick={onRescan} title="重新扫描">
            <ArrowClockwise16Regular className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="text-xs ink-soft mb-2.5">
        {loading ? "扫描中…" : `共 ${filtered.length} 个软件`}
      </div>

      {loading && apps.length === 0 ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center ink-soft text-sm">
          没有匹配的软件
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((a) => (
            <AppRow key={a.id + a.install_location} app={a} onMove={onMove} />
          ))}
        </div>
      )}
    </div>
  );
}

function RiskBadge({ level }: { level: AppInfo["risk_level"] }) {
  if (level === "high") {
    return (
      <span className="chip bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 shrink-0" title="高风险：移动可能影响系统稳定性">
        <ShieldError16Regular /> 高风险
      </span>
    );
  }
  if (level === "medium") {
    return (
      <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 shrink-0" title="中风险：建议先退出软件">
        <Shield16Regular /> 中风险
      </span>
    );
  }
  return (
    <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 shrink-0" title="低风险：可放心移动">
      <ShieldCheckmark16Regular /> 低风险
    </span>
  );
}

function AppRow({ app, onMove }: { app: AppInfo; onMove: (a: AppInfo) => void }) {
  const letter = app.source_drive.replace(/\\/g, "").replace(":", "");
  return (
    <div className="card p-3.5 flex items-center gap-3.5 hover:shadow-glow transition-shadow group">
      <Avatar name={app.display_name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium ink-primary truncate">{app.display_name}</span>
          {app.version && (
            <span className="text-[11px] ink-soft shrink-0">v{app.version}</span>
          )}
          {app.is_already_linked && (
            <span className="chip bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 shrink-0">
              <Link16Regular /> 已链接
            </span>
          )}
          <RiskBadge level={app.risk_level} />
        </div>
        <div className="text-xs ink-soft truncate flex items-center gap-1.5">
          {app.publisher && <span className="truncate">{app.publisher}</span>}
          {app.publisher && <span>·</span>}
          <code className="ink-secondary truncate" title={app.install_location}>
            {app.install_location}
          </code>
        </div>
        {app.risk_reason && (
          <div className="text-[11px] ink-soft truncate mt-0.5">{app.risk_reason}</div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <span className="chip bg-panel-soft dark:bg-white/5 ink-secondary">{formatBytes(app.estimated_size_bytes)}</span>
        <span className="text-[10px] ink-soft">{letter}: 盘</span>
      </div>
      <div className="shrink-0">
        {app.is_movable ? (
          <button className="btn-primary" onClick={() => onMove(app)}>
            移动
            <ArrowRight16Regular />
          </button>
        ) : (
          <button
            className="btn-subtle opacity-60 cursor-not-allowed"
            disabled
            title={app.not_movable_reason ?? "不可移动"}
          >
            <Prohibited16Regular />
            不可移动
          </button>
        )}
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card p-3.5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-panel-soft animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 bg-panel-soft rounded animate-pulse" />
            <div className="h-3 w-1/2 bg-panel-mute rounded animate-pulse" />
          </div>
          <div className="h-8 w-16 bg-panel-soft rounded-lg animate-pulse" />
        </div>
      ))}
    </div>
  );
}
