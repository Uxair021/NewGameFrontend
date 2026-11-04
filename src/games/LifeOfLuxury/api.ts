/**
 * Life of Luxury's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/LifeOfLuxury/{config,winCalc,engine}.ts`
 * and `backEnd/src/games/LifeOfLuxury/routes.ts`'s free-spin-round bookkeeping, using the exact
 * same tier weights/symbol payouts/scatter rules that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["life-of-luxury"]`. Kept as the same
 * exported function names/signatures as the old network calls (`getLifeOfLuxuryConfig`) so
 * `LifeOfLuxuryGame.tsx` didn't need type changes — `spinRequest` gains one new parameter
 * (`currentBalance`), the same shape SizzlingSevens' already-offline `spinRequest` uses, since this
 * game's `SpinResponse` (like Sizzling's, unlike Buffalo777's) already carries a `balance` field.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/LifeOfLuxury/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so Life of Luxury spins
 * show up in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It
 * never influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { MAX_TARGET_RTP_PERCENT, wholeX } from "../shared/rtpRules";
import { blendFrequencies, solveByBlend } from "../shared/rtpSolve";
import { apiClient } from "../../api/client";

export type LifeOfLuxurySymbol =
  | "AEROPLANE"
  | "BOAT"
  | "CAR"
  | "RING"
  | "MONEY"
  | "WATCH"
  | "GOLD_BAR"
  | "SILVER_BAR"
  | "BRONZE_BAR"
  | "WILD"
  | "COIN";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. Every cell is always
 * filled (plain classic 5x3 grid). */
export type Grid = LifeOfLuxurySymbol[][];

export interface LineWin {
  lineNumber: number;
  symbol: Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">;
  count: 3 | 4 | 5;
  multiplier: number;
  finalWin: number;
  positions: [number, number][];
}

export interface ScatterResult {
  count: number;
  win: number;
  positions: [number, number][];
  triggered: boolean;
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  scatter: ScatterResult;
  finalWin: number;
  winningPositions: [number, number][];
}

export interface SpinResponse {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  /** Present only for a base (non-free) spin's Coin trigger — a coin during an already-active
   * free-spins round still pays its scatter cash prize but never re-awards more free spins. */
  freeSpinsAwarded: number | null;
  /** Present only on the free spin that finishes the round — "total win × wilds seen across the
   * round" bonus (see the module-level `activeRound` bookkeeping below). bonusWin is already
   * folded into `balance` above; totalWin is the round's pre-bonus sum for display. */
  freeSpinRoundResult: {
    totalWin: number;
    wildCount: number;
    multiplier: number;
    bonusWin: number;
    finalWin: number;
  } | null;
  balance: number;
  meta: { forced: boolean };
}

export interface SymbolPayoutRow {
  symbol: Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">;
  x3: number;
  x4: number;
  x5: number;
}

export interface ScatterConfig {
  symbol: "COIN";
  triggerCount: number;
  /** Coin's own independent per-cell chance (0-100) — separate from the reel-strip weights. */
  chancePercent: number;
  x3: number;
  x4: number;
  x5: number;
  freeSpinsAwarded: number;
}

export interface LifeOfLuxuryConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  lineCount: number;
  betLevels: number[];
  minBet: number;
  maxBet: number;
  paylines: [number, number, number, number, number][];
  symbolPayouts: SymbolPayoutRow[];
  symbolWeights: Partial<Record<LifeOfLuxurySymbol, number>>;
  scatter: ScatterConfig;
}

// --- Game shape — ported verbatim from backEnd/src/games/LifeOfLuxury/config.ts -------------

type RegularSymbol = Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">;

const REGULAR_SYMBOLS: RegularSymbol[] = [
  "AEROPLANE",
  "BOAT",
  "CAR",
  "RING",
  "MONEY",
  "WATCH",
  "GOLD_BAR",
  "SILVER_BAR",
  "BRONZE_BAR",
];

const WILD_SYMBOL: LifeOfLuxurySymbol = "WILD";
const SCATTER_SYMBOL: LifeOfLuxurySymbol = "COIN";

/** 0-indexed reels the wild is allowed to land on — reels 2/3/4 in player-facing (1-indexed)
 * terms, never reel 1 or reel 5. */
