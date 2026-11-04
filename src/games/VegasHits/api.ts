/**
 * Vegas Hits' RNG, paytable, and balance are all computed entirely in the browser — RTP and odds
 * are configured client-side (see the RTP control below) and every spin resolves locally, on the
 * same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/VegasHits/{config,engine,winCalc}.ts`,
 * using the exact same symbol weights/paytable/wild rules that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["vegas-hits"]`. Kept as the same
 * exported function names/signatures as the old network calls (`spinRequest`,
 * `getVegasHitsConfig`) so `VegasHitsGame.tsx` didn't need type changes — `spinRequest` gains one
 * new parameter (`currentBalance`), the same shape every other already-offline game's
 * `spinRequest` uses.
 *
 * There's no free-games *round* state to track here at all: the server never tracked one either
 * (routes.ts trusted the client's own `isFreeSpin` flag directly, no round document) — free-games
 * remaining/total/Chili-multiplier bookkeeping has always lived entirely in VegasHitsGame.tsx's
 * own React state, one spin at a time, so this file stays a fully stateless, self-contained
 * per-call function, same as Crystal Clover's/Crazy 777's.
 *
 * RTP here can't be computed in closed form (5 overlapping paylines × wild × scatter × a
 * retriggering free-games chain is combinatorially far too large), so it's estimated via a
 * seeded Monte Carlo simulation (computeVegasHitsStats, originally ported from
 * `frontEnd/src/admin/adminApi.ts`). The admin page's Solve scales every payout together to hit
 * the target RTP (solveVegasHitsWeights) by changing symbol weights — pays never change.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/VegasHits/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so Vegas Hits spins show up in
 * the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { MAX_TARGET_RTP_PERCENT, wholeXInUnits } from "../shared/rtpRules";
import { blendFrequencies, solveByBlend } from "../shared/rtpSolve";
import { apiClient } from "../../api/client";

export type VegasHitsSymbol = "GREEN_7" | "DOUBLE_GREEN_7" | "TRIPLE_GREEN_7" | "RED_7" | "BLUE_7" | "WILD" | "BONUS";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. `null` means that reel has
 * no symbol on this row at all — every reel always shows either 1 symbol on the middle row, or 2
 * symbols on the top+bottom rows, never all 3 (same 2-state reel shape as 7 Crystal Clover). */
export type Grid = (VegasHitsSymbol | null)[][];

export type WinTierName = "BIG WIN" | "MEGA WIN" | "JACKPOT";

export interface LineWin {
  lineNumber: number;
  symbol: VegasHitsSymbol;
  wildCount: number;
  basePayout: number;
  betMultiplier: number;
  finalWin: number;
  involvesWild: boolean;
  positions: [number, number][];
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  chiliEligibleWin: number;
  wildWin: number;
  /** Wilds showing anywhere on screen, and what they paid on their own (see wildScatterPayout). */
  wildCount: number;
  wildScatterWin: number;
  chiliMultiplier: number;
  finalWin: number;
  winningPositions: [number, number][];
  triggeredFreeGames: boolean;
}

export interface FreeGamesAward {
  freeSpins: number;
}

export interface SpinResponse {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  tier: WinTierName | null;
  freeGamesAward: FreeGamesAward | null;
  balance: number;
  meta: { forced: boolean };
}

export interface PaytableRow {
  symbol: VegasHitsSymbol;
  payout: number;
}

export interface VegasHitsConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  lineCost: number;
  betLevels: number[];
  minBet: number;
  maxBet: number;
  paylineCount: number;
  paylines: [number, number, number][];
  paytable: PaytableRow[];
  symbolWeights: Partial<Record<VegasHitsSymbol, number>>;
  wild: { symbol: "WILD"; rules: WildRules };
  bonus: { symbol: "BONUS"; triggerCount: number; scatterPayoutMultipleOfBet: number };
  freeGames: { spinsPerTrigger: number; maxTotalFreeSpins: number; chiliMultiplierPool: number[] };
}

// --- Game shape — ported verbatim from backEnd/src/games/VegasHits/config.ts ----------------

const REEL_COUNT = 3;
const ROW_COUNT = 3;

const LINE_COST = 30;
const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

