/**
 * Zeus vs Hades — pure game math. No imports, no DOM: the same file runs in the browser (via
 * api.ts) and in Node for the RTP simulator (scripts/zeusVsHades-sim.ts), so what the
 * simulator measures is exactly what the game plays.
 *
 * Rules (mirroring the original "Zeus vs Hades - Gods of War" published rules; reels/weights are
 * our own):
 * - 5 reels x 5 rows, 15 fixed paylines, wins pay left to right on adjacent reels.
 * - Total bet = 10 coins; every paytable value is in coins (coin = bet / 10).
 * - WILD substitutes for everything except SCATTER and pays like the top symbol.
 * - EXPANDING WILD: in the base game it expands to cover its reel (becoming a wild reel with a
 *   random multiplier) only if that produces a win. Multipliers of wild reels on the same
 *   winning line add together.
 * - 3 SCATTERs (reels 1, 3, 5, base game only) award 10 FREE SPINS. In free spins every
 *   expanding wild that hits expands unconditionally, and stays sticky (with its multiplier)
 *   for the rest of the round. No retrigger.
 * - OLYMPUS profile: free spins hit more often, pay less on average. HADES: rarer, bigger.
 * - Buy feature: standard free spins (75x bet Olympus / 150x Hades) or super free spins (300x
 *   bet), where one expanding wild with a random multiplier is guaranteed on the first spin.
 * - Special bets: SUPER SPIN 1 (100 coins) guarantees one expanding wild with a random
 *   multiplier per spin; SUPER SPIN 2 (3000 coins) guarantees one with a 250x multiplier. The
 *   wild still only expands if that makes a win. No scatters while a special bet is active.
 * - Max win 15,000x total bet per round; free spins end immediately once it's reached.
 */

export const REELS = 5;
export const ROWS = 5;
export const COINS_PER_BET = 10;
/** Round rules the admin page can change (games/ZeusVsHades/api.ts applies the saved values). */
export const RULES = {
  freeSpinsAwarded: 10,
  /** Max win per round in x total bet. */
  maxWinX: 15000,
};

/**
 * TESTING ONLY — set to true to make the symbols that have win animations land (and win) on
 * almost every spin, so their animations can be checked. Changes the game's odds completely:
 * must be false for real play. The RTP simulator measures whatever this is set to.
 */
export const DEBUG_FORCE_ANIMATED_SYMBOLS = false;

/** Symbols with a win animation, per profile (keep in sync with SYMBOL_ANIMS in art.ts). */
const DEBUG_ANIMATED_SYMBOLS: Record<"olympus" | "hades", number[]> = {
  olympus: [2, 4, 5, 7],
  hades: [2, 3, 4, 7],
};

export const SCATTER = 1;
export const WILD = 2;
export const EXPANDING_WILD = 13;
/** Paying symbols, highest first. */
export const PAY_SYMBOLS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type Profile = "olympus" | "hades";
export type BuyOption = "standard" | "super";
export type SpecialBet = "none" | "super1" | "super2";

/** Cost per spin in coins (one normal bet = 10 coins). The special bets' prices are admin-set. */
export const SPECIAL_BET_COINS: Record<SpecialBet, number> = { none: 10, super1: 100, super2: 3000 };
/** Multiplier of the guaranteed wild in SUPER SPIN 2. */
export const SUPER2_MULTIPLIER = 250;

export type Paytable = Record<number, [number, number, number]>;

/** PAYTABLES[profile][symbol] = [pays for 3, 4, 5 of a kind] in coins. Both profiles start
 * with the original game's shared paytable; the admin page can set each one separately. */
const DEFAULT_PAYTABLE: Paytable = {
  2: [20, 100, 200],
  3: [20, 100, 200],
  4: [10, 50, 100],
  5: [10, 50, 100],
  6: [5, 25, 50],
  7: [5, 25, 50],
  8: [1, 5, 10],
  9: [1, 5, 10],
  10: [1, 5, 10],
  11: [1, 5, 10],
  12: [1, 5, 10],
};
export const PAYTABLES: Record<Profile, Paytable> = {
  olympus: JSON.parse(JSON.stringify(DEFAULT_PAYTABLE)) as Paytable,
  hades: JSON.parse(JSON.stringify(DEFAULT_PAYTABLE)) as Paytable,
};

/** Row index on each reel, per payline. */
export const PAYLINES: number[][] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3],
  [4, 4, 4, 4, 4],
  [0, 1, 2, 1, 0],
  [4, 3, 2, 3, 4],
  [1, 2, 3, 2, 1],
  [3, 2, 1, 2, 3],
  [1, 2, 1, 2, 1],
  [3, 2, 3, 2, 3],
  [0, 1, 0, 1, 0],
  [4, 3, 4, 3, 4],
  [2, 1, 2, 1, 2],
  [2, 3, 2, 3, 2],
];

