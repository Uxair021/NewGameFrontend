import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { GAME_THUMBNAILS } from "../games/thumbnails";
import {
  DEFAULT_KENO_TARGET_RTP_PERCENT,
  KENO_GAMES,
  KenoGameId,
  KenoGameSettings,
  KenoRtpConfig,
  MAX_PICKS,
  balanceAllRows,
  balanceRow,
  getKenoDefaultConfig,
  getKenoRtpConfig,
  matchProbability,
  minWinningHits,
  roundPay,
  rowRtpPercent,
  rowTolerancePercent,
  setKenoRtpConfig,
  saveKenoRtpConfigToServer,
  syncKenoRtpConfigFromServer,
} from "../games/shared/keno";

const PICK_COUNTS = Array.from({ length: MAX_PICKS }, (_, i) => i + 1);
const MATCH_COLUMNS = Array.from({ length: MAX_PICKS + 1 }, (_, i) => i);

function inputClass(invalid = false, width = "w-24"): string {
  return `${width} rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

function parseBetLevels(text: string): number[] | null {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.length === 0 || !nums.every((n) => Number.isFinite(n) && n > 0)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** Keno RTP is exact (no simulation), so rows are held to ±0.5% like the other exact pages —
 * wider only where whole-number pays can't physically get that close (see
 * rowTolerancePercent). */
function rowOnTarget(s: KenoGameSettings, picks: number): boolean {
  return Math.abs(rowRtpPercent(s, picks) - s.targetRtpPercent) <= rowTolerancePercent(s, picks);
}

function rowsOffTarget(s: KenoGameSettings): number[] {
  return PICK_COUNTS.filter((p) => !rowOnTarget(s, p));
}

/** Pays are whole numbers (e.g. 4x). */
const isWhole = (v: number) => Number.isInteger(v);

/**
 * Hexa Keno and Super Keno Balls run fully client-side (draws resolved in the browser by
 * games/shared/keno.ts), so like the other dedicated pages this control lives in localStorage
 * and applies to the next draw. Both games share one page and one saved document.
 *
 * Each pick count (1-10 numbers) is a separate bet the player chooses, so each row of the
 * paytable must pay back the target RTP on its own. RTP is exact here — the odds of every match
 * count are closed-form — so it's shown live per row, and changing the target (or clicking
 * "Balance") scales each row's pays proportionally to land on it.
 */
export function AdminKenoRtpPage() {
  const [config, setConfig] = useState<KenoRtpConfig>(() => getKenoRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncKenoRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getKenoRtpConfig();
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      if (changed) setConfig(next);
      setLoadingServer(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [betText, setBetText] = useState<Record<KenoGameId, string>>(() => {
    const c = getKenoRtpConfig();
    return { "hexa-keno": c["hexa-keno"].betLevels.join(", "), "super-keno-balls": c["super-keno-balls"].betLevels.join(", ") };
  });
  const [savedOk, setSavedOk] = useState(false);

  const betValid = (id: KenoGameId) => parseBetLevels(betText[id]) !== null;
  const allValid = KENO_GAMES.every(({ id }) => {
    const s = config[id];
    return (
      s.targetRtpPercent > 0 &&
      betValid(id) &&
      (s.bonusMultiplier === null || s.bonusMultiplier >= 1) &&
      s.paytable.every((row, picks) =>
        row.every((v, m) => Number.isFinite(v) && v >= 0 && isWhole(v) && (m >= minWinningHits(picks) || v === 0))
      ) &&
      rowsOffTarget(s).length === 0
    );
  });

  function update(id: KenoGameId, patch: (s: KenoGameSettings) => KenoGameSettings) {
    setSavedOk(false);
    setConfig((prev) => ({ ...prev, [id]: patch(prev[id]) }));
  }

  function setPay(id: KenoGameId, picks: number, matches: number, value: number) {
    update(id, (s) => ({
      ...s,
      paytable: s.paytable.map((row, p) => (p === picks ? row.map((v, m) => (m === matches ? value : v)) : row)),
    }));
  }

  // Changing the target re-balances every row straight away, like the other RTP pages.
  function setTarget(id: KenoGameId, target: number) {
    update(id, (s) => {
      const next = { ...s, targetRtpPercent: target };
      return target > 0 ? { ...next, paytable: balanceAllRows(next) } : next;
    });
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!allValid) return;
    const next = { ...config };
    for (const { id } of KENO_GAMES) next[id] = { ...next[id], betLevels: parseBetLevels(betText[id])! };
    setConfig(next);
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveKenoRtpConfigToServer(next);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setKenoRtpConfig(next);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    const d = getKenoDefaultConfig();
    setSavedOk(false);
    setConfig(d);
    setBetText({ "hexa-keno": d["hexa-keno"].betLevels.join(", "), "super-keno-balls": d["super-keno-balls"].betLevels.join(", ") });
  }

  return (
    <div>
      <AdminPageHeader
        title="Keno RTP — Hexa Keno & Super Keno Balls"
        gameSlugs={["hexa-keno", "super-keno-balls"]}
        description="Hexa Keno and Super Keno Balls — set each game's target RTP, pays, bonus and bet levels. Saved to the server — every player's game loads it each time it opens."
      />

      <div className="max-w-6xl space-y-6">
        {KENO_GAMES.map(({ id, name }) => {
          const s = config[id];
          const off = rowsOffTarget(s);
          return (
            <div key={id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <img src={GAME_THUMBNAILS[id]} alt="" className="h-12 w-12 rounded-lg border border-slate-200 bg-slate-800 object-cover" />
                <div className="text-base font-semibold text-slate-800">{name}</div>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-5">
                <div>
                  <label className="block text-xs text-slate-500">Target RTP %</label>
                  <input
                    type="number"
                    step="1"
                    value={s.targetRtpPercent}
                    onChange={(e) => setTarget(id, Number(e.target.value))}
                    className={`${inputClass(!(s.targetRtpPercent > 0))} mt-1`}
                  />
                </div>
                {s.bonusMultiplier !== null && (
                  <div>
                    <label className="block text-xs text-slate-500">Bonus ball multiplier (x)</label>
                    <input
                      type="number"
                      step="0.5"
                      min={1}
                      value={s.bonusMultiplier}
                      onChange={(e) => update(id, (prev) => ({ ...prev, bonusMultiplier: Number(e.target.value) }))}
                      className={`${inputClass(!(s.bonusMultiplier >= 1))} mt-1`}
                    />
                  </div>
                )}
                <div className="min-w-[260px] flex-1">
                  <label className="block text-xs text-slate-500">Bet levels (comma separated)</label>
                  <input
                    type="text"
                    value={betText[id]}
                    onChange={(e) => {
                      setSavedOk(false);
                      setBetText((prev) => ({ ...prev, [id]: e.target.value }));
                    }}
                    className={`${inputClass(!betValid(id), "w-full")} mt-1`}
                  />
                </div>
                <button
                  onClick={() => update(id, (prev) => ({ ...prev, paytable: balanceAllRows(prev) }))}
                  disabled={!(s.targetRtpPercent > 0)}
                  className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
                >
                  Balance all rows to target
                </button>
              </div>

              {off.length > 0 ? (
                <p className="mt-3 text-sm text-rose-600">
                  {off.length} row{off.length > 1 ? "s" : ""} (picks {off.join(", ")}) not at the target (±0.5%) — click
                  "Balance" on the row or "Balance all rows to target".
                </p>
              ) : s.paytable.some((row) => row.some((v) => !isWhole(v))) ? (
                <p className="mt-3 text-sm text-rose-600">
                  Some pays have decimals — click "Balance all rows to target" to round them to whole numbers.
                </p>
              ) : (
                <p className="mt-3 text-sm font-medium text-emerald-600">Every pick count pays back the target RTP ✓</p>
              )}

              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                    <tr>
                      <th className="px-2 py-2">Picks</th>
                      {MATCH_COLUMNS.map((m) => (
                        <th key={m} className="px-1 py-2 text-center">
                          {m} hit{m === 1 ? "" : "s"}
                        </th>
                      ))}
                      <th className="px-2 py-2">RTP</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {PICK_COUNTS.map((picks) => {
                      const rtp = rowRtpPercent(s, picks);
                      const ok = rowOnTarget(s, picks);
                      return (
                        <tr key={picks} className="border-t border-slate-200 even:bg-slate-50">
                          <td className="px-2 py-1.5 font-semibold text-slate-800">{picks}</td>
                          {MATCH_COLUMNS.map((m) => (
                            <td key={m} className="px-1 py-1.5">
                              {m <= picks ? (
                                <input
                                  type="number"
                                  step="1"
                                  min={0}
                                  value={s.paytable[picks][m]}
                                  disabled={m < minWinningHits(picks)}
                                  title={
                                    m < minWinningHits(picks)
                                      ? `${picks} picks needs at least ${minWinningHits(picks)} hits to win`
                                      : `Chance: ${(matchProbability(picks, m) * 100).toPrecision(3)}%`
                                  }
                                  onChange={(e) => setPay(id, picks, m, roundPay(Number(e.target.value)))}
                                  className={`${inputClass(!(s.paytable[picks][m] >= 0), "w-[72px]")} disabled:bg-slate-100 disabled:text-slate-400`}
                                />
                              ) : null}
                            </td>
                          ))}
                          <td className={`px-2 py-1.5 font-medium ${ok ? "text-emerald-600" : "text-rose-600"}`}>
                            {rtp.toFixed(2)}%
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() =>
                                update(id, (prev) => ({
                                  ...prev,
                                  paytable: prev.paytable.map((row, p) => (p === picks ? balanceRow(prev, picks) : row)),
                                }))
                              }
                              disabled={ok || !(s.targetRtpPercent > 0)}
                              className="text-xs font-medium text-indigo-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                            >
                              Balance
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Pays are x bet for that many hits, in whole numbers only (e.g. 4). Hover a pay to see how often it hits.
                10 picks needs at least {minWinningHits(10)} hits to win. Balancing scales a row's pays up or down together,
                then fine-tunes them in whole steps to land on the target — rows with very few pays (1–2 picks) can't hit
                it exactly, so they settle on the closest value below it.
                {s.bonusMultiplier !== null &&
                  " RTP includes the bonus ball: when it's one of the player's hits, that draw pays the bonus multiplier times the row's pay."}
              </p>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={!allValid || saving || loadingServer}
            className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {saving ? "Saving…" : loadingServer ? "Loading…" : "Save both games"}
          </button>
          <button
            onClick={resetToDefault}
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Reset to defaults ({DEFAULT_KENO_TARGET_RTP_PERCENT}%)
          </button>
          {!allValid && <span className="text-xs text-slate-500">Save unlocks when every row of both games is on target.</span>}
          {savedOk && (
            <div className="text-sm font-medium text-emerald-600">Saved to the server — players get it the next time the game loads.</div>
          )}
          {saveError && <div className="text-sm font-medium text-rose-600">{saveError}</div>}
        </div>
      </div>
    </div>
  );
}