const WILD_ALLOWED_REELS: readonly number[] = [1, 2, 3];

const REEL_COUNT = 5;
const ROW_COUNT = 3;
const LINE_COUNT = 15;
const SCATTER_TRIGGER_COUNT = 3;

const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

/** The 15 fixed payline patterns — one row index (0=top/1=mid/2=bottom) per reel. */
const PAYLINES: [number, number, number, number, number][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [2, 1, 0, 1, 2],
  [0, 1, 2, 1, 0],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------
//
// Mirrors the exact data model Buffalo777's AdminBuffaloRtpPage.tsx uses (a `targetRtpPercent`
// plus admin-edited rows), adapted to this game's richer shape — weight (`tiers`) and payout
// (`symbolPayouts`) are two independent tables here, unlike Buffalo's single `TierRow`, which is
// also why (unlike Buffalo's page) there's no "auto-rescale to target" button: there's no single
// well-defined lever to scale (weights? payouts? both?), so Target RTP is a validated number the
// admin tunes toward manually while watching the live "Effective RTP" readout, same as they'd
// have to for any Save-blocked mismatch. Persisted to localStorage instead of the server; the
// saved config *is* the live odds `drawGrid`/`calculateSpinWin` read below —
// there's no separate "base table" once something's been saved.

export interface LifeOfLuxuryRtpConfig {
  targetRtpPercent: number;
  /** 9 regular symbols + WILD, summing to 100% — reel-strip draw weight only. COIN is
   * deliberately not a row here: it's rolled as its own independent per-cell chance
   * (scatterRules.chancePercent), never a share of this table. */
  tiers: { key: LifeOfLuxurySymbol; frequencyPercent: number }[];
  symbolPayouts: Record<RegularSymbol, { x3: number; x4: number; x5: number }>;
  scatterRules: { chancePercent: number; x3: number; x4: number; x5: number; freeSpinsAwarded: number };
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-lifeofluxury-rtp-config";
export const DEFAULT_LOL_TARGET_RTP_PERCENT = 90;

/** Default reel-strip weights (9 symbols + WILD), summing to 100. */
const BASE_TIERS: { key: LifeOfLuxurySymbol; frequencyPercent: number }[] = [
  // Spread fairly evenly (few Wilds) so ~76% of spins lose, with the Coin chance below set so
  // the default pays return the 90% target — measured by simulation.
  { key: "AEROPLANE", frequencyPercent: 4.1451 },
  { key: "BOAT", frequencyPercent: 6.2176 },
  { key: "CAR", frequencyPercent: 9.3264 },
  { key: "RING", frequencyPercent: 11.399 },
  { key: "MONEY", frequencyPercent: 12.4352 },
  { key: "WATCH", frequencyPercent: 12.4352 },
  { key: "GOLD_BAR", frequencyPercent: 13.4715 },
  { key: "SILVER_BAR", frequencyPercent: 13.4715 },
  { key: "BRONZE_BAR", frequencyPercent: 13.4716 },
  { key: "WILD", frequencyPercent: 3.6269 },
];

const DEFAULT_SYMBOL_PAYOUTS: Record<RegularSymbol, { x3: number; x4: number; x5: number }> = {
  // Whole-number x of the bet per line (house rule, see shared/rtpRules.ts).
  AEROPLANE: { x3: 3, x4: 27, x5: 270 },
  BOAT: { x3: 2, x4: 11, x5: 54 },
  CAR: { x3: 1, x4: 5, x5: 27 },
  RING: { x3: 1, x4: 4, x5: 11 },
  MONEY: { x3: 1, x4: 3, x5: 11 },
  WATCH: { x3: 1, x4: 2, x5: 8 },
  GOLD_BAR: { x3: 1, x4: 2, x5: 8 },
  SILVER_BAR: { x3: 1, x4: 1, x5: 6 },
  BRONZE_BAR: { x3: 1, x4: 1, x5: 5 },
};

const DEFAULT_SCATTER_RULES = { chancePercent: 3.9, x3: 1, x4: 3, x5: 19, freeSpinsAwarded: 10 };

export function getLifeOfLuxuryDefaultConfig(): LifeOfLuxuryRtpConfig {
  return {
    targetRtpPercent: DEFAULT_LOL_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
    symbolPayouts: Object.fromEntries(
      Object.entries(DEFAULT_SYMBOL_PAYOUTS).map(([k, v]) => [k, { ...v }])
    ) as Record<RegularSymbol, { x3: number; x4: number; x5: number }>,
    scatterRules: { ...DEFAULT_SCATTER_RULES },
  };
}

function isValidConfig(value: unknown): value is LifeOfLuxuryRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0 &&
    typeof v.symbolPayouts === "object" &&
    v.symbolPayouts !== null &&
    typeof v.scatterRules === "object" &&
    v.scatterRules !== null
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getLifeOfLuxuryRtpConfig(): LifeOfLuxuryRtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getLifeOfLuxuryDefaultConfig();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidConfig(parsed)) return getLifeOfLuxuryDefaultConfig();
    return applyHouseRules(parsed);
  } catch {
    return getLifeOfLuxuryDefaultConfig();
  }
}