/** The 5 fixed payline patterns — one row index (0/1/2) per reel. */
const PAYLINES: readonly [number, number, number][] = [
  [1, 1, 1], // middle row
  [0, 0, 0], // top row
  [2, 2, 2], // bottom row
  [0, 1, 2], // diagonal: top-left -> center -> bottom-right
  [2, 1, 0], // diagonal: bottom-left -> center -> top-right
];

const WILD_SYMBOL: VegasHitsSymbol = "WILD";
const BONUS_SYMBOL: VegasHitsSymbol = "BONUS";
const WILD_SUBSTITUTES_FOR: VegasHitsSymbol[] = ["GREEN_7", "DOUBLE_GREEN_7", "TRIPLE_GREEN_7", "RED_7", "BLUE_7"];
const WILD_SUB_SET = new Set(WILD_SUBSTITUTES_FOR);

type PayingSymbol = Exclude<VegasHitsSymbol, "WILD" | "BONUS">;
type Paytable = Record<PayingSymbol, number>;

function isPayingSymbol(s: VegasHitsSymbol): s is PayingSymbol {
  return WILD_SUB_SET.has(s);
}

/** Wilds pay wherever they land on screen (no payline needed, blanks don't matter), by how many
 * are showing: 1 = onePureBet, 2 = twoPureBet, 3+ = threePureBet. This is on top of any payline
 * win they also complete as a substitute. Like any Wild win, the Chili Multiplier doesn't apply. */
function wildScatterPayout(wildCount: number, wildRules: WildRules): number {
  if (wildCount <= 0) return 0;
  return wildCount === 1 ? wildRules.onePureBet : wildCount === 2 ? wildRules.twoPureBet : wildRules.threePureBet;
}

function countOnGrid(grid: Grid, symbol: VegasHitsSymbol): number {
  let n = 0;
  for (const col of grid) for (const s of col) if (s === symbol) n++;
  return n;
}

/** 3-matching-symbol payouts (as a multiple of the *line* bet, i.e. before the bet-level scale
 * is applied). */
const DEFAULT_PAYTABLE: Paytable = {
  TRIPLE_GREEN_7: 34 * 30,
  DOUBLE_GREEN_7: 17 * 30,
  GREEN_7: 7 * 30,
  RED_7: 4 * 30,
  BLUE_7: 5 * 30,
};

export interface WildRules {
  onePureBet: number;
  twoPureBet: number;
  threePureBet: number;
  oneCompleteMultiplier: number;
  twoCompleteMultiplier: number;
  anyMixBet: number;
}

// Every pay a whole-number x of the bet (house rule, see shared/rtpRules.ts) — stored x 30.
const DEFAULT_WILD_RULES: WildRules = {
  onePureBet: 1 * 30,
  twoPureBet: 1 * 30,
  threePureBet: 118 * 30,
  oneCompleteMultiplier: 3,
  twoCompleteMultiplier: 6,
  anyMixBet: 1 * 30,
};

const BONUS_TRIGGER_COUNT = 3;
const SCATTER_PAYOUT_MULTIPLE_OF_BET = 1;
const FREE_SPINS_PER_TRIGGER = 7;
const MAX_TOTAL_FREE_SPINS = 700;
const CHILI_MULTIPLIER_POOL = [2, 3, 4, 5, 6, 7];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export type TierKey = VegasHitsSymbol;

export interface VegasHitsTierRow {
  key: TierKey;
  frequencyPercent: number;
  /** null for WILD and BONUS — neither has a direct 3-match payout of its own. */
  payoutMultiplier: number | null;
}

