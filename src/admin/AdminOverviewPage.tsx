import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Coins, Zap, TrendingUp, Wifi } from "lucide-react";
import { AdminPageHeader } from "./AdminPageHeader";
import { StatTile } from "./StatTile";
import { adminApi, AdminStats } from "./adminApi";
import { formatBalance, formatCount, formatRelativeTime } from "./format";
import { useLiveSpinFeed } from "./useLiveSpinFeed";
import { MaintenanceCard } from "./MaintenanceCard";
import { GeoBlockCard } from "./GeoBlockCard";

export function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const { spins, connected } = useLiveSpinFeed();

  useEffect(() => {
    adminApi.stats().then(setStats);
  }, []);

  return (
    <div>
      <AdminPageHeader title="Overview" description="Platform-wide activity at a glance." />

      {/* switch the whole website into / out of maintenance mode */}
      <MaintenanceCard />
      {/* block the website for visitors from selected countries (Pakistan by default) */}
      <GeoBlockCard />

      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total players" value={formatCount(stats.totalPlayers)} icon={Users} accent="indigo" />
          <StatTile label="Online now" value={formatCount(stats.onlineNow)} icon={Wifi} accent="emerald" />
          <StatTile label="Balance in circulation" value={formatBalance(stats.totalBalance)} icon={Coins} accent="amber" />
          <StatTile
            label="Wagered today"
            value={formatBalance(stats.today.wagered)}
            icon={TrendingUp}
            accent="indigo"
          />
        </div>
      )}

      {stats && stats.pendingForcedOutcomes > 0 && (
        <Link
          to="/admin/force-outcome"
          className="mt-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100"
        >
          <Zap size={16} />
          {stats.pendingForcedOutcomes} pending forced outcome{stats.pendingForcedOutcomes === 1 ? "" : "s"} — review
        </Link>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Recent activity</h2>
          <span className={`flex items-center gap-1 text-xs ${connected ? "text-emerald-600" : "text-slate-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
            {connected ? "live" : "connecting..."}
          </span>
        </div>
        <div className="divide-y divide-slate-200">
          {spins.slice(0, 6).map((s, i) => (
            <div key={i} className="flex hover:bg-slate-50 items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-700">{s.username || s.userId}</span>
              <span className="text-slate-500">bet {formatBalance(s.bet)}</span>
              <span className={s.winAmount > 0 ? "text-emerald-600" : "text-slate-500"}>
                {s.winAmount > 0 ? `+${formatBalance(s.winAmount)}` : "-"}
              </span>
              <span className="text-xs text-slate-500">{formatRelativeTime(s.createdAt)}</span>
            </div>
          ))}
          {spins.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-500">No spins yet.</div>}
        </div>
      </div>
    </div>
  );
}
