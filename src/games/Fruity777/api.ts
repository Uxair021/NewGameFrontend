/**
 * 777 Fruity's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/Fruity777/{config,engine,winTiers}.ts`,
 * using the exact same tier weights/payout multipliers that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["fruity-777"]`. Kept as the same
 * exported function names/signatures as the old network calls (`spinRequest`,
 * `getFruity777Config`) so `Fruity777Game.tsx` didn't need type changes — `spinRequest` gains one
 * new parameter (`currentBalance`), the same shape every other already-offline game's
 * `spinRequest` uses, since this game's `SpinResponse` (like theirs) already carries a `balance`
 * field.
 *
 * Unlike Shamrock Spin, every winning tier here maps 1:1 directly to a single symbol — no
 * cosmetic rule-tier-map layer to pick a rendered symbol within a tier, same flat shape Buffalo
 * 777 uses. There's also no free-spin *round* state to track here: the server never tracked one
 * either — free-spin remaining/total/winnings bookkeeping has always lived entirely in
 * Fruity777Game.tsx's own React state, one spin at a time, so this file stays a fully stateless,
 * self-contained per-call function. The free-spin COUNT granted (fixed 10) is intentionally NOT
 * admin-tunable — same hardcoded range the backend always used.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/Fruity777/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so 777 Fruity spins show up in the
 * admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type FruitySymbol =
  | "APPLE"
  | "LEMON"
  | "ORANGE"
  | "PEACH"
  | "PINEAPPLE"
  | "GRAPE"
  | "WATERMELON"
  | "DRAGON_FRUIT"
  | "SEVEN"
  | "BAR"
  | "STAR"
  | "BONUS";


export interface PayoutRow {
  symbol: FruitySymbol;
  payout: number;
}

export interface SpinResponse {
  reels: [FruitySymbol, FruitySymbol, FruitySymbol][];
  lineSymbols: [FruitySymbol, FruitySymbol, FruitySymbol];
  winTierKey: string | null;
  multiplier: number;
  winAmount: number;
  freeSpinsAwarded: number;
  balance: number;
  meta: { forced: boolean };
}

export interface Fruity777ConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: PayoutRow[];
  betLevels: number[];
  freeSpins: { min: number; max: number };
}

// --- Game shape — ported verbatim from backEnd/src/games/Fruity777/config.ts ----------------

const DISPLAY_SYMBOLS: FruitySymbol[] = [
  "APPLE",
  "LEMON",
  "ORANGE",
  "PEACH",
  "PINEAPPLE",
  "GRAPE",
  "WATERMELON",
  "DRAGON_FRUIT",
  "SEVEN",
  "BAR",
  "STAR",
  "BONUS",
];

const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

/** Free spins awarded by a Bonus trigger — fixed at 10 (min === max), not admin-tunable. */
const MIN_FREE_SPINS = 10;

/** TESTING ONLY — true = every paid spin lands 3 BONUS on the payline and triggers free spins
 * (bell animation, popup, free-spin round), so the bonus flow can be checked without waiting
 * ~3,300 spins for a natural trigger. Free spins themselves still play normally. MUST be false
 * before going live. */
const FORCE_BONUS_TRIGGER = false;
const MAX_FREE_SPINS = 10;

/** Static reference paytable for the rules popup — cosmetic/display only, matches the backend's
 * own REFERENCE_PAYTABLE; the real payout always comes from the live RTP config below. */
const REFERENCE_PAYTABLE: PayoutRow[] = [
  { symbol: "STAR", payout: 250 },
  { symbol: "BAR", payout: 100 },
  { symbol: "SEVEN", payout: 75 },
  { symbol: "DRAGON_FRUIT", payout: 50 },
  { symbol: "WATERMELON", payout: 15 },
  { symbol: "GRAPE", payout: 10 },
  { symbol: "PINEAPPLE", payout: 5 },
  { symbol: "PEACH", payout: 4 },
  { symbol: "ORANGE", payout: 3 },
  { symbol: "LEMON", payout: 2 },
  { symbol: "APPLE", payout: 1 },
];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export type TierKey =
  | "loss"
  | "freeSpin"
  | "apple"
  | "lemon"
  | "orange"
  | "peach"
  | "pineapple"
  | "grape"
  | "watermelon"
  | "dragonFruit"
  | "seven"
  | "bar"
  | "star";

export interface FruityTierRow {
  key: TierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
  freeSpinPayoutMultiplier: number | null;
}

