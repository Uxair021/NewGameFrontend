/**
 * Crazy 777's RNG, paytable, and balance are all computed entirely in the browser — RTP and odds
 * are configured client-side (see the RTP control below) and every spin resolves locally, on the
 * same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/Crazy777/{config,engine,winTiers}.ts`,
 * using the exact same tier weights/payout multipliers/respin range/joint-EV RTP formula that
 * previously came from `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["crazy-777"]`
 * and its `computeCrazy777RtpPercent`. Kept as the same exported function names/signatures as the
 * old network calls (`spinRequest`, `getCrazy777Config`) so `Crazy777Game.tsx` didn't need type
 * changes — `spinRequest` gains one new parameter (`currentBalance`), the same shape every other
 * already-offline game's `spinRequest` uses, since this game's `SpinResponse` (like theirs)
 * already carries a `balance` field.
 *
 * There's no respin *round* state to track here at all: the server never tracked one either (no
 * round-doc equivalent, see routes.ts's stateless /spin handler) — respin remaining/total
 * bookkeeping has always lived entirely in Crazy777Game.tsx's own React state, one spin at a time,
 * so this file stays a fully stateless, self-contained per-call function, same as Shamrock Spin's.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/Crazy777/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so Crazy 777 spins show up in the
 * admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type CrazySymbol = "SEVEN_LOW" | "SEVEN_MID" | "SEVEN_HIGH" | "SINGLE_BAR" | "DOUBLE_BAR";

export type SpecialSymbol = "MULT_2X" | "MULT_5X" | "MULT_10X" | "DOLLAR_PLUS" | "DOUBLE_DOLLAR_PLUS" | "RESPIN";

export interface PayoutRow {
  symbol: CrazySymbol | "ANY_SEVEN" | "ANY_BAR" | "ANY_GLOBAL";
  payout: number;
}

export interface SpecialPayoutRow {
  symbol: SpecialSymbol;
  label: string;
  effect: string;
  /** Bet-multiplier bonus for DOLLAR_PLUS/DOUBLE_DOLLAR_PLUS (finalWin = baseWin + this × bet) — null for the others. */
  betMultiplier: number | null;
}

export interface SpinResponse {
  reels: [CrazySymbol, CrazySymbol, CrazySymbol][];
  lineSymbols: [CrazySymbol, CrazySymbol, CrazySymbol];
  specialReel: [SpecialSymbol, SpecialSymbol, SpecialSymbol];
  lineWinTierKey: string | null;
  baseWin: number;
  winAmount: number;
  respinsAwarded: number;
  /** True when reel 4 landed a bonus that gets the backdrop/border glow (5X, 10X, $$+) — a
   * visual effect only, not a Big/Mega/Jackpot tier. */
  specialGlowBackdrop: boolean;
  /** Which of reels 0-2 (if any) should land physically between two symbols instead of
   * squarely on one — how a loss is represented (no separate "EMPTY" symbol). */
  emptyReelIndex: number | null;
  /** True when the special reel should land physically between two symbols (no bonus this round). */
  specialIsHalfStop: boolean;
  balance: number;
  meta: { forced: boolean };
}

export interface Crazy777ConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: PayoutRow[];
  specialPaytable: SpecialPayoutRow[];
  betLevels: number[];
}

// --- Game shape — ported verbatim from backEnd/src/games/Crazy777/config.ts -----------------

const DISPLAY_SYMBOLS: CrazySymbol[] = ["SEVEN_LOW", "SEVEN_MID", "SEVEN_HIGH", "SINGLE_BAR", "DOUBLE_BAR"];
const SPECIAL_SYMBOLS: SpecialSymbol[] = ["MULT_2X", "MULT_5X", "MULT_10X", "DOLLAR_PLUS", "DOUBLE_DOLLAR_PLUS", "RESPIN"];

const SEVEN_SYMBOLS: ReadonlySet<CrazySymbol> = new Set(["SEVEN_LOW", "SEVEN_MID", "SEVEN_HIGH"]);
const BAR_SYMBOLS: ReadonlySet<CrazySymbol> = new Set(["SINGLE_BAR", "DOUBLE_BAR"]);

