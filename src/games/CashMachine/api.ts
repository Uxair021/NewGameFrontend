/**
 * Cash Machine's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/CashMachine/{config,engine,winTiers}.ts`,
 * using the exact same tier weights/value ranges that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["cash-machine"]`. Kept as the same
 * exported function names/signatures as the old network calls (`spinRequest`,
 * `getCashMachineConfig`) so `CashMachineGame.tsx` didn't need type changes — `spinRequest` gains
 * one new parameter (`currentBalance`), the same shape every other already-offline game's
 * `spinRequest` uses, since this game's `SpinResponse` (like theirs) already carries a `balance`
 * field.
 *
 * Unlike every other converted game, the credited amount here is NOT `payoutMultiplier × bet` —
 * it's whatever number the reels' concatenated digits actually land on (see resolveTier), scaled
 * by the bet-tier ratio. `payoutMultiplier` on each tier row is only an *estimate*, used solely
 * for the admin panel's mix of tiers — the real per-spin amount always comes from the synthesized
 * reel symbols, picked to land within that tier's admin-configured value range (amountThresholds).
 * The real RTP is computed from those same boards, per reel count (see tiersForReels).
 *
 * There's no bonus-round state to track here at all — the "zeroRespin" tier's extra respin is
 * resolved within a single spin response (respunIndexes just tells the frontend which reels to
 * animate an extra reveal for), not a separate follow-up request.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/CashMachine/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so Cash Machine spins show
 * up in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, fitFrequencies } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type CashSymbol = "null" | "0" | "1" | "2" | "5" | "10";

export interface SpinResponse {
  /** Only the reels actually in play for this bet's tier — length equals activeReels. */
  symbols: CashSymbol[];
  /** How many of the 3 reels are in play at this bet (1, 2, or 3). */
  activeReels: number;
  /** Indexes (within `symbols`) of reels that got a bonus respin (0 landed elsewhere + this reel was null). */
  respunIndexes: number[];
  winAmount: number;
  balance: number;
  meta: { forced: boolean };
}

export interface CashMachineConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  betLevels: number[];
}

// --- Game shape — ported verbatim from backEnd/src/games/CashMachine/config.ts --------------

const NULL_SYMBOL: CashSymbol = "null";
const ZERO_SYMBOL: CashSymbol = "0";

/** "null" dominates so that a spin showing 2-3 real numbers (which is what produces the big
 * multi-digit wins via concatenation) stays rare — same weighting every reel shares. */
const SYMBOL_WEIGHTS: Record<CashSymbol, number> = {
  null: 75,
  "0": 10,
  "1": 7,
  "2": 5,
  "5": 2,
  "10": 1,
};

const NON_ZERO_SYMBOLS = (Object.keys(SYMBOL_WEIGHTS) as CashSymbol[]).filter((s) => s !== ZERO_SYMBOL);
/** The reels the "zeroRespin" tier respins must reveal an actual value, never blank. */
const NON_NULL_SYMBOLS = (Object.keys(SYMBOL_WEIGHTS) as CashSymbol[]).filter((s) => s !== NULL_SYMBOL);

/** Bet determines how many reels are even in play — 1 reel at the lowest tier, up to all 3 at
 * the highest. `fullBetForReels` is the "100%" bet for that reel count (1, 5, or 10); the win is
 * scaled by (bet / fullBetForReels) so the low-value tier lands on the same RTP as its full-value
 * pair instead of just being a flat fraction of it. */
export interface BetTier {
  bet: number;
  activeReels: number;
  fullBetForReels: number;
}

const BET_TIERS: BetTier[] = [
  { bet: 0.1, activeReels: 1, fullBetForReels: 1 },
  { bet: 1, activeReels: 1, fullBetForReels: 1 },
  { bet: 0.5, activeReels: 2, fullBetForReels: 5 },
  { bet: 5, activeReels: 2, fullBetForReels: 5 },
  { bet: 0.9, activeReels: 3, fullBetForReels: 10 },
  { bet: 10, activeReels: 3, fullBetForReels: 10 },
];

const BET_LEVELS = BET_TIERS.map((t) => t.bet).sort((a, b) => a - b);

function getBetTier(bet: number): BetTier | undefined {
  return BET_TIERS.find((t) => Math.abs(t.bet - bet) < 1e-9);
}

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------
//
// This game pays whatever number the reels spell out, so its outcome rows are *value bands*, not
// symbol combos. The keys below are internal ids only — the admin page shows them as plain value
// ranges ("100 - 999", ...). There are no Big/Mega/Jackpot celebrations.

export type TierKey = "loss" | "simpleWin" | "bigWin" | "megaWin" | "jackpot" | "zeroRespin";

