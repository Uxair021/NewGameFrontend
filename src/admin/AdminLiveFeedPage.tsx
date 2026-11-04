import { useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { useLiveSpinFeed } from "./useLiveSpinFeed";
import { formatBalance, formatDateTime, formatRelativeTime } from "./format";
import { gameRegistry } from "../games/registry";

export function AdminLiveFeedPage() {
  const [search, setSearch] = useState("");
  const [gameFilter, setGameFilter] = useState("all");
  const { spins, connected, loading } = useLiveSpinFeed({ username: search, gameId: gameFilter });

  return (
    <div>
      <AdminPageHeader
        title="Live Feed"
        description="Every spin across every player, streamed in real time."
        actions={
          <span className={`flex items-center gap-1.5 text-xs ${connected ? "text-emerald-600" : "text-slate-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
            {connected ? "live" : "connecting..."}
          </span>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username..."
          className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400"
        />
        <select
          value={gameFilter}
          onChange={(e) => setGameFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
        >
          <option value="all">All games</option>
          {gameRegistry.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-slate-500">Searching...</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
            <tr>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Game</th>
              <th className="px-3 py-2">Bet</th>
              <th className="px-3 py-2">Win</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Balance after</th>
              <th className="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {spins.map((s, i) => (
              <tr key={i} className="border-t border-slate-200 even:bg-slate-50 hover:bg-sky-50">
                <td className="px-3 py-2 text-slate-700">
                  {s.username || s.userId}
                  {s.forced && <span className="ml-2 text-xs text-indigo-600">forced</span>}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {gameRegistry.find((g) => g.slug === s.gameId)?.name ?? s.gameId}
                </td>
                <td className="px-3 py-2 text-slate-500">{formatBalance(s.bet)}</td>
                <td className={`px-3 py-2 ${s.winAmount > 0 ? "text-emerald-600" : "text-slate-500"}`}>
                  {s.winAmount > 0 ? `+${formatBalance(s.winAmount)}` : "-"}
                </td>
                <td className="px-3 py-2 text-amber-600">{s.tier ?? "-"}</td>
                <td className="px-3 py-2 text-slate-500">{formatBalance(s.balanceAfter)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  <div>{formatDateTime(s.createdAt)}</div>
                  <div className="text-slate-400">{formatRelativeTime(s.createdAt)}</div>
                </td>
              </tr>
            ))}
            {!loading && spins.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {search || gameFilter !== "all" ? "No spins match your search." : "Waiting for spins..."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
