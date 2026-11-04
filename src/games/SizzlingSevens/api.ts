/**
 * Sizzling 7s' RNG, paytable, Wild/Bonus/Free-Games math, and balance are all computed
 * entirely in the browser — same "fully offline, client-side test game" architecture as
 * Buffalo777 (see games/Buffalo777/api.ts). The reel's own continuous scroll already decided
 * the grid client-side before this file existed (it freezes wherever the player clicks Stop —
 * see pixi/Reel.ts); what moved here is the *scoring* of that grid (27-payline evaluation,
 * Wild substitution/multiplier, Bonus scatter, the whole Free Games/Mystery-Pick system) and
 * the admin-editable paytable, both of which used to round-trip to the backend on every spin.
 * config.ts/winCalc.ts are faithful ports of what used to live in
 * `backEnd/src/games/SizzlingSevens/{config,winCalc}.ts`, using the exact same weights/payouts
 * that previously came from `backEnd/src/services/paytableConfig.ts`'s
 * `DEFAULT_CONFIGS["sizzling-7s"]` (the live odds). Kept as the same exported function
 * names/signatures as the old network calls (`spinRequest`, `getSizzlingSevensConfig`) so
 * SizzlingSevensGame.tsx and the pixi/ files didn't need to change how they call them.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/SizzlingSevens/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so Sizzling 7s spins
 * show up in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's.
 * It never influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { MAX_TARGET_RTP_PERCENT, wholeXInUnits } from "../shared/rtpRules";
import { apiClient } from "../../api/client";
import {
  SizzlingSymbol,
  PAYLINES,
  DEFAULT_PAYTABLE,
  WILD_SYMBOL,
  BONUS_TRIGGER_COUNT,
  WILD_MULTIPLIER_BASE,
  PURE_WILD_PAYOUT,
  FREE_GAMES_AWARDS,
  MYSTERY_SPIN_COUNTS,
  MYSTERY_MULTIPLIER_POOL,
  LINE_COST,
  BET_LEVELS,
  FREE_GAMES_MIN_WIN_X,
  ANY_BAR_PAYOUT,
  ANY_SEVEN_PAYOUT,
} from "./config";
import { Cell, Grid, Paytable, PureWildPayout, calculateSpinWin, triggerFreeGames, pickFreeSpinMultiplier } from "./winCalc";

export type { SizzlingSymbol, Cell, Grid };


export interface LineWin {
  lineNumber: number;
  symbol: SizzlingSymbol;
  matchCount: number;
  basePayout: number;
  wildCount: number;
  wildMultiplier: number;
  betMultiplier: number;
  finalWin: number;
  positions: [number, number][];
  isPureWild: boolean;
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  totalLineWin: number;
  totalWinBeforeFreeMultiplier: number;
  freeGameMultiplier: number;
  finalWin: number;
  winningPositions: [number, number][];
  triggeredFreeGames: boolean;
}

export interface FreeGamesAward {
  freeSpins: number;
  multiplierPool: number[];
  isMystery: boolean;
}

export interface SpinResponse {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  freeGamesAward: FreeGamesAward | null;
  balance: number;
  meta: { forced: boolean };
}

export interface PaytableRow {
  symbol: SizzlingSymbol;
  payout: number;
}

export interface SizzlingSevensConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  lineCost: number;
  betLevels: number[];
  minBet: number;
  maxBet: number;
  paylineCount: number;
  paylines: [number, number, number][];
  paytable: PaytableRow[];
  symbolWeights: Partial<Record<SizzlingSymbol, number>>;
  /** Line-unit pays for any mix of 3 BARs / any mix of Red & Blue 7s (0 = doesn't pay). */
  anyBarPayout: number;
  anySevenPayout: number;
  wild: { symbol: "WILD_2X"; multiplierBase: number; purePayout: Record<1 | 2 | 3, number> };
  bonus: { symbol: "BONUS"; triggerCount: number };
  freeGames: {
    awards: Array<{ freeSpins: number; multiplierPool: number[] }>;
    mystery: { spinCounts: number[]; multiplierPool: number[] };
  };
}

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ---
//
// Mirrors Buffalo777's own client-side RTP control (games/Buffalo777/api.ts) — except here
// `tiers` is a 7-row *reel-strip weight* table (one row per symbol, not a per-outcome tier like
// Buffalo777's), matching the exact shape the backend's paytableConfig service used to store
// for this game. frequencyPercent is that symbol's draw weight (all 7 sum to 100%),
// payoutMultiplier is its 3-matching payout (WILD_2X's row holds only the 3-Wild pure payout —
// see pureWildPayoutFrom below). There's no dedicated "loss" row — losing is just whatever
// combinatorially doesn't line up across the 27 overlapping paylines.

