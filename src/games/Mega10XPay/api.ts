/**
 * Mega 10X Pay's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in
 * `backEnd/src/games/Mega10XPay/{config,engine,winTiers}.ts`, using the exact same tier
 * weights/payout multipliers that previously came from `backEnd/src/services/paytableConfig.ts`'s
 * `DEFAULT_CONFIGS["mega-10x-pay"]`. Kept as the same exported function names/signatures as the
 * old network calls (`spinRequest`, `getMega10xPayConfig`) so `Mega10XPayGame.tsx` didn't need
 * type changes — `spinRequest` gains one new parameter (`currentBalance`), the same shape every
 * other already-offline game's `spinRequest` uses, since this game's `SpinResponse` (like theirs)
 * already carries a `balance` field.
 *
 * There's no bonus-round state to track here at all — this game has no free spins/respins/special
 * reel, so `spinRequest` was already a single-shot, per-call function even on the backend.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/Mega10XPay/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so Mega 10X Pay spins show up in
 * the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, fitFrequencies, makeConfigLoader, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type Mega10xSymbol =
  | "TEN_X"
  | "THREE_X"
  | "SEVEN"
  | "SEVEN_BAR"
  | "TRIPLE_BAR"
  | "DOUBLE_BAR"
  | "SINGLE_BAR"
  | "CHERRY";


export interface PayoutRow {
  label: string;
  symbol: Mega10xSymbol | null;
  payout: number;
}

export interface SpinResponse {
  reels: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol][];
  lineSymbols: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol];
  winTierKey: string | null;
  /** total pay as a multiple of the bet (combination pay × wild multiplier) */
  multiplier: number;
  /** combined 10X / 3X wild multiplier on the line (1 = none) */
  wildMultiplier: number;
  /** which reels' payline symbols are part of the win (all false on a loss) */
  winningReels: [boolean, boolean, boolean];
  /** reels that stop between two symbols, leaving their spot on the payline empty (losses only) */
  halfStopReels: [boolean, boolean, boolean];
  winAmount: number;
  balance: number;
  meta: { forced: boolean };
}

export interface Mega10xPayConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: PayoutRow[];
  betLevels: number[];
}

// --- Game shape — ported verbatim from backEnd/src/games/Mega10XPay/config.ts ---------------

const DISPLAY_SYMBOLS: Mega10xSymbol[] = [
  "TEN_X",
  "THREE_X",
  "SEVEN",
  "SEVEN_BAR",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "SINGLE_BAR",
  "CHERRY",
];

const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

/** The 4 "bar family" symbols — SEVEN_BAR counts as a bar for the broader mixed-bar category but
 * also has its own narrower pairing with SINGLE_BAR, mirrors 5x Rewind's BAR_FAMILY/WHITE_OR_SEVEN
 * split exactly. */
const BAR_FAMILY: ReadonlySet<Mega10xSymbol> = new Set(["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR", "SEVEN_BAR"]);
const SEVEN_FAMILY: ReadonlySet<Mega10xSymbol> = new Set(["SEVEN", "SEVEN_BAR"]);
const SINGLE_OR_SEVENBAR: ReadonlySet<Mega10xSymbol> = new Set(["SINGLE_BAR", "SEVEN_BAR"]);

/** Structural predicates for the 3 "mixed" line categories — checked in this exact priority order
 * (narrowest first) since a SINGLE_BAR + SEVEN_BAR mix would otherwise also structurally satisfy
 * the broader bar-family category. */
