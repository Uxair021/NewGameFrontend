/**
 * Gems Deluxe's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/GemsDeluxe/{config,engine}.ts`, using
 * the exact same tier weights/payout multipliers/bonus-pool odds that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["gems-deluxe"]` and its
 * `computeGemsDeluxeRtpPercent`. Kept as the same exported function names/signatures as the old
 * network calls (`spinRequest`, `bonusAdvanceRequest`, `bonusResolveRequest`,
 * `getGemsDeluxeConfig`) so `GemsDeluxeGame.tsx` didn't need type changes — `spinRequest` and
 * `bonusResolveRequest` each gain one new parameter (`currentBalance`), the same shape every other
 * already-offline game's `spinRequest` uses.
 *
 * This is the first game in this offline-conversion series whose bonus round genuinely spans more
 * than one call: when "dollarBonus" rolls, 4 sequential dollar offers are pre-rolled up front (see
 * generateOffers) and only revealed one at a time — `bonusResolveRequest` always credits whichever
 * offer is "currently shown" for that round, `bonusAdvanceRequest` moves to the next one. The old
 * backend tracked this in a `GemsDeluxeBonus` Mongo document specifically so the full offer array
 * was never sent to the client up front (revealing all 4 would let a player always pick the best
 * of 4, which — since each is an independent random draw — skews realized RTP above target). Now
 * that everything lives in the browser anyway (same trust model as every other game converted this
 * way), that specific defense is moot, but the *mechanic* itself is preserved exactly: a
 * `bonusId`-keyed in-memory round (ACTIVE_BONUS_ROUNDS below) stands in for the Mongo doc. Per
 * GemsDeluxeGame.tsx's own code comment, the shipped UI never actually calls
 * `bonusAdvanceRequest` — one gem pick (the first pre-rolled offer) is the whole bonus round in
 * practice — but it's ported faithfully regardless, since it's still part of the real API surface.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/GemsDeluxe/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so Gems Deluxe spins show up in
 * the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called. A
 * bonus-triggering spin logs twice, same pattern Crazy 777's respins already use: once at trigger
 * time (bet staked, win 0) and once at resolve time (bet 0, win the credited offer).
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, fitFrequencies, makeConfigLoader, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type GemsDeluxeSymbol = "SEVEN" | "TRIPLE_BAR" | "DOUBLE_BAR" | "SINGLE_BAR" | "DIAMOND" | "DOLLAR";

/** [above, middle, below] for one reel — middle is the scored payline symbol. Every position
 * always shows a real symbol (no blank) — a loss is instead represented by one reel landing
 * half-stopped (see emptyReelIndex below and pixi/Reel.ts's spinTo). */
export interface ReelResult {
  symbols: [GemsDeluxeSymbol, GemsDeluxeSymbol, GemsDeluxeSymbol];
}

export interface PayoutRow {
  key: "SEVEN" | "TRIPLE_BAR" | "DOUBLE_BAR" | "SINGLE_BAR" | "ANY_BAR" | "DIAMOND_ONE" | "DIAMOND_TWO" | "DIAMOND_THREE";
  payout: number;
}

export interface BonusPoolRow {
  key: string;
  value: number;
}

export interface GemsDeluxeConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: PayoutRow[];
  bonusPool: BonusPoolRow[];
  offerCount: number;
  betLevels: number[];
}

interface SpinResponseBase {
  reels: [ReelResult, ReelResult, ReelResult];
  winAmount: number;
  balance: number;
}

export interface SpinResponseLine extends SpinResponseBase {
  bonusTriggered: false;
  /** Which of the 3 reels (0-2) lands half-stopped — how a loss is shown, no blank symbol
   * needed. null on an actual win. */
  emptyReelIndex: number | null;
}

export interface SpinResponseBonus extends SpinResponseBase {
  bonusTriggered: true;
  bonusId: string;
  currentOffer: number;
  offerNumber: number;
  offerCount: number;
  isLastOffer: boolean;
}

export type SpinResponse = SpinResponseLine | SpinResponseBonus;

export interface BonusAdvanceResponse {
  currentOffer: number;
  offerNumber: number;
  offerCount: number;
  isLastOffer: boolean;
}