const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

/** Cosmetic/display reference for reel 4's effects — not admin-tunable, matches every other
 * offline game's REFERENCE_PAYTABLE-style constant. */
const REFERENCE_SPECIAL_PAYTABLE: SpecialPayoutRow[] = [
  { symbol: "MULT_10X", label: "10X", effect: "Base win × 10", betMultiplier: null },
  { symbol: "MULT_5X", label: "5X", effect: "Base win × 5", betMultiplier: null },
  { symbol: "MULT_2X", label: "2X", effect: "Base win × 2", betMultiplier: null },
  { symbol: "DOUBLE_DOLLAR_PLUS", label: "$$+", effect: "+ bonus on top of base win", betMultiplier: 8 },
  { symbol: "DOLLAR_PLUS", label: "$+", effect: "+ bonus on top of base win", betMultiplier: 3 },
  { symbol: "RESPIN", label: "RESPIN", effect: "1-5 free re-spins", betMultiplier: null },
];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export type LineTierKey =
  | "loss"
  | "singleBar"
  | "doubleBar"
  | "sevenLow"
  | "sevenMid"
  | "sevenHigh"
  | "anySeven"
  | "anyBar"
  | "anyGlobal";

export type SpecialTierKey =
  | "multiplier2x"
  | "multiplier5x"
  | "multiplier10x"
  | "dollarPlus"
  | "doubleDollarPlus"
  | "respin"
  | "specialEmpty";

export interface LineTierRow {
  key: LineTierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface SpecialTierRow {
  key: SpecialTierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface Crazy777RtpConfig {
  targetRtpPercent: number;
  tiers: LineTierRow[];
  specialReelTiers: SpecialTierRow[];
  respinRange: { min: number; max: number };
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-crazy777-rtp-config";
export const DEFAULT_CRAZY777_TARGET_RTP_PERCENT = 90;

/** Default line odds: a ~78% loss rate at 90% RTP (verified by simulating the real spinRequest,
 * respin rounds included). Pays are small because reel 4 multiplies or adds to every line win.
 * Reels 1-3 win on an exact 3-of-a-kind OR a mixed-family combo (anySeven/anyBar/anyGlobal —
 * confirmed against a reference build). */
const BASE_TIERS: LineTierRow[] = [
  { key: "loss", frequencyPercent: 78.2, payoutMultiplier: null },
  { key: "singleBar", frequencyPercent: 1.966, payoutMultiplier: 2 },
  { key: "doubleBar", frequencyPercent: 1.092, payoutMultiplier: 3 },
  { key: "sevenLow", frequencyPercent: 0.546, payoutMultiplier: 5 },
  { key: "sevenMid", frequencyPercent: 0.218, payoutMultiplier: 10 },
  { key: "sevenHigh", frequencyPercent: 0.066, payoutMultiplier: 25 },
  { key: "anySeven", frequencyPercent: 2.622, payoutMultiplier: 2 },
  { key: "anyBar", frequencyPercent: 5.462, payoutMultiplier: 1 },
  { key: "anyGlobal", frequencyPercent: 9.828, payoutMultiplier: 1 },
];

/** Reel 4's own, fully independent weighted table (sums to 100% on its own, separate from
 * `tiers`' 100% sum) — payoutMultiplier here is the ×N actually credited for multiplier2x/5x/10x,
 * and the bet-multiplier bonus added on top of baseWin for dollarPlus/doubleDollarPlus. */
const BASE_SPECIAL_TIERS: SpecialTierRow[] = [
  { key: "multiplier2x", frequencyPercent: 45, payoutMultiplier: 2 },
  { key: "multiplier5x", frequencyPercent: 6, payoutMultiplier: 5 },
  { key: "multiplier10x", frequencyPercent: 1, payoutMultiplier: 10 },
  { key: "dollarPlus", frequencyPercent: 12, payoutMultiplier: 3 },
  { key: "doubleDollarPlus", frequencyPercent: 2, payoutMultiplier: 8 },
  { key: "respin", frequencyPercent: 6, payoutMultiplier: null },
  { key: "specialEmpty", frequencyPercent: 28, payoutMultiplier: null },
];

const BASE_RESPIN_RANGE = { min: 1, max: 5 };

/** Reel-4 bonuses that get the backdrop/border glow when they pay — the same three that used to
 * carry a celebration (there are no Big/Mega/Jackpot tiers anymore; this is only the visual). */
const GLOW_BACKDROP_SPECIAL_TIERS: ReadonlySet<SpecialTierKey> = new Set(["multiplier5x", "multiplier10x", "doubleDollarPlus"]);

export function getCrazy777DefaultConfig(): Crazy777RtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_CRAZY777_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
    specialReelTiers: BASE_SPECIAL_TIERS.map((t) => ({ ...t })),
    respinRange: { ...BASE_RESPIN_RANGE },
  });
}

