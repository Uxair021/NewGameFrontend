/**
 * 7 Crystal Clover's RNG, paytable, and balance are all computed entirely in the browser — RTP
 * and odds are configured client-side (see the RTP control below) and every spin resolves
 * locally, on the same tick, instead of over the network. Everything below (other than
 * `logSpinResult`) is a faithful port of what used to live in
 * `backEnd/src/games/CrystalClover/{config,engine,winCalc}.ts`, using the exact same tier
 * weights/payout multipliers/rule-tier map/reel-state chance that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["crystal-clover"]` and its
 * `computeCrystalCloverRtpPercent`. Kept as the same exported function names/signatures as the
 * old network calls (`spinRequest`, `getCrystalCloverConfig`) so `CrystalCloverGame.tsx` didn't
 * need type changes — `spinRequest` gains one new parameter (`currentBalance`), the same shape
 * every other already-offline game's `spinRequest` uses, since this game's `SpinResponse` (like
 * theirs) already carries a `balance` field.
 *
 * There's no bonus-round state to track here at all — this game has no free spins/respins, so
 * `spinRequest` was already a single-shot, per-call function even on the backend.
 *
 * Unlike Crazy 777/5x Rewind's static cosmetic paytables, `getCrystalCloverConfig()` stays live-
 * derived from the current RTP config (same as the old backend's /config route did) — the in-game
 * paytable modal (CrystalCloverGame.tsx's PaytableModal) actually renders these numbers, so they
 * need to track whatever the admin has configured, not a frozen snapshot.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/CrystalClover/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so Crystal Clover spins
 * show up in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It
 * never influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, fitFrequencies, makeConfigLoader, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type CrystalCloverSymbol = "SEVEN_CLOVER" | "TRIPLE_BAR" | "DOUBLE_BAR" | "BAR" | "WILD" | "MULTIPLIER_2X";

/** grid[reelIndex][rowIndex] — row 0 = TOP, 1 = MIDDLE, 2 = BOTTOM. `null` means that reel has
 * no symbol on this row at all — every reel always shows either 1 symbol on the middle row, or
 * 2 symbols on the top+bottom rows, never all 3. */
export type Grid = (CrystalCloverSymbol | null)[][];

export interface LineWin {
  lineNumber: number;
  symbol: CrystalCloverSymbol;
  matchCount: number;
  basePayout: number;
  wildCount: number;
  wildMultiplier: number;
  betMultiplier: number;
  finalWin: number;
  positions: [number, number][];
  isPureWild: boolean;
  isAnyBar: boolean;
}

export interface SpinEvaluation {
  lineWins: LineWin[];
  totalLineWin: number;
  multiplierCount: number;
  multiplierFactor: number;
  finalWin: number;
  winningPositions: [number, number][];
}

export interface SpinResponse {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  balance: number;
  meta: { forced: boolean };
}

export interface PaytableRow {
  symbol: CrystalCloverSymbol;
  payout: number;
}

export interface CrystalCloverConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  betLevels: number[];
  minBet: number;
  maxBet: number;
  paylineCount: number;
  paylines: [number, number, number][];
  paytable: PaytableRow[];
  anyBarPayout: number;
  wild: { symbol: "WILD"; multiplierBase: number; purePayout: Record<1 | 2 | 3, number> };
  multiplier: { symbol: "MULTIPLIER_2X"; base: number };
}

// --- Game shape — ported verbatim from backEnd/src/games/CrystalClover/config.ts ------------

const REEL_COUNT = 3;
const ROW_COUNT = 3;

const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];

/** The 9 fixed payline patterns — one row index (0/1/2) per reel. */
const PAYLINES: readonly [number, number, number][] = [
  [1, 1, 1], // 1 - MMM
  [0, 0, 0], // 2 - TTT
  [2, 2, 2], // 3 - BBB
  [0, 1, 2], // 4 - top-mid-bottom diagonal
  [2, 1, 0], // 5 - bottom-mid-top diagonal
  [0, 2, 0], // 6 - top-bottom-top (upper Λ)
  [2, 0, 2], // 7 - bottom-top-bottom (lower Λ)
  [1, 0, 1], // 8 - mid-top-mid (∧)
  [1, 2, 1], // 9 - mid-bottom-mid (∨)
];