export interface Fruity777RtpConfig {
  targetRtpPercent: number;
  /** RTP-preview average only — the actual count granted always comes from (see
   * MIN_FREE_SPINS/MAX_FREE_SPINS), not read from this field. */
  freeSpinsGranted: number;
  tiers: FruityTierRow[];
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-fruity777-rtp-config";
export const DEFAULT_FRUITY_TARGET_RTP_PERCENT = 90;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["fruity-777"] — the actual live odds
 * this game shipped with. freeSpinPayoutMultiplier == payoutMultiplier for every tier (confirmed:
 * free spins pay the same paytable, no boost). */
const BASE_TIERS: FruityTierRow[] = [
  { key: "loss", frequencyPercent: 72.5898, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
  { key: "freeSpin", frequencyPercent: 0.03, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
  { key: "apple", frequencyPercent: 5.0, payoutMultiplier: 1, freeSpinPayoutMultiplier: 1 },
  { key: "lemon", frequencyPercent: 6.0, payoutMultiplier: 2, freeSpinPayoutMultiplier: 2 },
  { key: "orange", frequencyPercent: 4.4846, payoutMultiplier: 3, freeSpinPayoutMultiplier: 3 },
  { key: "peach", frequencyPercent: 2.8029, payoutMultiplier: 4, freeSpinPayoutMultiplier: 4 },
  { key: "pineapple", frequencyPercent: 1.5696, payoutMultiplier: 5, freeSpinPayoutMultiplier: 5 },
  { key: "grape", frequencyPercent: 0.7848, payoutMultiplier: 10, freeSpinPayoutMultiplier: 10 },
  { key: "watermelon", frequencyPercent: 0.6166, payoutMultiplier: 15, freeSpinPayoutMultiplier: 15 },
  { key: "dragonFruit", frequencyPercent: 0.2018, payoutMultiplier: 50, freeSpinPayoutMultiplier: 50 },
  { key: "seven", frequencyPercent: 0.0729, payoutMultiplier: 75, freeSpinPayoutMultiplier: 75 },
  { key: "bar", frequencyPercent: 0.0247, payoutMultiplier: 100, freeSpinPayoutMultiplier: 100 },
  { key: "star", frequencyPercent: 0.005, payoutMultiplier: 250, freeSpinPayoutMultiplier: 250 },
];

const DEFAULT_FREE_SPINS_GRANTED_PREVIEW = (MIN_FREE_SPINS + MAX_FREE_SPINS) / 2;

export function getFruityDefaultConfig(): Fruity777RtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_FRUITY_TARGET_RTP_PERCENT,
    freeSpinsGranted: DEFAULT_FREE_SPINS_GRANTED_PREVIEW,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
  });
}

/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(input: Fruity777RtpConfig): Fruity777RtpConfig {
  const config: Fruity777RtpConfig = {
    ...input,
    targetRtpPercent: capTargetRtp(input.targetRtpPercent),
    tiers: input.tiers.map((t) => ({
      ...t,
      payoutMultiplier: wholeX(t.payoutMultiplier),
      freeSpinPayoutMultiplier: wholeX(t.freeSpinPayoutMultiplier),
    })),
  };
  const rtp = computeFruityRtpPercent(config);
  if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - config.targetRtpPercent) < 0.05) return config;
  return { ...config, tiers: fitFruityTiersToTarget(config, config.targetRtpPercent) };
}

function isValidConfig(value: unknown): value is Fruity777RtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    typeof v.freeSpinsGranted === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getFruityRtpConfig(): Fruity777RtpConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
  } catch {
    /* storage unavailable — use the default */
  }
  if (fittedCache && fittedCache.raw === raw) return fittedCache.config;
  let config = getFruityDefaultConfig();
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
let fittedCache: { raw: string | null; config: Fruity777RtpConfig } | null = null;

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setFruityRtpConfig(config: Fruity777RtpConfig): void {
  fittedCache = null;
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncFruityRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("fruity-777", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveFruityRtpConfigToServer(config: Fruity777RtpConfig): Promise<void> {
  return saveRtpConfigToServer("fruity-777", config);
}

/** Mirrors the backend's generic computeRtpPercent fallback (services/paytableConfig.ts) exactly
 * — the same formula every not-specially-handled game uses, Fruity 777 included (no dedicated
 * per-game RTP function ever existed for it). */
export function computeFruityRtpPercent(config: Fruity777RtpConfig): number {
  const winTiers = config.tiers.filter((t) => t.payoutMultiplier !== null);
  const baseRtp = winTiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0), 0);

  const freeSpinRow = config.tiers.find((t) => t.key === "freeSpin");
  if (!freeSpinRow || !config.freeSpinsGranted) {
    return baseRtp * 100;
  }

  const freeSpinTierSum = winTiers.reduce(
    (sum, t) => sum + (t.frequencyPercent / 100) * (t.freeSpinPayoutMultiplier ?? t.payoutMultiplier ?? 0),
    0
  );
  const freeSpinRtp = (freeSpinRow.frequencyPercent / 100) * config.freeSpinsGranted * freeSpinTierSum;

  // Round minimum: a round whose spins all lost has its last spin land the cheapest winning line
  // that covers FREE_SPIN_ROUND_MIN_WIN_X (see guaranteedTierFor). Free spins never roll the
  // Bonus row, so a free spin loses with odds loss / (everything but Bonus).
  const lossPct = config.tiers.find((t) => t.key === "loss")?.frequencyPercent ?? 0;
  const freePoolPct = config.tiers.reduce((sum, t) => (t.key === "freeSpin" ? sum : sum + t.frequencyPercent), 0);
  const pFreeLoss = freePoolPct > 0 ? lossPct / freePoolPct : 0;
  const guaranteed = guaranteedTierFor(config.tiers, FREE_SPIN_ROUND_MIN_WIN_X);
  const guaranteedPay = guaranteed ? freePayOf(guaranteed) : 0;
  const minimumRtp = (freeSpinRow.frequencyPercent / 100) * Math.pow(pFreeLoss, config.freeSpinsGranted) * guaranteedPay;

  return (baseRtp + freeSpinRtp + minimumRtp) * 100;
}