/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet and a target of at
 * most 90%. RTP here can only be measured by simulation (too slow to re-fit on every load), so a
 * saved config that breaks these rules is replaced by the default — which already follows them —
 * until the admin re-tunes it (Solve on the RTP page) and saves again. */
function applyHouseRules(config: LifeOfLuxuryRtpConfig): LifeOfLuxuryRtpConfig {
  const whole = (x: number) => wholeX(x) === x;
  const pays = Object.values(config.symbolPayouts).flatMap((p) => [p.x3, p.x4, p.x5]);
  const { x3, x4, x5 } = config.scatterRules;
  const compliant = config.targetRtpPercent <= MAX_TARGET_RTP_PERCENT && [...pays, x3, x4, x5].every(whole);
  return compliant ? config : getLifeOfLuxuryDefaultConfig();
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setLifeOfLuxuryRtpConfig(config: LifeOfLuxuryRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncLifeOfLuxuryRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("life-of-luxury", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveLifeOfLuxuryRtpConfigToServer(config: LifeOfLuxuryRtpConfig): Promise<void> {
  return saveRtpConfigToServer("life-of-luxury", config);
}

// --- RTP measurement + solve ----------------------------------------------------------------
//
// RTP is measured by simulating whole rounds with the game's own drawGrid/calculateSpinWin: a
// closed form can't capture the round-end wild bonus exactly (bonus = round total × wilds seen,
// and the wilds that raise the multiplier also create the line wins it multiplies).

/** Rounds per measurement. The wild bonus multiplies a whole free-spins round by ~10x, so wins
 * are heavy-tailed and ~2M rounds is what ~1% accuracy costs (run in chunks so the page stays
 * responsive). */
export const LOL_SIMS = 2_000_000;
const CHUNK = 25_000;

/** Deterministic seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LifeOfLuxuryStats {
  rtpPercent: number;
  /** Percent of base spins that pay nothing at all — informational. */
  lossPercent: number;
}

/** Simulates `sims` base spins at a 1-unit bet, each with the full free-spins round (and its
 * round-end wild bonus) it triggers, exactly as spinRequest plays them. Seeded, so a given
 * (config, seed) always gives the same numbers. */
export async function computeLifeOfLuxuryStats(
  config: LifeOfLuxuryRtpConfig,
  opts: { sims?: number; seed?: number; onProgress?: (fraction: number) => void } = {}
): Promise<LifeOfLuxuryStats> {
  const sims = opts.sims ?? LOL_SIMS;
  const rng = mulberry32(opts.seed ?? 0xc0ffee);
  const { tiers, symbolPayouts, scatterRules } = config;
  let total = 0;
  let losses = 0;
  for (let i = 0; i < sims; i++) {
    if (i > 0 && i % CHUNK === 0) {
      opts.onProgress?.(i / sims);
      await new Promise((r) => setTimeout(r, 0));
    }
    const base = calculateSpinWin(drawGrid(tiers, scatterRules.chancePercent, rng), symbolPayouts, 1, scatterRules);
    total += base.finalWin;
    if (base.finalWin === 0) losses++;
    if (!base.scatter.triggered) continue;

    let roundWin = 0;
    let wilds = 0;
    for (let k = 0; k < scatterRules.freeSpinsAwarded; k++) {
      let grid = drawGrid(tiers, scatterRules.chancePercent, rng);
      if (k === scatterRules.freeSpinsAwarded - 1) grid = applyRoundMinimum(grid, config, 1, roundWin, wilds);
      wilds += countWilds(grid);
      roundWin += calculateSpinWin(grid, symbolPayouts, 1, scatterRules).finalWin;
    }
    total += roundWin + roundWin * wilds;
  }
  opts.onProgress?.(1);
  return { rtpPercent: (total / sims) * 100, lossPercent: (losses / sims) * 100 };
}

/** Weight shapes the solver slides toward (pays never change — house rule, see
 * shared/rtpRules.ts): `lean` puts the weight on the cheap symbols with few Wilds and fewer Coins;
 * `rich` leans on the big symbols and Wilds. */
const LEAN_WEIGHTS: Record<LifeOfLuxurySymbol, number> = {
  AEROPLANE: 4, BOAT: 6, CAR: 8, RING: 10, MONEY: 12, WATCH: 13, GOLD_BAR: 14, SILVER_BAR: 16, BRONZE_BAR: 16.5, WILD: 0.5,
  COIN: 0,
};
const LEAN_COIN_PERCENT = 2;
const RICH_WEIGHTS: Record<LifeOfLuxurySymbol, number> = {
  AEROPLANE: 3, BOAT: 6, CAR: 8, RING: 12, MONEY: 12, WATCH: 12, GOLD_BAR: 12, SILVER_BAR: 12, BRONZE_BAR: 12, WILD: 11,
  COIN: 0,
};
const RICH_COIN_PERCENT = 4;

function withShape(config: LifeOfLuxuryRtpConfig, weights: Record<LifeOfLuxurySymbol, number>, coinPercent: number): LifeOfLuxuryRtpConfig {
  return {
    ...config,
    tiers: config.tiers.map((t) => ({ ...t, frequencyPercent: weights[t.key] ?? t.frequencyPercent })),
    scatterRules: { ...config.scatterRules, chancePercent: coinPercent },
  };
}

function blendShapes(a: LifeOfLuxuryRtpConfig, b: LifeOfLuxuryRtpConfig, t: number): LifeOfLuxuryRtpConfig {
  const coin = a.scatterRules.chancePercent * (1 - t) + b.scatterRules.chancePercent * t;
  return {
    ...a,
    tiers: blendFrequencies(a.tiers, b.tiers, t),
    scatterRules: { ...a.scatterRules, chancePercent: Math.round(coin * 100) / 100 },
  };
}

/** Rounds per solver step — each bisection step only needs to tell "above / below target". */
const SOLVE_STEP_SIMS = 400_000;

/**
 * Finds reel weights (and the Coin chance) that make the game return `targetRtpPercent` — every
 * pay stays exactly as set. Slides the weights from the current config toward the lean or rich
 * shape above and bisects on a fixed seed; the result is then re-measured on a fresh seed for an
 * honest estimate. `reachable` is false when even the lean/rich end can't get there.
 */
export async function solveLifeOfLuxuryWeights(
  config: LifeOfLuxuryRtpConfig,
  targetRtpPercent: number,
  onProgress?: (fraction: number) => void
): Promise<{ config: LifeOfLuxuryRtpConfig; stats: LifeOfLuxuryStats; reachable: boolean }> {
  const solved = await solveByBlend({
    current: config,
    lean: withShape(config, LEAN_WEIGHTS, LEAN_COIN_PERCENT),
    rich: withShape(config, RICH_WEIGHTS, RICH_COIN_PERCENT),
    blend: blendShapes,
    measure: async (c, progress) => (await computeLifeOfLuxuryStats(c, { sims: SOLVE_STEP_SIMS, onProgress: progress })).rtpPercent,
    target: targetRtpPercent,
    tolerance: 0.3,
    onProgress: (f) => onProgress?.(f * 0.75),
  });
  const result = { ...solved.config, targetRtpPercent };
  const stats = await computeLifeOfLuxuryStats(result, {
    seed: Math.floor(Math.random() * 2 ** 31),
    onProgress: (f) => onProgress?.(0.75 + f * 0.25),
  });
  return { config: result, stats, reachable: solved.reachable };
}

// --- Win-calc — ported verbatim from backEnd/src/games/LifeOfLuxury/winCalc.ts --------------

type SymbolPayoutTable = Record<RegularSymbol, { x3: number; x4: number; x5: number }>;

function symbolsOnLine(grid: Grid, line: readonly [number, number, number, number, number]): LifeOfLuxurySymbol[] {
  return line.map((row, reel) => grid[reel][row]);
}

/**
 * Evaluates a single payline: the longest run of one regular symbol starting at reel 1
 * (left-to-right), minimum 3, with WILD substituting for whatever symbol the run started with.
 * COIN (the scatter) breaks a run exactly like a mismatched symbol would.
 */
function evaluatePayline(
  grid: Grid,
  line: readonly [number, number, number, number, number],
  lineNumber: number,
  paytable: SymbolPayoutTable,
  bet: number
): LineWin | null {
  const symbols = symbolsOnLine(grid, line);
  const first = symbols[0];
  if (first === SCATTER_SYMBOL || first === WILD_SYMBOL) return null;

  let count = 1;
  while (count < symbols.length && (symbols[count] === first || symbols[count] === WILD_SYMBOL)) count++;
  if (count < 3) return null;

  const matched = first as RegularSymbol;
  const runLength = count as 3 | 4 | 5;
  const multiplier = runLength === 3 ? paytable[matched].x3 : runLength === 4 ? paytable[matched].x4 : paytable[matched].x5;
  const positions: [number, number][] = line.slice(0, runLength).map((row, reel) => [reel, row]);

  return {
    lineNumber,
    symbol: matched,
    count: runLength,
    multiplier,
    finalWin: multiplier * bet,
    positions,
  };
}

function evaluateAllPaylines(grid: Grid, paytable: SymbolPayoutTable, bet: number): LineWin[] {
  return PAYLINES.map((line, i) => evaluatePayline(grid, line, i + 1, paytable, bet)).filter(
    (w): w is LineWin => w !== null
  );
}

/** COIN can land anywhere on the 5x3 grid, doesn't need a payline. 3+ anywhere pays a multiple of
 * the bet and — on a base spin only — triggers free spins. "5" means 5 or more. */
function calculateScatterWin(grid: Grid, bet: number, scatterRules: LifeOfLuxuryRtpConfig["scatterRules"]): ScatterResult {
  const positions: [number, number][] = [];
  grid.forEach((reel, reelIndex) => {
    reel.forEach((symbol, rowIndex) => {
      if (symbol === SCATTER_SYMBOL) positions.push([reelIndex, rowIndex]);
    });
  });

  const count = positions.length;
  if (count < SCATTER_TRIGGER_COUNT) return { count, win: 0, positions, triggered: false };

  const multiplier = count === 3 ? scatterRules.x3 : count === 4 ? scatterRules.x4 : scatterRules.x5;
  return { count, win: multiplier * bet, positions, triggered: true };
}

function calculateSpinWin(
  grid: Grid,
  paytable: SymbolPayoutTable,
  bet: number,
  scatterRules: LifeOfLuxuryRtpConfig["scatterRules"]
): SpinEvaluation {
  const lineWins = evaluateAllPaylines(grid, paytable, bet);
  const scatter = calculateScatterWin(grid, bet, scatterRules);

  const lineWinTotal = lineWins.reduce((sum, w) => sum + w.finalWin, 0);
  const finalWin = lineWinTotal + scatter.win;

  const winningPositions: [number, number][] = [];
  for (const w of lineWins) winningPositions.push(...w.positions);

  return { lineWins, scatter, finalWin, winningPositions };
}

// --- Grid drawing — ported from backEnd/src/games/LifeOfLuxury/engine.ts --------------------

/** Weighted-random symbol pick from the admin-configured `tiers` table — reads the admin's saved
 * tier table fresh on every call, so a change saved from the RTP admin tab takes effect on the
 * very next spin. */
function weightedSymbol(tiers: { key: LifeOfLuxurySymbol; frequencyPercent: number }[], rng: () => number): LifeOfLuxurySymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = rng() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier.key;
  }
  return tiers[tiers.length - 1].key;
}