export const MULTIPLIER_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 25, 50, 100] as const;

/** Buy-feature cost in x total bet. */
export const BUY_COST_X: Record<Profile, Record<BuyOption, number>> = {
  olympus: { standard: 10, super: 20 },
  hades: { standard: 15, super: 30 },
};

// ---------------------------------------------------------------------------------------
// Tunable math. Everything the simulator adjusts lives in this block.
// ---------------------------------------------------------------------------------------

/** How a reel set's strips are built: counts of each special symbol per reel, plus scale
 * factors on the base high/low symbol counts. Scatters only go on reels 1, 3, 5 and WILD never
 * on reel 1 (so a line can't open on a plain wild run too easily). */
export interface StripParams {
  scatter: number;
  wild: number;
  exWild: number;
  highs: number;
  lows: number;
}

const HIGH_COUNTS: [number, number][] = [
  [3, 3],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
];
const LOW_COUNTS: [number, number][] = [
  [8, 9],
  [9, 9],
  [10, 9],
  [11, 9],
  [12, 9],
];

const REEL_SET_NAMES = [
  "olympusBase",
  "olympusCold",
  "hadesBase",
  "hadesCold",
  "freeSpins",
  "freeSpinsCold",
  "special",
  "specialCold",
] as const;
export type ReelSetName = (typeof REEL_SET_NAMES)[number];

export const STRIP_PARAMS: Record<ReelSetName, StripParams> = {
  olympusBase: { scatter: 4, wild: 1, exWild: 1, highs: 1, lows: 2 },
  olympusCold: { scatter: 4, wild: 0, exWild: 0, highs: 1, lows: 2 },
  hadesBase: { scatter: 3, wild: 1, exWild: 1, highs: 1, lows: 2 },
  hadesCold: { scatter: 3, wild: 0, exWild: 0, highs: 1, lows: 2 },
  freeSpins: { scatter: 0, wild: 1, exWild: 1, highs: 1, lows: 2 },
  freeSpinsCold: { scatter: 0, wild: 0, exWild: 0, highs: 1, lows: 2 },
  special: { scatter: 0, wild: 3, exWild: 0, highs: 3, lows: 0.5 },
  specialCold: { scatter: 0, wild: 0, exWild: 0, highs: 1, lows: 2 },
};

/** Weighted multiplier tables (same order as MULTIPLIER_VALUES). */
export const MULTIPLIER_WEIGHTS: Record<Profile, number[]> = {
  olympus: [300, 220, 160, 120, 90, 70, 55, 45, 40, 18, 12, 4, 1.5],
  hades: [200, 160, 130, 110, 90, 75, 60, 50, 45, 26, 20, 8, 3],
};

/**
 * Probability that a spin uses the hot reel set instead of its cold partner, per mode. These
 * are the RTP dials the simulator solves for.
 */
export const TUNING = {
  base: { olympus: 0.6353, hades: 0.5447 },
  /** Free spins, per how the round was entered (natural trigger uses "standard"). */
  freeSpins: {
    olympus: { standard: 0.4087, super: 0.4303 },
    hades: { standard: 0.5338, super: 0.3797 },
  } as Record<Profile, Record<BuyOption, number>>,
  super1: { olympus: 0.787, hades: 0.6103 },
  super2: { olympus: 0.4183, hades: 0.4183 },
};

// ---------------------------------------------------------------------------------------

export type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds one reel's strip with a fixed seed, so strips are identical on every load. Special
 * symbols are spread at least a window apart, so one reel never shows two of them at once. */
function buildStrip(params: StripParams, reel: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const pool: number[] = [];
  const add = (sym: number, count: number) => {
    for (let i = 0; i < Math.round(count); i++) pool.push(sym);
  };
  for (const [sym, n] of HIGH_COUNTS) add(sym, n * params.highs);
  for (const [sym, n] of LOW_COUNTS) add(sym, n * params.lows);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const specials: number[] = [];
  if (reel % 2 === 0) for (let i = 0; i < params.scatter; i++) specials.push(SCATTER);
  if (reel !== 0) for (let i = 0; i < params.wild; i++) specials.push(WILD);
  for (let i = 0; i < params.exWild; i++) specials.push(EXPANDING_WILD);
  if (specials.length === 0) return pool;

  // Insert specials at evenly spaced slots (with jitter), shuffled so kinds interleave.
  for (let i = specials.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [specials[i], specials[j]] = [specials[j], specials[i]];
  }
  const gap = pool.length / specials.length;
  const out: number[] = [];
  let next = 0;
  for (let i = 0; i < pool.length; i++) {
    out.push(pool[i]);
    while (next < specials.length && i + 1 >= Math.floor(next * gap + gap / 2)) out.push(specials[next++]);
  }
  while (next < specials.length) out.push(specials[next++]);
  return out;
}