export interface VegasHitsRtpConfig {
  targetRtpPercent: number;
  tiers: VegasHitsTierRow[];
  amountThresholds: { bigWinMin: number; megaWinMin: number; jackpotMin: number };
  reelStateConfig: { centerRowChancePercent: number };
  wildRules: WildRules;
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-vegashits-rtp-config";
export const DEFAULT_VEGASHITS_TARGET_RTP_PERCENT = 85.0;

/** Default odds — whole-number pays with weights solved (by simulation) to the 85% target. */
const BASE_TIERS: VegasHitsTierRow[] = [
  // Whole-number pays (x bet x 30); weights + center-row chance found by solveVegasHitsWeights
  // for the 85% default target.
  { key: "GREEN_7", frequencyPercent: 30.7813, payoutMultiplier: 210 },
  { key: "DOUBLE_GREEN_7", frequencyPercent: 6.9063, payoutMultiplier: 510 },
  { key: "TRIPLE_GREEN_7", frequencyPercent: 1.5859, payoutMultiplier: 1020 },
  { key: "RED_7", frequencyPercent: 26.875, payoutMultiplier: 120 },
  { key: "BLUE_7", frequencyPercent: 26.0937, payoutMultiplier: 150 },
  { key: "WILD", frequencyPercent: 2.0625, payoutMultiplier: null },
  { key: "BONUS", frequencyPercent: 5.6953, payoutMultiplier: null },
];

const BASE_AMOUNT_THRESHOLDS = { bigWinMin: 15, megaWinMin: 35, jackpotMin: 70 };
const BASE_REEL_STATE_CONFIG = { centerRowChancePercent: 60.97 };

export function getVegasHitsDefaultConfig(): VegasHitsRtpConfig {
  return {
    targetRtpPercent: DEFAULT_VEGASHITS_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
    amountThresholds: { ...BASE_AMOUNT_THRESHOLDS },
    reelStateConfig: { ...BASE_REEL_STATE_CONFIG },
    wildRules: { ...DEFAULT_WILD_RULES },
  };
}

function isValidConfig(value: unknown): value is VegasHitsRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0 &&
    typeof v.amountThresholds === "object" &&
    v.amountThresholds !== null &&
    typeof v.reelStateConfig === "object" &&
    v.reelStateConfig !== null &&
    typeof v.wildRules === "object" &&
    v.wildRules !== null
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getVegasHitsRtpConfig(): VegasHitsRtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getVegasHitsDefaultConfig();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidConfig(parsed)) return getVegasHitsDefaultConfig();
    return applyHouseRules(parsed);
  } catch {
    return getVegasHitsDefaultConfig();
  }
}

/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet (stored in line
 * units — LINE_COST per 1x) and a target of at most 90%. RTP here can only be measured by
 * simulation (too slow to re-fit on every load), so a saved config that breaks these rules is
 * replaced by the default — which already follows them — until the admin re-tunes it (Solve on
 * the RTP page) and saves again. */
