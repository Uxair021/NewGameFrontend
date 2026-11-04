import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  Crazy777RtpConfig,
  LineTierKey,
  SpecialTierKey,
  DEFAULT_CRAZY777_TARGET_RTP_PERCENT,
  computeCrazy777RtpPercent,
  getCrazy777DefaultConfig,
  getCrazy777RtpConfig,
  rescaleCrazy777Tiers,
  setCrazy777RtpConfig,
  saveCrazy777RtpConfigToServer,
  syncCrazy777RtpConfigFromServer,
} from "../games/Crazy777/api";
import { useEffect, useState } from "react";

const LINE_TIER_LABELS: Record<LineTierKey, string> = {
  loss: "Loss",
  singleBar: "3× Single Bar",
  doubleBar: "3× Double Bar",
  sevenLow: "3× 7",
  sevenMid: "3× 77",
  sevenHigh: "3× 777",
  anySeven: "Any 3 Sevens (mixed)",
  anyBar: "Any 3 Bars (mixed)",
  anyGlobal: "Any mix of 7s & Bars",
};

const SPECIAL_TIER_LABELS: Record<SpecialTierKey, string> = {
  multiplier2x: "2X Multiplier",
  multiplier5x: "5X Multiplier",
  multiplier10x: "10X Multiplier",
  dollarPlus: "$+ Bonus",
  doubleDollarPlus: "$$+ Bonus",
  respin: "Respin",
  specialEmpty: "Nothing (half-stop)",
};

/** Reel symbol art (as in games/Crazy777/pixi/symbols.ts) for each outcome. */
const C7 = (f: string) => `/symbols/carzy777/${f}`;
const LINE_TIER_IMAGES: Record<LineTierKey, string[]> = {
  loss: [],
  singleBar: [C7("BAR1.webp")],
  doubleBar: [C7("doubleBar.webp")],
  sevenLow: [C7("7.webp")],
  sevenMid: [C7("77.webp")],
  sevenHigh: [C7("777.webp")],
  anySeven: [C7("7.webp"), C7("77.webp"), C7("777.webp")],
  anyBar: [C7("BAR1.webp"), C7("doubleBar.webp")],
  anyGlobal: [C7("7.webp"), C7("77.webp"), C7("BAR1.webp")],
};
const SPECIAL_TIER_IMAGES: Record<SpecialTierKey, string[]> = {
  multiplier2x: [C7("2X.webp")],
  multiplier5x: [C7("5X.webp")],
  multiplier10x: [C7("10X.webp")],
  dollarPlus: [C7("singleDollar.webp")],
  doubleDollarPlus: [C7("doubleDollar.webp")],
  respin: [C7("respin.webp")],
  specialEmpty: [],
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Crazy 777 is a fully offline, client-side test game (no backend) — this tab is its own separate
 * RTP control, built the same way AdminShamrockRtpPage.tsx works, plus the extra structure this
 * game's shape needs: two fully independent weighted tables (line tiers + reel 4's special tiers,
 * each summing to 100% on their own) and a respin-count range instead of a rule-tier map. Changing
 * the target RTP re-scales the line tiers' frequencies and, because the RESPIN retrigger term
 * depends on both pLineWin and the joint EV (both of which move when line frequencies scale), runs
 * that rescale a few times in a loop to converge close to the target — same technique
 * AdminRtpPage.tsx already uses for this exact game. The saved config *is* the live odds
 * `spinRequest` reads from (see games/Crazy777/api.ts) — a change here takes effect on the very
 * next spin.
 */
export function AdminCrazy777RtpPage() {
  const [config, setConfig] = useState<Crazy777RtpConfig>(() => getCrazy777RtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncCrazy777RtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getCrazy777RtpConfig();
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

  const computedRtp = computeCrazy777RtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const specialFrequencySum = config.specialReelTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const specialFrequencyValid = Math.abs(specialFrequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const respinRangeValid = config.respinRange.min >= 0 && config.respinRange.max >= config.respinRange.min;
  const isValid = frequencyValid && specialFrequencyValid && rtpValid && respinRangeValid;

  function updateTier(key: LineTierKey, patch: Partial<Crazy777RtpConfig["tiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function updateSpecialTier(key: SpecialTierKey, patch: Partial<Crazy777RtpConfig["specialReelTiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      specialReelTiers: prev.specialReelTiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function updateRespinRange(patch: Partial<Crazy777RtpConfig["respinRange"]>) {
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, respinRange: { ...prev.respinRange, ...patch } }));
  }

  // Same mechanism as AdminRtpPage.tsx's own setTargetRtp for this game: rescale, then re-check
  // and rescale again a few times, since a single pass only lands close (not exact) here.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeCrazy777RtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }

    let tiers = rescaleCrazy777Tiers(config.tiers, newTarget / oldRtp);
    for (let i = 0; i < 6; i++) {
      const current = computeCrazy777RtpPercent({ ...config, tiers });
      if (!Number.isFinite(current) || current <= 0 || Math.abs(current - newTarget) < 0.005) break;
      tiers = rescaleCrazy777Tiers(tiers, newTarget / current);
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
      await saveCrazy777RtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setCrazy777RtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getCrazy777DefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Crazy 777 RTP"
        gameSlugs={["crazy-777"]}
        description="Saved to the server — every player\'s Crazy 777 loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
              Line tier frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
          {!specialFrequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Special reel frequencies must sum to 100% — currently {specialFrequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && specialFrequencyValid && !rtpValid && (
            <p className="mt-3 text-sm text-rose-600">
              Computed RTP ({computedRtp.toFixed(2)}%) doesn't match the target ({config.targetRtpPercent.toFixed(2)}%,
              ±0.5%). Adjust frequencies or payout multipliers below, or change the target to match.
            </p>
          )}
          {!respinRangeValid && (
            <p className="mt-3 text-sm text-rose-600">Respin range's minimum must be 0 or greater and ≤ its maximum.</p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Line outcome (reels 1-3)</th>
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">Base payout (x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.tiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={LINE_TIER_IMAGES[tier.key]}>{LINE_TIER_LABELS[tier.key]}</SymbolLabel></td>
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

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-indigo-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Special reel (reel 4) outcome</th>
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">Payout / bonus</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.specialReelTiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={SPECIAL_TIER_IMAGES[tier.key]}>{SPECIAL_TIER_LABELS[tier.key]}</SymbolLabel></td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.0001"
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
          <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            "Nothing (half-stop)" never pays as itself — if reels 1-3 already won, it resolves into a weighted-random
            pick among the other real special outcomes above instead, so a win always lands on a real bonus.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <label className="text-sm font-semibold text-slate-800">Respin count range</label>
          <p className="mt-1 text-xs text-slate-500">
            When reel 4 lands RESPIN, the player is awarded a random number of respins in this range (reels 1-3 only
            — reel 4 stays frozen on RESPIN for the whole bonus round, no re-trigger).
          </p>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Min</span>
              <input
                type="number"
                step="1"
                value={config.respinRange.min}
                onChange={(e) => updateRespinRange({ min: Number(e.target.value) })}
                className={inputClass(!respinRangeValid)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Max</span>
              <input
                type="number"
                step="1"
                value={config.respinRange.max}
                onChange={(e) => updateRespinRange({ max: Number(e.target.value) })}
                className={inputClass(!respinRangeValid)}
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
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Reset to default ({DEFAULT_CRAZY777_TARGET_RTP_PERCENT}%)
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