const WILD_SYMBOL: CrystalCloverSymbol = "WILD";
const MULTIPLIER_SYMBOL: CrystalCloverSymbol = "MULTIPLIER_2X";

/** The 3 BAR-family symbols — a rolled ANY_BAR win renders as a mixed (non-identical) run of
 * these three. */
const BAR_FAMILY: CrystalCloverSymbol[] = ["BAR", "DOUBLE_BAR", "TRIPLE_BAR"];

/** Every win pattern the reels can render — each one is its own outcome row with its own
 * frequency and x value (no Big/Mega/Jackpot grouping). */
export const WIN_RULE_IDS = ["SEVEN_CLOVER", "TRIPLE_BAR", "DOUBLE_BAR", "BAR", "ANY_BAR", "ONE_WILD", "TWO_WILD", "THREE_WILD"] as const;
export type WinRuleId = (typeof WIN_RULE_IDS)[number];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------
//
// Every winning pattern is its own row with its own frequency and x value — there is no
// Big/Mega/Jackpot grouping and no celebration overlay; a win simply pays its pattern's x value.

export type OutcomeKey = "loss" | WinRuleId;
export type SpecialTierKey = "specialEmpty" | "multiplier2x" | "multiplier4x" | "multiplier8x";

export interface OutcomeRow {
  key: OutcomeKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface SpecialTierRow {
  key: SpecialTierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface CrystalCloverRtpConfig {
  targetRtpPercent: number;
  outcomes: OutcomeRow[];
  specialReelTiers: SpecialTierRow[];
  reelStateConfig: { centerRowChancePercent: number };
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-crystalclover-rtp-config";
export const DEFAULT_CRYSTAL_CLOVER_TARGET_RTP_PERCENT = 90.0;

/** Default per-pattern odds and x values: a ~72.4% loss rate and a real spread of whole-number
 * pays (1x up to 50x) at 90% RTP. The pays are already whole, so the house rules (shared/rtpRules)
 * keep them exactly as written instead of rounding sub-1x pays up to 1x — which is what made nearly
 * every win show 1x before. The wilds' unavoidable extra lines are counted (see
 * UNAVOIDABLE_EXTRA_LINES), so this is the RTP actually realized — verified by simulation. */
const BASE_OUTCOMES: OutcomeRow[] = [
  { key: "loss", frequencyPercent: 72.35, payoutMultiplier: null },
  { key: "THREE_WILD", frequencyPercent: 0.1, payoutMultiplier: 50 },
  { key: "TWO_WILD", frequencyPercent: 0.5, payoutMultiplier: 15 },
  { key: "SEVEN_CLOVER", frequencyPercent: 1.6, payoutMultiplier: 8 },
  { key: "TRIPLE_BAR", frequencyPercent: 2.5, payoutMultiplier: 5 },
  { key: "DOUBLE_BAR", frequencyPercent: 3.5, payoutMultiplier: 3 },
  { key: "BAR", frequencyPercent: 5, payoutMultiplier: 2 },
  { key: "ANY_BAR", frequencyPercent: 11.45, payoutMultiplier: 1 },
  { key: "ONE_WILD", frequencyPercent: 3, payoutMultiplier: 2 },
];

/** MULTIPLIER_2X's independent roll — sums to 100% on its own. payoutMultiplier is the ×N
 * actually credited; MULTIPLIER_COPY_COUNT below pairs each row 1:1 with how many MULTIPLIER_2X
 * symbols cosmetically render. */
const BASE_SPECIAL_TIERS: SpecialTierRow[] = [
  { key: "specialEmpty", frequencyPercent: 95, payoutMultiplier: 1 },
  { key: "multiplier2x", frequencyPercent: 4, payoutMultiplier: 2 },
  { key: "multiplier4x", frequencyPercent: 0.8, payoutMultiplier: 4 },
  { key: "multiplier8x", frequencyPercent: 0.2, payoutMultiplier: 8 },
];

/** Chance a reel not forced by the designated win line lands 1-symbol-center vs.
 * 2-symbols-top+bottom — 50/50 out of the box. */
const BASE_REEL_STATE_CONFIG = { centerRowChancePercent: 50 };

export function getCrystalCloverDefaultConfig(): CrystalCloverRtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_CRYSTAL_CLOVER_TARGET_RTP_PERCENT,
    outcomes: BASE_OUTCOMES.map((o) => ({ ...o })),
    specialReelTiers: BASE_SPECIAL_TIERS.map((t) => ({ ...t })),
    reelStateConfig: { ...BASE_REEL_STATE_CONFIG },
  });
}

