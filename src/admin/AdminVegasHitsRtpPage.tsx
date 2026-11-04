import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useRef, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  VegasHitsRtpConfig,
  VegasHitsStats,
  TierKey,
  WildRules,
  DEFAULT_VEGASHITS_TARGET_RTP_PERCENT,
  computeVegasHitsStats,
  getVegasHitsDefaultConfig,
  getVegasHitsRtpConfig,
  setVegasHitsRtpConfig,
  solveVegasHitsWeights,
  saveVegasHitsRtpConfigToServer,
  syncVegasHitsRtpConfigFromServer,
} from "../games/VegasHits/api";

const TIER_LABELS: Record<TierKey, string> = {
  GREEN_7: "1 Green 7",
  DOUBLE_GREEN_7: "2 Green 7s",
  TRIPLE_GREEN_7: "3 Green 7s",
  RED_7: "Red 7",
  BLUE_7: "Blue 7",
  WILD: "Wild (RED HOT 3X) — pays by the rules below",
  BONUS: "Bonus — 3 anywhere start free games",
};

const TIER_IMAGES: Record<TierKey, string[]> = {
  GREEN_7: ["/symbols/vegasHit/Green7.webp"],
  DOUBLE_GREEN_7: ["/symbols/vegasHit/DoubleGreen7.webp"],
  TRIPLE_GREEN_7: ["/symbols/vegasHit/TripleGreen7.webp"],
  RED_7: ["/symbols/vegasHit/Red7.webp"],
  BLUE_7: ["/symbols/vegasHit/Blue7.webp"],
  WILD: ["/symbols/vegasHit/redHot.webp"],
  BONUS: ["/symbols/vegasHit/Bonus.webp"],
};

/** Every pay is stored relative to the game's internal LINE_COST (see games/VegasHits/api.ts),
 * i.e. 30x the real "x bet" value. This page shows and edits them as x bet. */
const LINE_COST = 30;
const toX = (stored: number) => +(stored / LINE_COST).toFixed(4);
const fromX = (x: number) => x * LINE_COST;

/** RTP is a simulation estimate (wins are heavy-tailed), so it's allowed a wider band than the
 * exact-math pages' ±0.5%. */
const RTP_TOLERANCE = 1.0;

const WILD_BET_FIELDS: { key: keyof WildRules; label: string }[] = [
  { key: "onePureBet", label: "1 Wild anywhere on screen" },
  { key: "twoPureBet", label: "2 Wilds anywhere on screen" },
  { key: "threePureBet", label: "3 Wilds anywhere on screen" },
  { key: "anyMixBet", label: "Any 7s mixed on a line (no Wild)" },
];
const WILD_RATIO_FIELDS: { key: keyof WildRules; label: string }[] = [
  { key: "oneCompleteMultiplier", label: "1 Wild completes a line (x the symbol's pay)" },
  { key: "twoCompleteMultiplier", label: "2 Wilds complete a line (x the symbol's pay)" },
];

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

type Run = { kind: "solve" | "measure"; fraction: number };

/**
 * Vegas Hits is a fully offline, client-side game (no backend) — this page is its own separate
 * RTP control, and the saved config *is* the live odds `spinRequest` reads (see
 * games/VegasHits/api.ts), so a change takes effect on the very next spin.
 *
 * RTP can't be computed exactly here (5 overlapping paylines × wild × scatter × a retriggering
 * free-games chain), so it's measured by a 2M-round simulation, on demand rather than on every
 * edit. "Solve for target" scales every payout together (symbol pays and the Wild's flat pays) —
 * RTP is linear in the pays, so that lands on the target precisely, unlike reshaping the symbol
 * weights. Loss rate is shown for information only.
 */
