/** Pure win-evaluation engine for Sizzling 7s — ported verbatim from the backend's own
 * games/SizzlingSevens/winCalc.ts (now deleted). No imports beyond ./config, so this stays
 * independently testable/auditable, same as it was server-side. */

import {
  SizzlingSymbol,
  PAYLINES,
  DEFAULT_PAYTABLE,
  WILD_SYMBOL,
  BONUS_SYMBOL,
  WILD_SUBSTITUTES_FOR,
  WILD_MULTIPLIER_BASE,
  PURE_WILD_PAYOUT,
  BONUS_TRIGGER_COUNT,
  BAR_FAMILY,
  ANY_BAR_PAYOUT,
  SEVEN_FAMILY,
  ANY_SEVEN_PAYOUT,
  FREE_GAMES_AWARDS,
  MYSTERY_SPIN_COUNTS,
  MYSTERY_MULTIPLIER_POOL,
  MYSTERY_PICK_SELECTION_WEIGHT,
  FreeGamesAward,
} from "./config";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. `null` = an empty (blank)
 * slot: every reel lands showing either 1 symbol on the MIDDLE row or 2 on TOP+BOTTOM (see
 * pixi/Reel.ts's alternating symbol/blank strip), so a blank never matches anything — any
 * payline crossing one simply can't pay. */
export type Cell = SizzlingSymbol | null;
export type Grid = Cell[][];

/** 3-matching pays per symbol, plus the two mixed-family pays (any 3 BARs / any 3 Sevens). */
export type Paytable = Record<Exclude<SizzlingSymbol, "WILD_2X">, number> & { ANY_BAR: number; ANY_SEVEN: number };

export interface LineWin {
  lineNumber: number;
  symbol: SizzlingSymbol;
  matchCount: number;
  basePayout: number;
  wildCount: number;
  wildMultiplier: number;
  betMultiplier: number;
  finalWin: number;
  positions: [number, number][]; // [reelIndex, rowIndex] for every winning cell on this line
  isPureWild: boolean;
  /** Set when this line paid a mixed-family rate (any 3 BARs / any 3 Sevens) rather than 3 matching. */
  mixed?: "ANY_BAR" | "ANY_SEVEN";
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

type PayingSymbol = Exclude<SizzlingSymbol, "WILD_2X">;
const WILD_SUB_SET = new Set<SizzlingSymbol>(WILD_SUBSTITUTES_FOR);
function isPayingSymbol(s: Cell): s is PayingSymbol {
  return s !== null && s !== BONUS_SYMBOL && WILD_SUB_SET.has(s);
}

/** BAR_FAMILY plus Wild (Wild substitutes into the ANY_BAR mix same as it does everywhere
 * else) — a line where every symbol is in this set counts for ANY_BAR_PAYOUT (see
 * evaluatePayline's candidateC), whether or not the 3 BAR symbols actually match each other. */
const ANY_BAR_SET = new Set<Cell>([...BAR_FAMILY, WILD_SYMBOL]);
/** Same idea for the Sevens: every symbol on the line is a Red 7, Blue 7 or Wild. */
const ANY_SEVEN_SET = new Set<Cell>([...SEVEN_FAMILY, WILD_SYMBOL]);

/** Reads the 3 symbols a payline passes through, one per reel. */
function symbolsOnLine(grid: Grid, line: readonly [number, number, number]): Cell[] {
  return line.map((row, reel) => grid[reel][row]);
}

/**
 * Evaluates a single payline. Computes two independent candidate wins and pays the higher
 * (never both — "only the highest applicable win on a payline is paid"):
 *   A) a real symbol's run (Wild substitutes in, worth wildMultiplier = 2^wildCount)
 *   B) a "pure Wild" run — 1, 2, or 3+ leading Wilds that don't resolve into a real symbol's
 *      3+ match, paid via PURE_WILD_PAYOUT and NOT multiplied again.
 * Candidate B is what makes a lone Wild on reel 1 a small guaranteed win instead of "no win"
 * (a single Wild alone never reaches the normal 3-match minimum). It also naturally wins out
 * over candidate A once 3 leading Wilds are in play, since PURE_WILD_PAYOUT[3] exceeds the
 * best possible substituted win — matching the spec's own example ("3 WILDS = 2500, NOT
 * 2500x8").
 */
export type PureWildPayout = Record<1 | 2 | 3, number>;

export function evaluatePayline(
  grid: Grid,
  line: readonly [number, number, number],
  lineNumber: number,
  paytable: Paytable,
  betMultiplier: number,
  pureWildPayout: PureWildPayout = PURE_WILD_PAYOUT
): LineWin | null {
  const symbols = symbolsOnLine(grid, line);

  let leadingWilds = 0;
  while (leadingWilds < symbols.length && symbols[leadingWilds] === WILD_SYMBOL) leadingWilds++;

  // Candidate A: the first non-Wild symbol (if any) determines the line's winning symbol.
  let candidateA: LineWin | null = null;
  if (leadingWilds < symbols.length) {
    const winningSymbol = symbols[leadingWilds];
    if (isPayingSymbol(winningSymbol)) {
      let matchCount = 0;
      let wildCount = 0;
      for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i];
        if (s === WILD_SYMBOL) {
          matchCount++;
          wildCount++;
        } else if (s === winningSymbol) {
          matchCount++;
        } else {
          break;
        }
      }
      if (matchCount >= 3) {
        const basePayout = paytable[winningSymbol];
        const wildMultiplier = Math.pow(WILD_MULTIPLIER_BASE, wildCount);
        const finalWin = basePayout * wildMultiplier * betMultiplier;
        const positions: [number, number][] = [];
        for (let i = 0; i < matchCount; i++) positions.push([i, line[i]]);
        candidateA = {
          lineNumber,
          symbol: winningSymbol,
          matchCount,
          basePayout,
          wildCount,
          wildMultiplier,
          betMultiplier,
          finalWin,
          positions,
          isPureWild: false,
        };
      }
    }
  }

  // Candidate B: leadingWilds >= 1 leading Wilds treated as their own combo.
  let candidateB: LineWin | null = null;
  if (leadingWilds >= 1) {
    const cappedCount = Math.min(leadingWilds, 3) as 1 | 2 | 3;
    const basePayout = pureWildPayout[cappedCount];
    const positions: [number, number][] = [];
    for (let i = 0; i < leadingWilds; i++) positions.push([i, line[i]]);
    candidateB = {
      lineNumber,
      symbol: WILD_SYMBOL,
      matchCount: leadingWilds,
      basePayout,
      wildCount: leadingWilds,
      wildMultiplier: 1,
      betMultiplier,
      finalWin: basePayout * betMultiplier,
      positions,
      isPureWild: true,
    };
  }

  // Candidate C: every symbol on the line is some mix of the 3 BAR symbols (not necessarily
  // identical — an all-identical BAR line already wins more via candidate A above, since
  // ANY_BAR_PAYOUT is always lower than any single BAR symbol's own exact-match payout, so max()
  // below picks candidate A automatically in that case). No Wild-count multiplier — this is a
  // flat rate, same as a pure-Wild run.
  const mixedFamily = (family: Set<Cell>, pay: number, mixed: "ANY_BAR" | "ANY_SEVEN"): LineWin | null => {
    if (pay <= 0 || !symbols.every((s) => family.has(s))) return null;
    const positions: [number, number][] = line.map((row, reel) => [reel, row]);
    return {
      lineNumber,
      symbol: symbols[0] as SizzlingSymbol,
      matchCount: 3,
      basePayout: pay,
      wildCount: symbols.filter((s) => s === WILD_SYMBOL).length,
      wildMultiplier: 1,
      betMultiplier,
      finalWin: pay * betMultiplier,
      positions,
      isPureWild: false,
      mixed,
    };
  };
  const candidateC = mixedFamily(ANY_BAR_SET, paytable.ANY_BAR ?? ANY_BAR_PAYOUT, "ANY_BAR");
  // Candidate D: the Sevens' counterpart — any mix of Red 7 / Blue 7 (Wild substitutes in).
  const candidateD = mixedFamily(ANY_SEVEN_SET, paytable.ANY_SEVEN ?? ANY_SEVEN_PAYOUT, "ANY_SEVEN");

  const candidates = [candidateA, candidateB, candidateC, candidateD].filter((c): c is LineWin => c !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.finalWin > best.finalWin ? c : best));
}

