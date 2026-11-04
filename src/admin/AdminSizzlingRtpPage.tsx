import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useRef, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  SizzlingRtpConfig,
  SizzlingStats,
  SizzlingTierRow,
  SizzlingSymbol,
  computeSizzlingStats,
  getForcedLossChance,
  getMixedPays,
  getSizzlingDefaultConfig,
  getSizzlingRtpConfig,
  setSizzlingRtpConfig,
  solveSizzlingWeights,
  saveSizzlingRtpConfigToServer,
  syncSizzlingRtpConfigFromServer,
} from "../games/SizzlingSevens/api";
import { FREE_GAMES_MIN_WIN_X, LINE_COST, PURE_WILD_PAYOUT } from "../games/SizzlingSevens/config";

const TIER_LABELS: Record<SizzlingSymbol, string> = {
  RED_7: "3x Red 7",
  BLUE_7: "3x Blue 7",
  TRIPLE_BAR: "3x Triple Bar",
  DOUBLE_BAR: "3x Double Bar",
  BAR: "3x Bar",
  BONUS: "3x Bonus (scatter — also starts Free Games)",
  WILD_2X: "3x Wild (pure, no matching symbol)",
};

/** Same reel-symbol art the game itself uses (public/symbols/sizzling7s — .webp files). */
const ART = (file: string) => `/symbols/sizzling7s/${file}.webp`;
const TIER_IMAGES: Record<SizzlingSymbol, string[]> = {
  RED_7: [ART("red-7")],
  BLUE_7: [ART("blue-7")],
  BAR: [ART("bar")],
  DOUBLE_BAR: [ART("bar2")],
  TRIPLE_BAR: [ART("bar3")],
  WILD_2X: [ART("2xWild")],
  BONUS: [ART("bonus")],
};

/** The two mixed-family pays — a payline of any mix, not 3 matching (pay only, no frequency). */
const MIXED_ROWS: { key: "anyBar" | "anySeven"; label: string; images: string[] }[] = [
  { key: "anyBar", label: "Any 3 Bars (mixed)", images: [ART("bar"), ART("bar2"), ART("bar3")] },
  { key: "anySeven", label: "Any 3 Sevens (mixed Red / Blue)", images: [ART("red-7"), ART("blue-7")] },
];

/** Every pay is stored relative to the game's internal LINE_COST (each winning line pays
 * pay × bet / LINE_COST), i.e. 30x the real "x bet" value. This page shows and edits x bet. */
const toX = (stored: number) => +(stored / LINE_COST).toFixed(5);
const fromX = (x: number) => x * LINE_COST;

/** RTP is a simulation estimate (free-games multipliers up to 30x make wins heavy-tailed), so it's
 * allowed a wider band than the exact-math pages' ±0.5%. */
const RTP_TOLERANCE = 1.0;

type Run = { kind: "solve" | "measure"; fraction: number };

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Sizzling 7s is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control, saved to localStorage; the saved config is what spinRequest scores with
 * (see games/SizzlingSevens/api.ts), so a change takes effect on the very next spin.
 *
 * RTP is measured by a 2M-round simulation built on the game's own win-calc (base spin + the
 * full Free Games round: awards, Mystery Pick, retriggers, multipliers, minimum-win floor), on
 * demand rather than on every edit. "Solve for target" changes only the reel frequencies (pays and
 * Loss % stay as set) — see solveSizzlingWeights.
 */