/** reelSet -> reel -> strip. Rebuilt in place by rebuildReelSets() (the simulator uses that
 * after changing STRIP_PARAMS). */
export const REEL_SETS = {} as Record<ReelSetName, number[][]>;

export function rebuildReelSets(): void {
  REEL_SET_NAMES.forEach((name, setIdx) => {
    REEL_SETS[name] = [0, 1, 2, 3, 4].map((reel) => buildStrip(STRIP_PARAMS[name], reel, 1000 + setIdx * 17 + reel));
  });
}
rebuildReelSets();

// ---------------------------------------------------------------------------------------
// Spin evaluation
// ---------------------------------------------------------------------------------------

/** board[reel][row] */
export type Board = number[][];

export interface WildReel {
  reel: number;
  /** Row where the expanding wild landed (-1 for sticky reels carried over, or a forced one). */
  row: number;
  multiplier: number;
}

export interface LineWin {
  line: number;
  symbol: number;
  count: number;
  /** [reel, row] of every cell that forms the win. */
  cells: [number, number][];
  multiplier: number;
  /** Coins. */
  coins: number;
}

export interface SpinResult {
  reelSet: ReelSetName;
  /** Where each reel stopped on its strip — lets the client scroll the real strip. */
  stops: number[];
  /** The board as it landed, before any expansion. */
  landed: Board;
  /** Wild reels newly expanded on this spin. */
  expansions: WildReel[];
  /** All wild reels active on this spin (sticky + new), for evaluation/display. */
  wildReels: WildReel[];
  lineWins: LineWin[];
  scatterCells: [number, number][];
  /** Coins won on this spin. */
  coins: number;
}

function pickWeighted<T>(values: readonly T[], weights: readonly number[], rng: Rng): T {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng() * total;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll < 0) return values[i];
  }
  return values[values.length - 1];
}

export function rollMultiplier(profile: Profile, rng: Rng): number {
  return pickWeighted(MULTIPLIER_VALUES, MULTIPLIER_WEIGHTS[profile], rng);
}

function landBoard(setName: ReelSetName, rng: Rng): { board: Board; stops: number[] } {
  const set = REEL_SETS[setName];
  const stops: number[] = [];
  const board: Board = set.map((strip) => {
    const stop = Math.floor(rng() * strip.length);
    stops.push(stop);
    const col: number[] = [];
    for (let row = 0; row < ROWS; row++) col.push(strip[(stop + row) % strip.length]);
    return col;
  });
  return { board, stops };
}

/** Evaluates every payline given the active wild reels. Single (unexpanded) WILD/EXPANDING_WILD
 * cells substitute with no multiplier. */
export function evaluateLines(board: Board, wildReels: WildReel[], profile: Profile): LineWin[] {
  const paytable = PAYTABLES[profile];
  const reelMult: number[] = new Array(REELS).fill(0);
  for (const w of wildReels) reelMult[w.reel] = w.multiplier;
  const isWild = (reel: number, row: number) => {
    if (reelMult[reel] > 0) return true;
    const s = board[reel][row];
    return s === WILD || s === EXPANDING_WILD;
  };

  const wins: LineWin[] = [];
  for (let li = 0; li < PAYLINES.length; li++) {
    const rows = PAYLINES[li];

    // Leading run of wilds (pays as WILD on its own).
    let wildRun = 0;
    while (wildRun < REELS && isWild(wildRun, rows[wildRun])) wildRun++;

    // Symbol run: first non-wild symbol, extended through wilds.
    let symbol = -1;
    let count = 0;
    if (wildRun < REELS) {
      symbol = board[wildRun][rows[wildRun]];
      if (symbol !== SCATTER) {
        count = wildRun + 1;
        while (count < REELS && (isWild(count, rows[count]) || board[count][rows[count]] === symbol)) count++;
      }
    }

    const multFor = (n: number) => {
      let m = 0;
      for (let r = 0; r < n; r++) m += reelMult[r];
      return m > 0 ? m : 1;
    };
    const wildBase = wildRun >= 3 ? paytable[WILD][wildRun - 3] : 0;
    const symBase = count >= 3 && paytable[symbol] ? paytable[symbol][count - 3] : 0;
    const wildCoins = wildBase * multFor(wildRun);
    const symCoins = symBase * multFor(count);
    if (wildCoins <= 0 && symCoins <= 0) continue;

    const useWild = wildCoins >= symCoins;
    const n = useWild ? wildRun : count;
    const cells: [number, number][] = [];
    for (let r = 0; r < n; r++) cells.push([r, rows[r]]);
    wins.push({
      line: li,
      symbol: useWild ? WILD : symbol,
      count: n,
      cells,
      multiplier: multFor(n),
      coins: useWild ? wildCoins : symCoins,
    });
  }
  return wins;
}