export interface BonusResolveResponse {
  balance: number;
  winAmount: number;
}

// --- Game shape — ported verbatim from backEnd/src/games/GemsDeluxe/config.ts ---------------

/** Where DOLLAR always lands when the "dollarBonus" tier rolls (0-indexed). Landing it there
 * triggers the bonus round instead of paying a line amount. */
const DOLLAR_REEL_INDEX = 2;

const BET_LEVELS = [10, 25, 50, 100];

const REFERENCE_PAYTABLE: PayoutRow[] = [
  { key: "SEVEN", payout: 100 },
  { key: "TRIPLE_BAR", payout: 75 },
  { key: "DOUBLE_BAR", payout: 50 },
  { key: "SINGLE_BAR", payout: 25 },
  { key: "ANY_BAR", payout: 10 },
  { key: "DIAMOND_THREE", payout: 20 },
  { key: "DIAMOND_TWO", payout: 10 },
  { key: "DIAMOND_ONE", payout: 4 },
];

/** The bonus round's note-bundle value pool — flat dollar amounts (never scaled by bet). */
const REFERENCE_BONUS_POOL: BonusPoolRow[] = [
  { key: "dollarPoolFive", value: 5 },
  { key: "dollarPoolTen", value: 10 },
  { key: "dollarPoolTwenty", value: 20 },
  { key: "dollarPoolFifty", value: 50 },
  { key: "dollarPoolHundred", value: 100 },
  { key: "dollarPoolThousand", value: 1000 },
];

/** How many pool values get summed into a single offer — not admin-tunable. */
const OFFER_DRAW_COUNT_WEIGHTS: { count: 1 | 2 | 3; weight: number }[] = [
  { count: 1, weight: 40 },
  { count: 2, weight: 40 },
  { count: 3, weight: 20 },
];

/** Exactly 4 sequential offers per bonus round (First/Second/Third/Last). */
const OFFER_COUNT = 4;

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export type TierKey =
  | "loss"
  | "seven"
  | "tripleBar"
  | "doubleBar"
  | "singleBar"
  | "anyBar"
  | "diamondOne"
  | "diamondTwo"
  | "diamondThree"
  | "dollarBonus";

export type BonusPoolKey = "dollarPoolFive" | "dollarPoolTen" | "dollarPoolTwenty" | "dollarPoolFifty" | "dollarPoolHundred" | "dollarPoolThousand";

export interface GemsTierRow {
  key: TierKey;
  frequencyPercent: number;
  /** null only for "dollarBonus" (the trigger — no flat multiplier of its own) and "loss". */
  payoutMultiplier: number | null;
}

export interface BonusPoolTierRow {
  key: BonusPoolKey;
  frequencyPercent: number;
  /** Flat dollar amount, not a bet multiple. */
  payoutMultiplier: number;
}

export interface GemsDeluxeRtpConfig {
  targetRtpPercent: number;
  tiers: GemsTierRow[];
  bonusPool: BonusPoolTierRow[];
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-gemsdeluxe-rtp-config";
export const DEFAULT_GEMS_TARGET_RTP_PERCENT = 90.24;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["gems-deluxe"] — the actual live odds
 * this game shipped with (itself a duplicate of Top Dollar's own numbers under a new id). */
const BASE_TIERS: GemsTierRow[] = [
  { key: "loss", frequencyPercent: 74.155, payoutMultiplier: null },
  { key: "seven", frequencyPercent: 0.1, payoutMultiplier: 100 },
  { key: "tripleBar", frequencyPercent: 0.135, payoutMultiplier: 75 },
  { key: "doubleBar", frequencyPercent: 0.2, payoutMultiplier: 50 },
  { key: "singleBar", frequencyPercent: 0.41, payoutMultiplier: 25 },
  { key: "anyBar", frequencyPercent: 1.0, payoutMultiplier: 10 },
  { key: "diamondThree", frequencyPercent: 0.5, payoutMultiplier: 20 },
  { key: "diamondTwo", frequencyPercent: 1.0, payoutMultiplier: 10 },
  { key: "diamondOne", frequencyPercent: 2.5, payoutMultiplier: 4 },
  { key: "dollarBonus", frequencyPercent: 20, payoutMultiplier: null },
];

const BASE_BONUS_POOL: BonusPoolTierRow[] = [
  { key: "dollarPoolFive", frequencyPercent: 40, payoutMultiplier: 5 },
  { key: "dollarPoolTen", frequencyPercent: 30, payoutMultiplier: 10 },
  { key: "dollarPoolTwenty", frequencyPercent: 15, payoutMultiplier: 20 },
  { key: "dollarPoolFifty", frequencyPercent: 10, payoutMultiplier: 50 },
  { key: "dollarPoolHundred", frequencyPercent: 4.9, payoutMultiplier: 100 },
  { key: "dollarPoolThousand", frequencyPercent: 0.1, payoutMultiplier: 1000 },
];

export function getGemsDeluxeDefaultConfig(): GemsDeluxeRtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_GEMS_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
    bonusPool: BASE_BONUS_POOL.map((t) => ({ ...t })),
  });
}

