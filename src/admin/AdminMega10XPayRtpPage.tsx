import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  Mega10xPayRtpConfig,
  TierKey,
  DEFAULT_MEGA10X_TARGET_RTP_PERCENT,
  computeMega10xRtpPercent,
  getMega10xDefaultConfig,
  getMega10xRtpConfig,
  rescaleMega10xTiers,
  setMega10xRtpConfig,
  saveMega10xRtpConfigToServer,
  syncMega10xRtpConfigFromServer,
} from "../games/Mega10XPay/api";

const TIER_LABELS: Record<TierKey, string> = {
  loss: "Loss",
  oneCherry: "1x Cherry (on the line)",
  twoCherry: "2x Cherry (on the line)",
  cherry: "3x Cherry",
  singleBar: "3x Single Bar",
  doubleBar: "3x Double Bar",
  tripleBar: "3x Triple Bar",
  sevenBar: "3x 7-BAR",
  seven: "3x Seven",
  any3BarFamilyMix: "Any 3 (Bar family mixed)",
  any3SingleBarSevenBar: "Any 3 (Single Bar / 7-BAR mixed)",
  any3SevenSevenBar: "Any 3 (7 / 7-BAR mixed)",
  threeX: "3x 3X PAY",
  tenX: "3x 10X PAY",
  anyWild: "10X / 3X on the line (pay × its multiplier)",
};

/** Reel symbol art (as in games/Mega10XPay/pixi/symbols.ts) for each outcome. */
const MX = (f: string) => `/symbols/mega10x/${f}`;
const TIER_IMAGES: Record<TierKey, string[]> = {
  loss: [],
  oneCherry: [MX("cherry.webp")],
  twoCherry: [MX("cherry.webp"), MX("cherry.webp")],
  cherry: [MX("cherry.webp"), MX("cherry.webp"), MX("cherry.webp")],
  singleBar: [MX("singleBar.webp")],
  doubleBar: [MX("doubleBar.webp")],
  tripleBar: [MX("TripleBar.webp")],
  sevenBar: [MX("7Bar.webp")],
  seven: [MX("7.webp")],
  any3BarFamilyMix: [MX("singleBar.webp"), MX("doubleBar.webp"), MX("TripleBar.webp")],
  any3SingleBarSevenBar: [MX("singleBar.webp"), MX("7Bar.webp")],
  any3SevenSevenBar: [MX("7.webp"), MX("7Bar.webp")],
  threeX: [MX("3x.webp")],
  tenX: [MX("10x.webp")],
  anyWild: [MX("10x.webp"), MX("3x.webp")],
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Mega 10X Pay is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control, built the same way AdminBuffaloRtpPage.tsx works: one flat tier table, no
 * free spins, no special reel, no rule-tier map. Changing the target RTP re-scales the win-tier
 * frequencies in a single pass (RTP here is exactly linear in each tier's own frequency — no
 * second independent roll to account for, unlike Crazy 777/Gems Deluxe). The saved config *is*
 * the live odds `spinRequest` reads from (see games/Mega10XPay/api.ts) — a change here takes
 * effect on the very next spin.
 */
export function AdminMega10XPayRtpPage() {
  const [config, setConfig] = useState<Mega10xPayRtpConfig>(() => getMega10xRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncMega10xRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getMega10xRtpConfig();
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

  const computedRtp = computeMega10xRtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && rtpValid;

  function updateTier(key: TierKey, patch: Partial<Mega10xPayRtpConfig["tiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  // Same mechanism as every other dedicated page's setTargetRtp — rescales every winning tier's
  // frequency proportionally so the config is instantly valid again at the new target; payout
  // multipliers are untouched.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeMega10xRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const tiers = rescaleMega10xTiers(config.tiers, newTarget / oldRtp);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, tiers }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveMega10xRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setMega10xRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getMega10xDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Mega 10X Pay RTP"
        gameSlugs={["mega-10x-pay"]}
        description="Saved to the server — every player\'s Mega 10X Pay loads this config each time the game opens. Spins still resolve in the player\'s browser."
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

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && !rtpValid && (
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
            Reset to default ({DEFAULT_MEGA10X_TARGET_RTP_PERCENT}%)
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
