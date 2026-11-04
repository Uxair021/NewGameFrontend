import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  FiveXRtpConfig,
  LineTierKey,
  CoinTierKey,
  DEFAULT_FIVEX_TARGET_RTP_PERCENT,
  computeFiveXRtpPercent,
  getFiveXDefaultConfig,
  getFiveXRtpConfig,
  rescaleFiveXTiers,
  setFiveXRtpConfig,
  saveFiveXRtpConfigToServer,
  syncFiveXRtpConfigFromServer,
} from "../games/FiveXRewind/api";

const LINE_TIER_LABELS: Record<LineTierKey, string> = {
  loss: "Loss",
  whiteBar: "WHITE-BAR x3",
  sevenBar: "7-BAR (WHITE 7-BAR) x3",
  redBar: "RED-BAR x3",
  purpleBar: "PURPLE-BAR x3",
  red7: "RED-7 x3",
  purple7: "PURPLE-7 x3",
  blue7: "BLUE-7 x3",
  any3BarOnly: "Any 3 Bar (no 7-BAR, mixed)",
  any3BarWithSevenBar: "Any 3 Bar + 7-BAR (mixed)",
  any3Sevens: "Any 3 Sevens (mixed)",
};

const COIN_TIER_LABELS: Record<CoinTierKey, string> = {
  noCoin: "No coin (this reel)",
  coin2x: "2X coin",
  coin3x: "3X coin",
  coin4x: "4X coin",
  coin5x: "5X coin",
};

/** Reel symbol art (as in games/FiveXRewind/pixi/symbols.ts) for each outcome. */
const FX = (f: string) => `/symbols/5xRewind/${f}`;
const LINE_TIER_IMAGES: Record<LineTierKey, string[]> = {
  loss: [],
  whiteBar: [FX("WHITE-BAR.webp")],
  sevenBar: [FX("7-BAR.webp")],
  redBar: [FX("RED-BAR.webp")],
  purpleBar: [FX("PURPLE-BAR.webp")],
  red7: [FX("RED-7.webp")],
  purple7: [FX("PURPLE-7.webp")],
  blue7: [FX("BLUE-7.webp")],
  any3BarOnly: [FX("WHITE-BAR.webp"), FX("RED-BAR.webp"), FX("PURPLE-BAR.webp")],
  any3BarWithSevenBar: [FX("7-BAR.webp"), FX("WHITE-BAR.webp"), FX("RED-BAR.webp")],
  any3Sevens: [FX("RED-7.webp"), FX("PURPLE-7.webp"), FX("BLUE-7.webp")],
};
const COIN_TIER_IMAGES: Record<CoinTierKey, string[]> = {
  noCoin: [],
  coin2x: [FX("2X-coin.webp")],
  coin3x: [FX("3X-coin.webp")],
  coin4x: [FX("4X-coin.webp")],
  coin5x: [FX("5X-coin.webp")],
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * 5x Rewind is a fully offline, client-side test game (no backend) — this tab is its own separate
 * RTP control, built the same way AdminCrazy777RtpPage.tsx works, plus the shape this game needs:
 * a coin-overlay table (rolled per reel, not per spin — no payout column of its own, its effect is
 * baked into calculateWin). There are no Big/Mega/Jackpot celebration tiers. Changing the target RTP re-scales the line
 * tiers' frequencies in a single pass — unlike Crazy 777, RTP here is exactly linear in each line
 * tier's own frequency (the coin distribution is independent of which line tier rolled), so no
 * iteration is needed. The saved config *is* the live odds `spinRequest` reads from (see
 * games/FiveXRewind/api.ts) — a change here takes effect on the very next spin.
 */
export function AdminFiveXRtpPage() {
  const [config, setConfig] = useState<FiveXRtpConfig>(() => getFiveXRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncFiveXRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getFiveXRtpConfig();
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

  const computedRtp = computeFiveXRtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const coinFrequencySum = config.coinTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const coinFrequencyValid = Math.abs(coinFrequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && coinFrequencyValid && rtpValid;

  function updateTier(key: LineTierKey, patch: Partial<FiveXRtpConfig["tiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function updateCoinTier(key: CoinTierKey, patch: Partial<FiveXRtpConfig["coinTiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      coinTiers: prev.coinTiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  // Same mechanism as Buffalo's/Shamrock's page — a single rescale pass lands exactly on target,
  // since RTP here is linear in the line tiers' own frequencies.
  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeFiveXRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const tiers = rescaleFiveXTiers(config.tiers, newTarget / oldRtp);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, tiers }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveFiveXRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setFiveXRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getFiveXDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="5x Rewind RTP"
        gameSlugs={["5x-rewind"]}
        description="Saved to the server — every player\'s 5x Rewind loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
          {!coinFrequencyValid && (
            <p className="mt-3 text-sm text-rose-600">
              Coin overlay frequencies must sum to 100% — currently {coinFrequencySum.toFixed(2)}%.
            </p>
          )}
          {frequencyValid && coinFrequencyValid && !rtpValid && (
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
                <th className="px-3 py-2">Line outcome</th>
                <th className="px-3 py-2">Frequency %</th>
                <th className="px-3 py-2">Payout (x bet)</th>
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

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-800">Coin overlay (rolled per reel)</div>
          <p className="mt-1 text-xs text-slate-500">
            Rolled independently for each of the 3 reels — a coin can replace that reel's line symbol regardless of
            what the line tier above rolled. Frequencies here must separately sum to 100%.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-indigo-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Frequency %</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {config.coinTiers.map((tier) => (
                  <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800"><SymbolLabel images={COIN_TIER_IMAGES[tier.key]}>{COIN_TIER_LABELS[tier.key]}</SymbolLabel></td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.0001"
                        value={tier.frequencyPercent}
                        onChange={(e) => updateCoinTier(tier.key, { frequencyPercent: Number(e.target.value) })}
                        className={inputClass(!coinFrequencyValid)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            2X|5X|2X pays 1000x and 2X|4X|2X pays 400x in exact left-to-right order (not admin-tunable — a fixed
            special-jackpot rule). Coins otherwise substitute into a 3-of-a-kind match or stack as a standalone
            multiplier — see calculateWin.
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
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Reset to default ({DEFAULT_FIVEX_TARGET_RTP_PERCENT}%)
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