export interface CashTierRow {
  key: TierKey;
  frequencyPercent: number;
  /** Estimate-only, for the RTP preview — the real payout comes from amountThresholds (see the
   * module doc comment). null only for tiers that never carry one (there are none here, but kept
   * for shape parity with every other game's tier row). */
  payoutMultiplier: number | null;
}

export interface CashRtpConfig {
  targetRtpPercent: number;
  tiers: CashTierRow[];
  /** The real payout control — whatever number the reels land on within a tier's range is
   * exactly what gets paid (scaled by bet). */
  amountThresholds: {
    simpleWinMax: number;
    bigWinMin: number;
    megaWinMin: number;
    jackpotMin: number;
    zeroRespinMin: number;
    zeroRespinMax: number;
  };
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-cashmachine-rtp-config";
export const DEFAULT_CASH_TARGET_RTP_PERCENT = 90;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["cash-machine"] — the actual live
 * odds this game shipped with, derived via Monte Carlo simulation of the previous weighted-digit
 * concatenation logic so it reproduces the already-accepted (if inflated) RTP of the old system. */
const BASE_TIERS: CashTierRow[] = [
  { key: "loss", frequencyPercent: 53.38, payoutMultiplier: null },
  { key: "simpleWin", frequencyPercent: 40.15, payoutMultiplier: 0.68 },
  { key: "bigWin", frequencyPercent: 3.16, payoutMultiplier: 17.96 },
  { key: "megaWin", frequencyPercent: 0.3, payoutMultiplier: 144.16 },
  { key: "jackpot", frequencyPercent: 0.01, payoutMultiplier: 1221.45 },
  { key: "zeroRespin", frequencyPercent: 3.0, payoutMultiplier: 10.5 },
];

const BASE_AMOUNT_THRESHOLDS = {
  simpleWinMax: 99,
  bigWinMin: 100,
  megaWinMin: 1000,
  jackpotMin: 10000,
  zeroRespinMin: 1,
  zeroRespinMax: 20,
};

export function getCashDefaultConfig(): CashRtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_CASH_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
    amountThresholds: { ...BASE_AMOUNT_THRESHOLDS },
  });
}

/** House rules (see shared/rtpRules.ts): target capped at 90%, matched by re-fitting the bands'
 * frequencies. Unlike every other game, Cash Machine has no x-bet pays to make whole — it pays
 * the number the reels spell out, and each band's payoutMultiplier is only an RTP estimate. */
function applyHouseRules(config: CashRtpConfig): CashRtpConfig {
  const targetRtpPercent = capTargetRtp(config.targetRtpPercent);
  if (Math.abs(computeCashRtpPercent(config) - targetRtpPercent) < 0.05) return { ...config, targetRtpPercent };
  const tiers = fitFrequencies(config.tiers, (t) => computeCashRtpPercent({ ...config, tiers: t }), rescaleCashTiers, targetRtpPercent);
  return { ...config, targetRtpPercent, tiers };
}

function isValidConfig(value: unknown): value is CashRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0 &&
    typeof v.amountThresholds === "object" &&
    v.amountThresholds !== null
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getCashRtpConfig(): CashRtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getCashDefaultConfig();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidConfig(parsed)) return getCashDefaultConfig();
    return applyHouseRules(parsed);
  } catch {
    return getCashDefaultConfig();
  }
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setCashRtpConfig(config: CashRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncCashRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("cash-machine", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveCashRtpConfigToServer(config: CashRtpConfig): Promise<void> {
  return saveRtpConfigToServer("cash-machine", config);
}

/** Mirrors the backend's generic computeRtpPercent fallback (services/paytableConfig.ts) exactly
 * — the same formula every not-specially-handled game uses. Cash Machine has no "freeSpin" tier,
 * so this is just the base sum, using each tier's payoutMultiplier *estimate*. It only keeps the
 * admin's mix of tiers consistent — computeCashRealRtpByReels is what players really get. */
export function computeCashRtpPercent(config: CashRtpConfig): number {
  const winTiers = config.tiers.filter((t) => t.payoutMultiplier !== null);
  const baseRtp = winTiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0), 0);
  return baseRtp * 100;
}

/** Rescales `tiers` to land on a new target — identical technique to the generic admin page's own
 * `rescaleLineTiers`: every tier with a real payoutMultiplier has its frequency scaled by `scale`
 * (clamped at 0), then `loss` absorbs whatever's left so frequencies still sum to exactly 100%. */
export function rescaleCashTiers(tiers: CashTierRow[], scale: number): CashTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/CashMachine/engine.ts ----------

function concatenatedValue(symbols: readonly CashSymbol[]): number {
  const concatenated = symbols.filter((s) => s !== NULL_SYMBOL).join("");
  return concatenated === "" ? 0 : parseInt(concatenated, 10);
}