function findScatters(board: Board): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < REELS; r++) for (let row = 0; row < ROWS; row++) if (board[r][row] === SCATTER) cells.push([r, row]);
  return cells;
}

function findExpandingWilds(board: Board, exclude: Set<number>): { reel: number; row: number }[] {
  const out: { reel: number; row: number }[] = [];
  for (let r = 0; r < REELS; r++) {
    if (exclude.has(r)) continue;
    const row = board[r].indexOf(EXPANDING_WILD);
    if (row >= 0) out.push({ reel: r, row });
  }
  return out;
}

interface SpinOptions {
  profile: Profile;
  setName: ReelSetName;
  sticky: WildReel[];
  /** Free spins: expand unconditionally. Base game: expand only if it produces a win. */
  alwaysExpand: boolean;
  /** Force one expanding wild onto a random cell (super free spins' first spin, super spins).
   * `multiplier` fixes its multiplier (SUPER SPIN 2), null rolls it as usual. */
  forcedWild?: { multiplier: number | null };
  rng: Rng;
}

/** Testing helper (see DEBUG_FORCE_ANIMATED_SYMBOLS): puts an animated symbol along a random
 * payline for 3-5 reels so it wins, and sprinkles a few more on the board. */
function debugPlantAnimatedSymbols(board: Board, profile: Profile, rng: Rng) {
  const pool = DEBUG_ANIMATED_SYMBOLS[profile];
  const pick = () => pool[Math.floor(rng() * pool.length)];
  const symbol = pick();
  const line = PAYLINES[Math.floor(rng() * PAYLINES.length)];
  const count = 3 + Math.floor(rng() * 3);
  for (let r = 0; r < count; r++) board[r][line[r]] = symbol;
  for (let i = 0; i < 4; i++) board[Math.floor(rng() * REELS)][Math.floor(rng() * ROWS)] = pick();
}

function playSpin(opts: SpinOptions): SpinResult {
  const { profile, setName, sticky, alwaysExpand, forcedWild, rng } = opts;
  const { board, stops } = landBoard(setName, rng);
  if (DEBUG_FORCE_ANIMATED_SYMBOLS) debugPlantAnimatedSymbols(board, profile, rng);
  const stickyReels = new Set(sticky.map((w) => w.reel));

  const forcedMult = new Map<number, number>();
  if (forcedWild) {
    const free = [0, 1, 2, 3, 4].filter((r) => !stickyReels.has(r));
    if (free.length > 0) {
      const reel = free[Math.floor(rng() * free.length)];
      const row = Math.floor(rng() * ROWS);
      for (let rr = 0; rr < ROWS; rr++) if (board[reel][rr] === EXPANDING_WILD) board[reel][rr] = WILD;
      board[reel][row] = EXPANDING_WILD;
      if (forcedWild.multiplier !== null) forcedMult.set(reel, forcedWild.multiplier);
    }
  }

  const candidates = findExpandingWilds(board, stickyReels).map((c) => ({
    ...c,
    multiplier: forcedMult.get(c.reel) ?? rollMultiplier(profile, rng),
  }));

  let expansions: WildReel[] = candidates;
  if (!alwaysExpand && candidates.length > 0) {
    // Keep only wild reels that take part in at least one winning line; repeat until stable
    // because removing one can change which lines the others win on.
    for (;;) {
      const wins = evaluateLines(board, [...sticky, ...expansions], profile);
      const used = new Set<number>();
      for (const w of wins) for (const [r] of w.cells) used.add(r);
      const kept = expansions.filter((e) => used.has(e.reel));
      if (kept.length === expansions.length) break;
      expansions = kept;
    }
  }

  const wildReels = [...sticky, ...expansions];
  const lineWins = evaluateLines(board, wildReels, profile);
  const coins = lineWins.reduce((s, w) => s + w.coins, 0);
  return {
    reelSet: setName,
    stops,
    landed: board,
    expansions,
    wildReels,
    lineWins,
    scatterCells: findScatters(board),
    coins,
  };
}