export interface SizzlingTierRow {
  key: SizzlingSymbol;
  frequencyPercent: number;
  payoutMultiplier: number;
}

export interface SizzlingRtpConfig {
  targetRtpPercent: number;
  tiers: SizzlingTierRow[];
  /** Pays (line units, like the tiers') for a payline showing any mix of the 3 BARs / of the 2
   * Sevens. Optional so configs saved before these existed still load (they get the defaults). */
  mixedPays?: { anyBar: number; anySeven: number };
  /** Target share (%) of paid spins that lose. Above the natural loss rate, that share is reached
   * by turning would-be wins into losses at the reel stop (see getForcedLossChance). Omitted or
   * at/below the natural rate = the reels play naturally. */
  lossPercent?: number;
  /** Natural loss rate (%) of these weights/pays without any forcing — measured by the admin's
   * simulation and saved with the config, since the forcing chance is derived from it. */
  naturalLossPercent?: number;
}

/** Chance that a paid spin is forced to lose so the total loss rate hits `lossPercent`:
 * natural + (1 - natural) x chance = target. 0 when no target is set or it's at/below natural. */
export function getForcedLossChance(config: SizzlingRtpConfig): number {
  const target = (config.lossPercent ?? 0) / 100;
  const natural = (config.naturalLossPercent ?? 100) / 100;
  if (target <= natural || natural >= 1) return 0;
  return Math.min(1, (target - natural) / (1 - natural));
}

/** True when this grid pays nothing at all and doesn't trigger Free Games, scored with the live
 * config — what a forced-loss reel stop must land on. */
export function isLosingSizzlingGrid(grid: Grid): boolean {
  const config = getSizzlingRtpConfig();
  const evaluation = calculateSpinWin(grid, paytableFrom(config), 1, 1, pureWildPayoutFrom(config.tiers));
  return evaluation.finalWin === 0 && !evaluation.triggeredFreeGames;
}

