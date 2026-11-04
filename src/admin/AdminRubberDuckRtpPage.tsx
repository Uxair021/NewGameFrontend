import { MAX_TARGET_RTP_PERCENT, parseWholeX } from "../games/shared/rtpRules";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import {
  RubberDuckRtpConfig,
  RubberDuckSymbol,
  DEFAULT_RUBBERDUCK_TARGET_RTP_PERCENT,
  computeRubberDuckRtpPercent,
  getRubberDuckDefaultConfig,
  getRubberDuckRtpConfig,
  fitRubberDuckTiersToTarget,
  setRubberDuckRtpConfig,
  saveRubberDuckRtpConfigToServer,
  syncRubberDuckRtpConfigFromServer,
} from "../games/RubberDuck/api";

const TIER_LABELS: Record<RubberDuckSymbol, string> = {
  TRIPLE_7: "Triple 7 (weight + direct pay)",
  DOUBLE_7: "Double 7 (weight + direct pay)",
  SEVEN: "Seven (weight + direct pay)",
  BOAT: "Boat (weight + direct pay)",
  GUN: "Water Gun (weight + direct pay)",
  TOOL: "Tool (weight + direct pay)",
  SHAMPOO: "Shampoo (weight + direct pay)",
  TOWEL: "Towel (weight + direct pay)",
  BRUSH: "Brush (weight + direct pay)",
  SAFEGUARD: "Safeguard Soap (weight + direct pay)",
  CAP: "Cap (weight + direct pay)",
  POT: "Pot (weight + direct pay)",
  SOAP: "Soap (weight + direct pay)",
  SPONGE: "Sponge (weight + direct pay)",
  BONUS: "BONUS (weight + free-spin trigger)",
  AVOCADO: "Avocado (loss fruit — weight only)",
  BANANA: "Banana (loss fruit — weight only)",
  COCONUT: "Coconut (loss fruit — weight only)",
  GRAPES: "Grapes (loss fruit — weight only)",
  LEMON: "Lemon (loss fruit — weight only)",
  STRAWBERRY: "Strawberry (loss fruit — weight only)",
};

const TIER_IMAGES: Record<RubberDuckSymbol, string> = {
  TRIPLE_7: "/symbols/rubberDuck/tripple7.webp",
  DOUBLE_7: "/symbols/rubberDuck/double7.webp",
  SEVEN: "/symbols/rubberDuck/7.webp",
  BOAT: "/symbols/rubberDuck/boat.webp",
  GUN: "/symbols/rubberDuck/gun.webp",
  TOOL: "/symbols/rubberDuck/tool.webp",
  SHAMPOO: "/symbols/rubberDuck/shampoo.webp",
  TOWEL: "/symbols/rubberDuck/towel.webp",
  BRUSH: "/symbols/rubberDuck/brush.webp",
  SAFEGUARD: "/symbols/rubberDuck/saveGaurd.webp",
  CAP: "/symbols/rubberDuck/cap.webp",
  POT: "/symbols/rubberDuck/pot.webp",
  SOAP: "/symbols/rubberDuck/soap.webp",
  SPONGE: "/symbols/rubberDuck/sponch.webp",
  BONUS: "/symbols/rubberDuck/bonus.webp",
  AVOCADO: "/symbols/rubberDuck/avacado.webp",
  BANANA: "/symbols/rubberDuck/banana.webp",
  COCONUT: "/symbols/rubberDuck/coconut.webp",
  GRAPES: "/symbols/rubberDuck/grapes.webp",
  LEMON: "/symbols/rubberDuck/lemon.webp",
  STRAWBERRY: "/symbols/rubberDuck/strawberry.webp",
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/**
 * Rubber Duck is a fully offline, client-side test game (no backend) — this tab is its own
 * separate RTP control. Unlike most other dedicated pages, this game has no single "loss" row —
 * the 6 fruit symbols jointly absorb whatever frequency the 14 paying symbols + BONUS don't use,
 * split evenly (same split a target-RTP rescale uses, preserving their equal-weight symmetry from
 * the shipped defaults). Changing the target RTP re-scales the 14 paying symbols' frequencies in
 * a single pass — exact, not approximate, since the free-spins feature's own RTP contribution is
 * multiplicatively tied to the base RTP here rather than an independent additive term. The saved
 * config *is* the live odds `spinRequest` reads from (see games/RubberDuck/api.ts) — a change here
 * takes effect on the very next spin.
 */
export function AdminRubberDuckRtpPage() {
  const [config, setConfig] = useState<RubberDuckRtpConfig>(() => getRubberDuckRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncRubberDuckRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getRubberDuckRtpConfig();
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

  const computedRtp = computeRubberDuckRtpPercent(config);
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = Math.abs(computedRtp - config.targetRtpPercent) <= 0.5;
  const isValid = frequencyValid && rtpValid;

  function updateTier(key: RubberDuckSymbol, patch: Partial<RubberDuckRtpConfig["tiers"][number]>) {
    setSavedOk(false);
    setConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  }

  function setTargetRtp(newTarget: number) {
    setSavedOk(false);
    const oldRtp = computeRubberDuckRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget }));
      return;
    }
    const tiers = fitRubberDuckTiersToTarget(config.tiers, newTarget);
    setConfig((prev) => ({ ...prev, targetRtpPercent: newTarget, tiers }));
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!isValid) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveRubberDuckRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setRubberDuckRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setConfig(getRubberDuckDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Rubber Duck RTP"
        gameSlugs={["rubber-duck"]}
        description="Saved to the server — every player\'s Rubber Duck loads this config each time the game opens. Spins still resolve in the player\'s browser."
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
            Every reel that lands a paying symbol adds its own value to the spin's total, independently — no
            matching required, even a single occurrence pays in full. 3+ BONUS cells award 15 free spins (+10 more
            on a mid-round retrigger, not admin-tunable); every win pays 3× during free spins.
          </p>

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
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Frequency % (per reel)</th>
                <th className="px-3 py-2">Payout (per hit, x bet)</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {config.tiers.map((tier) => (
                <tr key={tier.key} className="border-t border-slate-200 even:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <div className="flex items-center gap-2">
                      <img src={TIER_IMAGES[tier.key]} alt="" className="h-7 w-7 rounded object-contain bg-slate-100" />
                      {TIER_LABELS[tier.key]}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.00001"
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
            Reset to default ({DEFAULT_RUBBERDUCK_TARGET_RTP_PERCENT}%)
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
