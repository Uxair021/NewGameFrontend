/**
 * Centralized rules for Sizzling 7s — a classic 3-reel x 3-row, 27-fixed-payline slot. Ported
 * verbatim from the backend's own games/SizzlingSevens/config.ts (now deleted — this game is
 * fully offline/client-side, same as Buffalo777) so winCalc.ts/api.ts never scatter magic
 * numbers; the win-calc/RTP code reads this object, never hardcodes a payout or line pattern.
 */

export const SYMBOLS = ["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR", "WILD_2X", "BONUS"] as const;
export type SizzlingSymbol = (typeof SYMBOLS)[number];

export const REEL_COUNT = 3;
export const ROW_COUNT = 3;
/** row 0 = TOP, row 1 = MIDDLE, row 2 = BOTTOM. */
export const TOP = 0;
export const MIDDLE = 1;
export const BOTTOM = 2;

/** Purely an internal normalization constant — every payout in the paytable is expressed as a
 * multiple of this reference bet (see winCalc.ts), not a real player-facing "cost per line".
 * The player instead picks a BET_LEVEL directly (0.10-30, matching every other game's
 * BET_LEVELS convention) as their *total* bet; the actual scale factor fed into the win-calc
 * functions is (selected level / LINE_COST) — see api.ts's spinRequest. Renaming or changing
 * this value alone would silently rescale every payout, so it stays fixed at the value the
 * whole paytable was tuned for. */
export const LINE_COST = 30;
export const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/**
 * The 27 fixed payline patterns — one row index (0/1/2) per reel — read directly off the
 * reference 27-line chart (a 3x3-grid classic layout), not generated. Line 20 ([TOP, MID,
 * BOT]) is identical to line 4 in that same reference chart — kept verbatim rather than
 * silently deduplicated, both still evaluate/pay independently.
 */
export const PAYLINES: readonly [number, number, number][] = [
  [1, 1, 1], // 1
  [0, 0, 0], // 2
  [2, 2, 2], // 3
  [0, 1, 2], // 4
  [2, 1, 0], // 5
  [1, 0, 1], // 6
  [1, 2, 1], // 7
  [2, 1, 2], // 8
  [0, 1, 0], // 9
  [0, 1, 1], // 10
  [2, 1, 1], // 11
  [1, 0, 0], // 12
  [1, 2, 2], // 13
  [0, 0, 1], // 14
  [2, 2, 1], // 15
  [1, 1, 0], // 16
  [1, 1, 2], // 17
  [0, 2, 0], // 18
  [2, 0, 2], // 19
  [0, 1, 2], // 20 (duplicate of line 4, per the reference chart)
  [2, 2, 0], // 21
  [0, 2, 2], // 22
  [2, 0, 0], // 23
  [1, 0, 2], // 24
  [1, 2, 0], // 25
  [0, 2, 1], // 26
  [2, 0, 1], // 27
];

/** 3-matching-symbol base payouts (as a multiple of the *line* bet, i.e. before the bet level's
 * own multiplier is applied) — admin-editable defaults, see the Sizzling RTP admin tab. Spec
 * only defines a "3 matching" number for each symbol (no separate 4/5-match figure), so a
 * matched run of 4 or 5 pays the same as a run of exactly 3. */
export const DEFAULT_PAYTABLE: Record<Exclude<SizzlingSymbol, "WILD_2X">, number> = {
  RED_7: 14.1946,
  BLUE_7: 5.6779,
  TRIPLE_BAR: 2.8389,
  DOUBLE_BAR: 1.7034,
  BAR: 1.4195,
  BONUS: 3.4067,
};

export const WILD_SYMBOL: SizzlingSymbol = "WILD_2X";
export const BONUS_SYMBOL: SizzlingSymbol = "BONUS";

/** Wild substitutes for every normal paying symbol, never for BONUS. */
export const WILD_SUBSTITUTES_FOR: SizzlingSymbol[] = ["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR"];

/** The 3 BAR-family symbols — a payline showing any mix of these (not necessarily identical,
 * Wild substitutes in same as everywhere else) still wins, just at the flat ANY_BAR_PAYOUT
 * rate rather than one of the 3 higher exact-match payouts above. */