/** Every free-spins round pays at least this x of its bet in total — a round still short going
 * into its last spin has that spin land a real winning line (see guaranteedTierFor). */
export const FREE_SPIN_ROUND_MIN_WIN_X = 1;

function freePayOf(tier: FruityTierRow): number {
  return tier.freeSpinPayoutMultiplier ?? tier.payoutMultiplier ?? 0;
}

/** The winning line a short round's last spin is forced to: the lowest-paying tier whose free-spin
 * x value covers `shortfallX` — or, if none does, the highest-paying one. */
function guaranteedTierFor(tiers: FruityTierRow[], shortfallX: number): FruityTierRow | null {
  const byPay = tiers
    .filter((t) => t.key !== "loss" && t.key !== "freeSpin" && TIER_SYMBOL[t.key] && freePayOf(t) > 0)
    .sort((a, b) => freePayOf(a) - freePayOf(b));
  if (byPay.length === 0) return null;
  return byPay.find((t) => freePayOf(t) >= shortfallX - 1e-9) ?? byPay[byPay.length - 1];
}

/** How many x of the bet a round is still short of its minimum (0 = already met). */
export function getFreeSpinShortfallX(betAmount: number, roundWinnings: number): number {
  if (betAmount <= 0) return 0;
  const shortfall = FREE_SPIN_ROUND_MIN_WIN_X - roundWinnings / betAmount;
  return shortfall > 1e-9 ? shortfall : 0;
}

/** Repeatedly rescales the winning rows until the RTP lands on `target` — the round-minimum term
 * isn't linear in the scale, so one proportional pass can miss slightly. */
export function fitFruityTiersToTarget(config: Fruity777RtpConfig, target: number): FruityTierRow[] {
  let tiers = config.tiers;
  for (let i = 0; i < 30; i++) {
    const rtp = computeFruityRtpPercent({ ...config, tiers });
    if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - target) < 0.005) break;
    tiers = rescaleFruityTiers(tiers, target / rtp);
  }
  return tiers;
}

/** Rescales `tiers` to land on a new target — identical technique to the generic admin page's own
 * `rescaleLineTiers`: every tier with a real payoutMultiplier has its frequency scaled by `scale`
 * (clamped at 0; `freeSpin`'s own frequency is untouched), then `loss` absorbs whatever's left so
 * frequencies still sum to exactly 100%. */
export function rescaleFruityTiers(tiers: FruityTierRow[], scale: number): FruityTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/Fruity777/engine.ts ------------

/** The specific symbol each "3 of a kind" tier requires — every winning tier maps 1:1 to exactly
 * one symbol, no cosmetic rule-picking layer. */
const TIER_SYMBOL: Partial<Record<TierKey, FruitySymbol>> = {
  apple: "APPLE",
  lemon: "LEMON",
  orange: "ORANGE",
  peach: "PEACH",
  pineapple: "PINEAPPLE",
  grape: "GRAPE",
  watermelon: "WATERMELON",
  dragonFruit: "DRAGON_FRUIT",
  seven: "SEVEN",
  bar: "BAR",
  star: "STAR",
};

const SYMBOL_TIER: Partial<Record<FruitySymbol, TierKey>> = Object.fromEntries(
  (Object.entries(TIER_SYMBOL) as [TierKey, FruitySymbol][]).map(([tier, symbol]) => [symbol, tier])
);

function randomSymbol(): FruitySymbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

/** Classifies a 3-symbol line into the tier it satisfies, if any — used only as a
 * rejection-sampling guard for synthesizing a genuine "loss" line. */
