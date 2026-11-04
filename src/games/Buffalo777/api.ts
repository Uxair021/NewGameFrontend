/**
 * Buffalo777's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally,
 * on the same tick, instead of over the network. Everything below (other than `logSpinResult`)
 * is a faithful port of what used to live in `backEnd/src/games/Buffalo777/engine.ts`, using the
 * exact same tier weights/payout multipliers that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["buffalo-777"]` (the live odds —
 * `REFERENCE_PAYTABLE` below is/was the *display* table only). Kept as the same exported
 * function names/signatures as the old network calls (`spinRequest`, `getBuffalo777Config`) so
 * `Buffalo777Game.tsx` didn't need to change how it calls them.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/Buffalo777/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so Buffalo777 spins show
 * up in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It
 * never influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, fitFrequencies, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";
import { getJackpotRtpScale } from "../shared/jackpot/jackpotApi";

export type BuffaloSymbol =
  | "TEN"
  | "JACK"
  | "QUEEN"
  | "KING"
  | "ACE"
  | "BULL"
  | "SINGLE_BAR"
  | "DOUBLE_BAR"
  | "TRIPLE_BAR"
  | "MONEY_BAG"
  | "COIN";


export interface PayoutRow {
  symbol: BuffaloSymbol | "ANY_BAR";
  payout: number;
}

export interface SpinResponse {
  reels: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol][];
  lineSymbols: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol];
  winTierKey: string | null;
  multiplier: number;
  winAmount: number;
  /** True when 3 Gold Coins landed on a normal (non-free) spin — starts the 10 free spins bonus. */
  bonusTriggered: boolean;
}

/** Free spins awarded by the Gold Coin bonus. */
export const BONUS_FREE_SPINS = 10;

export interface Buffalo777ConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: PayoutRow[];
  betLevels: number[];
}

export type Buffalo777TierKey =
  | "loss"
  | "ten"
  | "jack"
  | "queen"
  | "king"
  | "ace"
  | "bull"
  | "anyBar"
  | "singleBar"
  | "doubleBar"
  | "tripleBar"
  | "moneyBag"
  | "coin";

export interface Buffalo777TierRow {
  key: Buffalo777TierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface Buffalo777RtpConfig {
  targetRtpPercent: number;
  tiers: Buffalo777TierRow[];
}

const DISPLAY_SYMBOLS: BuffaloSymbol[] = [
  "TEN",
  "JACK",
  "QUEEN",
  "KING",
  "ACE",
  "BULL",
  "SINGLE_BAR",
  "DOUBLE_BAR",
  "TRIPLE_BAR",
  "MONEY_BAG",
  "COIN",
];

const BAR_SYMBOLS: ReadonlySet<BuffaloSymbol> = new Set(["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR"]);

const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];

type TierKey = Buffalo777TierKey;
type TierRow = Buffalo777TierRow;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["buffalo-777"] — the actual live
 * odds this game shipped with (not the cosmetic REFERENCE_PAYTABLE below), frequencyPercent
 * summing to exactly 100 at a ~92.98% RTP. This is the fixed "shape"/relative rarity of every
 * tier — used only to build the very first default config (see getBuffaloDefaultConfig) the
 * first time the admin page loads; after that, the admin's own saved tiers are the live odds,
 * edited directly rather than always re-derived from this table. */