export function getMixedPays(config: SizzlingRtpConfig): { anyBar: number; anySeven: number } {
  return config.mixedPays ?? { anyBar: ANY_BAR_PAYOUT, anySeven: ANY_SEVEN_PAYOUT };
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-sizzling7s-rtp-config";

/** Default weights/payouts — 90% RTP: Loss ~77.8% of paid spins. Used both as the fallback when nothing's saved yet and by the admin page's
 * "Reset to default" action. */
export function getSizzlingDefaultConfig(): SizzlingRtpConfig {
  return {
    targetRtpPercent: 90.0,
    // Pays are stored in line units (each winning line pays pay x bet / LINE_COST, LINE_COST = 30),
    // i.e. x bet x 30: Bar 2x, Double Bar 2x, Triple Bar 3x, Blue 7 3x, Red 7 10x, Bonus 6x,
    // 3-Wild 4x. Pays are kept small so ~22% of spins can win at 90% RTP.
    tiers: [
      { key: "BAR", frequencyPercent: 29.38, payoutMultiplier: 60 },
      { key: "DOUBLE_BAR", frequencyPercent: 21.71, payoutMultiplier: 60 },
      { key: "TRIPLE_BAR", frequencyPercent: 13.81, payoutMultiplier: 90 },
      { key: "BLUE_7", frequencyPercent: 20.29, payoutMultiplier: 90 },
      { key: "RED_7", frequencyPercent: 12.74, payoutMultiplier: 300 },
      { key: "BONUS", frequencyPercent: 2.05, payoutMultiplier: 180 },
      { key: "WILD_2X", frequencyPercent: 0.02, payoutMultiplier: 120 },
    ],
    // Any 3 Bars 2x, Any 3 Sevens 1x.
    mixedPays: { anyBar: 60, anySeven: 30 },
    // 77.83% of paid spins lose → 90% RTP (natural RTP of these weights/pays ≈ 210.8%, measured
    // by computeSizzlingStats). The natural loss rate (~48.08%) is saved so the forcing chance is
    // known before the admin page has measured anything.
    lossPercent: 77.83,
    naturalLossPercent: 48.08,
  };
}

function isValidTierRow(row: unknown): row is SizzlingTierRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.key === "string" && typeof r.frequencyPercent === "number" && typeof r.payoutMultiplier === "number";
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getSizzlingRtpConfig(): SizzlingRtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getSizzlingDefaultConfig();
    const parsed = JSON.parse(raw) as Partial<SizzlingRtpConfig>;
    if (
      typeof parsed.targetRtpPercent !== "number" ||
      !Array.isArray(parsed.tiers) ||
      parsed.tiers.length === 0 ||
      !parsed.tiers.every(isValidTierRow)
    ) {
      return getSizzlingDefaultConfig();
    }
    return applyHouseRules({
      targetRtpPercent: parsed.targetRtpPercent,
      tiers: parsed.tiers,
      mixedPays: parsed.mixedPays,
      lossPercent: parsed.lossPercent,
      naturalLossPercent: parsed.naturalLossPercent,
    });
  } catch {
    return getSizzlingDefaultConfig();
  }
}

/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet (pays are stored
 * in line units — LINE_COST per 1x) and a target of at most 90%. This game's RTP can only be
 * measured by simulation (too slow to re-fit on every load), so a saved config that breaks these
 * rules is replaced by the default — which already follows them — until the admin re-tunes it
 * (Solve on the RTP page) and saves again. */
function applyHouseRules(config: SizzlingRtpConfig): SizzlingRtpConfig {
  const wholeUnits = (units: number) => wholeXInUnits(units, LINE_COST);
  const mixed = getMixedPays(config);
  const compliant =
    config.targetRtpPercent <= MAX_TARGET_RTP_PERCENT &&
    config.tiers.every((t) => wholeUnits(t.payoutMultiplier) === t.payoutMultiplier) &&
    wholeUnits(mixed.anyBar) === mixed.anyBar &&
    wholeUnits(mixed.anySeven) === mixed.anySeven;
  return compliant ? config : getSizzlingDefaultConfig();
}

/** Persists a new RTP config — takes effect on the very next spin (rollTier-equivalent
 * weighting re-reads this on every call, see symbolWeightsFrom below), no reload or cross-tab
 * wiring needed. Silently no-ops if localStorage isn't available. */