/** Every cell independently rolls: is this COIN (its own admin-configured chance)? If not, draw
 * from the 10-row weight table (9 payers + WILD) — except on a reel outside WILD_ALLOWED_REELS,
 * where WILD's row is excluded first (the remaining 9 payers' proportions renormalize
 * automatically), so WILD can never land there. */
function drawGrid(
  tiers: { key: LifeOfLuxurySymbol; frequencyPercent: number }[],
  scatterChancePercent: number,
  rng: () => number = Math.random
): Grid {
  const tiersNoWild = tiers.filter((t) => t.key !== "WILD");
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const reelTiers = WILD_ALLOWED_REELS.includes(reel) ? tiers : tiersNoWild;
    const column: LifeOfLuxurySymbol[] = [];
    for (let row = 0; row < ROW_COUNT; row++) {
      column.push(rng() * 100 < scatterChancePercent ? SCATTER_SYMBOL : weightedSymbol(reelTiers, rng));
    }
    grid.push(column);
  }
  return grid;
}

// --- Free-spin round minimum ---------------------------------------------------------------

/** Every free-spins round pays at least this x of its bet in total (after the wild bonus). */
export const FREE_SPIN_ROUND_MIN_WIN_X = 1;

function countWilds(grid: Grid): number {
  return grid.reduce((sum, reel) => sum + reel.filter((s) => s === WILD_SYMBOL).length, 0);
}

