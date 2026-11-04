import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  OutcomeKey,
  ShamrockOutcomeRow,
  ShamrockRtpConfig,
  DEFAULT_SHAMROCK_TARGET_RTP_PERCENT,
  computeShamrockRtpPercent,
  fitShamrockOutcomesToTarget,
  getFreeSpinMinWin,
  getShamrockDefaultConfig,
  getShamrockRtpConfig,
  setShamrockRtpConfig,
  saveShamrockRtpConfigToServer,
  syncShamrockRtpConfigFromServer,
} from "../games/ShamrockSpin/api";

const ASSET_BASE = "/symbols/shamrockSpin";
const SHAMROCK = `${ASSET_BASE}/Shamrock Spin.webp`;
const GREEN = `${ASSET_BASE}/Green 7.webp`;
const ORANGE = `${ASSET_BASE}/Orange 7.webp`;
const YELLOW = `${ASSET_BASE}/Yellow 7.webp`;
const TRIPLE = `${ASSET_BASE}/BAR BAR BAR.webp`;
const DOUBLE = `${ASSET_BASE}/BAR BAR.webp`;
const SINGLE = `${ASSET_BASE}/BAR.webp`;

/** Label + symbol art for every outcome row. Each winning line combo is its own row with its own
 * x values — there are no Big/Mega/Jackpot tiers in this game. */
const OUTCOME_LABELS: Record<OutcomeKey, { label: string; images: string[] }> = {
  loss: { label: "Loss", images: [] },
  freeSpin: { label: "Free Spin (bonus round trigger)", images: [`${ASSET_BASE}/Shamrock Spin 3.webp`] },
  WILD_JACKPOT: { label: "3× Shamrock Spin (wild)", images: [SHAMROCK] },
  GREEN_SEVEN: { label: "3× Green 7", images: [GREEN] },
  ORANGE_SEVEN: { label: "3× Orange 7", images: [ORANGE] },
  YELLOW_SEVEN: { label: "3× Yellow 7", images: [YELLOW] },
  TRIPLE_BAR: { label: "3× BAR BAR BAR", images: [TRIPLE] },
  DOUBLE_BAR: { label: "3× BAR BAR", images: [DOUBLE] },
  SINGLE_BAR: { label: "3× BAR", images: [SINGLE] },
  ANY_SEVENS: { label: "Any 3 Sevens (mixed)", images: [GREEN, ORANGE, YELLOW] },
  ANY_BARS: { label: "Any 3 BARs (mixed)", images: [TRIPLE, DOUBLE, SINGLE] },
  TWO_WILDS: { label: "2 Wilds + Any", images: [SHAMROCK] },
  ONE_WILD: { label: "1 Wild + Any + Any", images: [SHAMROCK] },
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Shamrock Spin is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control. Every winning line combo (3× Green 7, 3× BAR BAR, …) is its own row with
 * its own frequency and its own base / free-spin x values; a spin pays exactly the x value of the
 * combo the payline shows. There is no Big/Mega/Jackpot grouping and no celebration overlay. The
 * saved config *is* the live odds `spinRequest` reads from (see games/ShamrockSpin/api.ts) — a
 * change here takes effect on the very next spin.
 */
export function AdminShamrockRtpPage() {
  const [config, setConfig] = useState<ShamrockRtpConfig>(() => getShamrockRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncShamrockRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getShamrockRtpConfig();
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      if (changed) setConfig(next);
      setLoadingServer(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [savedOk, setSavedOk] = useState(false);

  const computedRtp = computeShamrockRtpPercent(config);
  const frequencySum = config.outcomes.reduce((sum, o) => sum + o.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && rtpValid;

  function updateOutcome(key: OutcomeKey, patch: Partial<ShamrockOutcomeRow>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      outcomes: prev.outcomes.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    }));
  }

  // Rescales every winning row's frequency so the config is instantly valid again at the new
  // target; x values, the free-spin trigger frequency, and freeSpinsGranted are untouched.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeShamrockRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0 || !Number.isFinite(newTarget) || newTarget <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const outcomes = fitShamrockOutcomesToTarget(
      config.outcomes,
      config.freeSpinsGranted,
      getFreeSpinMinWin(config),
      newTarget
    );
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, outcomes }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveShamrockRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setShamrockRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getShamrockDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Shamrock Spin RTP"
        gameSlugs={["shamrock-spin"]}
        description="Saved to the server — every player\'s Shamrock Spin loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
              onChange={(e) => setTargetRtp(Math.min(MAX_TARGET_RTP_PERCENT, Number(e.target.value)))}
              className={inputClass(!rtpValid)}
            />
            <div className={`text-sm font-medium ${rtpValid ? "text-emerald-600" : "text-rose-600"}`}>
              Effective RTP: {computedRtp.toFixed(2)}%
              {rtpValid ? " ✓" : ""}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Changing the target rescales every symbol's frequency proportionally (Loss absorbs the rest). Effective RTP
            includes free spins awarded by the Free Spin trigger and by Shamrock wilds on winning lines.
          </p>

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && !rtpValid && (
            <p className="mt-3 text-sm text-rose-600">
              Computed RTP ({computedRtp.toFixed(2)}%) doesn't match the target ({config.targetRtpPercent.toFixed(2)}%,
              ±0.5%). Adjust frequencies or x values below, or change the target to match.
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">Base payout (x bet)</th>
                <th className="px-3 py-2">Free-spin payout (x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.outcomes.map((row) => (
                <tr key={row.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <SymbolLabel images={OUTCOME_LABELS[row.key].images}>{OUTCOME_LABELS[row.key].label}</SymbolLabel>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.0001"
                      value={row.frequencyPercent}
                      onChange={(e) => updateOutcome(row.key, { frequencyPercent: Number(e.target.value) })}
                      className={inputClass(!frequencyValid)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row.payoutMultiplier === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <input
                        type="number"
                        step="1"
                min="0"
                        value={row.payoutMultiplier}
                        onChange={(e) => updateOutcome(row.key, { payoutMultiplier: parseWholeX(e.target.value) })}
                        className={inputClass()}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.freeSpinPayoutMultiplier === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <input
                        type="number"
                        step="1"
                min="0"
                        value={row.freeSpinPayoutMultiplier}
                        onChange={(e) => updateOutcome(row.key, { freeSpinPayoutMultiplier: parseWholeX(e.target.value) })}
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
          <label className="text-sm font-semibold text-slate-800">Free spins granted</label>
          <p className="mt-1 text-xs text-slate-500">
            Bonus spins awarded when the "Free Spin" outcome hits. Each bonus spin independently rolls its own outcome
            using the frequencies above (with the free-spin payout column); the Free Spin trigger can retrigger at half
            its normal frequency.
          </p>
          <input
            type="number"
            step="1"
            value={config.freeSpinsGranted}
            onChange={(e) => {
              setSavedOk(false);
              setConfig((prev) => ({ ...prev, freeSpinsGranted: Number(e.target.value) }));
            }}
            className={`${inputClass()} mt-2`}
          />
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
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Reset to default ({DEFAULT_SHAMROCK_TARGET_RTP_PERCENT}%)
          </button>
          {savedOk && (
            <div className="text-sm font-medium text-emerald-600">Saved to the server — players get it the next time the game loads.</div>
          )}
          {saveError && <div className="text-sm font-medium text-rose-600">{saveError}</div>}
        </div>
      </div>
    </div>
  );
}