function applyHouseRules(config: VegasHitsRtpConfig): VegasHitsRtpConfig {
  const whole = (units: number) => wholeXInUnits(units, LINE_COST) === units;
  const w = config.wildRules;
  const compliant =
    config.targetRtpPercent <= MAX_TARGET_RTP_PERCENT &&
    config.tiers.every((t) => t.payoutMultiplier === null || whole(t.payoutMultiplier)) &&
    [w.onePureBet, w.twoPureBet, w.threePureBet, w.anyMixBet].every(whole) &&
    Number.isInteger(w.oneCompleteMultiplier) &&
    Number.isInteger(w.twoCompleteMultiplier);
  return compliant ? config : getVegasHitsDefaultConfig();
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setVegasHitsRtpConfig(config: VegasHitsRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncVegasHitsRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("vegas-hits", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveVegasHitsRtpConfigToServer(config: VegasHitsRtpConfig): Promise<void> {
  return saveRtpConfigToServer("vegas-hits", config);
}

// --- RTP simulation — ported verbatim from frontEnd/src/admin/adminApi.ts's VegasHits mirror -

/** Deterministic seeded PRNG (mulberry32) — keeps the simulated estimate a pure, repeatable
 * function of the config, so the admin page's validation never flickers between renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simWeightedSymbol(tiers: VegasHitsTierRow[], rng: () => number): VegasHitsSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = rng() * total;
  for (const t of tiers) {
    roll -= t.frequencyPercent;
    if (roll < 0) return t.key;
  }
  return tiers[tiers.length - 1].key;
}

function simDrawGrid(tiers: VegasHitsTierRow[], centerRowChancePercent: number, rng: () => number): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const col: (VegasHitsSymbol | null)[] = [null, null, null];
    if (rng() * 100 < centerRowChancePercent) {
      col[1] = simWeightedSymbol(tiers, rng);
    } else {
      col[0] = simWeightedSymbol(tiers, rng);
      col[2] = simWeightedSymbol(tiers, rng);
    }
    grid.push(col);
  }
  return grid;
}

function paytableFrom(tiers: VegasHitsTierRow[]): Paytable {
  const paytable: Paytable = { ...DEFAULT_PAYTABLE };
  for (const tier of tiers) {
    if (tier.key === WILD_SYMBOL || tier.key === BONUS_SYMBOL || tier.payoutMultiplier === null) continue;
    if (tier.key in paytable) (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
  }
  return paytable;
}

/** A payline is exactly 3 stops. Up to 3 candidates, highest wins. Returns [win, involvesWild] —
 * a lightweight pair, not the full LineWin shape the real evaluatePayline below returns (this is
 * the RTP-simulation path, which only needs the numbers, not per-line display detail). */
function simEvaluateLine(grid: Grid, line: readonly [number, number, number], paytable: Paytable, wildRules: WildRules): [number, boolean] {
  const rawSymbols = line.map((row, reel) => grid[reel][row]);
  if (rawSymbols.some((s) => s === null || s === BONUS_SYMBOL)) return [0, false];
  const symbols = rawSymbols as VegasHitsSymbol[];

  const nonWild = symbols.filter((s) => s !== WILD_SYMBOL);
  const wildCount = symbols.length - nonWild.length;

  let candidateA: number | null = null;
  if (nonWild.length > 0 && nonWild.every((s) => s === nonWild[0]) && isPayingSymbol(nonWild[0])) {
    const mult = wildCount === 0 ? 1 : wildCount === 1 ? wildRules.oneCompleteMultiplier : wildRules.twoCompleteMultiplier;
    candidateA = paytable[nonWild[0] as PayingSymbol] * mult;
  }

  const candidateC: number | null = wildCount === 0 && nonWild.length > 0 && !nonWild.every((s) => s === nonWild[0]) ? wildRules.anyMixBet : null;

  const candidates = [candidateA, candidateC].filter((c): c is number => c !== null);
  if (candidates.length === 0) return [0, false];
  return [Math.max(...candidates), wildCount > 0];
}

function simCalculateSpinWin(
  grid: Grid,
  paytable: Paytable,
  wildRules: WildRules,
  chiliMultiplier: number,
  totalBetUnits: number
): { finalWin: number; triggeredFreeGames: boolean } {
  let nonWildTotal = 0;
  let wildTotal = 0;
  for (const line of PAYLINES) {
    const [win, involvesWild] = simEvaluateLine(grid, line, paytable, wildRules);
    if (involvesWild) wildTotal += win;
    else nonWildTotal += win;
  }

  wildTotal += wildScatterPayout(countOnGrid(grid, WILD_SYMBOL), wildRules);

  let scatterCount = 0;
  for (const col of grid) for (const s of col) if (s === BONUS_SYMBOL) scatterCount++;
  const scatterWin = scatterCount >= BONUS_TRIGGER_COUNT ? SCATTER_PAYOUT_MULTIPLE_OF_BET * totalBetUnits : 0;

  const finalWin = (nonWildTotal + scatterWin) * chiliMultiplier + wildTotal;
  return { finalWin, triggeredFreeGames: scatterCount >= BONUS_TRIGGER_COUNT };
}

/** Spins per measurement. Wins here are heavy-tailed (3 Wilds pay 117.5x bet, Wild-completed
 * Triple Green 7s ~200x, Chili multipliers in free games), so ~2M spins is what ~1% accuracy
 * costs (about 1.5s, run in chunks so the page stays responsive). */
export const VEGASHITS_SIMS = 2_000_000;
const CHUNK = 50_000;
const SOLVE_SEED = 0xc0ffee;

export interface VegasHitsStats {
  rtpPercent: number;
  /** Percent of base spins that pay nothing at all — informational. */
  lossPercent: number;
}

/** Runs `sims` simulated rounds (base spin + any free games it triggers) at a 1-unit line bet,
 * seeded so a given (config, seed) always gives the same numbers. Yields to the browser between
 * chunks and reports progress (0..1). */
export async function computeVegasHitsStats(
  config: VegasHitsRtpConfig,
  opts: { sims?: number; seed?: number; onProgress?: (fraction: number) => void } = {}
): Promise<VegasHitsStats> {
  const sims = opts.sims ?? VEGASHITS_SIMS;
  const paytable = paytableFrom(config.tiers);
  const wildRules = config.wildRules;
  const centerRowChancePercent = config.reelStateConfig.centerRowChancePercent;
  const rng = mulberry32(opts.seed ?? SOLVE_SEED);
  const totalBetUnits = LINE_COST;

  let total = 0;
  let lossCount = 0;
  for (let i = 0; i < sims; i++) {
    if (i > 0 && i % CHUNK === 0) {
      opts.onProgress?.(i / sims);
      await new Promise((r) => setTimeout(r, 0));
    }
    const grid = simDrawGrid(config.tiers, centerRowChancePercent, rng);
    const ev = simCalculateSpinWin(grid, paytable, wildRules, 1, totalBetUnits);
    total += ev.finalWin;
    if (ev.finalWin === 0) lossCount++;

    if (ev.triggeredFreeGames) {
      let remaining = FREE_SPINS_PER_TRIGGER;
      let totalAwarded = FREE_SPINS_PER_TRIGGER;
      let played = 0;
      while (remaining > 0 && totalAwarded <= MAX_TOTAL_FREE_SPINS) {
        remaining--;
        played++;
        const freeGrid = simDrawGrid(config.tiers, centerRowChancePercent, rng);
        const chili = CHILI_MULTIPLIER_POOL[Math.floor(rng() * CHILI_MULTIPLIER_POOL.length)];
        const freeEv = simCalculateSpinWin(freeGrid, paytable, wildRules, chili, totalBetUnits);
        total += freeEv.finalWin;
        if (freeEv.triggeredFreeGames && totalAwarded + FREE_SPINS_PER_TRIGGER <= MAX_TOTAL_FREE_SPINS) {
          remaining += FREE_SPINS_PER_TRIGGER;
          totalAwarded += FREE_SPINS_PER_TRIGGER;
        }
        if (played > 5000) break; // safety
      }
    }
  }
  opts.onProgress?.(1);
  return { rtpPercent: (total / LINE_COST / sims) * 100, lossPercent: (lossCount / sims) * 100 };
}

/** Weight shapes the solver slides toward (pays never change — house rule, see
 * shared/rtpRules.ts): `lean` puts the weight on the cheap 7s (most filled lines pay only the 1x
 * Any-Mix) with few Wilds and more center-row stops (fewer filled lines); `rich` leans on the
 * high 7s and Wilds. */
const LEAN_WEIGHTS: Record<VegasHitsSymbol, number> = {
  GREEN_7: 30, DOUBLE_GREEN_7: 3, TRIPLE_GREEN_7: 1, RED_7: 30, BLUE_7: 30, WILD: 0.5, BONUS: 5.5,
};
const LEAN_CENTER_ROW_PERCENT = 68;
const RICH_WEIGHTS: Record<VegasHitsSymbol, number> = {
  GREEN_7: 20, DOUBLE_GREEN_7: 18, TRIPLE_GREEN_7: 8, RED_7: 15, BLUE_7: 15, WILD: 8, BONUS: 6,
};
const RICH_CENTER_ROW_PERCENT = 50;

function withShape(config: VegasHitsRtpConfig, weights: Record<VegasHitsSymbol, number>, centerRow: number): VegasHitsRtpConfig {
  return {
    ...config,
    tiers: config.tiers.map((t) => ({ ...t, frequencyPercent: weights[t.key] ?? t.frequencyPercent })),
    reelStateConfig: { centerRowChancePercent: centerRow },
  };
}

function blendShapes(a: VegasHitsRtpConfig, b: VegasHitsRtpConfig, t: number): VegasHitsRtpConfig {
  const center = a.reelStateConfig.centerRowChancePercent * (1 - t) + b.reelStateConfig.centerRowChancePercent * t;
  return {
    ...a,
    tiers: blendFrequencies(a.tiers, b.tiers, t),
    reelStateConfig: { centerRowChancePercent: Math.round(center * 100) / 100 },
  };
}

/** Spins per solver step — each bisection step only needs to tell "above / below target". */
const SOLVE_STEP_SIMS = 500_000;

/**
 * Finds symbol weights (and the reel's center-row chance) that make the game return
 * `targetRtpPercent` — every pay stays exactly as set. Slides the weights from the current config
 * toward the lean or rich shape above and bisects on a fixed seed; the result is then re-measured
 * on a fresh seed for an honest estimate. `reachable` is false when even the lean/rich end can't
 * get there (the config returned is then that end).
 */
export async function solveVegasHitsWeights(
  config: VegasHitsRtpConfig,
  targetRtpPercent: number,
  onProgress?: (fraction: number) => void
): Promise<{ config: VegasHitsRtpConfig; stats: VegasHitsStats; reachable: boolean }> {
  const solved = await solveByBlend({
    current: config,
    lean: withShape(config, LEAN_WEIGHTS, LEAN_CENTER_ROW_PERCENT),
    rich: withShape(config, RICH_WEIGHTS, RICH_CENTER_ROW_PERCENT),
    blend: blendShapes,
    measure: async (c, progress) => (await computeVegasHitsStats(c, { sims: SOLVE_STEP_SIMS, onProgress: progress })).rtpPercent,
    target: targetRtpPercent,
    tolerance: 0.3,
    onProgress: (f) => onProgress?.(f * 0.75),
  });
  const result = { ...solved.config, targetRtpPercent };
  const stats = await computeVegasHitsStats(result, {
    seed: Math.floor(Math.random() * 2 ** 31),
    onProgress: (f) => onProgress?.(0.75 + f * 0.25),
  });
  return { config: result, stats, reachable: solved.reachable };
}

// --- Win-line logic (real gameplay) — ported verbatim from backEnd/src/games/VegasHits/{engine,winCalc}.ts

function weightedSymbol(tiers: VegasHitsTierRow[]): VegasHitsSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const t of tiers) {
    roll -= t.frequencyPercent;
    if (roll < 0) return t.key;
  }
  return tiers[tiers.length - 1].key;
}

function rollReelState(centerRowChancePercent: number): "CENTER" | "TOP_BOTTOM" {
  return Math.random() * 100 < centerRowChancePercent ? "CENTER" : "TOP_BOTTOM";
}

/** Draws a full grid — each reel independently rolls its 2-state shape and fills only the row(s)
 * that state calls for, each from the same shared weighted symbol table. */
function drawGrid(tiers: VegasHitsTierRow[], centerRowChancePercent: number): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const column: (VegasHitsSymbol | null)[] = new Array(ROW_COUNT).fill(null);
    if (rollReelState(centerRowChancePercent) === "CENTER") {
      column[1] = weightedSymbol(tiers);
    } else {
      column[0] = weightedSymbol(tiers);
      column[2] = weightedSymbol(tiers);
    }
    grid.push(column);
  }
  return grid;
}