/** For a round's last free spin: if `grid` would leave the round (spin wins so far `roundWin`,
 * wilds so far `roundWilds`, paid × (wilds + 1) at the end) under FREE_SPIN_ROUND_MIN_WIN_X × bet,
 * returns a grid with a real winning line on the middle payline instead — the lowest-paying
 * 3/4/5-of-a-kind that brings the round up to the minimum (or the best one if none does).
 * Otherwise returns `grid` unchanged. Shared by spinRequest and the RTP simulator so the admin's
 * measured RTP includes this. */
function applyRoundMinimum(grid: Grid, config: LifeOfLuxuryRtpConfig, bet: number, roundWin: number, roundWilds: number): Grid {
  const target = FREE_SPIN_ROUND_MIN_WIN_X * bet;
  const roundFinal = (g: Grid) =>
    (roundWin + calculateSpinWin(g, config.symbolPayouts, bet, config.scatterRules).finalWin) * (roundWilds + countWilds(g) + 1);
  if (roundFinal(grid) >= target - 1e-9) return grid;

  const candidates = REGULAR_SYMBOLS.flatMap((symbol) =>
    ([3, 4, 5] as const).map((count) => ({ symbol, count, pay: config.symbolPayouts[symbol][`x${count}`] }))
  )
    .filter((c) => c.pay > 0)
    .sort((a, b) => a.pay - b.pay);
  let best: Grid = grid;
  let bestFinal = -1;
  for (const { symbol, count } of candidates) {
    const next = grid.map((reel) => [...reel]);
    for (let reel = 0; reel < count; reel++) next[reel][1] = symbol;
    // Break the run right after it so it pays exactly `count` of a kind.
    if (count < REEL_COUNT) next[count][1] = REGULAR_SYMBOLS.find((s) => s !== symbol) ?? symbol;
    const final = roundFinal(next);
    if (final >= target - 1e-9) return next;
    if (final > bestFinal) {
      best = next;
      bestFinal = final;
    }
  }
  return best;
}

