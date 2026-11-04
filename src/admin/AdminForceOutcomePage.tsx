import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { AdminPageHeader } from "./AdminPageHeader";
import { adminApi, AdminUser, ForcedOutcomeEntry } from "./adminApi";
import { formatRelativeTime } from "./format";
import { slotGames } from "../games/registry";

const TIERS = ["BIG WIN", "MEGA WIN", "JACKPOT"] as const;

export function AdminForceOutcomePage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userId, setUserId] = useState("");
  const [gameId, setGameId] = useState(slotGames[0]?.slug ?? "");
  const [targetTier, setTargetTier] = useState<(typeof TIERS)[number]>("BIG WIN");
  const [directives, setDirectives] = useState<ForcedOutcomeEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadDirectives = () => {
    adminApi.listForcedOutcomes().then(setDirectives);
  };

  useEffect(() => {
    adminApi.listUsers("active").then(setUsers);
    loadDirectives();
  }, []);

  const usernameFor = (id: string) => users.find((u) => u._id === id)?.username ?? id;
  const gameNameFor = (id: string) => slotGames.find((g) => g.slug === id)?.name ?? id;

  const submit = async () => {
    if (!userId || !gameId) return;
    setSubmitting(true);
    try {
      await adminApi.createForcedOutcome(userId, gameId, targetTier);
      loadDirectives();
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    await adminApi.cancelForcedOutcome(id);
    loadDirectives();
  };

  return (
    <div>
      <AdminPageHeader
        title="Force Outcome"
        description="Queue a directive that makes a player's next spin, on a specific game, land on a specific win tier."
      />

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-5">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        >
          <option value="">Select player...</option>
          {users.map((u) => (
            <option key={u._id} value={u._id}>
              {u.username}
              {u.fullName ? ` (${u.fullName})` : ""}
            </option>
          ))}
        </select>
        <select
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        >
          {slotGames.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={targetTier}
          onChange={(e) => setTargetTier(e.target.value as (typeof TIERS)[number])}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={submit}
          disabled={!userId || !gameId || submitting}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 sm:col-span-2"
        >
          <Zap size={16} />
          {submitting ? "Queuing..." : "Queue directive"}
        </button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
            <tr>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Game</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Queued</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {directives.map((d) => (
              <tr key={d._id} className="border-t border-slate-200 even:bg-slate-50 hover:bg-sky-50">
                <td className="px-3 py-2 text-slate-700">{usernameFor(d.userId)}</td>
                <td className="px-3 py-2 text-slate-500">{gameNameFor(d.gameId)}</td>
                <td className="px-3 py-2 text-amber-600">{d.targetTier}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium text-white ${
                      d.status === "pending"
                        ? "bg-indigo-500"
                        : d.status === "consumed"
                          ? "bg-sky-500"
                          : "bg-slate-400"
                    }`}
                  >
                    {d.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatRelativeTime(d.createdAt)}</td>
                <td className="px-3 py-2 text-right">
                  {d.status === "pending" && (
                    <button
                      onClick={() => cancel(d._id)}
                      className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-400"
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {directives.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No directives yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