const BASE_TIERS: TierRow[] = [
  { key: "loss", frequencyPercent: 72.6187, payoutMultiplier: null },
  { key: "ten", frequencyPercent: 5.0, payoutMultiplier: 1 },
  { key: "jack", frequencyPercent: 6.0, payoutMultiplier: 2 },
  { key: "queen", frequencyPercent: 4.4846, payoutMultiplier: 3 },
  { key: "king", frequencyPercent: 2.8029, payoutMultiplier: 4 },
  { key: "ace", frequencyPercent: 1.5696, payoutMultiplier: 5 },
  { key: "bull", frequencyPercent: 0.7848, payoutMultiplier: 10 },
  { key: "anyBar", frequencyPercent: 0.6166, payoutMultiplier: 15 },
  { key: "singleBar", frequencyPercent: 0.2018, payoutMultiplier: 50 },
  { key: "doubleBar", frequencyPercent: 0.0729, payoutMultiplier: 75 },
  { key: "tripleBar", frequencyPercent: 0.0247, payoutMultiplier: 100 },
  { key: "moneyBag", frequencyPercent: 0.005, payoutMultiplier: 250 },
  { key: "coin", frequencyPercent: 0.0011, payoutMultiplier: 500 },
];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ---
//
// Mirrors the exact data model AdminRtpPage.tsx uses for every other game's (backend-driven)
// PaytableConfig — a `targetRtpPercent` plus a `tiers` array the admin edits directly
// (frequency % and payout multiplier per row) — except this one is persisted to localStorage
// instead of POSTed to the server. The saved `tiers` themselves ARE the live odds `rollTier()`
// draws from (see below) — there's no separate "base table" involved once something's been
// saved; BASE_TIERS below is only ever used to build the very first default.

const RTP_CONFIG_STORAGE_KEY = "texas-slots-buffalo777-rtp-config";
export const DEFAULT_BUFFALO_TARGET_RTP_PERCENT = 90;

/** Sum of (frequencyPercent/100 * payoutMultiplier) across every tier, as a percent — the
 * same formula AdminRtpPage.tsx's computeRtpPercent uses for every other game. */
export function computeBuffaloRtpPercent(tiers: TierRow[]): number {
  return (
    tiers.reduce((sum, t) => (t.payoutMultiplier !== null ? sum + (t.frequencyPercent / 100) * t.payoutMultiplier : sum), 0) *
    100
  );
}

/** Rescales `tiers` to land on `targetRtpPercent` — identical technique to AdminRtpPage.tsx's
 * own `rescaleLineTiers`: every winning tier's frequency is multiplied by `scale` (clamped at
 * 0, payout multipliers left untouched), then `loss` absorbs whatever's left so frequencies
 * still sum to exactly 100%. Callers pass `targetRtpPercent / computeBuffaloRtpPercent(tiers)`
 * as the effective scale, same as the admin page does. */
export function rescaleBuffaloTiers(tiers: TierRow[], scale: number): TierRow[] {
  const scaled = tiers.map((t) =>
    t.key === "loss" ? t : { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) }
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

/** The fresh, first-time-ever default config — BASE_TIERS' shape rescaled to the 90% default
 * target. Used both as the fallback when nothing's saved yet and by the admin page's "Reset to
 * default" action. */
export function getBuffaloDefaultConfig(): Buffalo777RtpConfig {
  const baseRtp = computeBuffaloRtpPercent(BASE_TIERS);
  const scale = baseRtp > 0 ? DEFAULT_BUFFALO_TARGET_RTP_PERCENT / baseRtp : 0;
  return { targetRtpPercent: DEFAULT_BUFFALO_TARGET_RTP_PERCENT, tiers: rescaleBuffaloTiers(BASE_TIERS, scale) };
}

function isValidTierRow(row: unknown): row is TierRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.key === "string" &&
    typeof r.frequencyPercent === "number" &&
    (r.payoutMultiplier === null || typeof r.payoutMultiplier === "number")
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getBuffaloRtpConfig(): Buffalo777RtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getBuffaloDefaultConfig();
    const parsed = JSON.parse(raw) as Partial<Buffalo777RtpConfig>;
    if (
      typeof parsed.targetRtpPercent !== "number" ||
      !Array.isArray(parsed.tiers) ||
      parsed.tiers.length === 0 ||
      !parsed.tiers.every(isValidTierRow)
    ) {
      return getBuffaloDefaultConfig();
    }
    return applyHouseRules({ targetRtpPercent: parsed.targetRtpPercent, tiers: parsed.tiers });
  } catch {
    return getBuffaloDefaultConfig();
  }
}

/** House rules (see shared/rtpRules.ts): whole-number pays, target capped at 90%, and the RTP
 * matched by re-fitting frequencies — so a config saved before these rules still plays by them. */
