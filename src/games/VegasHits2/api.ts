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
 * the target RTP (solveVegasHitsPays) — RTP is linear in the pays, so that lands precisely.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/VegasHits/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so Vegas Hits spins show up in
 * the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { apiClient } from "../../api/client";

export type VegasHitsSymbol = "GREEN_7" | "DOUBLE_GREEN_7" | "TRIPLE_GREEN_7" | "RED_7" | "BLUE_7" | "WILD" | "BONUS";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. `null` means that reel has
 * no symbol on this row at all — every reel always shows either 1 symbol on the middle row, or 2
 * symbols on the top+bottom rows, never all 3 (same 2-state reel shape as 7 Crystal Clover). */
export type Grid = (VegasHitsSymbol | null)[][];

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
const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];

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
  TRIPLE_GREEN_7: 23.5 * 30,
  DOUBLE_GREEN_7: 11.75 * 30,
  GREEN_7: 4.7 * 30,
  RED_7: 2.82 * 30,
  BLUE_7: 3.525 * 30,
};

export interface WildRules {
  onePureBet: number;
  twoPureBet: number;
  threePureBet: number;
  oneCompleteMultiplier: number;
  twoCompleteMultiplier: number;
  anyMixBet: number;
}

const DEFAULT_WILD_RULES: WildRules = {
  onePureBet: 0.47 * 30,
  twoPureBet: 1.41 * 30,
  threePureBet: 117.5 * 30,
  oneCompleteMultiplier: 3,
  twoCompleteMultiplier: 6,
  anyMixBet: 0.705 * 30,
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
  reelStateConfig: { centerRowChancePercent: number };
  wildRules: WildRules;
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-vegashits-rtp-config";
export const DEFAULT_VEGASHITS_TARGET_RTP_PERCENT = 85.0;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["vegas-hits"] — the actual live odds
 * this game shipped with, a hand-picked baseline (targeted search, confirmed by simulation)
 * landing at ~85% RTP at this payout scale. */
const BASE_TIERS: VegasHitsTierRow[] = [
  { key: "GREEN_7", frequencyPercent: 32, payoutMultiplier: 205.6 },
  { key: "DOUBLE_GREEN_7", frequencyPercent: 13, payoutMultiplier: 514 },
  { key: "TRIPLE_GREEN_7", frequencyPercent: 2.5, payoutMultiplier: 1028 },
  { key: "RED_7", frequencyPercent: 22, payoutMultiplier: 123.36 },
  { key: "BLUE_7", frequencyPercent: 20, payoutMultiplier: 154.2 },
  { key: "WILD", frequencyPercent: 4.5, payoutMultiplier: null },
  { key: "BONUS", frequencyPercent: 6, payoutMultiplier: null },
];

const BASE_REEL_STATE_CONFIG = { centerRowChancePercent: 50 };

export function getVegasHitsDefaultConfig(): VegasHitsRtpConfig {
  return {
    targetRtpPercent: DEFAULT_VEGASHITS_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
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
    return parsed;
  } catch {
    return getVegasHitsDefaultConfig();
  }
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
      let roundWin = 0;
      while (remaining > 0 && totalAwarded <= MAX_TOTAL_FREE_SPINS) {
        remaining--;
        played++;
        let freeGrid = simDrawGrid(config.tiers, centerRowChancePercent, rng);
        const chili = CHILI_MULTIPLIER_POOL[Math.floor(rng() * CHILI_MULTIPLIER_POOL.length)];
        let freeEv = simCalculateSpinWin(freeGrid, paytable, wildRules, chili, totalBetUnits);
        // The round's last spin, still short of the round minimum → a real line that covers it.
        const shortfall = FREE_SPIN_ROUND_MIN_WIN_X * totalBetUnits - roundWin;
        if (remaining === 0 && !freeEv.triggeredFreeGames && shortfall > 1e-9 && freeEv.finalWin < shortfall - 1e-9) {
          freeGrid = guaranteedLineGrid(shortfall, (g) => simCalculateSpinWin(g, paytable, wildRules, chili, totalBetUnits).finalWin);
          freeEv = simCalculateSpinWin(freeGrid, paytable, wildRules, chili, totalBetUnits);
        }
        roundWin += freeEv.finalWin;
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

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Every payout scaled by `factor`: the 5 symbol pays and the Wild rules' 4 flat pays. The Wild
 * "completes a match" ratios, the Bonus scatter pay and the symbol weights stay as they are. */
export function scaleVegasHitsPays(config: VegasHitsRtpConfig, factor: number): VegasHitsRtpConfig {
  const w = config.wildRules;
  return {
    ...config,
    tiers: config.tiers.map((t) => (t.payoutMultiplier === null ? t : { ...t, payoutMultiplier: round2(t.payoutMultiplier * factor) })),
    wildRules: {
      ...w,
      onePureBet: round2(w.onePureBet * factor),
      twoPureBet: round2(w.twoPureBet * factor),
      threePureBet: round2(w.threePureBet * factor),
      anyMixBet: round2(w.anyMixBet * factor),
    },
  };
}

/**
 * Scales every payout so the game returns `targetRtpPercent`, keeping their proportions and the
 * symbol weights. With a fixed seed every simulated spin lands the same board whatever the pays,
 * so RTP is exactly linear in the scale: RTP(f) = f * A + B, where B is the Bonus scatter's flat
 * pay (the one win that doesn't scale). Measuring f=1 and f=0 on the same seed gives A and B
 * exactly; the result is then re-measured on a fresh seed for an honest estimate.
 */
export async function solveVegasHitsPays(
  config: VegasHitsRtpConfig,
  targetRtpPercent: number,
  onProgress?: (fraction: number) => void
): Promise<{ config: VegasHitsRtpConfig; stats: VegasHitsStats }> {
  const part = (from: number) => (f: number) => onProgress?.((from + f) / 4);
  const atOne = (await computeVegasHitsStats(config, { onProgress: part(0) })).rtpPercent;
  const atZero = (await computeVegasHitsStats(scaleVegasHitsPays(config, 0), { onProgress: part(1) })).rtpPercent;
  let factor = atOne > atZero ? Math.max(0, (targetRtpPercent - atZero) / (atOne - atZero)) : 1;
  // The free-spin round minimum (a forced line when a round would end under 1x) isn't linear in
  // the pays, so check the solved pays on the same seed and correct once from there.
  const atFactor = (await computeVegasHitsStats(scaleVegasHitsPays(config, factor), { onProgress: part(2) })).rtpPercent;
  if (factor > 0 && atFactor > atZero) factor = Math.max(0, (factor * (targetRtpPercent - atZero)) / (atFactor - atZero));
  const solved = { ...scaleVegasHitsPays(config, factor), targetRtpPercent };
  const stats = await computeVegasHitsStats(solved, { seed: Math.floor(Math.random() * 2 ** 31), onProgress: part(3) });
  return { config: solved, stats };
}

// --- Free-spin round minimum ---------------------------------------------------------------

/** Every free-games round pays at least this x of its bet in total. */
export const FREE_SPIN_ROUND_MIN_WIN_X = 1;

/** Middle-row patterns a forced spin can land, each a real win: any mix of 7s, or 3 of one 7. */
const GUARANTEE_LINES: [VegasHitsSymbol, VegasHitsSymbol, VegasHitsSymbol][] = [
  ["GREEN_7", "RED_7", "BLUE_7"],
  ...WILD_SUBSTITUTES_FOR.map((s) => [s, s, s] as [VegasHitsSymbol, VegasHitsSymbol, VegasHitsSymbol]),
];

/** A grid with one winning line on the middle row (every reel showing just its center symbol, so
 * no other line can form) — the lowest-paying pattern whose win (`winOf`, which already applies
 * this spin's Chili Multiplier) covers `shortfall`, or the best one if none does. Shared by
 * spinRequest and the RTP simulator so the admin's measured RTP includes it. */
function guaranteedLineGrid(shortfall: number, winOf: (grid: Grid) => number): Grid {
  const options = GUARANTEE_LINES.map((line) => {
    const grid: Grid = line.map((s) => [null, s, null]);
    return { grid, win: winOf(grid) };
  }).sort((a, b) => a.win - b.win);
  return (options.find((o) => o.win >= shortfall - 1e-9) ?? options[options.length - 1]).grid;
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

/** Runs one local, server-equivalent spin: the grid is drawn fresh, then scored — same algorithm
 * as the old backend's engine.ts. `betLevel` is the real total bet (0.10-30); the paytable's own
 * numbers are expressed relative to the fixed LINE_COST reference, so the scale factor actually
 * fed into the win-calc functions is betLevel/LINE_COST. `isFreeSpin` true draws a fresh Chili
 * Multiplier and applies it per the spec's exception. `currentBalance` is the player's balance
 * right before this spin — the new balance (bet deducted, win credited) is computed here and
 * returned. Resolves on the same tick (no network involved), kept as an async function purely so
 * call sites can keep using `await spinRequest(...)` unchanged. */
export async function spinRequest(
  betLevel: number,
  isFreeSpin: boolean,
  currentBalance = 0,
  forceBonus = false,
  /** The round's last free spin only: how much the round is still short of its minimum. */
  guaranteeShortfall = 0
): Promise<SpinResponse> {
  const config = getVegasHitsRtpConfig();
  const totalBet = betLevel;
  const betMultiplier = totalBet / LINE_COST;

  let grid = drawGrid(config.tiers, config.reelStateConfig.centerRowChancePercent);
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
  let evaluation = calculateSpinWin(grid, paytable, config.wildRules, betMultiplier, totalBet, chiliMultiplier);
  if (isFreeSpin && guaranteeShortfall > 0 && !evaluation.triggeredFreeGames && evaluation.finalWin < guaranteeShortfall - 1e-9) {
    const winOf = (g: Grid) => calculateSpinWin(g, paytable, config.wildRules, betMultiplier, totalBet, chiliMultiplier).finalWin;
    grid = guaranteedLineGrid(guaranteeShortfall, winOf);
    evaluation = calculateSpinWin(grid, paytable, config.wildRules, betMultiplier, totalBet, chiliMultiplier);
  }
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;

  const stakedAmount = isFreeSpin ? 0 : totalBet;
  const balance = Math.round((currentBalance - stakedAmount + evaluation.finalWin) * 100) / 100;

  return { grid, evaluation, winAmount: evaluation.finalWin, freeGamesAward, balance, meta: { forced: false } };
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
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/vegas-hits/spin-log", { ...params, tier: null });
}
