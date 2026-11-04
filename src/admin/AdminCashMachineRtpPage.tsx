import { MAX_TARGET_RTP_PERCENT } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  CashRtpConfig,
  TierKey,
  DEFAULT_CASH_TARGET_RTP_PERCENT,
  computeCashRealRtpByReels,
  computeCashRtpPercent,
  getCashDefaultConfig,
  getCashRtpConfig,
  rescaleCashTiers,
  setCashRtpConfig,
  saveCashRtpConfigToServer,
  syncCashRtpConfigFromServer,
} from "../games/CashMachine/api";

/** Value-band labels follow the admin's current amount thresholds — this game pays the number the
 * reels spell out, so its outcome rows are value ranges, not Big/Mega/Jackpot tiers. */
function tierLabel(key: TierKey, t: CashRtpConfig["amountThresholds"]): string {
  const n = (v: number) => v.toLocaleString();
  switch (key) {
    case "loss":
      return "Loss";
    case "simpleWin":
      return `Win 1 – ${n(t.simpleWinMax)}`;
    case "bigWin":
      return `Win ${n(t.bigWinMin)} – ${n(t.megaWinMin - 1)}`;
    case "megaWin":
      return `Win ${n(t.megaWinMin)} – ${n(t.jackpotMin - 1)}`;
    case "jackpot":
      return `Win ${n(t.jackpotMin)}+`;
    case "zeroRespin":
      return "Zero Respin";
  }
}

/** Reel symbol art (as in games/CashMachine/pixi/symbols.ts). The win tiers aren't one symbol —
 * the reels' digit symbols spell out the prize within each tier's amount range — so they show
 * the digits; loss shows the blank and Zero Respin the 0 that triggers it. */
const CM = (f: string) => `/symbols/moneyMachine/${f}`;
const DIGITS = [CM("1.webp"), CM("2.webp"), CM("5.webp"), CM("10.webp")];
const TIER_IMAGES: Record<TierKey, string[]> = {
  loss: [CM("null.webp")],
  simpleWin: DIGITS,
  bigWin: DIGITS,
  megaWin: DIGITS,
  jackpot: DIGITS,
  zeroRespin: [CM("0.webp")],
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Cash Machine is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control. Unlike every other game's dedicated page, the payout "x bet" column below
 * is an ESTIMATE only, for the live RTP preview — the real payout is whatever number the reels
 * concatenate to within a tier's amount-range (edited in the second section), scaled by bet. That
 * makes the amount-range editor the actual payout control here, not the frequency/payout table
 * alone. Changing the target RTP re-scales the win-tier frequencies (same generic technique every
 * other page uses); it never touches the amount ranges. The saved config *is* the live odds
 * `spinRequest` reads from (see games/CashMachine/api.ts) — a change here takes effect on the very
 * next spin.
 */
export function AdminCashMachineRtpPage() {
  const [config, setConfig] = useState<CashRtpConfig>(() => getCashRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncCashRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getCashRtpConfig();
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

  const computedRtp = computeCashRtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const { zeroRespinMin, zeroRespinMax } = config.amountThresholds;
  const rangeValid = zeroRespinMin >= 0 && zeroRespinMax >= zeroRespinMin;
  const isValid = frequencyValid && rtpValid && rangeValid;

  function updateTier(key: TierKey, patch: Partial<CashRtpConfig["tiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function updateThreshold(field: keyof CashRtpConfig["amountThresholds"], value: number) {
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, amountThresholds: { ...prev.amountThresholds, [field]: value } }));
  }

  // Same mechanism as every other dedicated page's setTargetRtp — rescales every winning tier's
  // frequency proportionally so the config is instantly valid again at the new target; payout
  // estimates and amount ranges are untouched.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeCashRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const tiers = rescaleCashTiers(config.tiers, newTarget / oldRtp);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, tiers }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveCashRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setCashRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getCashDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Cash Machine RTP"
        gameSlugs={["cash-machine"]}
        description="Saved to the server — every player\'s Cash Machine loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
              Effective RTP (estimate): {computedRtp.toFixed(2)}%
              {rtpValid ? " ✓" : ""}
            </div>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">
            Real RTP:{" "}
            {computeCashRealRtpByReels(config)
              .map((r) => `${r.activeReels} reel${r.activeReels > 1 ? "s" : ""} ${r.rtpPercent.toFixed(2)}%`)
              .join(" · ")}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            The real RTP is worked out from what the reels actually pay. The frequencies and estimates below only set
            the mix of outcomes: the game scales them for each reel count so every bet lands on the target, which means
            the odds played at a given bet differ from the numbers shown here.
          </p>

          {!frequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && !rtpValid && (
            <p className="mt-3 text-sm text-rose-600">
              Computed RTP ({computedRtp.toFixed(2)}%) doesn't match the target ({config.targetRtpPercent.toFixed(2)}%,
              ±0.5%). Adjust frequencies or payout estimates below, or change the target to match.
            </p>
          )}
          {!rangeValid && (
            <p className="mt-3 text-sm text-rose-600">Zero Respin's minimum must be 0 or greater and ≤ its maximum.</p>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
              <tr>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">Payout estimate (x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.tiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={TIER_IMAGES[tier.key]}>{tierLabel(tier.key, config.amountThresholds)}</SymbolLabel></td>
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
                        step="0.01"
                        value={tier.payoutMultiplier}
                        onChange={(e) => updateTier(tier.key, { payoutMultiplier: Number(e.target.value) })}
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
          <div className="text-sm font-semibold text-slate-800">Amount thresholds</div>
          <p className="mt-1 text-xs text-slate-500">
            The value range for each tier — this is the real payout control: whatever number the reels land on
            within a tier's range is exactly what gets paid (scaled by bet). The payout estimate column above is
            only for the RTP preview.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["simpleWinMax", "Band 1 max"],
                ["bigWinMin", "Band 2 min"],
                ["megaWinMin", "Band 3 min"],
                ["jackpotMin", "Band 4 min"],
                ["zeroRespinMin", "Zero Respin min"],
                ["zeroRespinMax", "Zero Respin max"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <label className="block text-xs text-slate-500">{label}</label>
                <input
                  type="number"
                  value={config.amountThresholds[field]}
                  onChange={(e) => updateThreshold(field, Number(e.target.value))}
                  className={`${inputClass(field === "zeroRespinMin" || field === "zeroRespinMax" ? !rangeValid : false)} mt-1 w-full`}
                />
              </div>
            ))}
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
            Reset to default ({DEFAULT_CASH_TARGET_RTP_PERCENT}%)
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
