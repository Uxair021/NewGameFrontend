import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  GemsDeluxeRtpConfig,
  TierKey,
  BonusPoolKey,
  DEFAULT_GEMS_TARGET_RTP_PERCENT,
  computeGemsDeluxeRtpPercent,
  getGemsDeluxeDefaultConfig,
  getGemsDeluxeRtpConfig,
  rescaleGemsDeluxeTiers,
  setGemsDeluxeRtpConfig,
  saveGemsDeluxeRtpConfigToServer,
  syncGemsDeluxeRtpConfigFromServer,
} from "../games/GemsDeluxe/api";

const TIER_LABELS: Record<TierKey, string> = {
  loss: "Loss",
  seven: "3× Seven",
  tripleBar: "3× Triple Bar",
  doubleBar: "3× Double Bar",
  singleBar: "3× Single Bar",
  anyBar: "Any 3 Bars (mixed)",
  diamondOne: "1× Diamond (anywhere)",
  diamondTwo: "2× Diamond (anywhere)",
  diamondThree: "3× Diamond (anywhere)",
  dollarBonus: "$ Bonus Trigger",
};

const BONUS_POOL_LABELS: Record<BonusPoolKey, string> = {
  dollarPoolFive: "Bonus pool: $5",
  dollarPoolTen: "Bonus pool: $10",
  dollarPoolTwenty: "Bonus pool: $20",
  dollarPoolFifty: "Bonus pool: $50",
  dollarPoolHundred: "Bonus pool: $100",
  dollarPoolThousand: "Bonus pool: $1000",
};

/** Reel symbol art (as in games/GemsDeluxe) for each outcome. */
const GD = (f: string) => `/symbols/gemsDeluxe/${f}`;
const TIER_IMAGES: Record<TierKey, string[]> = {
  loss: [],
  seven: [GD("7.webp")],
  tripleBar: [GD("TripleBar.webp")],
  doubleBar: [GD("doubleBar.webp")],
  singleBar: [GD("singleBar.webp")],
  anyBar: [GD("singleBar.webp"), GD("doubleBar.webp"), GD("TripleBar.webp")],
  diamondOne: [GD("daimond.webp")],
  diamondTwo: [GD("daimond.webp"), GD("daimond.webp")],
  diamondThree: [GD("daimond.webp"), GD("daimond.webp"), GD("daimond.webp")],
  dollarBonus: [GD("dollar.webp")],
};
const BONUS_POOL_IMAGE = [GD("dollar.webp")];

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Gems Deluxe is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control. Unlike most other dedicated pages, "dollarBonus" (the bonus-round
 * trigger) has no payoutMultiplier of its own and is never touched by the frequency rescale, so a
 * single rescale pass only lands close to a new target RTP, not exactly on it — the same
 * iterative-refinement technique Crazy 777's page uses applies here too. No celebration map or
 * rule-tier map exists for this game (every win tier is a flat credited amount, no overlay). The
 * saved config *is* the live odds `spinRequest` reads from (see games/GemsDeluxe/api.ts) — a
 * change here takes effect on the very next spin.
 */
export function AdminGemsDeluxeRtpPage() {
  const [config, setConfig] = useState<GemsDeluxeRtpConfig>(() => getGemsDeluxeRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncGemsDeluxeRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getGemsDeluxeRtpConfig();
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

  const computedRtp = computeGemsDeluxeRtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const poolFrequencySum = config.bonusPool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const poolFrequencyValid = Math.abs(poolFrequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && poolFrequencyValid && rtpValid;

  function updateTier(key: TierKey, patch: Partial<GemsDeluxeRtpConfig["tiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function updateBonusPool(key: BonusPoolKey, patch: Partial<GemsDeluxeRtpConfig["bonusPool"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      bonusPool: prev.bonusPool.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  // Same mechanism as AdminCrazy777RtpPage.tsx's setTargetRtp: rescale, then re-check and
  // rescale again a few times, since "dollarBonus" never scales so a single pass only lands
  // close.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeGemsDeluxeRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }

    let tiers = rescaleGemsDeluxeTiers(config.tiers, newTarget / oldRtp);
    for (let i = 0; i < 6; i++) {
      const current = computeGemsDeluxeRtpPercent({ ...config, tiers });
      if (!Number.isFinite(current) || current <= 0 || Math.abs(current - newTarget) < 0.005) break;
      tiers = rescaleGemsDeluxeTiers(tiers, newTarget / current);
    }

    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, tiers }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveGemsDeluxeRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setGemsDeluxeRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getGemsDeluxeDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Gems Deluxe RTP"
        gameSlugs={["gems-deluxe"]}
        description="Saved to the server — every player\'s Gems Deluxe loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
              Effective RTP (at min bet): {computedRtp.toFixed(2)}%
              {rtpValid ? " ✓" : ""}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The bonus pool pays flat dollar amounts, not bet multiples, so this game's realized RTP genuinely
            varies by bet size — this preview reports it at the lowest bet level.
          </p>

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Line tier frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
          {!poolFrequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Bonus pool frequencies must sum to 100% — currently {poolFrequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && poolFrequencyValid && !rtpValid && (
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
              {config.tiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={TIER_IMAGES[tier.key]}>{TIER_LABELS[tier.key]}</SymbolLabel></td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.0001"
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
                        value={tier.payoutMultiplier}
                        onChange={(e) => updateTier(tier.key, { payoutMultiplier: parseWholeX(e.target.value) })}
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
          <div className="text-sm font-semibold text-slate-800">Bonus pool (pick-a-gem round)</div>
          <p className="mt-1 text-xs text-slate-500">
            Each of the 4 sequential offers sums 1-3 independent weighted draws from this pool (not admin-tunable —
            40%/40%/20% for 1/2/3 draws). Values are flat dollar amounts, never scaled by bet. Frequencies here must
            separately sum to 100%.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-indigo-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2">Pool value</th>
                  <th className="px-3 py-2">Frequency %</th>
                  <th className="px-3 py-2">Dollar amount</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {config.bonusPool.map((tier) => (
                  <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={BONUS_POOL_IMAGE}>{BONUS_POOL_LABELS[tier.key]}</SymbolLabel></td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={tier.frequencyPercent}
                        onChange={(e) => updateBonusPool(tier.key, { frequencyPercent: Number(e.target.value) })}
                        className={inputClass(!poolFrequencyValid)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="1"
                min="0"
                        value={tier.payoutMultiplier}
                        onChange={(e) => updateBonusPool(tier.key, { payoutMultiplier: parseWholeX(e.target.value) })}
                        className={inputClass()}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            Reset to default ({DEFAULT_GEMS_TARGET_RTP_PERCENT}%)
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