// --- Free-spin round + spin resolution -------------------------------------------------------

/** Mirrors the old backend's `FreeSpinRound` Mongo doc — module-level so it survives between
 * spinRequest calls within a round without threading extra state through LifeOfLuxuryGame.tsx's
 * own call site. Wiped on a page reload (no localStorage backing) — an abandoned round's
 * remaining free spins are lost on refresh instead of resuming, the same category of behavior
 * change as balance no longer persisting across refresh once a game goes fully client-side. */
let activeRound: { remaining: number; wildCount: number; totalWin: number } | null = null;

/** Runs one local, server-equivalent spin. `isFreeSpin` is only a hint — like the old backend
 * ("authoritative, not the client's own isFreeSpin flag"), this derives the real answer from its
 * own `activeRound` state so the module's round bookkeeping and the component's React state can
 * never drift apart (e.g. if a previous call threw mid-round). `currentBalance` is the player's
 * balance right before this spin — the new balance (bet deducted, wins/bonus credited) is
 * computed here and returned, mirroring SizzlingSevens' already-offline `spinRequest`. */
export async function spinRequest(bet: number, isFreeSpin: boolean, currentBalance: number): Promise<SpinResponse> {
  const actuallyFreeSpin = activeRound !== null && activeRound.remaining > 0;
  if (isFreeSpin !== actuallyFreeSpin) {
    console.warn(
      "LifeOfLuxury spinRequest: isFreeSpin argument disagreed with local round state — using local state as authoritative."
    );
  }

  const config = getLifeOfLuxuryRtpConfig();
  let grid = drawGrid(config.tiers, config.scatterRules.chancePercent);
  // The round's last free spin: if the round (with its wild bonus) would still end under the
  // FREE_SPIN_ROUND_MIN_WIN_X minimum, this spin lands a real winning line that covers it.
  if (actuallyFreeSpin && activeRound && activeRound.remaining === 1) {
    grid = applyRoundMinimum(grid, config, bet, activeRound.totalWin, activeRound.wildCount);
  }
  const evaluation = calculateSpinWin(grid, config.symbolPayouts, bet, config.scatterRules);
  // No retriggering: a coin scatter during an already-active free-spins round still pays its
  // cash prize (already folded into evaluation.finalWin) but never awards more free spins.
  const freeSpinsAwarded = evaluation.scatter.triggered && !actuallyFreeSpin ? config.scatterRules.freeSpinsAwarded : null;

  // End-of-round wild bonus: total free-spin win × (wilds seen across the round + 1). Only wilds
  // landing *during* the round count, never the triggering base spin's own grid. bonusWin is
  // credited on top of this spin's own winAmount, which (like every other free spin in the
  // round) is still paid out immediately below.
  let bonusWin = 0;
  let freeSpinRoundResult: SpinResponse["freeSpinRoundResult"] = null;

  if (actuallyFreeSpin && activeRound) {
    activeRound.wildCount += countWilds(grid);
    activeRound.totalWin += evaluation.finalWin;
    activeRound.remaining -= 1;

    if (activeRound.remaining <= 0) {
      const multiplier = activeRound.wildCount + 1;
      bonusWin = Math.round(activeRound.totalWin * activeRound.wildCount * 100) / 100;
      freeSpinRoundResult = {
        totalWin: activeRound.totalWin,
        wildCount: activeRound.wildCount,
        multiplier,
        bonusWin,
        finalWin: Math.round((activeRound.totalWin + bonusWin) * 100) / 100,
      };
      activeRound = null;
    }
  }

  const stakedAmount = actuallyFreeSpin ? 0 : bet;
  const balance = Math.round((currentBalance - stakedAmount + evaluation.finalWin + bonusWin) * 100) / 100;

  // A base spin's own Coin trigger starts the round others will play through.
  if (!actuallyFreeSpin && freeSpinsAwarded) {
    activeRound = { remaining: freeSpinsAwarded, wildCount: 0, totalWin: 0 };
  }

  return {
    grid,
    evaluation,
    winAmount: evaluation.finalWin,
    freeSpinsAwarded,
    freeSpinRoundResult,
    balance,
    meta: { forced: false },
  };
}

export async function getLifeOfLuxuryConfig(): Promise<LifeOfLuxuryConfigResponse> {
  const config = getLifeOfLuxuryRtpConfig();
  const symbolPayouts: SymbolPayoutRow[] = REGULAR_SYMBOLS.map((symbol) => ({
    symbol,
    ...config.symbolPayouts[symbol],
  }));
  const symbolWeights: Partial<Record<LifeOfLuxurySymbol, number>> = Object.fromEntries(
    config.tiers.map((t) => [t.key, t.frequencyPercent])
  );

  return {
    meta: {
      id: "life-of-luxury",
      name: "Life of Luxury",
      description: "Classic 5-reel, 15-line luxury-themed slot with a Coin scatter and free spins",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    lineCount: LINE_COUNT,
    betLevels: BET_LEVELS,
    minBet: BET_LEVELS[0],
    maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    paylines: PAYLINES,
    symbolPayouts,
    symbolWeights,
    scatter: { symbol: "COIN", triggerCount: SCATTER_TRIGGER_COUNT, ...config.scatterRules },
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: LifeOfLuxurySymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/life-of-luxury/spin-log", { ...params, tier: null });
}