export function evaluateAllPaylines(
  grid: Grid,
  paytable: Paytable,
  betMultiplier: number,
  pureWildPayout: PureWildPayout = PURE_WILD_PAYOUT
): LineWin[] {
  return PAYLINES.map((line, i) => evaluatePayline(grid, line, i + 1, paytable, betMultiplier, pureWildPayout)).filter(
    (w): w is LineWin => w !== null
  );
}

/** BONUS can land anywhere on the 3x3 grid, doesn't need a payline, and Wild never substitutes
 * for it. 3+ anywhere both pays the scatter amount and (see triggerFreeGames) awards Free
 * Games. Spec only defines a "3 BONUS" figure, so 4 or 5 anywhere still pays that same amount
 * — same "no invented higher payout" rule as line wins. */
export function calculateScatterWin(
  grid: Grid,
  paytable: Paytable,
  betMultiplier: number
): { scatterCount: number; scatterWin: number } {
  let scatterCount = 0;
  for (const reel of grid) for (const s of reel) if (s === BONUS_SYMBOL) scatterCount++;

  if (scatterCount < BONUS_TRIGGER_COUNT) return { scatterCount, scatterWin: 0 };
  return { scatterCount, scatterWin: paytable.BONUS * betMultiplier };
}

export function calculateLineWin(
  grid: Grid,
  line: readonly [number, number, number],
  lineNumber: number,
  paytable: Paytable,
  betMultiplier: number,
  pureWildPayout: PureWildPayout = PURE_WILD_PAYOUT
): LineWin | null {
  return evaluatePayline(grid, line, lineNumber, paytable, betMultiplier, pureWildPayout);
}