function symbolsOnLine(grid: Grid, line: readonly [number, number, number]): (VegasHitsSymbol | null)[] {
  return line.map((row, reel) => grid[reel][row]);
}

/** Evaluates a single payline — mirrors simEvaluateLine's candidate logic exactly, but returns
 * the full LineWin detail the real UI needs (symbol/positions/etc.), not just [win, involvesWild]. */
function evaluatePayline(
  grid: Grid,
  line: readonly [number, number, number],
  lineNumber: number,
  paytable: Paytable,
  wildRules: WildRules,
  betMultiplier: number
): LineWin | null {
  const rawSymbols = symbolsOnLine(grid, line);
  if (rawSymbols.some((s) => s === null || s === BONUS_SYMBOL)) return null;
  const symbols = rawSymbols as VegasHitsSymbol[];

  const nonWild = symbols.filter((s) => s !== WILD_SYMBOL);
  const wildCount = symbols.length - nonWild.length;

  let candidateSymbol: VegasHitsSymbol | null = null;
  let candidateA: number | null = null;
  if (nonWild.length > 0 && nonWild.every((s) => s === nonWild[0]) && isPayingSymbol(nonWild[0])) {
    candidateSymbol = nonWild[0];
    const mult = wildCount === 0 ? 1 : wildCount === 1 ? wildRules.oneCompleteMultiplier : wildRules.twoCompleteMultiplier;
    candidateA = paytable[nonWild[0] as PayingSymbol] * mult;
  }

  const candidateC: number | null = wildCount === 0 && nonWild.length > 0 && !nonWild.every((s) => s === nonWild[0]) ? wildRules.anyMixBet : null;

  const candidates = [candidateA, candidateC].filter((c): c is number => c !== null);
  if (candidates.length === 0) return null;

  const basePayout = Math.max(...candidates);
  const symbol: VegasHitsSymbol = basePayout === candidateA && candidateSymbol ? candidateSymbol : nonWild[0];
  const finalWin = basePayout * betMultiplier;
  const positions: [number, number][] = line.map((row, reel) => [reel, row]);

  return { lineNumber, symbol, wildCount, basePayout, betMultiplier, finalWin, involvesWild: wildCount > 0, positions };
}