interface AmountRange {
  min: number;
  max: number; // inclusive; Infinity for open-ended (jackpot)
}

function rangeForTier(tierKey: TierKey, thresholds: CashRtpConfig["amountThresholds"]): AmountRange {
  switch (tierKey) {
    case "loss":
      return { min: 0, max: 0 };
    case "simpleWin":
      return { min: 1, max: thresholds.simpleWinMax };
    case "bigWin":
      return { min: thresholds.bigWinMin, max: thresholds.megaWinMin - 1 };
    case "megaWin":
      return { min: thresholds.megaWinMin, max: thresholds.jackpotMin - 1 };
    case "jackpot":
      return { min: thresholds.jackpotMin, max: Infinity };
    case "zeroRespin":
      return { min: thresholds.zeroRespinMin, max: thresholds.zeroRespinMax };
    default:
      return { min: 0, max: 0 };
  }
}

/** One possible board for a tier: what the reels show, and the number that pays. */
interface Board {
  symbols: CashSymbol[];
  respunIndexes: number[];
  value: number;
  /** Relative odds, from SYMBOL_WEIGHTS. */
  weight: number;
}

/** Every board `options` (the symbols allowed on each reel) can make with a value within `range`. */
function boardsInRange(options: CashSymbol[][], range: AmountRange, respunIndexes: number[]): Board[] {
  let partial: { symbols: CashSymbol[]; weight: number }[] = [{ symbols: [], weight: 1 }];
  options.forEach((reelOptions) => {
    partial = partial.flatMap((board) =>
      reelOptions.map((symbol) => ({
        symbols: [...board.symbols, symbol],
        // A reel with one fixed option (the zeroRespin tier's "0") isn't a draw, so it weighs nothing.
        weight: board.weight * (reelOptions.length === 1 ? 1 : SYMBOL_WEIGHTS[symbol]),
      }))
    );
  });
  return partial
    .map((board) => ({ ...board, respunIndexes, value: concatenatedValue(board.symbols) }))
    .filter((board) => board.value >= range.min && board.value <= range.max);
}

/** Boards are enumerated (at most a few hundred) rather than rejection-sampled: a bounded number of
 * tries gives up on rare boards like 10-10 and pays a smaller number instead, which silently lowers
 * the RTP. Cached per reel count + range, since the tiers' ranges rarely change. */
const boardCache = new Map<string, Board[]>();

function boardsForTier(tierKey: TierKey, activeReels: number, thresholds: CashRtpConfig["amountThresholds"]): Board[] {
  const range = rangeForTier(tierKey, thresholds);
  const zeroRespin = tierKey === "zeroRespin" && activeReels > 1;
  const cacheKey = `${zeroRespin}|${activeReels}|${range.min}|${range.max}`;
  const cached = boardCache.get(cacheKey);
  if (cached) return cached;

  let boards: Board[];
  if (zeroRespin) {
    // One active reel is fixed to ZERO_SYMBOL, every other starts blank and gets a bonus respin
    // revealing a real digit.
    const reels = Array.from({ length: activeReels }, (_, i) => i);
    boards = reels.flatMap((zeroIndex) =>
      boardsInRange(
        reels.map((i) => (i === zeroIndex ? [ZERO_SYMBOL] : NON_NULL_SYMBOLS)),
        range,
        reels.filter((i) => i !== zeroIndex)
      )
    );
  } else {
    // "0" is reserved for the zeroRespin tier above, so a "loss" (range {0,0}) can only ever be an
    // all-blank board, never a lone "0" that would look like a near-miss. With one reel, zeroRespin
    // has no second reel to hide behind, so it just reveals a real digit directly.
    boards = boardsInRange(Array.from({ length: activeReels }, () => NON_ZERO_SYMBOLS), range, []);
  }
  boardCache.set(cacheKey, boards);
  return boards;
}

/** What a tier pays on average at this reel count (before bet-ratio scaling); null when its value
 * range can't be spelled with this many reels — e.g. 100+ on one reel. */
function averageValue(tierKey: TierKey, activeReels: number, thresholds: CashRtpConfig["amountThresholds"]): number | null {
  const boards = boardsForTier(tierKey, activeReels, thresholds);
  if (boards.length === 0) return null;
  const totalWeight = boards.reduce((sum, b) => sum + b.weight, 0);
  return boards.reduce((sum, b) => sum + b.weight * b.value, 0) / totalWeight;
}

function realRtpPercent(
  tiers: CashTierRow[],
  activeReels: number,
  fullBetForReels: number,
  thresholds: CashRtpConfig["amountThresholds"]
): number {
  return tiers.reduce((sum, t) => {
    const average = t.key === "loss" ? 0 : averageValue(t.key, activeReels, thresholds) ?? 0;
    return sum + (t.frequencyPercent * average) / fullBetForReels;
  }, 0);
}