/**
 * Assembles line + scatter wins for one spin. `freeGameMultiplier` is 1 for a normal spin;
 * pass the multiplier already drawn for the current free spin (see calculateFreeSpinWin) to
 * apply it to everything this spin won, per the spec's freeSpinWin formula.
 */
export function calculateSpinWin(
  grid: Grid,
  paytable: Paytable,
  betMultiplier: number,
  freeGameMultiplier = 1,
  pureWildPayout: PureWildPayout = PURE_WILD_PAYOUT
): SpinEvaluation {
  const lineWins = evaluateAllPaylines(grid, paytable, betMultiplier, pureWildPayout);
  const { scatterCount, scatterWin } = calculateScatterWin(grid, paytable, betMultiplier);
  const totalLineWin = lineWins.reduce((sum, w) => sum + w.finalWin, 0);
  const totalWinBeforeFreeMultiplier = totalLineWin + scatterWin;
  const finalWin = totalWinBeforeFreeMultiplier * freeGameMultiplier;

  const winningPositions: [number, number][] = [];
  for (const w of lineWins) winningPositions.push(...w.positions);

  return {
    lineWins,
    scatterCount,
    scatterWin,
    totalLineWin,
    totalWinBeforeFreeMultiplier,
    freeGameMultiplier,
    finalWin,
    winningPositions,
    triggeredFreeGames: scatterCount >= BONUS_TRIGGER_COUNT,
  };
}

/** Picks a single value from `pool`, weighted by `weights` (same length, need not sum to any
 * particular total) — the shared weighted-choice primitive every random pick in this module
 * uses, so RTP simulation and live play always draw from identical distributions. */
function weightedPick<T>(pool: T[], weights: number[], rng: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export interface FreeGamesTrigger {
  freeSpins: number;
  multiplierPool: number[];
  isMystery: boolean;
}

/**
 * Resolves a Bonus trigger (initial or retrigger) into an award: either landing directly on
 * one of the 4 fixed awards, or a Mystery Pick (picks its spin count uniformly from
 * MYSTERY_SPIN_COUNTS and hands the round the full 7-value multiplier pool instead of the
 * narrower 3-value pool a direct award would use).
 */
export function triggerFreeGames(rng: () => number = Math.random): FreeGamesTrigger {
  const options: Array<FreeGamesAward & { selectionWeight: number; isMystery: boolean }> = [
    ...FREE_GAMES_AWARDS.map((a) => ({ ...a, isMystery: false })),
    { freeSpins: 0, multiplierPool: [], selectionWeight: MYSTERY_PICK_SELECTION_WEIGHT, isMystery: true },
  ];
  const picked = weightedPick(
    options,
    options.map((o) => o.selectionWeight),
    rng
  );

  if (!picked.isMystery) {
    return { freeSpins: picked.freeSpins, multiplierPool: picked.multiplierPool, isMystery: false };
  }

  const freeSpins = MYSTERY_SPIN_COUNTS[Math.floor(rng() * MYSTERY_SPIN_COUNTS.length)];
  return { freeSpins, multiplierPool: MYSTERY_MULTIPLIER_POOL, isMystery: true };
}

/** Draws this free spin's multiplier — fresh every spin, from the active round's pool
 * (see FreeGamesTrigger.multiplierPool). Uniform among the pool's own values. */
export function pickFreeSpinMultiplier(multiplierPool: number[], rng: () => number = Math.random): number {
  if (multiplierPool.length === 0) return 1;
  return multiplierPool[Math.floor(rng() * multiplierPool.length)];
}

/** freeSpinWin = (lineWins + scatterWins) x freeGameMultiplier — see calculateSpinWin, which
 * already applies this when given a non-1 freeGameMultiplier. Exposed separately too so the
 * formula matches the spec's own naming 1:1 for anyone auditing the math. */
export function calculateFreeSpinWin(
  grid: Grid,
  paytable: Paytable,
  betMultiplier: number,
  freeGameMultiplier: number,
  pureWildPayout: PureWildPayout = PURE_WILD_PAYOUT
): SpinEvaluation {
  return calculateSpinWin(grid, paytable, betMultiplier, freeGameMultiplier, pureWildPayout);
}

export { DEFAULT_PAYTABLE };