function isValidConfig(value: unknown): value is GemsDeluxeRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0 &&
    Array.isArray(v.bonusPool) &&
    v.bonusPool.length > 0
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getGemsDeluxeRtpConfig(): GemsDeluxeRtpConfig {
  return loadConfig();
}

/** Saved config (or the default) with the house rules applied — cached per stored string. */
const loadConfig = makeConfigLoader<GemsDeluxeRtpConfig>(
  RTP_CONFIG_STORAGE_KEY,
  (raw) => {
    if (raw === null) return getGemsDeluxeDefaultConfig();
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isValidConfig(parsed) ? parsed : getGemsDeluxeDefaultConfig();
    } catch {
      return getGemsDeluxeDefaultConfig();
    }
  },
  applyHouseRules
);


/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(config: GemsDeluxeRtpConfig): GemsDeluxeRtpConfig {
  const targetRtpPercent = capTargetRtp(config.targetRtpPercent);
  const whole: GemsDeluxeRtpConfig = {
    ...config,
    targetRtpPercent,
    tiers: config.tiers.map((r) => (r.payoutMultiplier === null ? r : { ...r, payoutMultiplier: wholeX(r.payoutMultiplier) })),
  };
  if (Math.abs(computeGemsDeluxeRtpPercent(whole) - targetRtpPercent) < 0.05) return whole;
  return { ...whole, tiers: fitFrequencies(whole.tiers, (r) => computeGemsDeluxeRtpPercent({ ...whole, tiers: r }), rescaleAllWinRows, targetRtpPercent) };
}

/** Frequency-only rescale over every non-loss row — including the bonus trigger (whose RTP comes
 * from the bonus pool, not a payoutMultiplier), since that's this game's biggest RTP lever. "loss"
 * absorbs the rest so frequencies still sum to 100%. */