/** The tier odds actually played at this reel count. The admin's frequencies set the mix of tiers;
 * one shared table can't give the same RTP on every bet, since the same tier pays very differently
 * on 1, 2 and 3 reels. So the tiers a reel count can reach are scaled together to land exactly on
 * the target there (and `loss` absorbs the rest). Frequencies only — never the amounts paid. */
function tiersForReels(config: CashRtpConfig, activeReels: number, fullBetForReels: number): CashTierRow[] {
  const thresholds = config.amountThresholds;
  const reachable = config.tiers.map((t) =>
    t.key !== "loss" && averageValue(t.key, activeReels, thresholds) === null ? { ...t, frequencyPercent: 0 } : t
  );
  const rtp = realRtpPercent(reachable, activeReels, fullBetForReels, thresholds);
  if (rtp <= 0) return reachable;
  const scale = config.targetRtpPercent / rtp;
  const scaled = reachable.map((t) => (t.key === "loss" ? t : { ...t, frequencyPercent: t.frequencyPercent * scale }));
  const winSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - winSum) } : t));
}

/** The RTP a player really gets at each reel count (the bets sharing a reel count pay alike), for
 * the admin page — computed from the boards themselves, not the payout estimates. */
export function computeCashRealRtpByReels(config: CashRtpConfig): { activeReels: number; rtpPercent: number }[] {
  const fullBets = [...new Map(BET_TIERS.map((t) => [t.activeReels, t.fullBetForReels])).entries()];
  return fullBets
    .sort(([a], [b]) => a - b)
    .map(([activeReels, fullBet]) => ({
      activeReels,
      rtpPercent: realRtpPercent(tiersForReels(config, activeReels, fullBet), activeReels, fullBet, config.amountThresholds),
    }));
}

/** Weighted-random pick of one tier row by frequencyPercent. */
function rollTier(tiers: CashTierRow[]): CashTierRow {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Picks the reels + respin indexes for a rolled tier. The credited amount (before bet-ratio
 * scaling) is always the actual concatenated value the reels end up showing — what's on screen
 * is what gets paid, for every tier including "loss" (which always nets 0 since it's an all-blank
 * board). */
function resolveTier(
  tierKey: TierKey,
  activeReels: number,
  thresholds: CashRtpConfig["amountThresholds"]
): { symbols: CashSymbol[]; respunIndexes: number[]; rawAmount: number } {
  const boards = boardsForTier(tierKey, activeReels, thresholds);
  const totalWeight = boards.reduce((sum, b) => sum + b.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const board of boards) {
    roll -= board.weight;
    if (roll < 0) return { symbols: board.symbols, respunIndexes: board.respunIndexes, rawAmount: board.value };
  }
  // Only a range the admin has set so that nothing fits, even a blank board.
  return { symbols: Array.from({ length: activeReels }, () => NULL_SYMBOL), respunIndexes: [], rawAmount: 0 };
}

/** Runs one local, outcome-first spin: the tier is decided first (by frequency), then reel
 * symbols are synthesized to visually match it — same algorithm as the old backend's engine.ts.
 * `currentBalance` is the player's balance right before this spin — the new balance (bet
 * deducted, win credited) is computed here and returned. Resolves on the same tick (no network
 * involved), kept as an async function purely so call sites can keep using `await
 * spinRequest(...)` unchanged. */
export async function spinRequest(betAmount: number, currentBalance = 0): Promise<SpinResponse> {
  const betTier = getBetTier(betAmount);
  if (!betTier) {
    throw new Error(`betAmount must be one of: ${BET_LEVELS.join(", ")}`);
  }

  const config = getCashRtpConfig();
  const tier = rollTier(tiersForReels(config, betTier.activeReels, betTier.fullBetForReels));
  const { symbols, respunIndexes, rawAmount } = resolveTier(tier.key, betTier.activeReels, config.amountThresholds);

  const scaled = rawAmount * (betTier.bet / betTier.fullBetForReels);
  const winAmount = Math.round(scaled * 100) / 100;

  const balance = Math.round((currentBalance - betAmount + winAmount) * 100) / 100;

  return {
    symbols,
    activeReels: betTier.activeReels,
    respunIndexes,
    winAmount,
    balance,
    meta: { forced: false },
  };
}

export async function getCashMachineConfig(): Promise<CashMachineConfigResponse> {
  return {
    meta: {
      id: "cash-machine",
      name: "Cash Machine",
      description: "Win what you see",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    betLevels: BET_LEVELS,
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: CashSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/cash-machine/spin-log", { ...params, tier: null });
}
