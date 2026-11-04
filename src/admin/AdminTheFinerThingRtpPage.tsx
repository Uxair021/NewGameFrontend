import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useRef, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import {
  TheFinerThingRtpConfig,
  TheFinerThingStats,
  TheFinerThingSymbol,
  DEFAULT_TFT_TARGET_RTP_PERCENT,
  computeTheFinerThingStats,
  getTheFinerThingDefaultConfig,
  getTheFinerThingRtpConfig,
  setTheFinerThingRtpConfig,
  solveTheFinerThingWeights,
  saveTheFinerThingRtpConfigToServer,
  syncTheFinerThingRtpConfigFromServer,
} from "../games/TheFinerThing/api";

type RegularSymbol = Exclude<TheFinerThingSymbol, "COIN" | "WILD">;

const TIER_LABELS: Record<TheFinerThingSymbol, string> = {
  AEROPLANE: "Aeroplane",
  BOAT: "Boat",
  CAR: "Car",
  RING: "Ring",
  MONEY: "Money",
  WATCH: "Watch",
  GOLD_BAR: "Gold Bar",
  SILVER_BAR: "Silver Bar",
  BRONZE_BAR: "Bronze Bar",
  WILD: "WILD (substitutes on reels 2-4 only, no payout of its own)",
  COIN: "Coin (independent scatter chance, below)",
};

/** Same reel-symbol art the game itself uses. */
const TIER_IMAGES: Record<TheFinerThingSymbol, string> = {
  AEROPLANE: "/symbols/theFinerThing/aeroplane.webp",
  BOAT: "/symbols/theFinerThing/boat.webp",
  CAR: "/symbols/theFinerThing/car.webp",
  RING: "/symbols/theFinerThing/ring.webp",
  MONEY: "/symbols/theFinerThing/money.webp",
  WATCH: "/symbols/theFinerThing/watch.webp",
  GOLD_BAR: "/symbols/theFinerThing/goldBar.webp",
  SILVER_BAR: "/symbols/theFinerThing/silverBar.webp",
  BRONZE_BAR: "/symbols/theFinerThing/bronzeBar.webp",
  WILD: "/symbols/theFinerThing/daimond.webp",
  COIN: "/symbols/theFinerThing/coin.webp",
};

const REGULAR_SYMBOLS: RegularSymbol[] = [
  "AEROPLANE",
  "BOAT",
  "CAR",
  "RING",
  "MONEY",
  "WATCH",
  "GOLD_BAR",
  "SILVER_BAR",
  "BRONZE_BAR",
];

/** RTP is a simulation estimate (the wild bonus makes wins heavy-tailed), so it's allowed a wider
 * band than the exact-math pages' ±0.5%. */
const RTP_TOLERANCE = 1.0;

type Run = { kind: "solve" | "measure"; fraction: number };

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Final Thing is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control (this game is a replica of Life of Luxury under a new name/id), splitting
 * reel-strip weight (`tiers`) and payout (`symbolPayouts`) into two tables, plus scatter rules (no
 * Big/Mega/Jackpot celebration tiers). The saved config *is* the live odds `spinRequest` reads (see
 * games/TheFinerThing/api.ts), so a change takes effect on the very next spin.
 *
 * RTP is measured by a 2M-round simulation of the real game (base spin + the full free-spins
 * round and its round-end wild bonus), on demand rather than on every edit. "Solve for target"
 * scales every pay together — RTP is exactly proportional to the pays, so it lands on target.
 */