function rescaleAllWinRows<R extends { key: string; frequencyPercent: number }>(rowsIn: R[], scale: number): R[] {
  const scaled = rowsIn.map((r) => (r.key === "loss" ? r : { ...r, frequencyPercent: Math.max(0, r.frequencyPercent * scale) }));
  const nonLossSum = scaled.reduce((sum, r) => (r.key === "loss" ? sum : sum + r.frequencyPercent), 0);
  return scaled.map((r) => (r.key === "loss" ? { ...r, frequencyPercent: Math.max(0, 100 - nonLossSum) } : r));
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setGemsDeluxeRtpConfig(config: GemsDeluxeRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncGemsDeluxeRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("gems-deluxe", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveGemsDeluxeRtpConfigToServer(config: GemsDeluxeRtpConfig): Promise<void> {
  return saveRtpConfigToServer("gems-deluxe", config);
}

/**
 * Ported verbatim from paytableConfig.ts's computeGemsDeluxeRtpPercent (itself a straight copy of
 * computeTopDollarRtpPercent — see that function's doc comment there for the full derivation).
 * Short version: a fixed-horizon optional-stopping argument means E[whichever offer the player
 * ends up accepting] always equals E[a single offer], regardless of Take-It/Try-Again strategy —
 * so the bonus round's RTP contribution is just P(dollarBonus) × E[offer] / referenceBet, a flat
 * dollar expectation divided by the bet it's being expressed as a multiple of. Unlike every other
 * game here, this game's realized RTP genuinely varies by bet size; this reports it at MIN_BET.
 */
export function computeGemsDeluxeRtpPercent(config: GemsDeluxeRtpConfig): number {
  const lineEV = config.tiers.reduce(
    (sum, t) => sum + (t.payoutMultiplier !== null ? (t.frequencyPercent / 100) * t.payoutMultiplier : 0),
    0
  );

  const bonusTier = config.tiers.find((t) => t.key === "dollarBonus");
  const bonusProb = (bonusTier?.frequencyPercent ?? 0) / 100;

  const poolTotal = config.bonusPool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const poolMean = poolTotal > 0 ? config.bonusPool.reduce((sum, t) => sum + (t.frequencyPercent / poolTotal) * t.payoutMultiplier, 0) : 0;
  const drawCountTotal = OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  const eDrawCount = drawCountTotal > 0 ? OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + (w.weight / drawCountTotal) * w.count, 0) : 0;
  const eOffer = eDrawCount * poolMean;

  const referenceBet = BET_LEVELS[0];
  const bonusRtp = referenceBet > 0 ? (bonusProb * eOffer) / referenceBet : 0;

  return (lineEV + bonusRtp) * 100;
}

/** Rescales `tiers` to land on a new target — identical technique to the generic admin page's own
 * `rescaleLineTiers`: every tier with a real payoutMultiplier has its frequency scaled by `scale`
 * (clamped at 0), then `loss` absorbs whatever's left so frequencies still sum to exactly 100%.
 * "dollarBonus" itself is never scaled this way (its payoutMultiplier is null) — its frequency,
 * and therefore the bonus round's own RTP contribution, stays fixed across a rescale, same as the
 * existing generic admin page's behavior for this game today. Because of that, a single pass only
 * lands close (not exact) — the admin page calls this a few times in a loop, same as Crazy 777. */
export function rescaleGemsDeluxeTiers(tiers: GemsTierRow[], scale: number): GemsTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/GemsDeluxe/engine.ts -----------

const NON_DIAMOND_SYMBOLS: readonly GemsDeluxeSymbol[] = ["SEVEN", "TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"];
const ALL_REAL_SYMBOLS: readonly GemsDeluxeSymbol[] = ["SEVEN", "TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR", "DIAMOND"];
const BAR_SYMBOLS: readonly GemsDeluxeSymbol[] = ["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR"];

function randomFrom<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
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

/** A loss doesn't need a blank/filler symbol — one reel lands half-stopped, which alone
 * guarantees the exact-match and any-bars-mixed checks can never accidentally fire regardless of
 * what the other two reels show. The one wrinkle: Diamond pays for just 1 clean occurrence, so
 * the *other* two (clean) reels must also avoid Diamond entirely — otherwise a lone clean Diamond
 * would visually look like a win that isn't being paid. */
function buildLossLine(): [GemsDeluxeSymbol, GemsDeluxeSymbol, GemsDeluxeSymbol] {
  return [randomFrom(NON_DIAMOND_SYMBOLS), randomFrom(NON_DIAMOND_SYMBOLS), randomFrom(NON_DIAMOND_SYMBOLS)];
}

/** Constructs the exact 3-symbol line for a given winning tier. */
function buildLineForTier(tierKey: TierKey): [GemsDeluxeSymbol, GemsDeluxeSymbol, GemsDeluxeSymbol] {
  if (tierKey === "seven") return ["SEVEN", "SEVEN", "SEVEN"];
  if (tierKey === "tripleBar") return ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"];
  if (tierKey === "doubleBar") return ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"];
  if (tierKey === "singleBar") return ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"];

  if (tierKey === "anyBar") {
    let line: [GemsDeluxeSymbol, GemsDeluxeSymbol, GemsDeluxeSymbol];
    do {
      line = [randomFrom(BAR_SYMBOLS), randomFrom(BAR_SYMBOLS), randomFrom(BAR_SYMBOLS)];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  if (tierKey === "diamondOne" || tierKey === "diamondTwo" || tierKey === "diamondThree") {
    const count = tierKey === "diamondOne" ? 1 : tierKey === "diamondTwo" ? 2 : 3;
    const positions = [0, 1, 2].sort(() => Math.random() - 0.5);
    const line: GemsDeluxeSymbol[] = [];
    positions.forEach((pos, i) => {
      line[pos] = i < count ? "DIAMOND" : randomFrom(NON_DIAMOND_SYMBOLS);
    });
    return line as [GemsDeluxeSymbol, GemsDeluxeSymbol, GemsDeluxeSymbol];
  }

  if (tierKey === "dollarBonus") {
    // The other 2 reels' payline symbol must never be DIAMOND alongside the DOLLAR trigger —
    // drawn from NON_DIAMOND_SYMBOLS instead of ALL_REAL_SYMBOLS.
    const line: GemsDeluxeSymbol[] = [0, 1, 2].map((i) => (i === DOLLAR_REEL_INDEX ? "DOLLAR" : randomFrom(NON_DIAMOND_SYMBOLS)));
    return line as [GemsDeluxeSymbol, GemsDeluxeSymbol, GemsDeluxeSymbol];
  }

  return buildLossLine();
}

/** Wraps a scored payline symbol with random above/below flavor for the 3-row reel window.
 * `avoidDiamondFiller` also keeps the random above/below flavor off DIAMOND — used for the 2
 * non-DOLLAR reels on a dollarBonus trigger, so those reels show no DIAMOND anywhere. */
function buildReel(middle: GemsDeluxeSymbol, avoidDiamondFiller = false): ReelResult {
  const fillerPool = avoidDiamondFiller ? NON_DIAMOND_SYMBOLS : ALL_REAL_SYMBOLS;
  return { symbols: [randomFrom(fillerPool), middle, randomFrom(fillerPool)] };
}

/** One weighted-random draw from the bonus note-bundle pool — payoutMultiplier here holds a FLAT
 * dollar amount, not a bet multiple. */
function drawBonusPoolValue(pool: BonusPoolTierRow[]): number {
  const total = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const row of pool) {
    roll -= row.frequencyPercent;
    if (roll < 0) return row.payoutMultiplier;
  }
  return pool[pool.length - 1]?.payoutMultiplier ?? 0;
}

function rollDrawCount(): 1 | 2 | 3 {
  const total = OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of OFFER_DRAW_COUNT_WEIGHTS) {
    roll -= w.weight;
    if (roll < 0) return w.count;
  }
  return OFFER_DRAW_COUNT_WEIGHTS[OFFER_DRAW_COUNT_WEIGHTS.length - 1].count;
}

/** One offer = sum of 1-3 independent weighted draws from the bonus pool. */
function generateOffer(pool: BonusPoolTierRow[]): number {
  const count = rollDrawCount();
  let sum = 0;
  for (let i = 0; i < count; i++) sum += drawBonusPoolValue(pool);
  return sum;
}

/** All 4 sequential offers, pre-rolled up front — see the module doc comment for why
 * precomputing all of them at spin time (rather than one at a time as the player clicks "Try
 * Again") is both safe and equivalent. */
function generateOffers(pool: BonusPoolTierRow[]): [number, number, number, number] {
  const offers: number[] = [];
  for (let i = 0; i < OFFER_COUNT; i++) offers.push(generateOffer(pool));
  return offers as [number, number, number, number];
}

// --- In-memory bonus round tracking — stands in for the old GemsDeluxeBonus Mongo doc --------

interface ActiveBonusRound {
  offers: [number, number, number, number];
  currentIndex: number;
  resolved: boolean;
}

const ACTIVE_BONUS_ROUNDS = new Map<string, ActiveBonusRound>();
let nextBonusId = 1;

/** Runs one local, authoritative spin: the tier is decided first (from the live RTP config), then
 * reel symbols are built to match it exactly — same algorithm as the old backend's engine.ts. If
 * the "dollarBonus" tier rolls, a new in-memory bonus round is registered (mirroring the old
 * GemsDeluxeBonus doc) and its id/first offer are returned instead of a credited line amount.
 * `currentBalance` is the player's balance right before this spin — the new balance (bet
 * deducted, any line win credited — a bonus trigger pays 0 here, the offer is credited
 * separately via bonusResolveRequest) is computed here and returned. Resolves on the same tick
 * (no network involved), kept as an async function purely so call sites can keep using `await
 * spinRequest(...)` unchanged. */
export async function spinRequest(betAmount: number, currentBalance = 0): Promise<SpinResponse> {
  const config = getGemsDeluxeRtpConfig();
  const tier = rollTier(config.tiers);
  const isLoss = tier.key === "loss";
  const lineSymbols = isLoss ? buildLossLine() : buildLineForTier(tier.key);
  const emptyReelIndex = isLoss ? Math.floor(Math.random() * 3) : null;
  const reels = [0, 1, 2].map((i) =>
    buildReel(lineSymbols[i], tier.key === "dollarBonus" && i !== DOLLAR_REEL_INDEX)
  ) as [ReelResult, ReelResult, ReelResult];

  if (tier.key === "dollarBonus") {
    const offers = generateOffers(config.bonusPool);
    const bonusId = String(nextBonusId++);
    ACTIVE_BONUS_ROUNDS.set(bonusId, { offers, currentIndex: 0, resolved: false });

    const balance = Math.round((currentBalance - betAmount) * 100) / 100;
    return {
      reels,
      winAmount: 0,
      balance,
      bonusTriggered: true,
      bonusId,
      currentOffer: offers[0],
      offerNumber: 1,
      offerCount: OFFER_COUNT,
      isLastOffer: (OFFER_COUNT as number) <= 1,
    };
  }

  const multiplier = isLoss ? 0 : (tier.payoutMultiplier ?? 0);
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const balance = Math.round((currentBalance - betAmount + winAmount) * 100) / 100;

  return { reels, emptyReelIndex, winAmount, balance, bonusTriggered: false };
}

/** Reveals the next pre-rolled offer (a "Try Again" click) — never the last one twice. Not
 * currently called by GemsDeluxeGame.tsx's shipped UI (see the module doc comment), but kept as a
 * faithful, working part of the API surface. */
export async function bonusAdvanceRequest(bonusId: string): Promise<BonusAdvanceResponse> {
  const bonus = ACTIVE_BONUS_ROUNDS.get(bonusId);
  if (!bonus || bonus.resolved) {
    throw new Error("No pending bonus round found");
  }
  if (bonus.currentIndex >= bonus.offers.length - 1) {
    throw new Error("Already on the last offer");
  }

  bonus.currentIndex += 1;

  return {
    currentOffer: bonus.offers[bonus.currentIndex],
    offerNumber: bonus.currentIndex + 1,
    offerCount: bonus.offers.length,
    isLastOffer: bonus.currentIndex === bonus.offers.length - 1,
  };
}

/** Take It — always credits whichever offer is currently revealed for this bonus round
 * (bonus.currentIndex), regardless of anything the caller might otherwise try to pass.
 * `currentBalance` is the player's balance right before this call (already reflecting the
 * original spin's bet deduction) — the new balance is computed here and returned. */
export async function bonusResolveRequest(bonusId: string, currentBalance = 0): Promise<BonusResolveResponse> {
  const bonus = ACTIVE_BONUS_ROUNDS.get(bonusId);
  if (!bonus || bonus.resolved) {
    throw new Error("No pending bonus round found");
  }

  const winAmount = bonus.offers[bonus.currentIndex];
  const balance = Math.round((currentBalance + winAmount) * 100) / 100;

  bonus.resolved = true;
  ACTIVE_BONUS_ROUNDS.delete(bonusId);

  return { balance, winAmount };
}

export async function getGemsDeluxeConfig(): Promise<GemsDeluxeConfigResponse> {
  return {
    meta: {
      id: "gems-deluxe",
      name: "Gems Deluxe",
      description: "Classic 3-reel, single-line slot with a pick-a-gem bonus round",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    paytable: REFERENCE_PAYTABLE,
    bonusPool: REFERENCE_BONUS_POOL,
    offerCount: OFFER_COUNT,
    betLevels: BET_LEVELS,
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: GemsDeluxeSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  await apiClient.post("/api/games/gems-deluxe/spin-log", params);
}