/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(input: Crazy777RtpConfig): Crazy777RtpConfig {
  const config: Crazy777RtpConfig = {
    ...input,
    targetRtpPercent: capTargetRtp(input.targetRtpPercent),
    tiers: input.tiers.map((t) => ({ ...t, payoutMultiplier: wholeX(t.payoutMultiplier) })),
    specialReelTiers: input.specialReelTiers.map((t) => ({ ...t, payoutMultiplier: wholeX(t.payoutMultiplier) })),
  };
  const rtp = computeCrazy777RtpPercent(config);
  if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - config.targetRtpPercent) < 0.05) return config;
  // RESPIN's retrigger term moves with the line rows too, so iterate (same loop as the admin page).
  let tiers = config.tiers;
  for (let i = 0; i < 40; i++) {
    const current = computeCrazy777RtpPercent({ ...config, tiers });
    if (!Number.isFinite(current) || current <= 0 || Math.abs(current - config.targetRtpPercent) < 0.005) break;
    tiers = rescaleCrazy777Tiers(tiers, config.targetRtpPercent / current);
  }
  return { ...config, tiers };
}

function isValidConfig(value: unknown): value is Crazy777RtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0 &&
    Array.isArray(v.specialReelTiers) &&
    v.specialReelTiers.length > 0 &&
    typeof v.respinRange === "object" &&
    v.respinRange !== null
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getCrazy777RtpConfig(): Crazy777RtpConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
  } catch {
    /* storage unavailable — use the default */
  }
  if (fittedCache && fittedCache.raw === raw) return fittedCache.config;
  let config = getCrazy777DefaultConfig();
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidConfig(parsed)) config = parsed;
    } catch {
      /* corrupt — use the default */
    }
  }
  config = applyHouseRules(config);
  fittedCache = { raw, config };
  return config;
}