function evaluateLine(line: [FruitySymbol, FruitySymbol, FruitySymbol]): TierKey | "freeSpin" | null {
  if (line[0] === line[1] && line[1] === line[2]) {
    if (line[0] === "BONUS") return "freeSpin";
    return SYMBOL_TIER[line[0]] ?? null;
  }
  return null;
}

/** A line that genuinely matches nothing — rejection-sampled, converges in 1-2 tries. */
function buildLossLine(): [FruitySymbol, FruitySymbol, FruitySymbol] {
  let line: [FruitySymbol, FruitySymbol, FruitySymbol];
  do {
    line = [randomSymbol(), randomSymbol(), randomSymbol()];
  } while (evaluateLine(line) !== null);
  return line;
}

/** Constructs the exact 3-symbol line for a given tier. */
function buildLineForTier(tierKey: TierKey): [FruitySymbol, FruitySymbol, FruitySymbol] {
  if (tierKey === "freeSpin") return ["BONUS", "BONUS", "BONUS"];
  const symbol = TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];
  return buildLossLine();
}

function buildReel(middle: FruitySymbol): [FruitySymbol, FruitySymbol, FruitySymbol] {
  return [randomSymbol(), middle, randomSymbol()];
}

/** Weighted-random pick of one tier row by frequencyPercent. Optionally excludes "freeSpin" (a
 * bonus-round spin doesn't re-trigger itself — no retrigger). */
function rollTier(tiers: FruityTierRow[], excludeFreeSpin: boolean): FruityTierRow {
  const pool = excludeFreeSpin ? tiers.filter((t) => t.key !== "freeSpin") : tiers;
  const total = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of pool) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return pool[pool.length - 1];
}

function randomFreeSpinsAwarded(): number {
  return MIN_FREE_SPINS + Math.floor(Math.random() * (MAX_FREE_SPINS - MIN_FREE_SPINS + 1));
}

/** Runs one local, outcome-first spin: the tier is decided first (by frequency), then the line is
 * synthesized to match it exactly — same algorithm as the old backend's engine.ts. `betAmount` is
 * the total bet (0 during a free spin). `currentBalance` is the player's balance right before this
 * spin — the new balance (bet deducted, win credited) is computed here and returned. Resolves on
 * the same tick (no network involved), kept as an async function purely so call sites can keep
 * using `await spinRequest(...)` unchanged. */
export async function spinRequest(
  betAmount: number,
  freeSpin = false,
  currentBalance = 0,
  guaranteeShortfallX = 0
): Promise<SpinResponse> {
  const config = getFruityRtpConfig();
  const forcedBonus = FORCE_BONUS_TRIGGER && !freeSpin ? config.tiers.find((t) => t.key === "freeSpin") : undefined;
  // The round's last free spin while still under the round minimum → a real line that covers it.
  const guaranteed = freeSpin && guaranteeShortfallX > 0 ? guaranteedTierFor(config.tiers, guaranteeShortfallX) : null;
  const tier = forcedBonus ?? guaranteed ?? rollTier(config.tiers, freeSpin);

  const lineSymbols = tier.key === "loss" ? buildLossLine() : buildLineForTier(tier.key);
  const isFreeSpinTrigger = tier.key === "freeSpin";
  const multiplier =
    tier.key === "loss" || isFreeSpinTrigger ? 0 : ((freeSpin ? tier.freeSpinPayoutMultiplier : tier.payoutMultiplier) ?? 0);
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const freeSpinsAwarded = isFreeSpinTrigger ? randomFreeSpinsAwarded() : 0;
  const reels: [FruitySymbol, FruitySymbol, FruitySymbol][] = [
    buildReel(lineSymbols[0]),
    buildReel(lineSymbols[1]),
    buildReel(lineSymbols[2]),
  ];

  const stakedAmount = freeSpin ? 0 : betAmount;
  const balance = Math.round((currentBalance - stakedAmount + winAmount) * 100) / 100;

  return {
    reels,
    lineSymbols,
    winTierKey: tier.key === "loss" ? null : tier.key,
    multiplier,
    winAmount,
    freeSpinsAwarded,
    balance,
    meta: { forced: false },
  };
}

export async function getFruity777Config(): Promise<Fruity777ConfigResponse> {
  return {
    meta: {
      id: "fruity-777",
      name: "777 Fruity",
      description: "Classic 3-reel, single-payline fruit slot with a Bonus free-spins feature",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    paytable: REFERENCE_PAYTABLE,
    betLevels: BET_LEVELS,
    freeSpins: { min: MIN_FREE_SPINS, max: MAX_FREE_SPINS },
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: FruitySymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/fruity-777/spin-log", { ...params, tier: null });
}