function applyHouseRules(config: Buffalo777RtpConfig): Buffalo777RtpConfig {
  const targetRtpPercent = capTargetRtp(config.targetRtpPercent);
  const whole = config.tiers.map((t) => (t.payoutMultiplier === null ? t : { ...t, payoutMultiplier: wholeX(t.payoutMultiplier) }));
  const tiers =
    Math.abs(computeBuffaloRtpPercent(whole) - targetRtpPercent) < 0.05
      ? whole
      : fitFrequencies(whole, computeBuffaloRtpPercent, rescaleBuffaloTiers, targetRtpPercent);
  return { targetRtpPercent, tiers };
}

/** Persists a new RTP config — takes effect on the very next spin (rollTier() re-reads this
 * on every call, see below), no reload or cross-tab wiring needed. Silently no-ops if
 * localStorage isn't available. */
export function setBuffaloRtpConfig(config: Buffalo777RtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncBuffaloRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("buffalo-777", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveBuffaloRtpConfigToServer(config: Buffalo777RtpConfig): Promise<void> {
  return saveRtpConfigToServer("buffalo-777", config);
}

/** Every win tier maps 1:1 to a single symbol/combo — anyBar has no fixed symbol (it's a
 * mixed combination, handled separately in buildLineForTier/evaluateLine). */
const TIER_SYMBOL: Partial<Record<TierKey, BuffaloSymbol>> = {
  ten: "TEN",
  jack: "JACK",
  queen: "QUEEN",
  king: "KING",
  ace: "ACE",
  bull: "BULL",
  singleBar: "SINGLE_BAR",
  doubleBar: "DOUBLE_BAR",
  tripleBar: "TRIPLE_BAR",
  moneyBag: "MONEY_BAG",
  coin: "COIN",
};

const SYMBOL_TIER: Partial<Record<BuffaloSymbol, TierKey>> = Object.fromEntries(
  (Object.entries(TIER_SYMBOL) as [TierKey, BuffaloSymbol][]).map(([tier, symbol]) => [symbol, tier])
);

/** Cosmetic/display paytable for the paytable modal — payout amounts here already match each
 * tier's payoutMultiplier above, so this stays valid as pure display data. */
const REFERENCE_PAYTABLE: PayoutRow[] = [
  { symbol: "COIN", payout: 500 },
  { symbol: "MONEY_BAG", payout: 250 },
  { symbol: "TRIPLE_BAR", payout: 100 },
  { symbol: "DOUBLE_BAR", payout: 75 },
  { symbol: "SINGLE_BAR", payout: 50 },
  { symbol: "ANY_BAR", payout: 15 },
  { symbol: "BULL", payout: 10 },
  { symbol: "ACE", payout: 5 },
  { symbol: "KING", payout: 4 },
  { symbol: "QUEEN", payout: 3 },
  { symbol: "JACK", payout: 2 },
  { symbol: "TEN", payout: 1 },
];

function randomSymbol(): BuffaloSymbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

function randomBar(): BuffaloSymbol {
  const bars = [...BAR_SYMBOLS];
  return bars[Math.floor(Math.random() * bars.length)];
}

/** Classifies a 3-symbol line into the tier it satisfies, if any — used only as a
 * rejection-sampling guard for synthesizing a genuine "loss" line. */
function evaluateLine(line: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol]): TierKey | null {
  if (line[0] === line[1] && line[1] === line[2]) {
    return SYMBOL_TIER[line[0]] ?? null;
  }
  if (line.every((s) => BAR_SYMBOLS.has(s))) {
    return "anyBar";
  }
  return null;
}

/** A line that genuinely matches nothing — rejection-sampled, converges in 1-2 tries. */
function buildLossLine(): [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol] {
  let line: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol];
  do {
    line = [randomSymbol(), randomSymbol(), randomSymbol()];
  } while (evaluateLine(line) !== null);
  return line;
}

/** Constructs the exact 3-symbol line for a given tier. */
function buildLineForTier(tierKey: TierKey): [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol] {
  const symbol = TIER_SYMBOL[tierKey];
  if (symbol) return [symbol, symbol, symbol];

  if (tierKey === "anyBar") {
    let line: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol];
    do {
      line = [randomBar(), randomBar(), randomBar()];
    } while (line[0] === line[1] && line[1] === line[2]);
    return line;
  }

  return buildLossLine();
}

/** TESTING ONLY — set to true to force every spin to land 3x Bull on the payline (so the bull
 * win animation can be checked); set back to false for normal random play. */