function evaluateAllPaylines(grid: Grid, paytable: Paytable, wildRules: WildRules, betMultiplier: number): LineWin[] {
  return PAYLINES.map((line, i) => evaluatePayline(grid, line, i + 1, paytable, wildRules, betMultiplier)).filter(
    (w): w is LineWin => w !== null
  );
}

function calculateScatterWin(grid: Grid, totalBet: number): { scatterCount: number; scatterWin: number } {
  let scatterCount = 0;
  for (const reel of grid) for (const s of reel) if (s === BONUS_SYMBOL) scatterCount++;
  if (scatterCount < BONUS_TRIGGER_COUNT) return { scatterCount, scatterWin: 0 };
  return { scatterCount, scatterWin: SCATTER_PAYOUT_MULTIPLE_OF_BET * totalBet };
}

/** Per the spec, the Chili Multiplier scales every win *except* one a wild substituted into —
 * those keep only their own 3X/9X boost. */
function calculateSpinWin(
  grid: Grid,
  paytable: Paytable,
  wildRules: WildRules,
  betMultiplier: number,
  totalBet: number,
  chiliMultiplier = 1
): SpinEvaluation {
  const lineWins = evaluateAllPaylines(grid, paytable, wildRules, betMultiplier);
  const { scatterCount, scatterWin } = calculateScatterWin(grid, totalBet);

  const chiliEligibleLineWin = lineWins.filter((w) => !w.involvesWild).reduce((sum, w) => sum + w.finalWin, 0);
  const wildCount = countOnGrid(grid, WILD_SYMBOL);
  const wildScatterWin = wildScatterPayout(wildCount, wildRules) * betMultiplier;
  const wildWin = lineWins.filter((w) => w.involvesWild).reduce((sum, w) => sum + w.finalWin, 0) + wildScatterWin;
  const chiliEligibleWin = chiliEligibleLineWin + scatterWin;

  const finalWin = chiliEligibleWin * chiliMultiplier + wildWin;

  const winningPositions: [number, number][] = [];
  for (const w of lineWins) winningPositions.push(...w.positions);
  if (wildScatterWin > 0) {
    grid.forEach((col, reel) =>
      col.forEach((s, row) => {
        if (s === WILD_SYMBOL && !winningPositions.some(([r, w]) => r === reel && w === row)) winningPositions.push([reel, row]);
      })
    );
  }

  return {
    lineWins,
    scatterCount,
    scatterWin,
    chiliEligibleWin,
    wildWin,
    wildCount,
    wildScatterWin,
    chiliMultiplier,
    finalWin,
    winningPositions,
    triggeredFreeGames: scatterCount >= BONUS_TRIGGER_COUNT,
  };
}

