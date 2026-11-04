import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Coins, Crosshair, Percent, TrendingUp } from "lucide-react";
import { AdminPageHeader } from "./AdminPageHeader";
import { StatTile } from "./StatTile";
import { adminApi, FishGameAdminConfig, FishGameSessionRow, FishGameStats, FishStatsRange } from "./adminApi";
import { formatBalance, formatCount, formatDateTime } from "./format";
import { SPECIES, speciesPreviewPath } from "../games/FishGame/pixi/species";

/** Server species ids are the same as the game's asset folder names. */
const PREVIEW_BY_ID = new Map(SPECIES.map((s) => [s.folder, speciesPreviewPath(s)]));

const RANGES: { value: FishStatsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
];

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Fish Game's own admin page, kept apart from the slot RTP tools. Each hit costs one bet and
 * kills with chance RTP ÷ multiplier, so every shot returns exactly the target RTP on average
 * whichever creature it hits. Changing a multiplier changes how big and how rare that catch is,
 * not the game's RTP.
 */
export function AdminFishGamePage() {
  const [config, setConfig] = useState<FishGameAdminConfig | null>(null);
  const [rtpInput, setRtpInput] = useState("");
  const [multiplierInputs, setMultiplierInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const [range, setRange] = useState<FishStatsRange>("today");
  const [stats, setStats] = useState<FishGameStats | null>(null);
  const [sessions, setSessions] = useState<FishGameSessionRow[]>([]);

  function loadForm(next: FishGameAdminConfig) {
    setConfig(next);
    setRtpInput(String(next.rtpPercent));
    setMultiplierInputs(Object.fromEntries(next.species.map((s) => [s.id, String(s.multiplier)])));
  }

  useEffect(() => {
    adminApi.getFishGameConfig().then(loadForm);
  }, []);

  useEffect(() => {
    adminApi.getFishGameStats(range).then(setStats);
    adminApi.listFishGameSessions(range).then(setSessions);
  }, [range]);

  if (!config) return <div className="p-8 text-center text-slate-500">Loading fish game settings...</div>;

  const { limits } = config;
  const rtp = Number(rtpInput);
  const rtpValid = rtpInput !== "" && rtp >= limits.minRtpPercent && rtp <= limits.maxRtpPercent;
  const multiplierValid = (id: string) => {
    const raw = multiplierInputs[id];
    const value = Number(raw);
    return raw !== "" && value >= limits.minMultiplier && value <= limits.maxMultiplier;
  };
  const formValid = rtpValid && config.species.every((s) => multiplierValid(s.id));
  const statsBySpecies = new Map(stats?.species.map((s) => [s.speciesId, s]) ?? []);

  function edit(update: () => void) {
    setSavedOk(false);
    setSaveError(null);
    update();
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const speciesMultipliers = Object.fromEntries(
        Object.entries(multiplierInputs).map(([id, value]) => [id, Number(value)])
      );
      loadForm(await adminApi.updateFishGameConfig(rtp, speciesMultipliers));
      setSavedOk(true);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function resetMultipliers() {
    edit(() =>
      setMultiplierInputs(Object.fromEntries(config!.species.map((s) => [s.id, String(s.defaultMultiplier)])))
    );
  }

  return (
    <div className="max-w-6xl">
      <AdminPageHeader
        title="Fish Game RTP"
        gameSlugs={["fish-game"]}
        description="Target RTP and the ×multiplier each creature pays when caught. Changes apply to the very next shot."
        actions={
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  range === r.value ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Wagered" value={formatBalance(stats?.totals.wagered ?? 0)} icon={Coins} accent="indigo" />
        <StatTile label="Paid out" value={formatBalance(stats?.totals.paidOut ?? 0)} icon={TrendingUp} accent="amber" />
        <StatTile
          label="Actual RTP"
          value={`${(stats?.totals.rtpActual ?? 0).toFixed(2)}%`}
          icon={Percent}
          accent="emerald"
        />
        <StatTile
          label="Hits / catches"
          value={`${formatCount(stats?.totals.hits ?? 0)} / ${formatCount(stats?.totals.kills ?? 0)}`}
          icon={Crosshair}
          accent="rose"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Target RTP (%)
          <input
            type="number"
            step="0.1"
            min={limits.minRtpPercent}
            max={limits.maxRtpPercent}
            value={rtpInput}
            onChange={(e) => edit(() => setRtpInput(e.target.value))}
            className={inputClass(!rtpValid)}
          />
        </label>
        <p className="max-w-md flex-1 text-xs text-slate-500">
          Allowed {limits.minRtpPercent}–{limits.maxRtpPercent}%. Each hit costs one bet and catches with chance
          RTP ÷ ×multiplier, so the house edge is the same on every creature. Actual RTP only settles near the target
          after many thousands of hits.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={resetMultipliers}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset multipliers to defaults
          </button>
          <button
            onClick={save}
            disabled={!formValid || saving}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {saveError && <div className="w-full text-sm text-rose-600">{saveError}</div>}
        {savedOk && <div className="w-full text-sm text-emerald-600">Saved — live on the next shot.</div>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Creature</th>
              <th className="px-4 py-3">Multiplier (×)</th>
              <th className="px-4 py-3">Catch chance / hit</th>
              <th className="px-4 py-3">Avg hits to catch</th>
              <th className="px-4 py-3 text-right">Hits</th>
              <th className="px-4 py-3 text-right">Catches</th>
              <th className="px-4 py-3 text-right">Actual RTP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {config.species.map((s) => {
              const multiplier = Number(multiplierInputs[s.id]);
              const valid = multiplierValid(s.id) && rtpValid;
              const killChance = valid ? rtp / 100 / multiplier : null;
              const observed = statsBySpecies.get(s.id);
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-sky-950">
                        {PREVIEW_BY_ID.has(s.id) ? (
                          <img
                            src={PREVIEW_BY_ID.get(s.id)}
                            alt={s.name}
                            title={s.name}
                            loading="lazy"
                            className="max-h-full max-w-full object-contain p-1"
                          />
                        ) : (
                          <span className="text-xs text-sky-300/60">no image</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">default ×{s.defaultMultiplier}</div>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="1"
                      min={limits.minMultiplier}
                      max={limits.maxMultiplier}
                      value={multiplierInputs[s.id] ?? ""}
                      onChange={(e) =>
                        edit(() => setMultiplierInputs((prev) => ({ ...prev, [s.id]: e.target.value })))
                      }
                      className={inputClass(!multiplierValid(s.id))}
                    />
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">
                    {killChance === null ? "—" : `${(killChance * 100).toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">
                    {killChance === null ? "—" : (1 / killChance).toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatCount(observed?.hits ?? 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatCount(observed?.kills ?? 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {observed ? `${observed.rtpActual.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-1 mt-8 text-lg font-bold text-slate-800">Sessions</h2>
      <p className="mb-3 text-sm text-slate-400">
        One row per visit — {formatCount(stats?.totals.sessions ?? 0)} in this range,{" "}
        {formatCount(stats?.totals.activeSessions ?? 0)} playing now. "Result" is won − bet in this game;
        the balance change can differ if the player used other games at the same time.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Start bal.</th>
              <th className="px-4 py-3 text-right">End bal.</th>
              <th className="px-4 py-3 text-right">Hits / catches</th>
              <th className="px-4 py-3 text-right">Bet</th>
              <th className="px-4 py-3 text-right">Won</th>
              <th className="px-4 py-3 text-right">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sessions.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  No sessions in this range.
                </td>
              </tr>
            )}
            {sessions.map((s) => {
              const result = s.won - s.wagered;
              const end = s.endedAt ?? s.lastActivityAt;
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {s.userId ? (
                      <Link to={`/admin/users/${s.userId}`} className="hover:text-indigo-600 hover:underline">
                        {s.username}
                      </Link>
                    ) : (
                      s.username
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatDateTime(s.startedAt)}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">{formatDuration(s.startedAt, end)}</td>
                  <td className="px-4 py-2">
                    <SessionStatus status={s.status} reason={s.closeReason} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatBalance(s.startBalance)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {s.endBalance === null ? "—" : formatBalance(s.endBalance)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {formatCount(s.hits)} / {formatCount(s.kills)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatBalance(s.wagered)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{formatBalance(s.won)}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium tabular-nums ${
                      result >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {result >= 0 ? "+" : "−"}
                    {formatBalance(Math.abs(result))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CLOSE_REASON_LABELS: Record<NonNullable<FishGameSessionRow["closeReason"]>, string> = {
  exit: "Left game",
  idle: "Idle timeout",
  timeout: "Disconnected",
  replaced: "Opened elsewhere",
};

function SessionStatus({ status, reason }: { status: FishGameSessionRow["status"]; reason: FishGameSessionRow["closeReason"] }) {
  if (status === "active") {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Playing</span>;
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {reason ? CLOSE_REASON_LABELS[reason] : "Closed"}
    </span>
  );
}

function formatDuration(startIso: string, endIso: string): string {
  const totalSec = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