export const FORCE_BULL_WIN = false;

/** TESTING ONLY — set to true to force every normal spin to land 3x Gold Coin and start the
 * free spins bonus; set back to false for normal random play. */
export const FORCE_COIN_BONUS = false;

/** Weighted-random pick of one tier by frequencyPercent — reads the admin's saved tier table
 * fresh on every call, so a change saved from the "Buffalo RTP" admin tab takes effect on the
 * very next spin. */
function rollTier(freeSpin: boolean, minMultiplier = 0, forceBonus = false): TierRow {
  const configTiers = getBuffaloRtpConfig().tiers;
  if (forceBonus && !freeSpin) {
    const coin = configTiers.find((t) => t.key === "coin");
    if (coin) return coin;
  }
  // While this game is in the jackpot pool, the base game gives up the pool's contribution %.
  const jackpotScale = getJackpotRtpScale("buffalo-777", computeBuffaloRtpPercent(configTiers));
  const liveTiers = jackpotScale < 1 ? rescaleBuffaloTiers(configTiers, jackpotScale) : configTiers;
  // Coins can't retrigger the bonus during free spins — the coin tier is left out of the draw.
  let tiers = liveTiers.filter((t) => !freeSpin || t.key !== "coin");
  if (minMultiplier > 0) {
    // Guaranteed win: only winning tiers paying at least minMultiplier stay in the draw (still
    // weighted by frequency, so the smallest qualifying win is by far the most likely).
    const qualifying = tiers.filter((t) => t.key !== "loss" && (t.payoutMultiplier ?? 0) >= minMultiplier);
    if (qualifying.length > 0) {
      tiers = qualifying;
    } else {
      const best = tiers.reduce((a, b) => ((b.payoutMultiplier ?? 0) > (a.payoutMultiplier ?? 0) ? b : a));
      return best;
    }
  }
  if (FORCE_COIN_BONUS && !freeSpin) {
    const coin = tiers.find((t) => t.key === "coin");
    if (coin) return coin;
  }
  if (FORCE_BULL_WIN) {
    const bull = tiers.find((t) => t.key === "bull");
    if (bull) return bull;
  }
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Runs one local, outcome-first spin: the tier is decided first (by frequency), then the
 * payline and each reel's cosmetic above/below filler are built to match it exactly — same
 * algorithm as the old backend's engine.ts. Resolves on the same tick (no network involved),
 * kept as an async function purely so call sites can keep using `await spinRequest(...)`
 * unchanged. */
/** `minWinAmount` > 0 guarantees this spin wins at least that much (used to make sure the free
 * spins bonus pays out its minimum). `forceBonus` lands 3x Gold Coin to start the free spins for a
 * jackpot hit — that trigger line pays nothing itself, since the jackpot is the prize. */
export async function spinRequest(
  betAmount: number,
  freeSpin = false,
  minWinAmount = 0,
  forceBonus = false
): Promise<SpinResponse> {
  const minMultiplier = minWinAmount > 0 && betAmount > 0 ? minWinAmount / betAmount : 0;
  const tier = rollTier(freeSpin, minMultiplier, forceBonus);
  const lineSymbols = tier.key === "loss" ? buildLossLine() : buildLineForTier(tier.key);
  const multiplier = tier.key === "loss" || (forceBonus && !freeSpin) ? 0 : (tier.payoutMultiplier ?? 0);
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const reels = lineSymbols.map((mid) => [randomSymbol(), mid, randomSymbol()]) as [
    BuffaloSymbol,
    BuffaloSymbol,
    BuffaloSymbol,
  ][];

  return {
    reels,
    lineSymbols,
    winTierKey: tier.key === "loss" ? null : tier.key,
    multiplier,
    winAmount,
    bonusTriggered: !freeSpin && tier.key === "coin",
  };
}

export async function getBuffalo777Config(): Promise<Buffalo777ConfigResponse> {
  return {
    meta: {
      id: "buffalo-777",
      name: "Buffalo 777",
      description: "Classic 3-reel, single-payline slot",
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
  reelSymbols: BuffaloSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/buffalo-777/spin-log", { ...params, tier: null });
}
