import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { SymbolLabel } from "./SymbolLabel";
import {
  Fruity777RtpConfig,
  TierKey,
  DEFAULT_FRUITY_TARGET_RTP_PERCENT,
  computeFruityRtpPercent,
  getFruityDefaultConfig,
  getFruityRtpConfig,
  fitFruityTiersToTarget,
  setFruityRtpConfig,
  saveFruityRtpConfigToServer,
  syncFruityRtpConfigFromServer,
} from "../games/Fruity777/api";

const TIER_LABELS: Record<TierKey, string> = {
  loss: "Loss",
  freeSpin: "Free Spin (bonus round trigger)",
  apple: "3× Apple",
  lemon: "3× Lemon",
  orange: "3× Orange",
  peach: "3× Peach",
  pineapple: "3× Pineapple",
  grape: "3× Grape",
  watermelon: "3× Watermelon",
  dragonFruit: "3× Dragon Fruit",
  seven: "3× Seven",
  bar: "3× Bar",
  star: "3× Star",
};

/** Reel symbol art (as in games/Fruity777/pixi/symbols.ts) for each outcome. */
const FR = (f: string) => `/symbols/fruity777/${f}`;
const TIER_IMAGES: Record<TierKey, string[]> = {
  loss: [],
  freeSpin: [FR("bonus.webp")],
  apple: [FR("apple.webp")],
  lemon: [FR("lemon.webp")],
  orange: [FR("orange.webp")],
  peach: [FR("peach.webp")],
  pineapple: [FR("pineapple.webp")],
  grape: [FR("graps.webp")],
  watermelon: [FR("watermellon.webp")],
  dragonFruit: [FR("dragonFruit.webp")],
  seven: [FR("7.webp")],
  bar: [FR("bar.webp")],
  star: [FR("luckyStar.webp")],
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * 777 Fruity is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control, built the same way AdminShamrockRtpPage.tsx works, minus the rule-tier-map
 * editor Shamrock needs: every winning tier here maps 1:1 directly to one symbol, so there's no
 * cosmetic rule id to pick within a tier. The free-spin COUNT granted (always a random 3-10) is
 * NOT editable here — only its RTP-preview average is, same split the original backend had. The
 * saved config *is* the live odds `spinRequest` reads from (see games/Fruity777/api.ts) — a change
 * here takes effect on the very next spin.
 */
export function AdminFruity777RtpPage() {
  const [config, setConfig] = useState<Fruity777RtpConfig>(() => getFruityRtpConfig());
  const [savedOk, setSavedOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched (the page then shows that, not just
   * whatever this browser had). */
  const [loadingServer, setLoadingServer] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void syncFruityRtpConfigFromServer().then(() => {
      if (cancelled) return;
      setConfig(getFruityRtpConfig());
      setLoadingServer(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const computedRtp = computeFruityRtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && rtpValid;

  function updateTier(key: TierKey, patch: Partial<Fruity777RtpConfig["tiers"][number]>) {
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
    const oldRtp = computeFruityRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const tiers = fitFruityTiersToTarget(config, newTarget);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, tiers }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveFruityRtpConfigToServer(config);
      setFruityRtpConfig(config);
      setSavedOk(true);
      window.setTimeout(() => setSavedOk(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getFruityDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="777 Fruity RTP"
        gameSlugs={["fruity-777"]}
        description="Saved to the server — every player's 777 Fruity loads this config each time the game opens. Spins still resolve in the player's browser."
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
                <th className="px-3 py-2">Base payout (x bet)</th>
                <th className="px-3 py-2">Free-spin payout (x bet)</th>
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
                  <td className="px-3 py-2">
                    {tier.freeSpinPayoutMultiplier === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <input
                        type="number"
                        step="1"
                min="0"
                        value={tier.freeSpinPayoutMultiplier}
                        onChange={(e) => updateTier(tier.key, { freeSpinPayoutMultiplier: parseWholeX(e.target.value) })}
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
          <label className="text-sm font-semibold text-slate-800">Free spins granted (RTP preview only)</label>
          <p className="mt-1 text-xs text-slate-500">
            The actual count awarded when "Free Spin" hits is always a random draw between 3 and 10 — that range
            isn't admin-tunable. This field only feeds the Effective RTP estimate above; it has no effect on
            gameplay.
          </p>
          <input
            type="number"
            step="0.1"
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
            Reset to default ({DEFAULT_FRUITY_TARGET_RTP_PERCENT}%)
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
