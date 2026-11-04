import { useCallback, useEffect, useState } from "react";
import { Trophy, Save, CalendarClock, X, Zap, Search, RotateCcw } from "lucide-react";
import { AdminPageHeader } from "./AdminPageHeader";
import {
  adminApi,
  AdminUser,
  JackpotHistoryEntry,
  JackpotOverview,
  JackpotSettings,
  JackpotTierKey,
  JackpotTierOverview,
} from "./adminApi";
import { formatBalance, formatDateTime } from "./format";
import { slotGames } from "../games/registry";

const REFRESH_MS = 5000;
const LOCK_BEFORE_MS = 2 * 60_000;

const TIER_ACCENT: Record<JackpotTierKey, string> = {
  jackpot: "bg-rose-500",
  mega: "bg-purple-500",
  major: "bg-blue-500",
  mini: "bg-emerald-500",
};

function apiError(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

/** Date → the "YYYY-MM-DDTHH:mm" local-time string a datetime-local input expects. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

const gameNameFor = (slug: string) => slotGames.find((g) => g.slug === slug)?.name ?? slug;

export function AdminJackpotPage() {
  const [overview, setOverview] = useState<JackpotOverview | null>(null);
  const [history, setHistory] = useState<JackpotHistoryEntry[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<JackpotSettings | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([adminApi.getJackpotOverview(), adminApi.listJackpotHistory()]);
    setOverview(o);
    setHistory(h);
    return o;
  }, []);

  useEffect(() => {
    adminApi.listUsers("active").then(setUsers);
    load().then((o) => setSettings(o.settings));
    const id = window.setInterval(() => void load().catch(() => {}), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const editSettings = (patch: Partial<JackpotSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettingsDirty(true);
    setSettingsMessage(null);
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      await adminApi.updateJackpotSettings(settings);
      setSettingsDirty(false);
      setSettingsMessage("Saved");
      await load();
    } catch (err) {
      setSettingsMessage(apiError(err, "Save failed"));
    } finally {
      setSavingSettings(false);
    }
  };

  const togglePoolGame = (slug: string) => {
    if (!settings) return;
    const poolGames = settings.poolGames.includes(slug)
      ? settings.poolGames.filter((g) => g !== slug)
      : [...settings.poolGames, slug];
    editSettings({ poolGames });
  };

  if (!overview || !settings) {
    return (
      <div>
        <AdminPageHeader title="Jackpot" description="Loading..." />
      </div>
    );
  }

  const fillingTiers = overview.tiers.filter((t) => t.fillPercent < 100).length;

  return (
    <div>
      <AdminPageHeader
        title="Jackpot"
        description="Four jackpot tiers shared by the pool games. Every pool-game bet fills them equally up to each tier's max (a full tier's share goes to the others). A tier hits on its date, or in Auto mode as soon as it's full; the winner gets whatever it has collected."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Contribution right now"
          value={`${overview.contributionPercent.toFixed(2)}%`}
          note={
            fillingTiers === 0
              ? "Every tier is at its max — nothing is taken from bets"
              : `Split equally between ${fillingTiers} filling tier${fillingTiers === 1 ? "" : "s"} (${(100 / fillingTiers).toFixed(2)}% each)`
          }
        />
        <StatCard label="Pool-game bets per minute" value={formatBalance(overview.wagerPerMinute)} note="Average over the last hour" />
        <StatCard
          label="Playing pool games now"
          value={String(overview.poolPlayers.length)}
          note={overview.poolPlayers.map((p) => p.username).slice(0, 5).join(", ") || "Nobody"}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overview.tiers.map((tier) => (
          <TierCard
            key={tier.key}
            tier={tier}
            users={users}
            onChanged={() => void load()}
          />
        ))}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">Settings</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {overview.tiers.map((t) => (
            <label key={t.key} className="text-xs text-slate-500">
              {t.label} max
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={settings.amounts[t.key]}
                onChange={(e) => editSettings({ amounts: { ...settings.amounts, [t.key]: Number(e.target.value) } })}
                className="mt-1 w-full bg-white rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
            </label>
          ))}
          <label className="text-xs text-slate-500">
            Contribution %
            <input
              type="number"
              min={0}
              max={50}
              step={0.1}
              value={settings.baseContributionPercent}
              onChange={(e) => editSettings({ baseContributionPercent: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-sm text-slate-800"
            />
          </label>
        </div>

        <div className="mt-4 text-xs font-medium text-slate-500">Pool games</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {slotGames.map((g) => {
            const on = settings.poolGames.includes(g.slug);
            return (
              <button
                key={g.slug}
                onClick={() => togglePoolGame(g.slug)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  on ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveSettings}
            disabled={!settingsDirty || savingSettings}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            <Save size={16} />
            {savingSettings ? "Saving..." : "Save settings"}
          </button>
          {settingsMessage && <span className="text-sm text-slate-500">{settingsMessage}</span>}
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">Payout report</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
            <tr>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Winner</th>
              <th className="px-3 py-2">Game</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Chosen by</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Scheduled</th>
              <th className="px-3 py-2">Paid</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {history.map((h) => (
              <tr key={h._id} className="border-t border-slate-200 even:bg-slate-50 hover:bg-sky-50">
                <td className="px-3 py-2 font-medium text-amber-600">{h.label}</td>
                <td className="px-3 py-2 text-slate-700">{h.username ?? h.userId}</td>
                <td className="px-3 py-2 text-slate-500">{h.gameId ? gameNameFor(h.gameId) : "—"}</td>
                <td className="px-3 py-2 text-slate-700">{formatBalance(h.amount)}</td>
                <td className="px-3 py-2 text-slate-500">{h.winnerMode === "random" ? "Random" : "Admin"}</td>
                <td className="px-3 py-2 text-slate-500">{h.trigger === "auto" ? "Auto (full)" : "Date"}</td>
                <td className="px-3 py-2">
                  <PayoutResult entry={h} onRetried={() => void load()} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(h.scheduledAt)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{h.paidAt ? formatDateTime(h.paidAt) : "—"}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  No payouts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Outcome of a hit's payout for the report: Paid, Failed (with the reason and a Retry button),
 * or Retrying (waiting for the winner's next spin). Hover shows every try. */
function PayoutResult({ entry, onRetried }: { entry: JackpotHistoryEntry; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFailure = entry.attempts.filter((a) => !a.ok).slice(-1)[0];
  const tries = entry.attempts
    .map((a) => `${formatDateTime(a.at)} — ${a.ok ? `paid ${formatBalance(a.amount ?? 0)}` : `failed: ${a.reason ?? "unknown"}`}`)
    .join("\n");

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.retryJackpotHit(entry._id);
      onRetried();
    } catch (err) {
      setError(apiError(err, "Could not retry"));
    } finally {
      setBusy(false);
    }
  };

  if (entry.result === "paid") {
    return (
      <span title={tries} className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Success{entry.attempts.length > 1 ? ` (try ${entry.attempts.length})` : ""}
      </span>
    );
  }
  if (entry.result === "retrying") {
    return (
      <span title={tries} className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        Retrying — waiting for the winner to spin
      </span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1" title={tries}>
      <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Failed</span>
      {lastFailure?.reason && <span className="max-w-[220px] text-xs text-rose-600">{lastFailure.reason}</span>}
      <button
        onClick={() => void retry()}
        disabled={busy}
        className="flex items-center gap-1 rounded-md bg-rose-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-rose-400 disabled:opacity-50"
      >
        <RotateCcw size={12} />
        Retry
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}

function StatCard({ label, value, note, highlight }: { label: string; value: string; note?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${highlight ? "border-amber-400" : "border-slate-200"}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${highlight ? "text-amber-600" : "text-slate-800"}`}>{value}</div>
      {note && <div className="mt-1 truncate text-xs text-slate-400">{note}</div>}
    </div>
  );
}

function hitStatusText(tier: JackpotTierOverview): { label: string; tone: string } {
  const hit = tier.hit;
  if (!hit) return tier.auto.enabled ? { label: "Auto — hits when full", tone: "bg-violet-500" } : { label: "Not scheduled", tone: "bg-slate-400" };
  if (hit.status === "scheduled") return { label: "Scheduled", tone: "bg-indigo-500" };
  if (hit.paymentFailed) return { label: "Payment failed", tone: "bg-rose-500" };
  const due = new Date(hit.scheduledAt).getTime() <= Date.now();
  if (!hit.userId) return { label: "Locked — waiting for a player", tone: "bg-amber-500" };
  if (!due) return { label: "Locked", tone: "bg-sky-600" };
  if (tier.balance < 0.01) return { label: "Waiting for funds", tone: "bg-amber-500" };
  return { label: `Waiting for ${hit.username ?? "winner"} to play`, tone: "bg-amber-500" };
}

/** Live time left until a date hit, ticking every second ("2d 03h 14m 05s"), with the full hit
 * date (year included) underneath. */
function HitCountdown({ at }: { at: string }) {
  const target = new Date(at).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const totalSeconds = Math.max(0, Math.floor((target - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-indigo-500">
        {totalSeconds > 0 ? "Hits in" : "Hit time reached"}
      </div>
      <div className="font-mono text-xl font-bold tabular-nums text-indigo-700">
        {days}d {pad(hours)}h {pad(minutes)}m {pad(seconds)}s
      </div>
      <div className="text-[11px] text-indigo-400">
        {new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </div>
    </div>
  );
}

/** Pick a player by typing their username or user ID. Read-only when `disabled`. */
function PlayerSearch({
  users,
  value,
  onChange,
  disabled,
}: {
  users: AdminUser[];
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  if (value) {
    const selected = users.find((u) => u._id === value);
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-800">{selected?.username ?? "Unknown player"}</div>
          <div className="truncate font-mono text-[11px] text-slate-400">{value}</div>
        </div>
        {!disabled && (
          <button onClick={() => onChange("")} className="text-slate-400 hover:text-rose-500" aria-label="Clear player">
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = q
    ? users
        .filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u._id.toLowerCase().startsWith(q) ||
            (u.fullName ?? "").toLowerCase().includes(q)
        )
        .slice(0, 8)
    : [];

  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder="Username or user ID"
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-800 disabled:bg-slate-100"
      />
      {open && q && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {matches.map((u) => (
            <button
              key={u._id}
              // onMouseDown so the pick lands before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(u._id);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-indigo-50"
            >
              <div className="text-sm text-slate-800">
                {u.username}
                {u.fullName ? <span className="text-slate-400"> ({u.fullName})</span> : null}
              </div>
              <div className="font-mono text-[11px] text-slate-400">{u._id}</div>
            </button>
          ))}
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matching player</div>}
        </div>
      )}
    </div>
  );
}

function TierCard({
  tier,
  users,
  onChanged,
}: {
  tier: JackpotTierOverview;
  users: AdminUser[];
  onChanged: () => void;
}) {
  const hit = tier.hit;
  const autoOn = tier.auto.enabled;
  const locked = hit?.status === "locked";
  const dateEditable = !hit || (hit.status === "scheduled" && new Date(hit.scheduledAt).getTime() - Date.now() > LOCK_BEFORE_MS);
  const status = hitStatusText(tier);

  const [when, setWhen] = useState("");
  const [winnerMode, setWinnerMode] = useState<"random" | "player">("random");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the form from the server whenever the hit or the Auto setting changes there: in Auto mode
  // it edits the next round's winner, otherwise the date hit.
  useEffect(() => {
    setWhen(hit && hit.trigger === "date" ? toLocalInput(new Date(hit.scheduledAt)) : "");
    const pick = autoOn ? tier.auto.userId : hit?.winnerMode === "player" ? hit.userId : null;
    setWinnerMode(pick ? "player" : "random");
    setUserId(pick ?? "");
    setError(null);
  }, [hit?._id, autoOn, tier.auto.userId]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(apiError(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const pickedUser = winnerMode === "player" ? userId || null : null;

  const toggleAuto = () => {
    if (!autoOn && hit?.status === "scheduled" && !window.confirm("Turning Auto on cancels the scheduled date hit. Continue?")) return;
    void run(() => adminApi.updateJackpotAuto(tier.key, { enabled: !autoOn, userId: autoOn ? null : pickedUser }), "Could not change Auto");
  };

  const saveAutoWinner = () => {
    if (winnerMode === "player" && !userId) {
      setError("Select the winning player");
      return;
    }
    void run(() => adminApi.updateJackpotAuto(tier.key, { enabled: true, userId: pickedUser }), "Could not save");
  };

  const submitDate = () => {
    if (!when) {
      setError("Pick a date and time");
      return;
    }
    const scheduledAt = new Date(when);
    if (scheduledAt.getTime() - Date.now() <= LOCK_BEFORE_MS) {
      setError("Pick a time more than 2 minutes from now");
      return;
    }
    if (winnerMode === "player" && !userId) {
      setError("Select the winning player");
      return;
    }
    const payload = { scheduledAt: scheduledAt.toISOString(), winnerMode, userId: pickedUser };
    void run(
      () => (hit ? adminApi.updateJackpotHit(hit._id, payload) : adminApi.createJackpotHit({ tier: tier.key, ...payload })),
      "Could not save"
    );
  };

  const cancel = () => {
    if (hit) void run(() => adminApi.cancelJackpotHit(hit._id), "Could not cancel");
  };

  const eta =
    tier.fillPercent >= 100
      ? "At max — its share now goes to the other tiers"
      : tier.minutesToFull === null
        ? "No bets coming in yet"
        : `~${formatMinutes(tier.minutesToFull)} to max`;
  const lateWarning =
    hit?.trigger === "date" &&
    tier.fillPercent < 100 &&
    (tier.minutesToFull === null || Date.now() + tier.minutesToFull * 60_000 > new Date(hit.scheduledAt).getTime());
  // The form is hidden while a round is locked (its winner is final) or a date hit is about to lock.
  const showForm = !locked && (autoOn || dateEditable);

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-amber-500" />
          <span className="text-lg font-bold text-slate-800">{tier.label}</span>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium text-white ${status.tone}`}>{status.label}</span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800">{formatBalance(tier.balance)}</span>
        <span className="text-xs text-slate-400">collected · max {formatBalance(tier.amount)}</span>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Filled toward max</span>
          <span className="font-semibold text-slate-700">{tier.fillPercent.toFixed(1)}%</span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full ${TIER_ACCENT[tier.key]} transition-all`} style={{ width: `${tier.fillPercent}%` }} />
        </div>
        <div className={`mt-1 text-xs ${lateWarning ? "font-medium text-amber-600" : "text-slate-400"}`}>
          {eta}
          {lateWarning && " — won't reach max by the hit time; the winner gets whatever is collected"}
        </div>
      </div>

      {/* Countdown only for tiers with a date hit (Auto tiers hit when full, so there's no time). */}
      {hit?.trigger === "date" && <HitCountdown at={hit.scheduledAt} />}

      <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Zap size={14} className={autoOn ? "text-violet-500" : "text-slate-400"} />
            Auto
          </div>
          <div className="text-[11px] text-slate-400">Hit every time it's full, until turned off</div>
        </div>
        <button
          role="switch"
          aria-checked={autoOn}
          aria-label={`Auto mode for ${tier.label}`}
          onClick={toggleAuto}
          disabled={busy}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${autoOn ? "bg-violet-500" : "bg-slate-300"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoOn ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </div>

      {hit && !showForm && (
        <div className="mt-4 space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <div>
            <span className="text-slate-400">{hit.trigger === "auto" ? "Hit when full at:" : "Hits at:"}</span>{" "}
            {formatDateTime(hit.scheduledAt)}
          </div>
          <div className="text-slate-400">Winner{locked ? " (locked)" : ""}:</div>
          {hit.userId ? (
            <PlayerSearch users={users} value={hit.userId} onChange={() => {}} disabled />
          ) : (
            <div>Random — the first player to open a pool game</div>
          )}
          {hit.paymentFailed && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
              <div className="font-medium">Payout failed{hit.lastError ? `: ${hit.lastError}` : ""}</div>
              <div className="mt-0.5 text-rose-500">The tier keeps its {formatBalance(tier.balance)} until the winner is paid.</div>
              <button
                onClick={() => void run(() => adminApi.retryJackpotHit(hit._id), "Could not retry")}
                disabled={busy}
                className="mt-2 flex items-center gap-1 rounded-md bg-rose-500 px-2.5 py-1 font-medium text-white hover:bg-rose-400 disabled:opacity-50"
              >
                <RotateCcw size={13} />
                Retry payout
              </button>
            </div>
          )}
          {locked && autoOn && <div className="pt-1 text-xs text-slate-400">The next round's winner can be picked once this one is paid.</div>}
        </div>
      )}

      {showForm && (
        <div className="mt-4 space-y-2">
          <label className="block text-xs text-slate-500">
            Hit date & time
            <input
              type="datetime-local"
              value={autoOn ? "" : when}
              disabled={autoOn}
              min={toLocalInput(new Date(Date.now() + 3 * 60_000))}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-white border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
            />
            {autoOn && <span className="mt-1 block text-[11px] text-violet-500">Auto is on — it hits as soon as the tier is full</span>}
          </label>
          <div className="flex gap-2 text-sm">
            {(["random", "player"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setWinnerMode(mode)}
                className={`flex-1 rounded-lg border px-2 py-1.5 ${
                  winnerMode === mode ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600"
                }`}
              >
                {mode === "random" ? "Random player" : "Pick player"}
              </button>
            ))}
          </div>
          {winnerMode === "player" && <PlayerSearch users={users} value={userId} onChange={setUserId} />}
          <div className="flex gap-2">
            <button
              onClick={autoOn ? saveAutoWinner : submitDate}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              {autoOn ? <Zap size={16} /> : <CalendarClock size={16} />}
              {autoOn ? "Save winner" : hit ? "Update hit" : "Schedule hit"}
            </button>
            {!autoOn && hit && (
              <button
                onClick={cancel}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:opacity-50"
              >
                <X size={16} />
                Cancel
              </button>
            )}
          </div>
          {autoOn && (
            <div className="text-xs text-slate-400">
              {tier.auto.userId
                ? `Next round goes to ${tier.auto.username ?? tier.auto.userId}; after that it's random again`
                : "Next round goes to a random player playing a pool game"}
            </div>
          )}
          {!autoOn && hit && <div className="text-xs text-slate-400">Locks 2 minutes before {formatDateTime(hit.scheduledAt)}</div>}
        </div>
      )}
      {error && <div className="mt-2 text-xs text-rose-600">{error}</div>}
    </div>
  );
}
