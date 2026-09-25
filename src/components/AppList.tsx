import { Search16Regular, ArrowRight16Regular, ArrowClockwise16Regular, Link16Regular, Prohibited16Regular, ShieldError16Regular, ShieldCheckmark16Regular, Shield16Regular } from "@fluentui/react-icons";
import { useMemo, useState } from "react";
import type { AppInfo, DriveInfo, RiskLevel } from "../types";
import { Avatar } from "./Avatar";
import { driveLetter } from "../lib/format";
import { useFormatters } from "../lib/useFormatters";
import { describeReason } from "../lib/errors";
import { K, useTranslation } from "../i18n";

interface Props {
  apps: AppInfo[];
  drives: DriveInfo[];
  loading: boolean;
  onMove: (app: AppInfo) => void;
  onRescan: () => void;
}

type RiskFilter = "all" | RiskLevel;

export function AppList({ apps, loading, onMove, onRescan }: Props) {
  const { t } = useTranslation();
  const { compare, number } = useFormatters();
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [sortBy, setSortBy] = useState<"size" | "name">("size");

  const riskOptions: { value: RiskFilter; label: string }[] = [
    { value: "all", label: t(K.list.riskAll) },
    { value: "low", label: t(K.list.riskLowOnly) },
    { value: "medium", label: t(K.list.riskMediumOnly) },
    { value: "high", label: t(K.list.riskHighOnly) },
  ];

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
      // 按当前语言的排序规则比较（中文按拼音，日文按假名）
      return compare(a.display_name, b.display_name);
    });
    return list;
  }, [apps, query, riskFilter, sortBy, compare]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search16Regular className="absolute left-3 top-1/2 -translate-y-1/2 ink-soft" />
          <input
            className="field pl-9"
            placeholder={t(K.list.searchPlaceholder)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="field w-auto py-1.5 text-xs"
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
            title={t(K.list.filterByRisk)}
          >
            {riskOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="field w-auto py-1.5 text-xs"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "size" | "name")}
          >
            <option value="size">{t(K.list.sortBySize)}</option>
            <option value="name">{t(K.list.sortByName)}</option>
          </select>
          <button className="btn-ghost" onClick={onRescan} title={t(K.list.rescan)}>
            <ArrowClockwise16Regular className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="text-xs ink-soft mb-2.5">
        {loading ? t(K.list.scanning) : t(K.list.count, { count: number(filtered.length) })}
      </div>

      {loading && apps.length === 0 ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center ink-soft text-sm">
          {t(K.list.empty)}
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

function RiskBadge({ level }: { level: RiskLevel }) {
  const { t } = useTranslation();
  const label = t(K.list.risk[level]);
  const tip = t(K.list.riskTip[level]);

  if (level === "high") {
    return (
      <span className="chip bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 shrink-0" title={tip}>
        <ShieldError16Regular /> {label}
      </span>
    );
  }
  if (level === "medium") {
    return (
      <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 shrink-0" title={tip}>
        <Shield16Regular /> {label}
      </span>
    );
  }
  return (
    <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 shrink-0" title={tip}>
      <ShieldCheckmark16Regular /> {label}
    </span>
  );
}

function AppRow({ app, onMove }: { app: AppInfo; onMove: (a: AppInfo) => void }) {
  const { t } = useTranslation();
  const { bytes } = useFormatters();
  const letter = app.source_drive.replace(/\\/g, "").replace(":", "");
  const riskReason = describeReason(t, app.risk_reason);
  const notMovable = describeReason(t, app.not_movable_reason);

  return (
    <div className="card p-3.5 flex items-center gap-3.5 hover:shadow-ring transition-shadow group">
      <Avatar name={app.display_name} size={44} icon={app.icon} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium ink-primary truncate">{app.display_name}</span>
          {app.version && (
            <span className="text-[11px] ink-soft shrink-0">
              {t(K.list.version, { version: app.version })}
            </span>
          )}
          {app.is_already_linked && (
            <span className="chip bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 shrink-0">
              <Link16Regular /> {t(K.list.linked)}
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
        {riskReason && (
          <div className="text-[11px] ink-soft truncate mt-0.5">
            {riskReason}
          </div>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <span className="chip bg-panel-soft dark:bg-white/5 ink-secondary">{bytes(app.estimated_size_bytes)}</span>
        <span className="text-[10px] ink-soft">{t(K.list.driveLabel, { letter })}</span>
      </div>
      <div className="shrink-0">
        {app.is_movable ? (
          <button className="btn-primary" onClick={() => onMove(app)}>
            {t(K.list.move)}
            <ArrowRight16Regular />
          </button>
        ) : (
          <button
            className="btn-subtle opacity-60 cursor-not-allowed"
            disabled
            title={notMovable ?? t(K.list.notMovableFallback)}
          >
            <Prohibited16Regular />
            {t(K.list.notMovable)}
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