export function AdminTheFinerThingRtpPage() {
  const [config, setConfig] = useState<TheFinerThingRtpConfig>(() => getTheFinerThingRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncTheFinerThingRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getTheFinerThingRtpConfig();
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
  const [savedOk, setSavedOk] = useState(false);
  const [stats, setStats] = useState<TheFinerThingStats | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  /** Bumped to abandon a running simulation (on unmount, on edit, or when a new one starts). */
  const runId = useRef(0);

  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = stats !== null && Math.abs(stats.rtpPercent - config.targetRtpPercent) <= RTP_TOLERANCE;
  const isValid = frequencyValid && rtpValid && run === null;

  async function measure(target: TheFinerThingRtpConfig) {
    const id = ++runId.current;
    setRun({ kind: "measure", fraction: 0 });
    const result = await computeTheFinerThingStats(target, {
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
    const result = await solveTheFinerThingWeights(config, config.targetRtpPercent, (fraction) => {
      if (runId.current === id) setRun({ kind: "solve", fraction });
    });
    if (runId.current !== id) return;
    setConfig(result.config);
    setStats(result.stats);
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
  function invalidate() {
    runId.current++;
    setRun(null);
    setStats(null);
  }

  function updateTier(key: TheFinerThingSymbol, frequencyPercent: number) {
    setSavedOk(false);
    invalidate();
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, frequencyPercent } : t)),
    }));
  }

  function updateSymbolPayout(symbol: RegularSymbol, patch: Partial<{ x3: number; x4: number; x5: number }>) {
    setSavedOk(false);
    invalidate();
    setConfig((prev) => ({
      ...prev,
      symbolPayouts: { ...prev.symbolPayouts, [symbol]: { ...prev.symbolPayouts[symbol], ...patch } },
    }));
  }

  function updateScatterRules(patch: Partial<TheFinerThingRtpConfig["scatterRules"]>) {
    setSavedOk(false);
    invalidate();
    setConfig((prev) => ({ ...prev, scatterRules: { ...prev.scatterRules, ...patch } }));
  }

  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveTheFinerThingRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setTheFinerThingRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    invalidate();
    setConfig(getTheFinerThingDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Final Thing RTP"
        gameSlugs={["the-finer-thing"]}
        description="Saved to the server — every player\'s Final Thing loads this config each time the game opens. Spins still resolve in the player\'s browser."
      />

      <div className="max-w-3xl space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-800">Target RTP %</label>
            <input
              type="number"
              step="0.01"
              max={MAX_TARGET_RTP_PERCENT}
              value={config.targetRtpPercent}
              onChange={(e) => setTargetRtp(Math.min(MAX_TARGET_RTP_PERCENT, Number(e.target.value)))}
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
                Effective RTP: {stats.rtpPercent.toFixed(2)}%{rtpValid ? " ✓" : ""}
              </div>
              <div className="text-slate-600">Loss rate (info): {stats.lossPercent.toFixed(2)}% of spins pay nothing</div>
            </div>
          )}
          {!run && !stats && (
            <p className="mt-3 text-sm text-amber-600">Changed since last measured — click "Solve for target" or "Measure current".</p>
          )}
          {!run && stats && !rtpValid && (
            <p className="mt-2 text-sm text-rose-600">
              RTP is more than ±{RTP_TOLERANCE}% away from the target — click "Solve for target".
            </p>
          )}

          <p className="mt-3 text-xs text-slate-500">
            RTP is measured by simulating 2,000,000 spins of the real game, including every free-spins round and its
            end-of-round wild bonus, so it can move by about 1% between runs. "Solve for target" scales every symbol pay
            and Coin pay up or down together, keeping their proportions; frequencies, Coin chance and free spins stay as
            you set them.
          </p>

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Frequency % (reel-strip weight)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.tiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      <img src={TIER_IMAGES[tier.key]} alt="" className="h-8 w-8 rounded object-contain bg-slate-100" />
                      {TIER_LABELS[tier.key]}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={tier.frequencyPercent}
                      onChange={(e) => updateTier(tier.key, Number(e.target.value))}
                      className={inputClass(!frequencyValid)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">Symbol payouts (x total bet, per winning line)</div>
          <p className="mt-1 text-xs text-slate-500">
            Each symbol's own 3/4/5-of-a-kind payout — matched left-to-right on any of the 15 lines, minimum 3, and each
            winning line pays this many times the player's whole bet. These
            don't correspond to the Frequency % rows above (those are reel-strip draw weight); this is the actual
            paytable.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="py-1 pr-3">Symbol</th>
                  <th className="py-1 pr-3">X3</th>
                  <th className="py-1 pr-3">X4</th>
                  <th className="py-1 pr-3">X5</th>
                </tr>
              </thead>
              <tbody>
                {REGULAR_SYMBOLS.map((symbol) => (
                  <tr key={symbol} className="border-t border-slate-200">
                    <td className="py-2 pr-3 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <img src={TIER_IMAGES[symbol]} alt="" className="h-8 w-8 rounded object-contain bg-slate-100" />
                        {TIER_LABELS[symbol]}
                      </div>
                    </td>
                    {(["x3", "x4", "x5"] as const).map((field) => (
                      <td key={field} className="py-2 pr-3">
                        <input
                          type="number"
                          step="1"
                min="0"
                          value={config.symbolPayouts[symbol][field]}
                          onChange={(e) => updateSymbolPayout(symbol, { [field]: parseWholeX(e.target.value) })}
                          className={`${inputClass()} w-24`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">Coin scatter rules</div>
          <p className="mt-1 text-xs text-slate-500">
            Coin is rolled independently on every cell at its own Chance % below — it is NOT one of the Frequency %
            rows above. Coin counts anywhere on the 5x3 grid (no payline needed). X3/X4/X5 are multiples of the bet
            (this game has no per-line split). X5 also covers 5 or more. A 3+ trigger on a base spin awards the
            free spins below; a coin during an already-active free-spins round still pays its cash prize but never
            awards more free spins (no retriggering).
          </p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <label className="block text-xs text-slate-500">Chance % (per cell)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={config.scatterRules.chancePercent}
                onChange={(e) => updateScatterRules({ chancePercent: Number(e.target.value) })}
                className={`${inputClass()} mt-1 w-28`}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">X3 (bet)</label>
              <input
                type="number"
                step="1"
                min="0"
                value={config.scatterRules.x3}
                onChange={(e) => updateScatterRules({ x3: parseWholeX(e.target.value) })}
                className={`${inputClass()} mt-1 w-28`}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">X4 (bet)</label>
              <input
                type="number"
                step="1"
                min="0"
                value={config.scatterRules.x4}
                onChange={(e) => updateScatterRules({ x4: parseWholeX(e.target.value) })}
                className={`${inputClass()} mt-1 w-28`}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">X5+ (bet)</label>
              <input
                type="number"
                step="1"
                min="0"
                value={config.scatterRules.x5}
                onChange={(e) => updateScatterRules({ x5: parseWholeX(e.target.value) })}
                className={`${inputClass()} mt-1 w-28`}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Free spins awarded</label>
              <input
                type="number"
                step="1"
                min={0}
                value={config.scatterRules.freeSpinsAwarded}
                onChange={(e) => updateScatterRules({ freeSpinsAwarded: Number(e.target.value) })}
                className={`${inputClass()} mt-1 w-28`}
              />
            </div>
          </div>
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
            Reset to default ({DEFAULT_TFT_TARGET_RTP_PERCENT}%)
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