export function setSizzlingRtpConfig(config: SizzlingRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncSizzlingRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("sizzling-7s", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveSizzlingRtpConfigToServer(config: SizzlingRtpConfig): Promise<void> {
  return saveRtpConfigToServer("sizzling-7s", config);
}

/** Admin-configured 3-match payouts (from each symbol's own tier row), falling back to the
 * built-in defaults for any row left unset. WILD_2X's row holds the 3-Wild pure payout only
 * (see pureWildPayoutFrom below) — it has no "3 matching WILD_2X" entry in Paytable itself. */
function paytableFrom(config: SizzlingRtpConfig): Paytable {
  const { anyBar, anySeven } = getMixedPays(config);
  const paytable: Paytable = { ...DEFAULT_PAYTABLE, ANY_BAR: anyBar, ANY_SEVEN: anySeven };
  for (const tier of config.tiers) {
    if (tier.key === WILD_SYMBOL) continue;
    if (tier.key in paytable) (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
  }
  return paytable;
}

/** The admin-editable 3-Wild pure payout, falling back to the spec default. 1/2-Wild stay
 * fixed (not worth their own admin rows) — see config.ts's PURE_WILD_PAYOUT comment. */
function pureWildPayoutFrom(tiers: SizzlingTierRow[]): PureWildPayout {
  const wildRow = tiers.find((t) => t.key === WILD_SYMBOL);
  return { 1: PURE_WILD_PAYOUT[1], 2: PURE_WILD_PAYOUT[2], 3: wildRow?.payoutMultiplier ?? PURE_WILD_PAYOUT[3] };
}

function symbolWeightsFrom(tiers: SizzlingTierRow[]): Partial<Record<SizzlingSymbol, number>> {
  return Object.fromEntries(tiers.map((t) => [t.key, t.frequencyPercent]));
}

/** Scores a client-supplied grid — the reel's own continuous scroll (using the same
 * admin-configured weights, replicated client-side, see pixi/Reel.ts) determines what's
 * showing when the player clicks Stop, and that's what's passed in here to be evaluated/paid.
 * `currentBalance` is the player's balance right before this spin — the new balance (bet
 * deducted, win credited; free spins never deduct) is computed here and returned, mirroring
 * what the old backend endpoint used to do with the DB's own user record. */
export async function spinRequest(
  betLevel: number,
  grid: Grid,
  isFreeSpin: boolean,
  freeGameMultiplierPool: number[] | null,
  currentBalance: number,
  /** A free spin's multiplier, when the caller already drew it (a round's guaranteed last spin
   * picks its landing with this multiplier in hand — see makeFreeSpinWinOf). */
  forcedMultiplier?: number
): Promise<SpinResponse> {
  const rtpConfig = getSizzlingRtpConfig();
  const paytable = paytableFrom(rtpConfig);
  const pureWildPayout = pureWildPayoutFrom(rtpConfig.tiers);

  const totalBet = betLevel;
  const betMultiplier = totalBet / LINE_COST;
  const freeGameMultiplier =
    isFreeSpin && forcedMultiplier !== undefined
      ? forcedMultiplier
      : isFreeSpin && freeGameMultiplierPool
        ? pickFreeSpinMultiplier(freeGameMultiplierPool)
        : 1;

  const evaluation = calculateSpinWin(grid, paytable, betMultiplier, freeGameMultiplier, pureWildPayout);
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;

  const stakedAmount = isFreeSpin ? 0 : totalBet;
  const balance = Math.round((currentBalance - stakedAmount + evaluation.finalWin) * 100) / 100;

  return {
    grid,
    evaluation,
    winAmount: evaluation.finalWin,
    freeGamesAward: freeGamesAward ? { ...freeGamesAward } : null,
    balance,
    meta: { forced: false },
  };
}

// --- Free Games round minimum -------------------------------------------------------------
//
// A round still under its FREE_GAMES_MIN_WIN_X floor going into its last spin (one that doesn't
// retrigger) has that spin land a real winning board: fresh landings are drawn and the
// lowest-paying one that covers the shortfall is used. Only if no draw covers it is the small
// remainder topped up, as a last resort.

/** Fresh landings tried for a short round's last spin. */
const GUARANTEE_ATTEMPTS = 400;

/** Scores a candidate board for a free spin at `betLevel` with its multiplier already drawn. */
export function makeFreeSpinWinOf(betLevel: number, multiplier: number): (grid: Grid) => { win: number; triggers: boolean } {
  const config = getSizzlingRtpConfig();
  const paytable = paytableFrom(config);
  const pureWildPayout = pureWildPayoutFrom(config.tiers);
  const betMultiplier = betLevel / LINE_COST;
  return (grid) => {
    const e = calculateSpinWin(grid, paytable, betMultiplier, multiplier, pureWildPayout);
    return { win: e.finalWin, triggers: e.triggeredFreeGames };
  };
}

/** `natural` if it already covers `need` (or retriggers); otherwise the lowest-paying of up to
 * GUARANTEE_ATTEMPTS fresh draws that covers it — or the best draw seen if none does. */
export function pickCoveringGrid(
  natural: Grid,
  draw: () => Grid,
  winOf: (grid: Grid) => { win: number; triggers: boolean },
  need: number
): Grid {
  const own = winOf(natural);
  if (own.triggers || own.win >= need - 1e-9) return natural;
  let cover: { grid: Grid; win: number } | null = null;
  let best = { grid: natural, win: own.win };
  for (let i = 0; i < GUARANTEE_ATTEMPTS; i++) {
    const grid = draw();
    const r = winOf(grid);
    if (r.triggers) continue;
    if (r.win >= need - 1e-9) {
      if (!cover || r.win < cover.win) cover = { grid, win: r.win };
    } else if (r.win > best.win) {
      best = { grid, win: r.win };
    }
  }
  return (cover ?? best).grid;
}

/** The round's floor for this round, in money — a value in [minX, maxX] x bet, drawn per round. */
export function drawFreeGamesFloor(betLevel: number, rng: () => number = Math.random): number {
  const [minX, maxX] = FREE_GAMES_MIN_WIN_X;
  return (minX + rng() * (maxX - minX)) * betLevel;
}

// --- RTP measurement + solve -------------------------------------------------------------
//
// Simulates the real game with the same winCalc functions spinRequest uses: each reel lands
// either 1 symbol on the middle row or 2 on top+bottom (the strip alternates symbol/blank — see
// pixi/Reel.ts), symbols drawn by the admin weights; Bonus triggers play the full Free Games
// round (awards, Mystery Pick, retriggers, per-spin multipliers) and the round's minimum-win
// floor, exactly as SizzlingSevensGame.tsx plays them.

/** Rounds per measurement — free-games multipliers up to 30x make wins heavy-tailed, so ~2M
 * rounds is what ~1% accuracy costs (run in chunks so the page stays responsive). */
export const SIZZLING_SIMS = 2_000_000;
const CHUNK = 50_000;
const SOLVE_SEED = 0xc0ffee;
/** Safety cap on one Free Games round's length (retriggers can chain). */
const MAX_FREE_SPINS_PER_ROUND = 5000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simGrid(tiers: SizzlingTierRow[], totalWeight: number, rng: () => number): Grid {
  const pick = (): SizzlingSymbol => {
    let roll = rng() * totalWeight;
    for (const t of tiers) {
      roll -= t.frequencyPercent;
      if (roll < 0) return t.key;
    }
    return tiers[tiers.length - 1].key;
  };
  const grid: Grid = [];
  for (let reel = 0; reel < 3; reel++) grid.push(rng() < 0.5 ? [null, pick(), null] : [pick(), null, pick()]);
  return grid;
}

export interface SizzlingStats {
  /** RTP including the forced losses of the config's Loss % (see getForcedLossChance). */
  rtpPercent: number;
  /** Percent of base spins that pay nothing at all, including forced losses. */
  lossPercent: number;
  /** Same two figures with the reels playing naturally (no forced losses). */
  naturalRtpPercent: number;
  naturalLossPercent: number;
  /** Share (%) of paid spins whose biggest win is each combo — a symbol key (3 matching), "ANY_BAR",
   * "ANY_SEVEN", "WILD_2X" (pure Wild) or "BONUS" (scatter) — reels playing naturally. Together with
   * naturalLossPercent these add up to 100. */
  naturalHitPercent: Record<string, number>;
}

/** Which combo a paid spin's biggest single win came from (see SizzlingStats.naturalHitPercent). */
function hitKey(evaluation: ReturnType<typeof calculateSpinWin>): string | null {
  let best: { key: string; amount: number } | null = null;
  for (const w of evaluation.lineWins) {
    const key = w.isPureWild ? "WILD_2X" : w.mixed ?? w.symbol;
    if (!best || w.finalWin > best.amount) best = { key, amount: w.finalWin };
  }
  if (evaluation.scatterWin > 0 && (!best || evaluation.scatterWin > best.amount)) best = { key: "BONUS", amount: evaluation.scatterWin };
  if (!best && evaluation.triggeredFreeGames) return "BONUS";
  return best?.key ?? null;
}

/** Simulates `sims` base spins at a 1-unit bet, each with the full Free Games round it
 * triggers. Seeded, so a given (config, seed) always gives the same numbers. */
export async function computeSizzlingStats(
  config: SizzlingRtpConfig,
  opts: { sims?: number; seed?: number; onProgress?: (fraction: number) => void } = {}
): Promise<SizzlingStats> {
  const sims = opts.sims ?? SIZZLING_SIMS;
  const rng = mulberry32(opts.seed ?? SOLVE_SEED);
  const paytable = paytableFrom(config);
  const pureWildPayout = pureWildPayoutFrom(config.tiers);
  const totalWeight = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const betMultiplier = 1 / LINE_COST;
  const [minX, maxX] = FREE_GAMES_MIN_WIN_X;

  let total = 0;
  let losses = 0;
  const hits: Record<string, number> = {};
  for (let i = 0; i < sims; i++) {
    if (i > 0 && i % CHUNK === 0) {
      opts.onProgress?.(i / sims);
      await new Promise((r) => setTimeout(r, 0));
    }
    const base = calculateSpinWin(simGrid(config.tiers, totalWeight, rng), paytable, betMultiplier, 1, pureWildPayout);
    total += base.finalWin;
    if (base.finalWin === 0 && !base.triggeredFreeGames) losses++;
    else {
      const key = hitKey(base);
      if (key) hits[key] = (hits[key] ?? 0) + 1;
    }
    if (!base.triggeredFreeGames) continue;

    let award = triggerFreeGames(rng);
    let remaining = award.freeSpins;
    let roundWin = 0;
    for (let played = 0; remaining > 0 && played < MAX_FREE_SPINS_PER_ROUND; played++) {
      const multiplier = pickFreeSpinMultiplier(award.multiplierPool, rng);
      let grid = simGrid(config.tiers, totalWeight, rng);
      const winOf = (g: Grid) => {
        const e = calculateSpinWin(g, paytable, betMultiplier, multiplier, pureWildPayout);
        return { win: e.finalWin, triggers: e.triggeredFreeGames };
      };
      let floor = 0;
      if (remaining === 1) {
        // The round's last spin: land a real board that covers the floor, as the game does.
        floor = minX + rng() * (maxX - minX);
        grid = pickCoveringGrid(grid, () => simGrid(config.tiers, totalWeight, rng), winOf, floor - roundWin);
      }
      const spin = calculateSpinWin(grid, paytable, betMultiplier, multiplier, pureWildPayout);
      roundWin += spin.finalWin;
      remaining--;
      if (spin.triggeredFreeGames) {
        award = triggerFreeGames(rng);
        remaining += award.freeSpins;
      } else if (remaining === 0) {
        // Last resort only (no draw covered it): top up the small remainder.
        roundWin = Math.max(roundWin, floor);
      }
    }
    total += roundWin;
  }
  opts.onProgress?.(1);
  const naturalRtpPercent = (total / sims) * 100;
  const naturalLossPercent = (losses / sims) * 100;
  // A forced loss zeroes a random share of the would-be wins (value-independent), so it scales
  // the RTP by exactly (1 - chance) and lifts the loss rate to the target.
  const chance = getForcedLossChance({ ...config, naturalLossPercent });
  return {
    rtpPercent: naturalRtpPercent * (1 - chance),
    lossPercent: naturalLossPercent + (100 - naturalLossPercent) * chance,
    naturalRtpPercent,
    naturalLossPercent,
    naturalHitPercent: Object.fromEntries(Object.entries(hits).map(([k, n]) => [k, (n / sims) * 100])),
  };
}

/** Same tiers with new reel weights, rounded to 2 decimals and summing to exactly 100. */
function withWeights(config: SizzlingRtpConfig, weights: number[]): SizzlingRtpConfig {
  const sum = weights.reduce((a, b) => a + b, 0);
  const rounded = weights.map((w) => Math.max(0.01, Math.round((w / sum) * 10000) / 100));
  const biggest = rounded.indexOf(Math.max(...rounded));
  rounded[biggest] = Math.round((rounded[biggest] + 100 - rounded.reduce((a, b) => a + b, 0)) * 100) / 100;
  return { ...config, tiers: config.tiers.map((t, i) => ({ ...t, frequencyPercent: rounded[i] })) };
}

/**
 * Solves the *reel frequencies* so the game returns `targetRtpPercent` — every pay (symbols,
 * Bonus, 3-Wild, Any Bar / Any 7) and the Loss % stay exactly as set.
 *
 * - Target above the current RTP: shifts weight toward the high-pay symbols along one dial
 *   (weight x pay^-t, t < 0), bisecting t until the RTP matches.
 * - Target below it: first searches for the lowest-RTP weights these pays allow (coordinate
 *   descent), then blends from those back toward the current weights to land on the target. If
 *   even the lowest isn't low enough, returns the lowest with `reachable: false`.
 *
 * Every step measures on one fixed seed (so steps compare cleanly); the result is re-measured
 * on a fresh seed at full size for an honest estimate.
 */
export async function solveSizzlingWeights(
  config: SizzlingRtpConfig,
  targetRtpPercent: number,
  onProgress?: (fraction: number) => void
): Promise<{ config: SizzlingRtpConfig; stats: SizzlingStats; reachable: boolean }> {
  const STEP_SIMS = 120_000;
  /** The bisection homes in on the target, so it measures bigger (less noisy) samples. */
  const BISECT_SIMS = 400_000;
  // Coarse to fine: one pass per row, each trying these multipliers on every symbol's weight.
  const DESCENT_SCHEDULE = [
    [0.5, 0.75, 1.33, 2],
    [0.7, 0.85, 1.18, 1.4],
    [0.88, 0.95, 1.05, 1.12],
  ];
  const BISECT_STEPS = 10;
  const keys = config.tiers.map((t) => t.key);
  const current = config.tiers.map((t) => Math.max(t.frequencyPercent, 0.01));
  const maxPay = Math.max(...config.tiers.map((t) => t.payoutMultiplier), 1);
  const dialPay = config.tiers.map((t) => (t.key === WILD_SYMBOL ? maxPay : Math.max(t.payoutMultiplier, 1)));

  // Progress: a rough budget of quick measurements, plus the final full-size one (~1/3 of the bar).
  const totalSteps = 2 + DESCENT_SCHEDULE.length * keys.length * 4 + BISECT_STEPS;
  let done = 0;
  const tick = () => onProgress?.(Math.min(0.66, (++done / totalSteps) * 0.66));
  const rtpOf = async (weights: number[], sims = STEP_SIMS) => {
    const r = (await computeSizzlingStats(withWeights(config, weights), { sims, seed: SOLVE_SEED })).rtpPercent;
    tick();
    return r;
  };
  const bisect = async (lo: number, hi: number, at: (x: number) => number[], rising: boolean) => {
    for (let i = 0; i < BISECT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      const r = await rtpOf(at(mid), BISECT_SIMS);
      if (r < targetRtpPercent === rising) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2);
  };

  let reachable = true;
  let solved: number[];
  const currentRtp = await rtpOf(current);

  if (targetRtpPercent >= currentRtp) {
    // Up: t from 0 (current) toward -3 (heavily toward the big pays) — RTP rises as t falls.
    const dial = (t: number) => current.map((w, i) => w * Math.pow(dialPay[i], -t));
    const far = await rtpOf(dial(-3));
    if (far < targetRtpPercent) {
      reachable = false;
      solved = dial(-3);
    } else {
      solved = await bisect(0, 1, (x) => dial(-3 * x), true);
    }
  } else {
    // Down: find the lowest-RTP weights, then blend from them toward the current ones. The search
    // starts from whichever is lower: the current weights or the 1/sqrt(pay) shape (which
    // minimises 3-matching pays for a fixed total weight).
    let low = [...current];
    let lowRtp = currentRtp;
    const sqrtShape = dialPay.map((pay) => 1 / Math.sqrt(pay));
    const sqrtRtp = await rtpOf(sqrtShape);
    if (sqrtRtp < lowRtp) {
      low = sqrtShape;
      lowRtp = sqrtRtp;
    }
    for (const factors of DESCENT_SCHEDULE) {
      for (let i = 0; i < keys.length; i++) {
        for (const f of factors) {
          const trial = low.map((w, j) => (j === i ? w * f : w));
          const r = await rtpOf(trial);
          if (r < lowRtp) {
            low = trial;
            lowRtp = r;
          }
        }
      }
    }
    if (lowRtp > targetRtpPercent) {
      reachable = false;
      solved = low;
    } else {
      // x = 0 → lowest weights, x = 1 → current weights; RTP rises with x. Both are put on the
      // same 100% scale first, or the blend would be dominated by whichever has bigger raw numbers.
      const toPercent = (w: number[]) => {
        const sum = w.reduce((a, b) => a + b, 0);
        return w.map((v) => (v / sum) * 100);
      };
      const lowPct = toPercent(low);
      const currentPct = toPercent(current);
      solved = await bisect(0, 1, (x) => lowPct.map((w, i) => w + (currentPct[i] - w) * x), true);
    }
  }

  const result = { ...withWeights(config, solved), targetRtpPercent };
  const stats = await computeSizzlingStats(result, {
    seed: Math.floor(Math.random() * 2 ** 31),
    onProgress: (f) => onProgress?.(0.66 + f * 0.34),
  });
  return { config: result, stats, reachable };
}

export async function getSizzlingSevensConfig(): Promise<SizzlingSevensConfigResponse> {
  const rtpConfig = getSizzlingRtpConfig();
  const wildRow = rtpConfig.tiers.find((t) => t.key === WILD_SYMBOL);

  return {
    meta: {
      id: "sizzling-7s",
      name: "Sizzling 7s",
      description: "Classic 3-reel, 27-line slot with 2X wilds and a Bonus free games feature",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    lineCost: LINE_COST,
    betLevels: BET_LEVELS,
    minBet: BET_LEVELS[0],
    maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    paylineCount: PAYLINES.length,
    paylines: PAYLINES as [number, number, number][],
    paytable: Object.keys(DEFAULT_PAYTABLE).map((key) => {
      const row = rtpConfig.tiers.find((t) => t.key === key);
      return { symbol: key as SizzlingSymbol, payout: row?.payoutMultiplier ?? DEFAULT_PAYTABLE[key as keyof typeof DEFAULT_PAYTABLE] };
    }),
    symbolWeights: symbolWeightsFrom(rtpConfig.tiers),
    anyBarPayout: getMixedPays(rtpConfig).anyBar,
    anySevenPayout: getMixedPays(rtpConfig).anySeven,
    wild: {
      symbol: "WILD_2X",
      multiplierBase: WILD_MULTIPLIER_BASE,
      purePayout: { 1: PURE_WILD_PAYOUT[1], 2: PURE_WILD_PAYOUT[2], 3: wildRow?.payoutMultiplier ?? PURE_WILD_PAYOUT[3] },
    },
    bonus: { symbol: "BONUS", triggerCount: BONUS_TRIGGER_COUNT },
    freeGames: {
      awards: FREE_GAMES_AWARDS.map((a) => ({ freeSpins: a.freeSpins, multiplierPool: a.multiplierPool })),
      mystery: { spinCounts: MYSTERY_SPIN_COUNTS, multiplierPool: MYSTERY_MULTIPLIER_POOL },
    },
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: Cell[][];
  balanceAfter: number;
}): Promise<void> {
  // The backend's validator only accepts symbol strings, so blank slots are logged as "EMPTY".
  const reelSymbols = params.reelSymbols.map((reel) => reel.map((s) => s ?? "EMPTY"));
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/sizzling-7s/spin-log", { ...params, reelSymbols, tier: null });
}