/** A Bonus trigger (initial or retrigger) always awards a flat FREE_SPINS_PER_TRIGGER — no
 * variable award pool. The 700-spin lifetime cap is enforced by the caller (VegasHitsGame.tsx's
 * own React state), same as the old backend left it to routes.ts to enforce. */
function triggerFreeGames(): FreeGamesAward {
  return { freeSpins: FREE_SPINS_PER_TRIGGER };
}

/** Draws this free spin's Chili Multiplier — fresh every spin, uniform over the fixed 2X-7X pool. */
function pickChiliMultiplier(): number {
  return CHILI_MULTIPLIER_POOL[Math.floor(Math.random() * CHILI_MULTIPLIER_POOL.length)];
}

function celebrationTier(finalWin: number, totalBet: number, thresholds: VegasHitsRtpConfig["amountThresholds"]): WinTierName | null {
  const multiple = totalBet > 0 ? finalWin / totalBet : 0;
  if (multiple >= thresholds.jackpotMin) return "JACKPOT";
  if (multiple >= thresholds.megaWinMin) return "MEGA WIN";
  if (multiple >= thresholds.bigWinMin) return "BIG WIN";
  return null;
}

/** Runs one local, server-equivalent spin: the grid is drawn fresh, then scored — same algorithm
 * as the old backend's engine.ts. `betLevel` is the real total bet (0.10-30); the paytable's own
 * numbers are expressed relative to the fixed LINE_COST reference, so the scale factor actually
 * fed into the win-calc functions is betLevel/LINE_COST. `isFreeSpin` true draws a fresh Chili
 * Multiplier and applies it per the spec's exception. `currentBalance` is the player's balance
 * right before this spin — the new balance (bet deducted, win credited) is computed here and
 * returned. Resolves on the same tick (no network involved), kept as an async function purely so
 * call sites can keep using `await spinRequest(...)` unchanged. */