// ---------------------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------------------

export interface FreeSpinsRound {
  spins: SpinResult[];
  /** Coins, capped. */
  coins: number;
  /** True if the round ended early because the max win was reached. */
  capped: boolean;
}

export interface RoundResult {
  profile: Profile;
  /** Total cost in coins (10 = one normal bet). */
  costCoins: number;
  /** Undefined for a buy-feature round (it goes straight to free spins). */
  base?: SpinResult;
  freeSpins?: FreeSpinsRound;
  /** Total coins won this round, capped at RULES.maxWinX * 10. */
  coins: number;
  capped: boolean;
}

const maxWinCoins = () => RULES.maxWinX * COINS_PER_BET;

function chooseSet(pHit: number, hit: ReelSetName, cold: ReelSetName, rng: Rng): ReelSetName {
  return rng() < pHit ? hit : cold;
}

export function playFreeSpins(
  profile: Profile,
  kind: BuyOption,
  alreadyWonCoins: number,
  rng: Rng
): FreeSpinsRound {
  const spins: SpinResult[] = [];
  let sticky: WildReel[] = [];
  let coins = 0;
  let capped = false;
  for (let i = 0; i < RULES.freeSpinsAwarded; i++) {
    const setName = chooseSet(TUNING.freeSpins[profile][kind], "freeSpins", "freeSpinsCold", rng);
    const spin = playSpin({
      profile,
      setName,
      sticky,
      alwaysExpand: true,
      forcedWild: i === 0 && kind === "super" ? { multiplier: null } : undefined,
      rng,
    });
    spins.push(spin);
    sticky = spin.wildReels;
    coins += spin.coins;
    if (alreadyWonCoins + coins >= maxWinCoins()) {
      coins = maxWinCoins() - alreadyWonCoins;
      capped = true;
      break;
    }
  }
  return { spins, coins, capped };
}

export function playRound(profile: Profile, special: SpecialBet = "none", rng: Rng = Math.random): RoundResult {
  let base: SpinResult;
  if (special === "none") {
    const hitSet: ReelSetName = profile === "olympus" ? "olympusBase" : "hadesBase";
    const coldSet: ReelSetName = profile === "olympus" ? "olympusCold" : "hadesCold";
    base = playSpin({
      profile,
      setName: chooseSet(TUNING.base[profile], hitSet, coldSet, rng),
      sticky: [],
      alwaysExpand: false,
      rng,
    });
  } else {
    base = playSpin({
      profile,
      setName: chooseSet(TUNING[special][profile], "special", "specialCold", rng),
      sticky: [],
      alwaysExpand: false,
      forcedWild: { multiplier: special === "super2" ? SUPER2_MULTIPLIER : null },
      rng,
    });
  }

  let coins = Math.min(base.coins, maxWinCoins());
  let capped = base.coins >= maxWinCoins();
  let freeSpins: FreeSpinsRound | undefined;
  if (!capped && special === "none" && base.scatterCells.length >= 3) {
    freeSpins = playFreeSpins(profile, "standard", coins, rng);
    coins += freeSpins.coins;
    capped = freeSpins.capped;
  }
  return { profile, costCoins: SPECIAL_BET_COINS[special], base, freeSpins, coins, capped };
}

/**
 * Cosmetic spin shown before a bought feature, as in the original: a base-game board with a
 * SCATTER on reels 1, 3 and 5 (the trigger pattern). It pays nothing and has no wilds, so it
 * never affects the round's result or RTP.
 */
function triggerSpin(profile: Profile, rng: Rng): SpinResult {
  const setName: ReelSetName = profile === "olympus" ? "olympusCold" : "hadesCold";
  const { board, stops } = landBoard(setName, rng);
  for (let r = 0; r < REELS; r++) {
    for (let row = 0; row < ROWS; row++) if (board[r][row] === SCATTER) board[r][row] = PAY_SYMBOLS[5 + ((r + row) % 5)];
  }
  for (const r of [0, 2, 4]) board[r][Math.floor(rng() * ROWS)] = SCATTER;
  return { reelSet: setName, stops, landed: board, expansions: [], wildReels: [], lineWins: [], scatterCells: findScatters(board), coins: 0 };
}

export function playBuyRound(profile: Profile, option: BuyOption, rng: Rng = Math.random): RoundResult {
  const costCoins = BUY_COST_X[profile][option] * COINS_PER_BET;
  const freeSpins = playFreeSpins(profile, option, 0, rng);
  return { profile, costCoins, base: triggerSpin(profile, rng), freeSpins, coins: freeSpins.coins, capped: freeSpins.capped };
}
