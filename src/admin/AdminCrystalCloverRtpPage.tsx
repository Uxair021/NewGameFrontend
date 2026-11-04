import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  CrystalCloverRtpConfig,
  OutcomeKey,
  SpecialTierKey,
  WinRuleId,
  DEFAULT_CRYSTAL_CLOVER_TARGET_RTP_PERCENT,
  computeCrystalCloverRtpPercent,
  getCrystalCloverDefaultConfig,
  getCrystalCloverRtpConfig,
  rescaleCrystalCloverOutcomes,
  setCrystalCloverRtpConfig,
  saveCrystalCloverRtpConfigToServer,
  syncCrystalCloverRtpConfigFromServer,
} from "../games/CrystalClover/api";

const SPECIAL_TIER_LABELS: Record<SpecialTierKey, string> = {
  specialEmpty: "Nothing (×1)",
  multiplier2x: "2X Multiplier",
  multiplier4x: "4X Multiplier",
  multiplier8x: "8X Multiplier",
};

/** Label and art for every outcome row — each win pattern is its own row with its own x value
 * (no Big/Mega/Jackpot tiers). */
const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  loss: "Loss",
  SEVEN_CLOVER: "3× 7 Crystal Clover",
  TRIPLE_BAR: "3× TRIPLE BAR",
  DOUBLE_BAR: "3× DOUBLE BAR",
  BAR: "3× BAR",
  ANY_BAR: "Any 3 Bars (mixed)",
  ONE_WILD: "1 Wild + Any + Any",
  TWO_WILD: "2 Wilds + Any",
  THREE_WILD: "3× WILD",
};

const RULE_IMAGES: Record<WinRuleId, string> = {
  SEVEN_CLOVER: "/symbols/crystalClover/7clover.webp",
  TRIPLE_BAR: "/symbols/crystalClover/trippleBar.webp",
  DOUBLE_BAR: "/symbols/crystalClover/doubleBar.webp",
  BAR: "/symbols/crystalClover/bar.webp",
  ANY_BAR: "/symbols/crystalClover/bar.webp",
  ONE_WILD: "/symbols/crystalClover/wild.webp",
  TWO_WILD: "/symbols/crystalClover/wild.webp",
  THREE_WILD: "/symbols/crystalClover/wild.webp",
};

function outcomeImages(key: OutcomeKey): string[] {
  return key === "loss" ? [] : [RULE_IMAGES[key as WinRuleId]];
}

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * 7 Crystal Clover is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control, built the same way AdminShamrockRtpPage.tsx works, plus the extra
 * structure this game's shape needs: a MULTIPLIER_2X roll table (mirrors Crazy 777's reel 4) and
 * a reel-state-chance control. Every win pattern is its own row with its own frequency and x value
 * (no Big/Mega/Jackpot tiers). Changing the target RTP re-scales the pattern frequencies in a
 * single pass — RTP here is linear in the outcome rows' own frequencies (the multiplier EV depends
 * only on the special table, untouched by this), same as 5x Rewind, unlike Crazy 777. The saved
 * config *is* the live odds `spinRequest` reads from (see games/CrystalClover/api.ts) — a change
 * here takes effect on the very next spin.
 */
export function AdminCrystalCloverRtpPage() {
  const [config, setConfig] = useState<CrystalCloverRtpConfig>(() => getCrystalCloverRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncCrystalCloverRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getCrystalCloverRtpConfig();
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

  const computedRtp = computeCrystalCloverRtpPercent(config);
  const frequencySum = config.outcomes.reduce((sum, o) => sum + o.frequencyPercent, 0);
  const specialFrequencySum = config.specialReelTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const specialFrequencyValid = Math.abs(specialFrequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && specialFrequencyValid && rtpValid;

  function updateOutcome(key: OutcomeKey, patch: Partial<CrystalCloverRtpConfig["outcomes"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      outcomes: prev.outcomes.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    }));
  }

  function updateSpecialTier(key: SpecialTierKey, patch: Partial<CrystalCloverRtpConfig["specialReelTiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      specialReelTiers: prev.specialReelTiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function updateReelState(centerRowChancePercent: number) {
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, reelStateConfig: { centerRowChancePercent } }));
  }

  // Same mechanism as Buffalo's/Shamrock's page — a single rescale pass lands exactly on target,
  // since RTP here is linear in the outcome rows' own frequencies.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeCrystalCloverRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const outcomes = rescaleCrystalCloverOutcomes(config.outcomes, newTarget / oldRtp);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, outcomes }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveCrystalCloverRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setCrystalCloverRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getCrystalCloverDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="7 Crystal Clover RTP"
        gameSlugs={["crystal-clover"]}
        description="Saved to the server — every player\'s 7 Crystal Clover loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
              Effective RTP (lower bound): {computedRtp.toFixed(2)}%
              {rtpValid ? " ✓" : ""}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            All 9 paylines are evaluated for real every spin, so a spin can incidentally rack up extra wins beyond
            the one it was built for — this preview is a closed-form lower bound, the true realized RTP can run a
            bit above it.
          </p>

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Outcome frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
          {!specialFrequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Multiplier roll frequencies must sum to 100% — currently {specialFrequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && specialFrequencyValid && !rtpValid && (
            <p className="mt-3 text-sm text-rose-600">
              Computed RTP ({computedRtp.toFixed(2)}%) doesn't match the target ({config.targetRtpPercent.toFixed(2)}%,
              ±0.5%). Adjust frequencies or payout multipliers below, or change the target to match.
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">Payout (x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.outcomes.map((row) => (
                <tr key={row.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={outcomeImages(row.key)}>{OUTCOME_LABELS[row.key]}</SymbolLabel></td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">MULTIPLIER_2X roll</div>
          <p className="mt-1 text-xs text-slate-500">
            Fully independent from the table above — rolled every spin regardless of win/loss, applied as a flat
            multiplier on top of whatever the table above pays. Frequencies here must separately sum to 100%.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-indigo-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Frequency %</th>
                  <th className="px-3 py-2">Multiplier</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {config.specialReelTiers.map((tier) => (
                  <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={tier.key === "specialEmpty" ? [] : ["/symbols/crystalClover/2X.webp"]}>{SPECIAL_TIER_LABELS[tier.key]}</SymbolLabel></td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={tier.frequencyPercent}
                        onChange={(e) => updateSpecialTier(tier.key, { frequencyPercent: Number(e.target.value) })}
                        className={inputClass(!specialFrequencyValid)}
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
                          value={tier.payoutMultiplier}
                          onChange={(e) => updateSpecialTier(tier.key, { payoutMultiplier: parseWholeX(e.target.value) })}
                          className={inputClass()}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">Reel state chance</div>
          <p className="mt-1 text-xs text-slate-500">
            Each reel always shows either 1 symbol on the center payline or 2 symbols on the top+bottom paylines —
            never all 3. This is the chance it picks the center-only state (only applies to reels the designated
            winning line doesn't already force).
          </p>
          <div className="mt-3">
            <label className="block text-xs text-slate-500">Center-row chance (%)</label>
            <input
              type="number"
              step="1"
              min={0}
              max={100}
              value={config.reelStateConfig.centerRowChancePercent}
              onChange={(e) => updateReelState(Number(e.target.value))}
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
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Reset to default ({DEFAULT_CRYSTAL_CLOVER_TARGET_RTP_PERCENT}%)
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