export async function spinRequest(betLevel: number, isFreeSpin: boolean, currentBalance = 0, forceBonus = false): Promise<SpinResponse> {
  const config = getVegasHitsRtpConfig();
  const totalBet = betLevel;
  const betMultiplier = totalBet / LINE_COST;

  const grid = drawGrid(config.tiers, config.reelStateConfig.centerRowChancePercent);
  // Testing aid (see VegasHitsGame.tsx's FORCE_FREE_GAMES): a BONUS on every reel's first filled
  // row, so 3 BONUS always land and Free Games trigger.
  if (forceBonus) {
    for (const col of grid) {
      const row = col.findIndex((s) => s !== null);
      if (row >= 0) col[row] = BONUS_SYMBOL;
    }
  }
  const chiliMultiplier = isFreeSpin ? pickChiliMultiplier() : 1;
  const paytable = paytableFrom(config.tiers);
  const evaluation = calculateSpinWin(grid, paytable, config.wildRules, betMultiplier, totalBet, chiliMultiplier);
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;
  const tier = celebrationTier(evaluation.finalWin, totalBet, config.amountThresholds);

  const stakedAmount = isFreeSpin ? 0 : totalBet;
  const balance = Math.round((currentBalance - stakedAmount + evaluation.finalWin) * 100) / 100;

  return { grid, evaluation, winAmount: evaluation.finalWin, tier, freeGamesAward, balance, meta: { forced: false } };
}

export async function getVegasHitsConfig(): Promise<VegasHitsConfigResponse> {
  const config = getVegasHitsRtpConfig();

  const paytable: PaytableRow[] = (Object.keys(DEFAULT_PAYTABLE) as PayingSymbol[]).map((key) => {
    const row = config.tiers.find((t) => t.key === key);
    return { symbol: key, payout: row?.payoutMultiplier ?? DEFAULT_PAYTABLE[key] };
  });
  const symbolWeights = Object.fromEntries(config.tiers.map((t) => [t.key, t.frequencyPercent]));

  return {
    meta: {
      id: "vegas-hits",
      name: "Vegas Hits",
      description: "Classic 3-reel, 5-line RED HOT 3X slot with a 9X wild multiplier and a Chili-multiplier Free Games feature",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    lineCost: LINE_COST,
    betLevels: BET_LEVELS,
    minBet: BET_LEVELS[0],
    maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    paylineCount: PAYLINES.length,
    paylines: PAYLINES as [number, number, number][],
    paytable,
    symbolWeights,
    wild: { symbol: "WILD", rules: config.wildRules },
    bonus: { symbol: "BONUS", triggerCount: BONUS_TRIGGER_COUNT, scatterPayoutMultipleOfBet: SCATTER_PAYOUT_MULTIPLE_OF_BET },
    freeGames: { spinsPerTrigger: FREE_SPINS_PER_TRIGGER, maxTotalFreeSpins: MAX_TOTAL_FREE_SPINS, chiliMultiplierPool: CHILI_MULTIPLIER_POOL },
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: Grid;
  balanceAfter: number;
  tier: WinTierName | null;
}): Promise<void> {
  await apiClient.post("/api/games/vegas-hits/spin-log", params);
}