/** Last config read, keyed by the raw stored string — spinRequest reads the config every spin. */
let fittedCache: { raw: string | null; config: Crazy777RtpConfig } | null = null;

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setCrazy777RtpConfig(config: Crazy777RtpConfig): void {
  fittedCache = null;
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncCrazy777RtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("crazy-777", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveCrazy777RtpConfigToServer(config: Crazy777RtpConfig): Promise<void> {
  return saveRtpConfigToServer("crazy-777", config);
}

/** Crazy 777 only — final win per unit bet for one (line tier, special tier) combination.
 * Multiplier special tiers scale baseWin; dollar-bonus special tiers add a flat bet-scaled
 * amount on top; RESPIN (and any other tier) passes baseWin through unchanged for *this* spin —
 * its extra value is folded in separately below as a first-order retrigger term. specialEmpty
 * never actually pays out as itself — see resolveSpin — a line win always resolves it into a
 * weighted-random pick among the other real special tiers, so its RTP contribution is that same
 * frequency-weighted average, not zero. Ported verbatim from paytableConfig.ts. */
function crazy777FinalWinPerBet(lineTier: LineTierRow, specialTier: SpecialTierRow, specialTiers: SpecialTierRow[]): number {
  if (lineTier.key === "loss" || lineTier.payoutMultiplier === null) return 0;
  const baseWin = lineTier.payoutMultiplier;

  if (specialTier.key === "specialEmpty") {
    const realTiers = specialTiers.filter((t) => t.key !== "specialEmpty");
    const realTotal = realTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
    if (realTotal === 0) return baseWin;
    return realTiers.reduce(
      (sum, t) => sum + (t.frequencyPercent / realTotal) * crazy777FinalWinPerBet(lineTier, t, specialTiers),
      0
    );
  }

  switch (specialTier.key) {
    case "multiplier2x":
    case "multiplier5x":
    case "multiplier10x":
      return baseWin * (specialTier.payoutMultiplier ?? 1);
    case "dollarPlus":
    case "doubleDollarPlus":
      return baseWin + (specialTier.payoutMultiplier ?? 0);
    default:
      return baseWin;
  }
}

/**
 * Crazy 777 has two fully independent weighted tables (line tiers × special-reel tiers), so RTP
 * is the *exact* joint EV over every combination (cheap — a handful of rows each way), plus a
 * first-order term for RESPIN's retrigger value: P(line win) × P(special=RESPIN) × average
 * respins granted × the same joint EV (treating each awarded respin as worth another full spin's
 * EV). Ported verbatim from paytableConfig.ts's computeCrazy777RtpPercent.
 */
export function computeCrazy777RtpPercent(config: Crazy777RtpConfig): number {
  const specialTiers = config.specialReelTiers;
  let jointEV = 0;
  for (const line of config.tiers) {
    for (const special of specialTiers) {
      jointEV +=
        (line.frequencyPercent / 100) * (special.frequencyPercent / 100) * crazy777FinalWinPerBet(line, special, specialTiers);
    }
  }

  const pLineWin =
    config.tiers.filter((t) => t.key !== "loss" && t.payoutMultiplier !== null).reduce((sum, t) => sum + t.frequencyPercent, 0) /
    100;
  const respinTier = specialTiers.find((t) => t.key === "respin");
  const specialEmptyTier = specialTiers.find((t) => t.key === "specialEmpty");
  const realTiers = specialTiers.filter((t) => t.key !== "specialEmpty");
  const realTotal = realTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  // A line win can reach RESPIN two ways: rolling it directly, or rolling specialEmpty and
  // having its weighted-random reveal land on respin — see crazy777FinalWinPerBet.
  const pRespinDirect = respinTier ? respinTier.frequencyPercent / 100 : 0;
  const pRespinViaReveal =
    specialEmptyTier && respinTier && realTotal > 0
      ? (specialEmptyTier.frequencyPercent / 100) * (respinTier.frequencyPercent / realTotal)
      : 0;
  const pRespin = pRespinDirect + pRespinViaReveal;
  const avgRespins = (config.respinRange.min + config.respinRange.max) / 2;
  // A respin keeps reel 4 frozen on RESPIN (see resolveSpin), so it pays only the plain line win
  // — no multiplier, bonus or retrigger — not another full spin's jointEV.
  const lineEV = config.tiers.reduce((sum, t) => (t.key === "loss" ? sum : sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0)), 0);
  const extraRtp = pLineWin * pRespin * avgRespins * lineEV;

  // Respin round minimum: a round whose respins all lost has its last respin land the cheapest
  // line that covers RESPIN_ROUND_MIN_WIN_X (see guaranteedLineTierFor). Rounds award a uniform
  // min..max respins, each losing with the line table's own Loss odds.
  const pLoss = (config.tiers.find((t) => t.key === "loss")?.frequencyPercent ?? 0) / 100;
  const { min, max } = config.respinRange;
  let pAllLose = 0;
  for (let k = min; k <= max; k++) pAllLose += Math.pow(pLoss, k) / (max - min + 1);
  const guaranteed = guaranteedLineTierFor(config.tiers, RESPIN_ROUND_MIN_WIN_X);
  const minimumRtp = pLineWin * pRespin * pAllLose * (guaranteed?.payoutMultiplier ?? 0);

  return (jointEV + extraRtp + minimumRtp) * 100;
}

/** The respins of a respin round pay at least this x of the round's bet in total — a round still
 * short going into its last respin has that respin land a real winning line. */
export const RESPIN_ROUND_MIN_WIN_X = 1;

/** The lowest-paying winning line tier whose pay covers `shortfallX` — or the best one if none does. */
function guaranteedLineTierFor(tiers: LineTierRow[], shortfallX: number): LineTierRow | null {
  const byPay = tiers.filter((t) => t.key !== "loss" && (t.payoutMultiplier ?? 0) > 0).sort((a, b) => (a.payoutMultiplier ?? 0) - (b.payoutMultiplier ?? 0));
  if (byPay.length === 0) return null;
  return byPay.find((t) => (t.payoutMultiplier ?? 0) >= shortfallX - 1e-9) ?? byPay[byPay.length - 1];
}

/** How many x of the bet a respin round is still short of its minimum (0 = already met). */
export function getRespinShortfallX(betAmount: number, respinWinnings: number): number {
  if (betAmount <= 0) return 0;
  const shortfall = RESPIN_ROUND_MIN_WIN_X - respinWinnings / betAmount;
  return shortfall > 1e-9 ? shortfall : 0;
}

/** Rescales the line tiers to land on a new target — identical technique to the generic admin
 * page's own `rescaleLineTiers`: every tier with a real payoutMultiplier has its frequency scaled
 * by `scale` (clamped at 0), then `loss` absorbs whatever's left so frequencies still sum to
 * exactly 100%. Because RESPIN's retrigger term depends on both pLineWin and jointEV (both of
 * which move when line frequencies scale), a single pass lands close but not exact — the admin
 * page calls this a few times in a loop, same as AdminRtpPage.tsx does for this same game. */
export function rescaleCrazy777Tiers(tiers: LineTierRow[], scale: number): LineTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/Crazy777/engine.ts -------------

/** Exact 3-of-a-kind tiers map 1:1 to a single symbol. anySeven/anyBar/anyGlobal are mixed-
 * family combos — confirmed against a reference build that these are real wins too, not just
 * decorative ladder rows. */
const LINE_TIER_SYMBOL: Partial<Record<LineTierKey, CrazySymbol>> = {
  sevenLow: "SEVEN_LOW",
  sevenMid: "SEVEN_MID",
  sevenHigh: "SEVEN_HIGH",
  singleBar: "SINGLE_BAR",
  doubleBar: "DOUBLE_BAR",
};

const SPECIAL_TIER_SYMBOL: Partial<Record<SpecialTierKey, SpecialSymbol>> = {
  multiplier2x: "MULT_2X",
  multiplier5x: "MULT_5X",
  multiplier10x: "MULT_10X",
  dollarPlus: "DOLLAR_PLUS",
  doubleDollarPlus: "DOUBLE_DOLLAR_PLUS",
  respin: "RESPIN",
  // specialEmpty has no symbol mapping — it lands as a half-stop (see resolveSpin), using a
  // random real symbol as its nominal target via the `?? randomSpecialSymbol()` fallback.
};

/** Maps each line tier key to the display symbol its ladder row/LCD represents — ported from
 * routes.ts's LINE_TIER_DISPLAY, used only by getCrazy777Config's cosmetic paytable. */
const LINE_TIER_DISPLAY: Partial<Record<LineTierKey, PayoutRow["symbol"]>> = {
  sevenHigh: "SEVEN_HIGH",
  sevenMid: "SEVEN_MID",
  sevenLow: "SEVEN_LOW",
  doubleBar: "DOUBLE_BAR",
  singleBar: "SINGLE_BAR",
  anySeven: "ANY_SEVEN",
  anyBar: "ANY_BAR",
  anyGlobal: "ANY_GLOBAL",
};

const SPECIAL_TIER_DISPLAY: Partial<Record<SpecialTierKey, SpecialSymbol>> = {
  multiplier2x: "MULT_2X",
  multiplier5x: "MULT_5X",
  multiplier10x: "MULT_10X",
  dollarPlus: "DOLLAR_PLUS",
  doubleDollarPlus: "DOUBLE_DOLLAR_PLUS",
  respin: "RESPIN",
};

function randomSymbol(): CrazySymbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

function randomFrom(pool: ReadonlySet<CrazySymbol>): CrazySymbol {
  const arr = [...pool];
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomSpecialSymbol(): SpecialSymbol {
  return SPECIAL_SYMBOLS[Math.floor(Math.random() * SPECIAL_SYMBOLS.length)];
}

/** A loss doesn't need special symbol selection — one reel lands half-stopped (see
 * emptyReelIndex in resolveSpin), which alone guarantees no tier can match regardless of what
 * the other two reels show, so all 3 are just independent random real symbols. */
function buildLossLine(): [CrazySymbol, CrazySymbol, CrazySymbol] {
  return [randomSymbol(), randomSymbol(), randomSymbol()];
}

/** Constructs the exact 3-symbol line for a given line tier. */
function buildLineForTier(tierKey: LineTierKey): [CrazySymbol, CrazySymbol, CrazySymbol] {
  const symbol = LINE_TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];

  if (tierKey === "anySeven") {
    let line: [CrazySymbol, CrazySymbol, CrazySymbol];
    do {
      line = [randomFrom(SEVEN_SYMBOLS), randomFrom(SEVEN_SYMBOLS), randomFrom(SEVEN_SYMBOLS)];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  if (tierKey === "anyBar") {
    let line: [CrazySymbol, CrazySymbol, CrazySymbol];
    do {
      line = [randomFrom(BAR_SYMBOLS), randomFrom(BAR_SYMBOLS), randomFrom(BAR_SYMBOLS)];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  if (tierKey === "anyGlobal") {
    // A genuine mix of both families (not identical, not all-seven, not all-bar) — everything
    // else among the real symbols falls here by elimination.
    let line: [CrazySymbol, CrazySymbol, CrazySymbol];
    do {
      line = [randomSymbol(), randomSymbol(), randomSymbol()];
    } while (
      (line[0] === line[1] && line[1] === line[2]) ||
      line.every((s) => SEVEN_SYMBOLS.has(s)) ||
      line.every((s) => BAR_SYMBOLS.has(s))
    );
    return line;
  }

  return buildLossLine();
}

function buildReel(middle: CrazySymbol): [CrazySymbol, CrazySymbol, CrazySymbol] {
  return [randomSymbol(), middle, randomSymbol()];
}

function buildSpecialReel(middle: SpecialSymbol): [SpecialSymbol, SpecialSymbol, SpecialSymbol] {
  return [randomSpecialSymbol(), middle, randomSpecialSymbol()];
}

/** Weighted-random pick of one tier row by frequencyPercent. */
function rollTier<T extends { frequencyPercent: number }>(tiers: T[]): T {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Uniform-random integer in [min, max], inclusive. */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Placeholder tier used to keep the special reel showing RESPIN during a respin round — never
 * actually rolled, so its frequencyPercent/payoutMultiplier are irrelevant. */
const FROZEN_RESPIN_TIER: SpecialTierRow = { key: "respin", frequencyPercent: 100, payoutMultiplier: null };

interface ResolvedSpin {
  reels: [CrazySymbol, CrazySymbol, CrazySymbol][];
  lineSymbols: [CrazySymbol, CrazySymbol, CrazySymbol];
  specialReel: [SpecialSymbol, SpecialSymbol, SpecialSymbol];
  lineWinTierKey: LineTierKey | null;
  baseWin: number;
  finalWin: number;
  respinsAwarded: number;
  specialGlowBackdrop: boolean;
  emptyReelIndex: number | null;
  specialIsHalfStop: boolean;
}

function resolveSpin(
  betAmount: number,
  lineTier: LineTierRow,
  specialTier: SpecialTierRow,
  config: Crazy777RtpConfig,
  isRespin = false
): ResolvedSpin {
  const isLineLoss = lineTier.key === "loss";
  const lineSymbols = isLineLoss ? buildLossLine() : buildLineForTier(lineTier.key);
  const emptyReelIndex = isLineLoss ? Math.floor(Math.random() * 3) : null;
  const reels: [CrazySymbol, CrazySymbol, CrazySymbol][] = [
    buildReel(lineSymbols[0]),
    buildReel(lineSymbols[1]),
    buildReel(lineSymbols[2]),
  ];

  // Base Win = Pay × Bet.
  const baseWin = lineTier.key === "loss" ? 0 : Math.round((lineTier.payoutMultiplier ?? 0) * betAmount * 100) / 100;

  const isSpecialEmpty = !isRespin && specialTier.key === "specialEmpty";

  // A specialEmpty roll always renders as a half-stop (reel pauses between two symbols) for
  // suspense. If reels 1-3 already won, the shake+drop reveal must resolve onto a real bonus and
  // genuinely pay it, so a weighted-random pick among the other real special tiers stands in as
  // the reel's true target here. If reels 1-3 lost, there's nothing to reveal — the reel just
  // stays half-stopped, purely cosmetic.
  let effectiveSpecialTier = specialTier;
  if (isSpecialEmpty && baseWin > 0) {
    const realTiers = config.specialReelTiers.filter((t) => t.key !== "specialEmpty");
    if (realTiers.length > 0) effectiveSpecialTier = rollTier(realTiers);
  }

  const specialSymbol = SPECIAL_TIER_SYMBOL[effectiveSpecialTier.key] ?? randomSpecialSymbol();
  const specialReel = buildSpecialReel(specialSymbol);

  let finalWin = baseWin;
  let respinsAwarded = 0;
  let specialGlowBackdrop = false;

  // During a respin round the special reel is frozen (held on RESPIN, not re-rolled) — no
  // multiplier/bonus/celebration/re-trigger this round, it just pays the plain line win.
  if (baseWin > 0 && !isRespin) {
    specialGlowBackdrop = GLOW_BACKDROP_SPECIAL_TIERS.has(effectiveSpecialTier.key);
    switch (effectiveSpecialTier.key) {
      case "multiplier2x":
      case "multiplier5x":
      case "multiplier10x":
        finalWin = Math.round(baseWin * (effectiveSpecialTier.payoutMultiplier ?? 1) * 100) / 100;
        break;
      case "dollarPlus":
      case "doubleDollarPlus": {
        const bonus = Math.round((effectiveSpecialTier.payoutMultiplier ?? 0) * betAmount * 100) / 100;
        finalWin = Math.round((baseWin + bonus) * 100) / 100;
        break;
      }
      case "respin": {
        respinsAwarded = randomInRange(config.respinRange.min, config.respinRange.max);
        break;
      }
      default:
        // specialEmpty (only possible here if no real tiers were configured to reveal): no
        // bonus, finalWin stays = baseWin.
        break;
    }
  }

  return {
    reels,
    lineSymbols,
    specialReel,
    lineWinTierKey: isLineLoss ? null : lineTier.key,
    baseWin,
    finalWin,
    respinsAwarded,
    specialGlowBackdrop,
    emptyReelIndex,
    specialIsHalfStop: isSpecialEmpty,
  };
}

/** TESTING ONLY — true = every spin's reels 1-3 land a winning pattern on the payline (a random
 * winning tier, weighted by its frequency: 3 of a kind, any 7s, any BARs or any mix). The special
 * reel still rolls normally. MUST be false before going live. */
export const FORCE_LINE_WIN = false;

/** TESTING ONLY — true = reel 4 (the special reel) always lands RESPIN on a paid spin. RESPIN only
 * awards respins when reels 1-3 also win, so pair it with FORCE_LINE_WIN to get a respin round on
 * every spin. MUST be false before going live. */
export const FORCE_RESPIN = false;

/** Runs one local, outcome-first spin: the line tier and the special tier are each decided first
 * (independently, from the two separate frequency tables), then reel symbols are built to match
 * exactly — same algorithm as the old backend's engine.ts. During a respin round (isRespin) the
 * special tier is never rolled — the special reel stays frozen on RESPIN for the whole bonus
 * round, only reels 1-3 spin. `currentBalance` is the player's balance right before this spin —
 * the new balance (bet deducted, win credited) is computed here and returned. Resolves on the
 * same tick (no network involved), kept as an async function purely so call sites can keep using
 * `await spinRequest(...)` unchanged. */
export async function spinRequest(
  betAmount: number,
  respin = false,
  currentBalance = 0,
  /** A respin round's last respin only: how many x of the bet its respins are still short. */
  guaranteeShortfallX = 0
): Promise<SpinResponse> {
  const config = getCrazy777RtpConfig();
  const winningLineTiers = config.tiers.filter((t) => t.key !== "loss" && (t.payoutMultiplier ?? 0) > 0);
  let lineTier = FORCE_LINE_WIN && winningLineTiers.length > 0 ? rollTier(winningLineTiers) : rollTier(config.tiers);
  // Still short of the round minimum on the round's last respin → a real line that covers it.
  if (respin && guaranteeShortfallX > 0 && (lineTier.payoutMultiplier ?? 0) < guaranteeShortfallX - 1e-9) {
    lineTier = guaranteedLineTierFor(config.tiers, guaranteeShortfallX) ?? lineTier;
  }
  const specialTier = respin || FORCE_RESPIN ? FROZEN_RESPIN_TIER : rollTier(config.specialReelTiers);
  const result = resolveSpin(betAmount, lineTier, specialTier, config, respin);

  const stakedAmount = respin ? 0 : betAmount;
  const balance = Math.round((currentBalance - stakedAmount + result.finalWin) * 100) / 100;

  return {
    reels: result.reels,
    lineSymbols: result.lineSymbols,
    specialReel: result.specialReel,
    lineWinTierKey: result.lineWinTierKey,
    baseWin: result.baseWin,
    winAmount: result.finalWin,
    respinsAwarded: result.respinsAwarded,
    specialGlowBackdrop: result.specialGlowBackdrop,
    emptyReelIndex: result.emptyReelIndex,
    specialIsHalfStop: result.specialIsHalfStop,
    balance,
    meta: { forced: false },
  };
}

export async function getCrazy777Config(): Promise<Crazy777ConfigResponse> {
  const config = getCrazy777RtpConfig();

  const paytable: PayoutRow[] = config.tiers
    .map((t) => {
      const symbol = LINE_TIER_DISPLAY[t.key];
      return symbol && t.payoutMultiplier !== null ? { symbol, payout: t.payoutMultiplier } : null;
    })
    .filter((row): row is PayoutRow => row !== null);

  const specialLabels = new Map(REFERENCE_SPECIAL_PAYTABLE.map((r) => [r.symbol, r]));
  const specialPaytable: SpecialPayoutRow[] = config.specialReelTiers
    .map((t) => {
      const symbol = SPECIAL_TIER_DISPLAY[t.key];
      const ref = symbol ? specialLabels.get(symbol) : undefined;
      if (!symbol || !ref) return null;
      const isBetBonus = t.key === "dollarPlus" || t.key === "doubleDollarPlus";
      return { symbol, label: ref.label, effect: ref.effect, betMultiplier: isBetBonus ? t.payoutMultiplier : null };
    })
    .filter((row): row is SpecialPayoutRow => row !== null);

  return {
    meta: {
      id: "crazy-777",
      name: "Crazy 777",
      description: "4-reel slot with a bonus special reel",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    paytable,
    specialPaytable,
    betLevels: BET_LEVELS,
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: (CrazySymbol | SpecialSymbol)[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/crazy-777/spin-log", { ...params, tier: null });
}