function isAny3SevenFamily(s1: Mega10xSymbol, s2: Mega10xSymbol, s3: Mega10xSymbol): boolean {
  if (!SEVEN_FAMILY.has(s1) || !SEVEN_FAMILY.has(s2) || !SEVEN_FAMILY.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

function isAny3SingleSevenBarMix(s1: Mega10xSymbol, s2: Mega10xSymbol, s3: Mega10xSymbol): boolean {
  if (!SINGLE_OR_SEVENBAR.has(s1) || !SINGLE_OR_SEVENBAR.has(s2) || !SINGLE_OR_SEVENBAR.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

function isAny3BarFamilyMix(s1: Mega10xSymbol, s2: Mega10xSymbol, s3: Mega10xSymbol): boolean {
  if (!BAR_FAMILY.has(s1) || !BAR_FAMILY.has(s2) || !BAR_FAMILY.has(s3)) return false;
  if (s1 === s2 && s2 === s3) return false;
  return !isAny3SingleSevenBarMix(s1, s2, s3);
}

/** Static reference paytable for the rules popup — cosmetic/display only, matches the backend's
 * own REFERENCE_PAYTABLE; the real payout always comes from the live RTP config below. */
const REFERENCE_PAYTABLE: PayoutRow[] = [
  { label: "10X PAY x3", symbol: "TEN_X", payout: 5000 },
  { label: "3X PAY x3", symbol: "THREE_X", payout: 2000 },
  { label: "CHERRY x3", symbol: "CHERRY", payout: 64 },
  { label: "7 x3", symbol: "SEVEN", payout: 15 },
  { label: "7-BAR x3", symbol: "SEVEN_BAR", payout: 10 },
  { label: "1 CHERRY (anywhere on the line)", symbol: null, payout: 10 },
  { label: "TRIPLE BAR x3", symbol: "TRIPLE_BAR", payout: 8 },
  { label: "Any 3 (7 / 7-BAR mixed)", symbol: null, payout: 8 },
  { label: "DOUBLE BAR x3", symbol: "DOUBLE_BAR", payout: 6 },
  { label: "Any 3 (SINGLE/DOUBLE/TRIPLE BAR / 7-BAR mixed)", symbol: null, payout: 6 },
  { label: "SINGLE BAR x3", symbol: "SINGLE_BAR", payout: 4 },
  { label: "Any 3 (SINGLE BAR / 7-BAR mixed)", symbol: null, payout: 4 },
  { label: "2 CHERRY on the line", symbol: null, payout: 2 },
  { label: "10X / 3X on the line (pays its multiplier)", symbol: null, payout: 1 },
];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export type TierKey =
  | "loss"
  | "oneCherry"
  | "twoCherry"
  | "cherry"
  | "singleBar"
  | "doubleBar"
  | "tripleBar"
  | "sevenBar"
  | "seven"
  | "any3BarFamilyMix"
  | "any3SingleBarSevenBar"
  | "any3SevenSevenBar"
  | "threeX"
  | "tenX"
  /** a 10X / 3X on the payline with no other win: pays this × its multiplier (×10 / ×3, two multiply) */
  | "anyWild";

export interface Mega10xTierRow {
  key: TierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface Mega10xPayRtpConfig {
  targetRtpPercent: number;
  tiers: Mega10xTierRow[];
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-mega10xpay-rtp-config";
export const DEFAULT_MEGA10X_TARGET_RTP_PERCENT = 90.0;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["mega-10x-pay"] — the actual live
 * odds this game shipped with. Frequencies solved so each tier's own (freq/100 * payout)
 * contribution sums to exactly 90% RTP, with the two flagship TEN_X/THREE_X tiers kept extremely
 * rare given their 5000x/2000x payouts. */
const BASE_TIERS: Mega10xTierRow[] = [
  { key: "loss", frequencyPercent: 87.4381, payoutMultiplier: null },
  { key: "oneCherry", frequencyPercent: 1.5, payoutMultiplier: 10 },
  { key: "twoCherry", frequencyPercent: 34.0, payoutMultiplier: 2 },
  { key: "cherry", frequencyPercent: 0.125, payoutMultiplier: 64 },
  { key: "singleBar", frequencyPercent: 6.0, payoutMultiplier: 4 },
  { key: "doubleBar", frequencyPercent: 1.333, payoutMultiplier: 6 },
  { key: "tripleBar", frequencyPercent: 0.75, payoutMultiplier: 8 },
  { key: "sevenBar", frequencyPercent: 0.5, payoutMultiplier: 10 },
  { key: "seven", frequencyPercent: 0.2667, payoutMultiplier: 15 },
  { key: "any3BarFamilyMix", frequencyPercent: 1.333, payoutMultiplier: 6 },
  { key: "any3SingleBarSevenBar", frequencyPercent: 1.25, payoutMultiplier: 4 },
  { key: "any3SevenSevenBar", frequencyPercent: 0.5, payoutMultiplier: 8 },
  { key: "threeX", frequencyPercent: 0.003, payoutMultiplier: 2000 },
  { key: "tenX", frequencyPercent: 0.0012, payoutMultiplier: 5000 },
  { key: "anyWild", frequencyPercent: 3.0, payoutMultiplier: 1 },
];

export function getMega10xDefaultConfig(): Mega10xPayRtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_MEGA10X_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
  });
}

function isValidConfig(value: unknown): value is Mega10xPayRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getMega10xRtpConfig(): Mega10xPayRtpConfig {
  return loadConfig();
}

/** Saved config (or the default) with the house rules applied — cached per stored string. */
const loadConfig = makeConfigLoader<Mega10xPayRtpConfig>(
  RTP_CONFIG_STORAGE_KEY,
  (raw) => {
    if (raw === null) return getMega10xDefaultConfig();
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isValidConfig(parsed) ? parsed : getMega10xDefaultConfig();
    } catch {
      return getMega10xDefaultConfig();
    }
  },
  applyHouseRules
);


/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(config: Mega10xPayRtpConfig): Mega10xPayRtpConfig {
  const targetRtpPercent = capTargetRtp(config.targetRtpPercent);
  // A config saved before a tier existed (e.g. anyWild) gets it at its default, loss re-balanced.
  const missing = BASE_TIERS.filter((b) => !config.tiers.some((t) => t.key === b.key)).map((b) => ({ ...b }));
  const tiers = missing.length ? rescaleMega10xTiers([...config.tiers, ...missing], 1) : config.tiers;
  const whole: Mega10xPayRtpConfig = {
    ...config,
    targetRtpPercent,
    tiers: tiers.map((r) => (r.payoutMultiplier === null ? r : { ...r, payoutMultiplier: wholeX(r.payoutMultiplier) })),
  };
  if (Math.abs(computeMega10xRtpPercent(whole) - targetRtpPercent) < 0.05) return whole;
  return { ...whole, tiers: fitFrequencies(whole.tiers, (r) => computeMega10xRtpPercent({ ...whole, tiers: r }), rescaleMega10xTiers, targetRtpPercent) };
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setMega10xRtpConfig(config: Mega10xPayRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncMega10xRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("mega-10x-pay", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveMega10xRtpConfigToServer(config: Mega10xPayRtpConfig): Promise<void> {
  return saveRtpConfigToServer("mega-10x-pay", config);
}

/** Σ frequency × pay × that tier's average 10X / 3X wild multiplier (see wildFactor) — exactly
 * what spinRequest pays out on average. */
export function computeMega10xRtpPercent(config: Mega10xPayRtpConfig): number {
  const winTiers = config.tiers.filter((t) => t.payoutMultiplier !== null);
  const baseRtp = winTiers.reduce(
    (sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0) * wildFactor(config, t.key),
    0
  );
  return baseRtp * 100;
}

/** Rescales `tiers` to land on a new target — identical technique to the generic admin page's own
 * `rescaleLineTiers`: every tier with a real payoutMultiplier has its frequency scaled by `scale`
 * (clamped at 0), then `loss` absorbs whatever's left so frequencies still sum to exactly 100%. */
export function rescaleMega10xTiers(tiers: Mega10xTierRow[], scale: number): Mega10xTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

// --- Win-line logic: outcome-first, with 10X / 3X as wild multipliers ------------------------

/** 10X Pay / 3X Pay are wild: on the payline each one stands in for any symbol except CHERRY to
 * complete the best-paying combination, and multiplies that win by its value (two of them
 * multiply together: 3X+3X = ×9, 3X+10X = ×30, 10X+10X = ×100). Three of the same wild is its
 * own top prize (the tenX / threeX tiers), not multiplied further. */
const WILD_MULTIPLIER: Partial<Record<Mega10xSymbol, number>> = { TEN_X: 10, THREE_X: 3 };
const isWild = (s: Mega10xSymbol) => WILD_MULTIPLIER[s] !== undefined;

/** What a wild can stand in for. */
const SUBSTITUTES: Mega10xSymbol[] = ["SEVEN", "SEVEN_BAR", "TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"];

/** How often a winning spin lands with wilds on its line, by the combined multiplier (percent of
 * winning spins); the rest pay ×1. Only applies where a wild can actually be part of that win
 * (see wildFactor) — the frequencies are re-fitted so the RTP target still holds. */
export const WILD_MULTIPLIER_ODDS: { multiplier: number; percent: number }[] = [
  { multiplier: 3, percent: 8 },
  { multiplier: 10, percent: 2 },
  { multiplier: 9, percent: 0.4 },
  { multiplier: 30, percent: 0.2 },
  { multiplier: 100, percent: 0.05 },
];

type Line = [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol];

/** The tier a wild-free line lands in, or null for no win. */
function plainTier(s1: Mega10xSymbol, s2: Mega10xSymbol, s3: Mega10xSymbol): TierKey | null {
  if (s1 === s2 && s2 === s3) {
    const exact = (Object.keys(TIER_SYMBOL) as TierKey[]).find((k) => TIER_SYMBOL[k] === s1);
    if (exact) return exact;
  }
  const cherries = [s1, s2, s3].filter((s) => s === "CHERRY").length;
  if (cherries === 1) return "oneCherry";
  if (cherries === 2) return "twoCherry";
  if (isAny3SevenFamily(s1, s2, s3)) return "any3SevenSevenBar";
  if (isAny3SingleSevenBarMix(s1, s2, s3)) return "any3SingleBarSevenBar";
  if (isAny3BarFamilyMix(s1, s2, s3)) return "any3BarFamilyMix";
  return null;
}

interface LineResult {
  /** every tier this line's best-paying reading matches (ties pay the same) */
  tiers: TierKey[];
  /** wild multiplier (1 = no wilds) */
  multiplier: number;
  /** which reels' symbols are part of the win */
  winning: [boolean, boolean, boolean];
}

/** Scores one payline under the wild rules, against `payout` (the live config's pays). */
function evaluateLine(line: Line, payout: (k: TierKey) => number): LineResult | null {
  const wilds = line.map(isWild);
  const wildCount = wilds.filter(Boolean).length;
  if (wildCount === 0) {
    const tier = plainTier(...line);
    if (!tier) return null;
    return { tiers: [tier], multiplier: 1, winning: cherryAware(tier, line, wilds) };
  }
  if (wildCount === 3) {
    // 3 of the same wild is its own top prize; a mixed all-wild line pays as 3X Pay.
    const tier: TierKey = line.every((s) => s === "TEN_X") ? "tenX" : "threeX";
    return { tiers: [tier], multiplier: 1, winning: [true, true, true] };
  }

  // Try every substitution for the wild positions and keep the best-paying reading(s).
  let best = 0;
  let tiers: TierKey[] = [];
  const positions = [0, 1, 2].filter((i) => wilds[i]);
  const choices = positions.length === 1 ? SUBSTITUTES.map((a) => [a]) : SUBSTITUTES.flatMap((a) => SUBSTITUTES.map((b) => [a, b]));
  for (const choice of choices) {
    const read = [...line] as Line;
    positions.forEach((p, i) => (read[p] = choice[i]));
    const tier = plainTier(...read);
    if (!tier) continue;
    const pay = payout(tier);
    if (pay > best) {
      best = pay;
      tiers = [tier];
    } else if (pay === best && pay > 0 && !tiers.includes(tier)) {
      tiers.push(tier);
    }
  }
  // No combination: a wild on the line still pays its own multiplier (10X = 10x the bet, 3X = 3x).
  if (best <= 0) tiers = ["anyWild"];
  if (payout(tiers[0]) <= 0) return null;
  const multiplier = line.reduce((m, s) => m * (WILD_MULTIPLIER[s] ?? 1), 1);
  return { tiers, multiplier, winning: cherryAware(tiers[0], line, wilds) };
}

/** Cherry-count wins are made by the cherries (and any wilds multiplying them) alone — the other
 * symbols aren't part of the win. Every other win uses all 3 reels. */
function cherryAware(tier: TierKey, line: Line, wilds: boolean[]): [boolean, boolean, boolean] {
  if (tier === "anyWild") return wilds as [boolean, boolean, boolean];
  if (tier !== "oneCherry" && tier !== "twoCherry") return [true, true, true];
  return line.map((s, i) => s === "CHERRY" || wilds[i]) as [boolean, boolean, boolean];
}

interface LineTable {
  /** `${tier}|${multiplier}` → every line that pays exactly that */
  byOutcome: Map<string, Line[]>;
}

/** Every one of the 8³ possible paylines, scored once per set of pays (the pays decide which
 * reading of a wild line is best) — cached by the pays, since the RTP fitter re-scores the same
 * pays with many different frequencies. */
const lineTables = new Map<string, LineTable>();
function lineTable(config: Mega10xPayRtpConfig): LineTable {
  const payout = (k: TierKey) => config.tiers.find((t) => t.key === k)?.payoutMultiplier ?? 0;
  const cacheKey = config.tiers.map((t) => `${t.key}:${t.payoutMultiplier}`).join(",");
  const cached = lineTables.get(cacheKey);
  if (cached) return cached;
  const table: LineTable = { byOutcome: new Map() };
  for (const s1 of DISPLAY_SYMBOLS) {
    for (const s2 of DISPLAY_SYMBOLS) {
      for (const s3 of DISPLAY_SYMBOLS) {
        const line: Line = [s1, s2, s3];
        const result = evaluateLine(line, payout);
        if (!result) continue;
        for (const tier of result.tiers) {
          const key = `${tier}|${result.multiplier}`;
          const list = table.byOutcome.get(key);
          if (list) list.push(line);
          else table.byOutcome.set(key, [line]);
        }
      }
    }
  }
  lineTables.set(cacheKey, table);
  return table;
}

/** Whether `tier` can land with this wild multiplier at all (3 Single Bars + a wild, for one,
 * always reads as the better-paying mixed-bars win instead). */
function canLand(config: Mega10xPayRtpConfig, tier: TierKey, multiplier: number): boolean {
  if (multiplier !== 1 && (tier === "tenX" || tier === "threeX")) return false;
  return lineTable(config).byOutcome.has(`${tier}|${multiplier}`);
}

/** The wild multipliers `tier` can pay, with their chances (summing to 1). Most tiers mostly pay
 * ×1, with WILD_MULTIPLIER_ODDS' share of wilds where a wild can be part of that win; anyWild
 * always has a wild, so it's spread over those same odds' multipliers alone. */
function multiplierChances(config: Mega10xPayRtpConfig, tier: TierKey): { multiplier: number; chance: number }[] {
  const landable = WILD_MULTIPLIER_ODDS.filter((o) => canLand(config, tier, o.multiplier));
  if (tier === "anyWild") {
    const total = landable.reduce((sum, o) => sum + o.percent, 0);
    return landable.map((o) => ({ multiplier: o.multiplier, chance: o.percent / total }));
  }
  const wild = landable.map((o) => ({ multiplier: o.multiplier, chance: o.percent / 100 }));
  return [{ multiplier: 1, chance: 1 - wild.reduce((sum, o) => sum + o.chance, 0) }, ...wild];
}

/** A tier's average wild multiplier — what each of its wins is worth on average, used by the RTP. */
function wildFactor(config: Mega10xPayRtpConfig, tier: TierKey): number {
  return multiplierChances(config, tier).reduce((sum, o) => sum + o.chance * o.multiplier, 0) || 1;
}

function rollWildMultiplier(config: Mega10xPayRtpConfig, tier: TierKey): number {
  const chances = multiplierChances(config, tier);
  let roll = Math.random();
  for (const { multiplier, chance } of chances) {
    roll -= chance;
    if (roll < 0) return multiplier;
  }
  return chances[chances.length - 1]?.multiplier ?? 1;
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** How a loss shows on the reels, like Crazy 777: how many reels stop between two symbols
 * (leaving their payline spot empty), as a percent of losses. Always at least 1: on a one-line
 * game, 3 symbols filling the payline would read as a win. */
const LOSS_HALF_STOP_ODDS: { count: number; percent: number }[] = [
  { count: 1, percent: 60 },
  { count: 2, percent: 30 },
  { count: 3, percent: 10 },
];

/** Symbols that can sit on the payline next to an empty spot without making a win — anything
 * but CHERRY (1 Cherry anywhere on the line pays) and the wilds (a 10X / 3X on the line pays). */
const LOSS_LINE_SYMBOLS = DISPLAY_SYMBOLS.filter((s) => s !== "CHERRY" && !isWild(s));

/** A losing spin's payline + which reels half-stop. With at least one empty spot no 3-symbol
 * combination can form, so the rest only need to avoid CHERRY and the wilds. */
function buildLoss(): { line: Line; halfStops: [boolean, boolean, boolean] } {
  let roll = Math.random() * 100;
  let count = 1;
  for (const o of LOSS_HALF_STOP_ODDS) {
    roll -= o.percent;
    if (roll < 0) {
      count = o.count;
      break;
    }
  }
  const order = [0, 1, 2].sort(() => Math.random() - 0.5);
  const halfStops = [0, 1, 2].map((i) => order.indexOf(i) < count) as [boolean, boolean, boolean];
  const line = halfStops.map((half) => (half ? randomSymbol() : pick(LOSS_LINE_SYMBOLS))) as Line;
  return { line, halfStops };
}

/** The specific symbol each exact "3 of a kind" tier requires. */
const TIER_SYMBOL: Partial<Record<TierKey, Mega10xSymbol>> = {
  tenX: "TEN_X",
  threeX: "THREE_X",
  cherry: "CHERRY",
  seven: "SEVEN",
  sevenBar: "SEVEN_BAR",
  tripleBar: "TRIPLE_BAR",
  doubleBar: "DOUBLE_BAR",
  singleBar: "SINGLE_BAR",
};

function randomSymbol(): Mega10xSymbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

function buildReel(middle: Mega10xSymbol): [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol] {
  return [randomSymbol(), middle, randomSymbol()];
}

/** Weighted-random pick of one tier row by frequencyPercent. */
function rollTier(tiers: Mega10xTierRow[]): Mega10xTierRow {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Runs one local, outcome-first spin: the tier is decided first (by frequency), then the wild
 * multiplier, then a payline is picked from every line that pays exactly that — so what's on the
 * reels always matches what's paid. `currentBalance` is the player's balance right before this
 * spin — the new balance (bet deducted, win credited) is computed here and returned. Resolves on
 * the same tick (no network involved), kept async so call sites can keep using `await`. */
export async function spinRequest(betAmount: number, currentBalance = 0): Promise<SpinResponse> {
  const config = getMega10xRtpConfig();
  const table = lineTable(config);
  const tier = rollTier(config.tiers);

  let lineSymbols: Line;
  let wildMultiplier = 1;
  let winningReels: [boolean, boolean, boolean] = [false, false, false];
  let halfStopReels: [boolean, boolean, boolean] = [false, false, false];
  let lines: Line[] | undefined;
  if (tier.key === "tenX" || tier.key === "threeX") {
    lines = [[TIER_SYMBOL[tier.key]!, TIER_SYMBOL[tier.key]!, TIER_SYMBOL[tier.key]!]];
  } else if (tier.key !== "loss" && tier.payoutMultiplier !== null) {
    wildMultiplier = rollWildMultiplier(config, tier.key);
    lines = table.byOutcome.get(`${tier.key}|${wildMultiplier}`);
  }
  // No line pays exactly this (only if an admin zeroed a pay) — it's a loss.
  const isLoss = !lines;
  if (lines) {
    lineSymbols = pick(lines);
    const payout = (k: TierKey) => config.tiers.find((t) => t.key === k)?.payoutMultiplier ?? 0;
    winningReels = evaluateLine(lineSymbols, payout)?.winning ?? [true, true, true];
  } else {
    wildMultiplier = 1;
    ({ line: lineSymbols, halfStops: halfStopReels } = buildLoss());
  }

  const multiplier = isLoss ? 0 : (tier.payoutMultiplier ?? 0) * wildMultiplier;
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const reels: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol][] = [
    buildReel(lineSymbols[0]),
    buildReel(lineSymbols[1]),
    buildReel(lineSymbols[2]),
  ];

  const balance = Math.round((currentBalance - betAmount + winAmount) * 100) / 100;

  return {
    reels,
    lineSymbols,
    winTierKey: isLoss ? null : tier.key,
    multiplier,
    wildMultiplier,
    winningReels,
    halfStopReels,
    winAmount,
    balance,
    meta: { forced: false },
  };
}

export async function getMega10xPayConfig(): Promise<Mega10xPayConfigResponse> {
  return {
    meta: {
      id: "mega-10x-pay",
      name: "Mega 10X Pay",
      description: "Classic 3-reel, single-payline slot with a 10X/3X pay-multiplier symbol and a cherry bonus",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    paytable: REFERENCE_PAYTABLE,
    betLevels: BET_LEVELS,
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: Mega10xSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/mega-10x-pay/spin-log", { ...params, tier: null });
}