function isValidConfig(value: unknown): value is CrystalCloverRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    // Old tier-based configs (tiers/ruleTierMap) have no `outcomes` and fall back to the default.
    Array.isArray(v.outcomes) &&
    ["loss", ...WIN_RULE_IDS].every((k) => (v.outcomes as OutcomeRow[]).some((o) => o?.key === k)) &&
    Array.isArray(v.specialReelTiers) &&
    v.specialReelTiers.length > 0 &&
    typeof v.reelStateConfig === "object" &&
    v.reelStateConfig !== null
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getCrystalCloverRtpConfig(): CrystalCloverRtpConfig {
  return loadConfig();
}

/** Saved config (or the default) with the house rules applied — cached per stored string. */
const loadConfig = makeConfigLoader<CrystalCloverRtpConfig>(
  RTP_CONFIG_STORAGE_KEY,
  (raw) => {
    if (raw === null) return getCrystalCloverDefaultConfig();
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isValidConfig(parsed) ? parsed : getCrystalCloverDefaultConfig();
    } catch {
      return getCrystalCloverDefaultConfig();
    }
  },
  applyHouseRules
);


/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(config: CrystalCloverRtpConfig): CrystalCloverRtpConfig {
  const targetRtpPercent = capTargetRtp(config.targetRtpPercent);
  const whole: CrystalCloverRtpConfig = {
    ...config,
    targetRtpPercent,
    outcomes: config.outcomes.map((r) => (r.payoutMultiplier === null ? r : { ...r, payoutMultiplier: wholeX(r.payoutMultiplier) })),
    specialReelTiers: config.specialReelTiers.map((r) => ({ ...r, payoutMultiplier: wholeX(r.payoutMultiplier) })),
  };
  if (Math.abs(computeCrystalCloverRtpPercent(whole) - targetRtpPercent) < 0.05) return whole;
  return { ...whole, outcomes: fitFrequencies(whole.outcomes, (r) => computeCrystalCloverRtpPercent({ ...whole, outcomes: r }), rescaleCrystalCloverOutcomes, targetRtpPercent) };
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setCrystalCloverRtpConfig(config: CrystalCloverRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncCrystalCloverRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("crystal-clover", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveCrystalCloverRtpConfigToServer(config: CrystalCloverRtpConfig): Promise<void> {
  return saveRtpConfigToServer("crystal-clover", config);
}

/**
 * 7 Crystal Clover is outcome-first — one outcome rolled from `outcomes`, then an independent
 * MULTIPLIER_2X roll from `specialReelTiers` applied as a flat multiplier on top. Both are plain
 * weighted rolls over admin-set frequencies/payouts, so this is exact closed-form arithmetic:
 * RTP = baseRTP × E[multiplier effect]. Ported verbatim from paytableConfig.ts's
 * computeCrystalCloverRtpPercent — see the module doc comment on why this is a lower bound, not
 * an exact figure, on the true realized RTP.
 */
export function computeCrystalCloverRtpPercent(config: CrystalCloverRtpConfig): number {
  const pay = (key: WinRuleId) => config.outcomes.find((o) => o.key === key)?.payoutMultiplier ?? 0;
  // What a spin that rolled `o` really pays: its own line, plus the extra wild lines its grid
  // can't avoid (see UNAVOIDABLE_EXTRA_LINES).
  const effectivePay = (o: OutcomeRow) => {
    if (o.key === "loss" || o.payoutMultiplier === null) return 0;
    const extra = UNAVOIDABLE_EXTRA_LINES[o.key] ?? {};
    return o.payoutMultiplier + (Object.entries(extra) as [WinRuleId, number][]).reduce((sum, [k, n]) => sum + n * pay(k), 0);
  };
  const baseRtp = config.outcomes.reduce((sum, o) => sum + (o.frequencyPercent / 100) * effectivePay(o), 0);
  const multiplierEV =
    config.specialReelTiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 1), 0) || 1;
  return baseRtp * multiplierEV * 100;
}

/** Extra paying lines a wild outcome's grid can't avoid, on average per spin. A wild sits in cells
 * that several of the 9 paylines share, and the reel shapes its designated line forces often leave
 * other full lines through that wild — which, by the rules, pay too (resolve() strips every other
 * accidental win). These depend only on the grid's geometry, not on the pays; measured over 400k
 * spins per outcome through spinRequest. Without them the formula undercounts the real RTP. */
const UNAVOIDABLE_EXTRA_LINES: Partial<Record<WinRuleId, Partial<Record<WinRuleId, number>>>> = {
  THREE_WILD: { TWO_WILD: 0.661, ONE_WILD: 0.675 },
  TWO_WILD: { TWO_WILD: 0.227, ONE_WILD: 0.881 },
  ONE_WILD: { ONE_WILD: 0.668 },
};

/** Rescales `outcomes` to land on a new target: every row with a real payoutMultiplier has its
 * frequency scaled by `scale`
 * (clamped at 0), then `loss` absorbs whatever's left so frequencies still sum to exactly 100%.
 * RTP here is linear in the outcome rows' own frequencies (multiplierEV depends only on
 * specialReelTiers, which this never touches), so a single pass lands exactly on target — no
 * iteration needed, unlike Crazy 777. */
export function rescaleCrystalCloverOutcomes(outcomes: OutcomeRow[], scale: number): OutcomeRow[] {
  const scaled = outcomes.map((o) =>
    o.payoutMultiplier !== null ? { ...o, frequencyPercent: Math.max(0, o.frequencyPercent * scale) } : o
  );
  const nonLossSum = scaled.reduce((sum, o) => (o.key === "loss" ? sum : sum + o.frequencyPercent), 0);
  return scaled.map((o) => (o.key === "loss" ? { ...o, frequencyPercent: Math.max(0, 100 - nonLossSum) } : o));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/CrystalClover/{engine,winCalc}.ts

/** Pure structural classifier — does this line's 3 cells form one of the known win patterns? Any
 * `null` (empty) cell means an automatic non-match, since a reel in either 2-state shape always
 * leaves at least one payline's worth of cells empty on it. Mirrors buildSymbolsForRule exactly,
 * in reverse. */
function classifyLine(
  cells: [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null]
): WinRuleId | null {
  if (cells.some((c) => c === null)) return null;
  const [a, b, c] = cells as [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol];

  const wildCount = [a, b, c].filter((s) => s === WILD_SYMBOL).length;
  if (wildCount === 3) return "THREE_WILD";
  if (wildCount === 2) return "TWO_WILD";
  if (wildCount === 1) return "ONE_WILD";

  if (a === b && b === c) {
    if (a === "SEVEN_CLOVER") return "SEVEN_CLOVER";
    if (a === "TRIPLE_BAR") return "TRIPLE_BAR";
    if (a === "DOUBLE_BAR") return "DOUBLE_BAR";
    if (a === "BAR") return "BAR";
    return null; // MULTIPLIER_2X x3 isn't a real win pattern
  }

  if (BAR_FAMILY.includes(a) && BAR_FAMILY.includes(b) && BAR_FAMILY.includes(c)) {
    return "ANY_BAR";
  }

  return null;
}

/** Weighted-random pick of one tier row by frequencyPercent. */
function weightedPick<T extends { frequencyPercent: number }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const row of rows) {
    roll -= row.frequencyPercent;
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

/** How many MULTIPLIER_2X copies to cosmetically place on the grid for each special-reel tier —
 * paired 1:1 with that tier's own admin-editable payoutMultiplier. Purely a display count; the
 * credited factor always comes from the rolled row's own payoutMultiplier, not from this count. */
const MULTIPLIER_COPY_COUNT: Partial<Record<SpecialTierKey, number>> = {
  specialEmpty: 0,
  multiplier2x: 1,
  multiplier4x: 2,
  multiplier8x: 3,
};

const FILLER_POOL: CrystalCloverSymbol[] = ["SEVEN_CLOVER", "BAR", "DOUBLE_BAR", "TRIPLE_BAR"];
function randomFiller(): CrystalCloverSymbol {
  return FILLER_POOL[Math.floor(Math.random() * FILLER_POOL.length)];
}

function randomBarFamily(exclude?: CrystalCloverSymbol): CrystalCloverSymbol {
  const pool = exclude ? BAR_FAMILY.filter((s) => s !== exclude) : BAR_FAMILY;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffle3<T>(items: [T, T, T]): [T, T, T] {
  const arr = [...items] as [T, T, T];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The exact 3-symbol line for a given rule — the only place a rule's cosmetic pattern is
 * defined. */
function buildSymbolsForRule(ruleId: WinRuleId): [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol] {
  switch (ruleId) {
    case "SEVEN_CLOVER":
      return ["SEVEN_CLOVER", "SEVEN_CLOVER", "SEVEN_CLOVER"];
    case "TRIPLE_BAR":
      return ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"];
    case "DOUBLE_BAR":
      return ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"];
    case "BAR":
      return ["BAR", "BAR", "BAR"];
    case "ANY_BAR": {
      const a = randomBarFamily();
      const b = randomBarFamily(a);
      return [a, b, a];
    }
    case "ONE_WILD":
      return shuffle3([WILD_SYMBOL, randomFiller(), randomFiller()]);
    case "TWO_WILD":
      return shuffle3([WILD_SYMBOL, WILD_SYMBOL, randomFiller()]);
    case "THREE_WILD":
      return [WILD_SYMBOL, WILD_SYMBOL, WILD_SYMBOL];
  }
}

function rollReelState(centerRowChancePercent: number): "CENTER" | "TOP_BOTTOM" {
  return Math.random() * 100 < centerRowChancePercent ? "CENTER" : "TOP_BOTTOM";
}

/** Builds the full grid: the designated line (if any) gets `lineSymbols` on its 3 cells, which
 * also forces each of those 3 reels' 2-state shape. A reel the designated line doesn't touch
 * (only possible when there's no designated line at all, i.e. a rolled "loss") rolls its own
 * state via `centerRowChancePercent`. `multiplierCopies` MULTIPLIER_2X symbols are then
 * sprinkled onto cells that are outside the designated line AND already hold a real filler
 * symbol (never onto an empty slot, which would break a reel's 2-state shape). */
function buildGrid(
  designatedLineIndex: number | null,
  lineSymbols: [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol] | null,
  multiplierCopies: number,
  centerRowChancePercent: number
): Grid {
  const grid: (CrystalCloverSymbol | null)[][] = Array.from({ length: REEL_COUNT }, () => new Array(ROW_COUNT).fill(null));
  const designatedCells = new Set<string>();
  if (designatedLineIndex !== null) {
    PAYLINES[designatedLineIndex].forEach((row, reel) => designatedCells.add(`${reel},${row}`));
  }

  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const requiredRow = designatedLineIndex !== null ? PAYLINES[designatedLineIndex][reel] : null;

    if (requiredRow !== null && lineSymbols) {
      const requiredSymbol = lineSymbols[reel];
      if (requiredRow === 1) {
        grid[reel][1] = requiredSymbol; // center-only — rows 0/2 stay null
      } else {
        grid[reel][requiredRow] = requiredSymbol;
        grid[reel][requiredRow === 0 ? 2 : 0] = randomFiller(); // top+bottom — row 1 stays null
      }
    } else {
      const state = rollReelState(centerRowChancePercent);
      if (state === "CENTER") {
        grid[reel][1] = randomFiller();
      } else {
        grid[reel][0] = randomFiller();
        grid[reel][2] = randomFiller();
      }
    }
  }

  if (multiplierCopies > 0) {
    const eligible: [number, number][] = [];
    for (let reel = 0; reel < REEL_COUNT; reel++) {
      for (let row = 0; row < ROW_COUNT; row++) {
        if (designatedCells.has(`${reel},${row}`)) continue;
        if (grid[reel][row] === null) continue;
        eligible.push([reel, row]);
      }
    }
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    eligible.slice(0, multiplierCopies).forEach(([reel, row]) => (grid[reel][row] = MULTIPLIER_SYMBOL));
  }

  return grid as Grid;
}

/** Checks all 9 PAYLINES against the built grid and pays every one that matches, summed — not
 * just the designated line. Each matched line pays its own pattern's x value. */
function evaluateAllLines(
  grid: Grid,
  config: CrystalCloverRtpConfig,
  betMultiplier: number
): { lineWins: LineWin[]; totalLineWin: number; winningPositions: [number, number][] } {
  const lineWins: LineWin[] = [];
  let totalLineWin = 0;
  const winningPositions: [number, number][] = [];
  const seenPositions = new Set<string>();

  PAYLINES.forEach((line, lineIdx) => {
    const cells = line.map((row, reel) => grid[reel][row]) as [
      CrystalCloverSymbol | null,
      CrystalCloverSymbol | null,
      CrystalCloverSymbol | null,
    ];
    const ruleId = classifyLine(cells);
    if (!ruleId) return;

    const basePayout = payoutForRule(ruleId, config);
    if (basePayout <= 0) return;

    const symbols = cells as [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol];
    const isPureWild = ruleId === "ONE_WILD" || ruleId === "TWO_WILD" || ruleId === "THREE_WILD";
    const isAnyBar = ruleId === "ANY_BAR";
    const wildCount = symbols.filter((s) => s === WILD_SYMBOL).length;
    const positions: [number, number][] = line.map((row, reel) => [reel, row] as [number, number]);
    const lineFinalWin = basePayout * betMultiplier;

    lineWins.push({
      lineNumber: lineIdx + 1,
      symbol: isPureWild ? WILD_SYMBOL : symbols[0],
      matchCount: 3,
      basePayout,
      wildCount,
      wildMultiplier: 1,
      betMultiplier,
      finalWin: lineFinalWin,
      positions,
      isPureWild,
      isAnyBar,
    });
    totalLineWin += lineFinalWin;

    for (const pos of positions) {
      const key = `${pos[0]},${pos[1]}`;
      if (!seenPositions.has(key)) {
        seenPositions.add(key);
        winningPositions.push(pos);
      }
    }
  });

  return { lineWins, totalLineWin, winningPositions };
}

/** Re-draws allowed per spin while looking for a grid that pays exactly the rolled outcome (see
 * resolve) — each try succeeds most of the time, so this is only ever a safety cap. */
const MAX_GRID_ATTEMPTS = 200;

function resolve(
  outcome: OutcomeRow,
  totalBet: number,
  config: CrystalCloverRtpConfig
): { grid: Grid; evaluation: SpinEvaluation; winAmount: number } {
  const multiplierRow = weightedPick(config.specialReelTiers);
  const multiplierFactor = multiplierRow?.payoutMultiplier ?? 1;
  const multiplierCopies = (multiplierRow && MULTIPLIER_COPY_COUNT[multiplierRow.key]) ?? 0;

  let lineIndex: number | null = null;
  let lineSymbols: [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol] | null = null;

  if (outcome.key !== "loss") {
    lineIndex = Math.floor(Math.random() * PAYLINES.length);
    lineSymbols = buildSymbolsForRule(outcome.key);
  }

  // The grid's filler cells are random, and across 9 paylines they often form extra wins by
  // accident — which paid out far above the configured odds (measured ~172% realized RTP on the
  // old defaults, vs the 90% configured). So re-draw the filler until the grid pays exactly the
  // rolled outcome: nothing on a loss, only the designated line on a win. A clean grid turns up
  // within a few tries; MAX_GRID_ATTEMPTS is just a safety net.
  // Some wild wins can't avoid it (other full lines run through the same wild cell) — then the
  // grid paying the least is kept.
  let grid = buildGrid(lineIndex, lineSymbols, multiplierCopies, config.reelStateConfig.centerRowChancePercent);
  let result = evaluateAllLines(grid, config, totalBet);
  const expectedLines = lineIndex === null ? 0 : 1;
  for (let attempt = 1; attempt < MAX_GRID_ATTEMPTS && result.lineWins.length !== expectedLines; attempt++) {
    const nextGrid = buildGrid(lineIndex, lineSymbols, multiplierCopies, config.reelStateConfig.centerRowChancePercent);
    const next = evaluateAllLines(nextGrid, config, totalBet);
    if (next.totalLineWin < result.totalLineWin) {
      grid = nextGrid;
      result = next;
    }
  }
  const { lineWins, totalLineWin, winningPositions } = result;
  const finalWin = totalLineWin * multiplierFactor;
  const winAmount = Math.round(finalWin * 100) / 100;

  const evaluation: SpinEvaluation = {
    lineWins,
    totalLineWin,
    multiplierCount: multiplierCopies,
    multiplierFactor,
    finalWin,
    winningPositions,
  };

  return { grid, evaluation, winAmount };
}

/** Runs one local, outcome-first spin: the outcome is decided first (by frequency), then the grid
 * is synthesized to match — same algorithm as the old backend's engine.ts. `currentBalance` is
 * the player's balance right before this spin — the new balance (bet deducted, win credited) is
 * computed here and returned. Resolves on the same tick (no network involved), kept as an async
 * function purely so call sites can keep using `await spinRequest(...)` unchanged. */
export async function spinRequest(betLevel: number, currentBalance = 0): Promise<SpinResponse> {
  const config = getCrystalCloverRtpConfig();
  const outcome = weightedPick(config.outcomes) ?? { key: "loss" as const, frequencyPercent: 100, payoutMultiplier: null };
  const { grid, evaluation, winAmount } = resolve(outcome, betLevel, config);

  const balance = Math.round((currentBalance - betLevel + winAmount) * 100) / 100;

  return { grid, evaluation, winAmount, balance, meta: { forced: false } };
}

/** The x value a win pattern pays — its own outcome row's payoutMultiplier. */
function payoutForRule(ruleId: WinRuleId, config: CrystalCloverRtpConfig): number {
  return config.outcomes.find((o) => o.key === ruleId)?.payoutMultiplier ?? 0;
}

export async function getCrystalCloverConfig(): Promise<CrystalCloverConfigResponse> {
  const config = getCrystalCloverRtpConfig();

  const paytable: PaytableRow[] = (["SEVEN_CLOVER", "TRIPLE_BAR", "DOUBLE_BAR", "BAR"] as const).map((symbol) => ({
    symbol,
    payout: payoutForRule(symbol, config),
  }));

  return {
    meta: {
      id: "crystal-clover",
      name: "7 Crystal Clover",
      description: "Classic 3-reel, 9-line slot with wild substitution and a 2X multiplier symbol",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    betLevels: BET_LEVELS,
    minBet: BET_LEVELS[0],
    maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    paylineCount: PAYLINES.length,
    paylines: PAYLINES as [number, number, number][],
    paytable,
    anyBarPayout: payoutForRule("ANY_BAR", config),
    wild: {
      symbol: "WILD",
      multiplierBase: 2,
      purePayout: {
        1: payoutForRule("ONE_WILD", config),
        2: payoutForRule("TWO_WILD", config),
        3: payoutForRule("THREE_WILD", config),
      },
    },
    multiplier: { symbol: "MULTIPLIER_2X", base: 2 },
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
  await apiClient.post("/api/games/crystal-clover/spin-log", { ...params, tier: null });
}