export function AdminSizzlingRtpPage() {
  const [config, setConfig] = useState<SizzlingRtpConfig>(() => getSizzlingRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncSizzlingRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getSizzlingRtpConfig();
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      if (changed) setConfig(next);
      if (changed) void measure(next);
      setLoadingServer(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [stats, setStats] = useState<SizzlingStats | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  /** Bumped to abandon a running simulation (on unmount, on edit, or when a new one starts). */
  const runId = useRef(0);

  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  // The Loss % is applied on top of the last measurement exactly (a forced loss zeroes a random
  // share of would-be wins), so changing it never needs a new simulation.
  const forcedChance = stats ? getForcedLossChance({ ...config, naturalLossPercent: stats.naturalLossPercent }) : 0;
  const effectiveRtp = stats ? stats.naturalRtpPercent * (1 - forcedChance) : null;
  const effectiveLoss = stats ? stats.naturalLossPercent + (100 - stats.naturalLossPercent) * forcedChance : null;
  const hitPercent = (key: string): string =>
    stats ? `${((stats.naturalHitPercent[key] ?? 0) * (1 - forcedChance)).toFixed(2)}%` : "—";
  const lossBelowNatural = stats !== null && (config.lossPercent ?? 0) > 0 && (config.lossPercent ?? 0) < stats.naturalLossPercent;
  const rtpValid = effectiveRtp !== null && Math.abs(effectiveRtp - config.targetRtpPercent) <= RTP_TOLERANCE;
  const isValid = frequencyValid && rtpValid && run === null;

  async function measure(target: SizzlingRtpConfig) {
    const id = ++runId.current;
    setRun({ kind: "measure", fraction: 0 });
    const result = await computeSizzlingStats(target, {
      onProgress: (fraction) => runId.current === id && setRun({ kind: "measure", fraction }),
    });
    if (runId.current !== id) return;
    setStats(result);
    setRun(null);
  }

  async function solve() {
    const id = ++runId.current;
    setSavedOk(false);
    setRun({ kind: "solve", fraction: 0 });
    const result = await solveSizzlingWeights(config, config.targetRtpPercent, (fraction) => {
      if (runId.current === id) setRun({ kind: "solve", fraction });
    });
    if (runId.current !== id) return;
    setConfig(result.config);
    setStats(result.stats);
    setUnreachable(!result.reachable);
    setRun(null);
  }

  // Measure what's currently saved when the page opens.
  useEffect(() => {
    void measure(config);
    return () => {
      runId.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Any change to the odds or pays invalidates the last measurement. */
  function updateTier(key: SizzlingSymbol, patch: Partial<SizzlingTierRow>) {
    runId.current++;
    setRun(null);
    setStats(null);
    setUnreachable(false);
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)) }));
  }

  function updateMixedPay(key: "anyBar" | "anySeven", value: number) {
    runId.current++;
    setRun(null);
    setStats(null);
    setUnreachable(false);
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, mixedPays: { ...getMixedPays(prev), [key]: value } }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid || !stats) return;
    // The forcing chance is derived from the natural loss rate, so it's saved with the config.
    const saved = { ...config, naturalLossPercent: stats.naturalLossPercent };
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveSizzlingRtpConfigToServer(saved);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setSizzlingRtpConfig(saved);
    setConfig(saved);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    runId.current++;
    setRun(null);
    setStats(null);
    setUnreachable(false);
    setSavedOk(false);
    setConfig(getSizzlingDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Sizzling 7s RTP"
        gameSlugs={["sizzling-7s"]}
        description="Saved to the server — every player\'s Sizzling 7s loads this config each time the game opens. Spins still resolve in the player\'s browser."
      />

      <div className="max-w-3xl space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-800">Target RTP %</label>
            <input
              type="number"
              step="0.1"
              max={MAX_TARGET_RTP_PERCENT}
              value={config.targetRtpPercent}
              onChange={(e) => {
                setSavedOk(false);
                setConfig((prev) => ({ ...prev, targetRtpPercent: Math.min(MAX_TARGET_RTP_PERCENT, Number(e.target.value)) }));
              }}
              disabled={run !== null}
              className={inputClass(stats !== null && !rtpValid)}
            />
            <button
              onClick={() => void solve()}
              disabled={run !== null || !frequencyValid || !(config.targetRtpPercent > 0)}
              className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              Solve for target
            </button>
            <button
              onClick={() => void measure(config)}
              disabled={run !== null || !frequencyValid}
              className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Measure current
            </button>
          </div>

          {lossBelowNatural && stats && (
            <p className="mt-2 text-sm text-amber-600">
              {config.lossPercent}% is below the natural loss rate ({stats.naturalLossPercent.toFixed(2)}%) — it can't go lower, so the
              reels just play naturally.
            </p>
          )}

          {run && (
            <div className="mt-4">
              <div className="text-xs text-slate-500">
                {run.kind === "solve" ? "Solving" : "Measuring"} — simulating spins… {Math.round(run.fraction * 100)}%
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${run.fraction * 100}%` }} />
              </div>
            </div>
          )}

          {!run && stats && (
            <div className="mt-3 flex flex-wrap gap-6 text-sm">
              <div className={`font-medium ${rtpValid ? "text-emerald-600" : "text-rose-600"}`}>
                Effective RTP: {effectiveRtp!.toFixed(2)}%{rtpValid ? " ✓" : ""}
              </div>
              <div className="text-slate-600">
                Loss rate: {effectiveLoss!.toFixed(2)}% of paid spins pay nothing (natural {stats.naturalLossPercent.toFixed(2)}%)
              </div>
            </div>
          )}
          {!run && !stats && (
            <p className="mt-3 text-sm text-amber-600">Changed since last measured — click "Solve for target" or "Measure current".</p>
          )}
          {!run && stats && !rtpValid && !unreachable && (
            <p className="mt-2 text-sm text-rose-600">
              RTP is more than ±{RTP_TOLERANCE}% away from the target — click "Solve for target".
            </p>
          )}
          {!run && unreachable && (
            <p className="mt-2 text-sm text-rose-600">
              This target can't be reached by changing reel frequencies alone with these pays and this Loss % — the closest
              frequencies were applied. Change the target, the Loss % or the pays.
            </p>
          )}

          <p className="mt-3 text-xs text-slate-500">
            RTP is measured by simulating 2,000,000 spins of the real game, including every Free Games round, so it can
            move by about 1% between runs. "Solve for target" changes only the reel frequencies to hit the target RTP —
            every pay and the Loss % stay exactly as you set them (can take up to a minute).
          </p>

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">Frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.</p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Reel frequency %</th>
                <th className="px-3 py-2">Hit % of spins</th>
                <th className="px-3 py-2">Pays (x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              <tr className="border-t border-slate-200 bg-rose-50/60">
                <td className="px-3 py-2 font-medium text-slate-800">Loss (no win)</td>
                <td className="px-3 py-2 text-slate-400">—</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={config.lossPercent ?? 0}
                    onChange={(e) => {
                      setSavedOk(false);
                      const v = Math.min(100, Math.max(0, Number(e.target.value)));
                      setConfig((prev) => ({ ...prev, lossPercent: v }));
                    }}
                    disabled={run !== null}
                    className={inputClass(lossBelowNatural)}
                  />
                  {stats && <div className="mt-1 text-[11px] text-slate-500">now {effectiveLoss!.toFixed(2)}% · natural {stats.naturalLossPercent.toFixed(2)}%</div>}
                </td>
                <td className="px-3 py-2 text-slate-400">—</td>
              </tr>
              {config.tiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <SymbolLabel images={TIER_IMAGES[tier.key]}>{TIER_LABELS[tier.key]}</SymbolLabel>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={tier.frequencyPercent}
                      onChange={(e) => updateTier(tier.key, { frequencyPercent: Number(e.target.value) })}
                      className={inputClass(!frequencyValid)}
                    />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{hitPercent(tier.key)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="1"
                min="0"
                      value={toX(tier.payoutMultiplier)}
                      onChange={(e) => updateTier(tier.key, { payoutMultiplier: fromX(parseWholeX(e.target.value)) })}
                      className={inputClass()}
                    />
                  </td>
                </tr>
              ))}
              {MIXED_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <SymbolLabel images={row.images}>{row.label}</SymbolLabel>
                  </td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{hitPercent(row.key === "anyBar" ? "ANY_BAR" : "ANY_SEVEN")}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={toX(getMixedPays(config)[row.key])}
                      onChange={(e) => updateMixedPay(row.key, fromX(parseWholeX(e.target.value)))}
                      className={inputClass()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">
          Loss is the share of paid spins that lose — above the natural rate, the extra losses are made by turning
          would-be wins into a losing reel stop (Free Games spins aren't affected). Hit % is the share of paid spins whose
          biggest win is that combo, so Loss + every Hit % = 100%. Reel frequency is how often each symbol shows on the
          reels (sums to 100% on its own). Symbol pays are per winning line (27 lines). The Bonus pay is for 3+ Bonus anywhere. Wilds double a line's pay for
          each Wild in it (x2 / x4 / x8). "Any 3" rows pay a line showing any mix of that family (Wilds count) when it isn't
          already 3 matching; 0 turns a row off.
        </p>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">Fixed pays (not admin settings)</div>
          <p className="mt-1 text-xs text-slate-500">
            Built into the game, not admin settings: 1 or 2 pure Wilds pay
            x{toX(PURE_WILD_PAYOUT[1])} / x{toX(PURE_WILD_PAYOUT[2])} bet; every Free Games round pays at least{" "}
            {FREE_GAMES_MIN_WIN_X[0]}–{FREE_GAMES_MIN_WIN_X[1]}x bet in total.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={!isValid || saving || loadingServer}
            className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {saving ? "Saving…" : loadingServer ? "Loading…" : "Save"}
          </button>
          <button
            onClick={resetToDefault}
            disabled={run !== null}
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Reset to default
          </button>
          {!isValid && run === null && (
            <span className="text-xs text-slate-500">Save unlocks when the measured RTP is on target.</span>
          )}
          {savedOk && (
            <div className="text-sm font-medium text-emerald-600">Saved to the server — players get it the next time the game loads.</div>
          )}
          {saveError && <div className="text-sm font-medium text-rose-600">{saveError}</div>}
        </div>
      </div>
    </div>
  );
}