export function AdminVegasHitsRtpPage() {
  const [config, setConfig] = useState<VegasHitsRtpConfig>(() => getVegasHitsRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncVegasHitsRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getVegasHitsRtpConfig();
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
  const [stats, setStats] = useState<VegasHitsStats | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  /** Bumped to abandon a running simulation (on unmount or when a new one starts). */
  const runId = useRef(0);

  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = stats !== null && Math.abs(stats.rtpPercent - config.targetRtpPercent) <= RTP_TOLERANCE;
  const isValid = frequencyValid && rtpValid && run === null;

  async function measure(target: VegasHitsRtpConfig) {
    const id = ++runId.current;
    setRun({ kind: "measure", fraction: 0 });
    const result = await computeVegasHitsStats(target, {
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
    const result = await solveVegasHitsWeights(config, config.targetRtpPercent, (fraction) => {
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

  /** Any change to the odds invalidates the last measurement. */
  function edit(patch: (prev: VegasHitsRtpConfig) => VegasHitsRtpConfig) {
    runId.current++;
    setRun(null);
    setSavedOk(false);
    setStats(null);
    setConfig(patch);
  }

  function updateTier(key: TierKey, patch: Partial<VegasHitsRtpConfig["tiers"][number]>) {
    edit((prev) => ({ ...prev, tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)) }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveVegasHitsRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setVegasHitsRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    edit(() => getVegasHitsDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Vegas Hits RTP"
        gameSlugs={["vegas-hits"]}
        description="Saved to the server — every player\'s Vegas Hits loads this config each time the game opens. Spins still resolve in the player\'s browser."
      />

      <div className="max-w-4xl space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-800">Target RTP %</label>
            <input
              type="number"
              step="0.01"
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
            RTP is estimated from a 2,000,000-spin simulation (it can't be computed exactly here), so it can move by
            about 1% between runs. "Solve for target" scales every payout below up or down together — the symbol pays
            and the Wild's flat pays — keeping their proportions; symbol frequencies stay as you set them.
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
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">3 on a line pays (x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
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
                  <td className="px-3 py-2">
                    {tier.payoutMultiplier === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <input
                        type="number"
                        step="1"
                min="0"
                        value={toX(tier.payoutMultiplier)}
                        onChange={(e) => updateTier(tier.key, { payoutMultiplier: fromX(parseWholeX(e.target.value)) })}
                        className={inputClass()}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <SymbolLabel images={TIER_IMAGES.WILD}>
            <span className="text-sm font-semibold text-slate-800">RED HOT 3X Wild rules</span>
          </SymbolLabel>
          <p className="mt-2 text-xs text-slate-500">
            Flat pays are x bet and are scaled by "Solve for target" along with the symbol pays. The two "completes a line"
            values are boosts on the symbol's own pay and are left as you set them.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {WILD_BET_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs text-slate-500">{label} (x bet)</label>
                <input
                  type="number"
                  step="1"
                min="0"
                  value={toX(config.wildRules[key])}
                  onChange={(e) => edit((prev) => ({ ...prev, wildRules: { ...prev.wildRules, [key]: fromX(parseWholeX(e.target.value)) } }))}
                  className={`${inputClass()} mt-1 w-32`}
                />
              </div>
            ))}
            {WILD_RATIO_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs text-slate-500">{label}</label>
                <input
                  type="number"
                  step="1"
                min="0"
                  value={config.wildRules[key]}
                  onChange={(e) => edit((prev) => ({ ...prev, wildRules: { ...prev.wildRules, [key]: Math.max(1, Math.round(Number(e.target.value))) } }))}
                  className={`${inputClass()} mt-1 w-32`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">Reel state chance</div>
          <p className="mt-1 text-xs text-slate-500">
            Each reel always shows either 1 symbol on the center payline or 2 symbols on the top+bottom paylines — never
            all 3. This is the chance it picks the center-only state.
          </p>
          <div className="mt-3">
            <label className="block text-xs text-slate-500">Center-row chance (%)</label>
            <input
              type="number"
              step="1"
              min={0}
              max={100}
              value={config.reelStateConfig.centerRowChancePercent}
              onChange={(e) => edit((prev) => ({ ...prev, reelStateConfig: { centerRowChancePercent: Number(e.target.value) } }))}
              className={`${inputClass()} mt-1 w-32`}
            />
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
            Reset to default ({DEFAULT_VEGASHITS_TARGET_RTP_PERCENT}%)
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