export const BAR_FAMILY: SizzlingSymbol[] = ["BAR", "DOUBLE_BAR", "TRIPLE_BAR"];
/** Flat payout for a payline showing a mixed (non-identical) combination of BAR_FAMILY symbols
 * (see BAR_FAMILY) — always lower than any of the 3 exact-match BAR payouts, so an
 * all-identical BAR line still pays its own higher rate (evaluatePayline takes the max). */
export const ANY_BAR_PAYOUT = 5;

/** The 2 Seven symbols — a payline showing any mix of these (Wild substitutes in) pays the
 * Any 3 Sevens rate, the Sevens' counterpart to ANY_BAR_PAYOUT. Default only; admin-editable. */
export const SEVEN_FAMILY: SizzlingSymbol[] = ["RED_7", "BLUE_7"];
export const ANY_SEVEN_PAYOUT = 0;

/** wildMultiplier = WILD_MULTIPLIER_BASE ^ numberOfWilds (0 wilds = x1, 1 = x2, 2 = x4, 3 = x8),
 * applied when a Wild substitutes into an otherwise-normal winning line. */
export const WILD_MULTIPLIER_BASE = 2;

/** Pure-Wild-only payouts (a Wild run from reel 1 that never resolves into a real symbol) — a
 * flat, standalone payout, NOT multiplied again by WILD_MULTIPLIER_BASE. Keyed by consecutive
 * leading-Wild count; a run longer than the highest defined key (3) still uses that key's
 * payout. Only the 3-Wild figure is admin-editable (see the RTP admin tab); 1/2-Wild stay
 * fixed consolation amounts, not worth their own admin rows. */
// Whole-number x of the bet (house rule, see shared/rtpRules.ts): 1 and 2 leading Wilds pay 1x
// (30 line units); the 3-Wild default is the admin-editable WILD_2X row.
export const PURE_WILD_PAYOUT: Record<1 | 2 | 3, number> = { 1: 30, 2: 30, 3: 120 };

export const BONUS_TRIGGER_COUNT = 3;

export interface FreeGamesAward {
  freeSpins: number;
  /** Multiplier pool this bonus round draws from — a fresh multiplier is picked from this pool
   * independently for every free spin played (see winCalc.ts's pickFreeSpinMultiplier). */
  multiplierPool: number[];
}

/** The 4 direct award tiers a Bonus trigger can land on, each carrying its own free-spin count
 * and multiplier pool. Selection weights are relative (don't need to sum to 100) — see
 * winCalc.ts's pickFreeGamesAward. */
export const FREE_GAMES_AWARDS: Array<FreeGamesAward & { selectionWeight: number }> = [
  { freeSpins: 5, multiplierPool: [30, 15, 8], selectionWeight: 30 },
  { freeSpins: 8, multiplierPool: [10, 8, 5], selectionWeight: 28 },
  { freeSpins: 10, multiplierPool: [8, 5, 3], selectionWeight: 24 },
  { freeSpins: 15, multiplierPool: [5, 3, 2], selectionWeight: 18 },
];

/** Mystery Pick — an alternative to landing directly on one of the 4 awards above: picks a
 * free-spin count uniformly from MYSTERY_SPIN_COUNTS and hands the whole 7-value multiplier
 * pool to the round (not the narrower 3-value pool the matching direct award would use). */
export const MYSTERY_SPIN_COUNTS = [5, 8, 10, 15];
export const MYSTERY_MULTIPLIER_POOL = [2, 3, 5, 8, 10, 15, 30];
/** Chance a Bonus trigger resolves as a Mystery Pick instead of a direct award (relative to the
 * FREE_GAMES_AWARDS selectionWeights above — see winCalc.ts's pickFreeGamesAward). */
export const MYSTERY_PICK_SELECTION_WEIGHT = 20;

export const RETRIGGER_ENABLED = true;

/** Every Free Games round pays at least this many times the (locked) bet in total — a random
 * value in [min, max] picked per round. If the round's spins won less, the shortfall is added to
 * the round's last spin (see SizzlingSevensGame.tsx's runFreeSpin, and the RTP simulation in
 * api.ts). */
export const FREE_GAMES_MIN_WIN_X: [number, number] = [3, 4];
