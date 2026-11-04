/**
 * Rubber Duck's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/RubberDuck/{config,engine,winCalc}.ts`,
 * using the exact same symbol weights/payouts/free-spin constants that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["rubber-duck"]` and its
 * `computeRubberDuckRtpPercent`. Kept as the same exported function names/signatures as the old
 * network calls (`spinRequest`, `getRubberDuckConfig`) so `RubberDuckGame.tsx` didn't need type
 * changes — `spinRequest` gains one new parameter (`currentBalance`), the same shape every other
 * already-offline game's `spinRequest` uses.
 *
 * Unlike most games converted this way, the free-spins round here was never purely React-state —
 * the old backend tracked it in a `FreeSpinRound` Mongo document specifically so the client's own
 * claimed `isFreeSpin` flag was never trusted ("authoritative, not the client's own claim"). This
 * mirrors exactly how Life of Luxury's own already-offline `spinRequest` (see
 * games/LifeOfLuxury/api.ts) handles the same situation: a module-level `activeRound` variable
 * stands in for the Mongo doc, and the `isFreeSpin` argument passed in is only a hint — the real
 * answer always comes from `activeRound` itself, so the module's bookkeeping and the component's
 * own React state can never drift apart (e.g. if a previous call threw mid-round).
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/RubberDuck/routes.ts`) that just records the already-decided result
 * into the same `SpinHistory` collection every other game uses, so Rubber Duck spins show up in
 * the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type PayingSymbol =
  | "TRIPLE_7"
  | "DOUBLE_7"
  | "SEVEN"
  | "BOAT"
  | "GUN"
  | "TOOL"
  | "SHAMPOO"
  | "TOWEL"
  | "BRUSH"
  | "SAFEGUARD"
  | "CAP"
  | "POT"
  | "SOAP"
  | "SPONGE";

export type FruitSymbol = "AVOCADO" | "BANANA" | "COCONUT" | "GRAPES" | "LEMON" | "STRAWBERRY";

export type RubberDuckSymbol = PayingSymbol | "BONUS" | FruitSymbol;

export interface PayoutRow {
  symbol: PayingSymbol;
  payout: number;
}

export interface PositionWin {
  reelIndex: number;
  symbol: PayingSymbol;
  win: number;
}

export interface SpinEvaluation {
  positionWins: PositionWin[];
  winningPositions: number[];
  bonusCount: number;
  triggered: boolean;
  finalWin: number;
}

export interface SpinResponse {
  reels: RubberDuckSymbol[];
  evaluation: SpinEvaluation;
  winAmount: number;
  freeSpinsAwarded: number | null;
  retriggered: boolean;
  freeSpinRoundResult: { totalWin: number; totalSpins: number } | null;
  balance: number;
  meta: { forced: boolean };
}

export interface RubberDuckConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  betLevels: number[];
  minBet: number;
  maxBet: number;
  paytable: PayoutRow[];
  symbolWeights: Record<string, number>;
  freeSpins: { triggerCount: number; base: number; retrigger: number; winMultiplier: number };
}

// --- Game shape — ported verbatim from backEnd/src/games/RubberDuck/config.ts ---------------

const PAYING_SYMBOLS: PayingSymbol[] = [
  "TRIPLE_7",
  "DOUBLE_7",
  "SEVEN",
  "BOAT",
  "GUN",
  "TOOL",
  "SHAMPOO",
  "TOWEL",
  "BRUSH",
  "SAFEGUARD",
  "CAP",
  "POT",
  "SOAP",
  "SPONGE",
];

/** Pure loss cells — never pay, never trigger anything; just filler weight on the shared
 * reel-strip table. */
const FRUIT_SYMBOLS: FruitSymbol[] = ["AVOCADO", "BANANA", "COCONUT", "GRAPES", "LEMON", "STRAWBERRY"];

const BONUS_SYMBOL: RubberDuckSymbol = "BONUS";

const REEL_COUNT = 5;

const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

/** 3+ BONUS cells anywhere among the 5 reels triggers free spins — 15 on a base spin, or +10
 * more (added to whatever's left, not a fresh batch) if it lands again while already inside a
 * free-spins round. Not admin-tunable — same "fixed feature constants, only the paytable's
 * frequencies/payouts are admin-editable" choice Fruity777's free-spin count range uses. */
const FREE_SPIN_TRIGGER_COUNT = 3;
const FREE_SPINS_BASE = 15;
const FREE_SPINS_RETRIGGER = 10;
/** Every win pays 3x while a free-spins round is active. */
const FREE_SPIN_WIN_MULTIPLIER = 3;
/** Every free-spins round pays at least this x of its bet in total — a round still short going
 * into its last spin has that spin land a real paying symbol (see `forceRoundMinimum`). */
const FREE_SPIN_ROUND_MIN_WIN_X = 1;

/** The exact per-hit values — one flat number per symbol (no 3/4/5-of-a-kind tiers; a single
 * landed cell already pays this in full). */
const DEFAULT_PAYOUTS: Record<PayingSymbol, number> = {
  TRIPLE_7: 10810,
  DOUBLE_7: 6095,
  SEVEN: 3100,
  BOAT: 1000,
  GUN: 500,
  TOOL: 400,
  SHAMPOO: 250,
  TOWEL: 100,
  BRUSH: 20,
  SAFEGUARD: 10,
  CAP: 5,
  POT: 3,
  SOAP: 2,
  SPONGE: 1,
};

const REFERENCE_PAYTABLE: PayoutRow[] = PAYING_SYMBOLS.map((symbol) => ({
  symbol,
  payout: DEFAULT_PAYOUTS[symbol],
}));

/** Default reel-strip weights (percent, one row per symbol, summing to 100 across all 21). The
 * common symbols pay little (Sponge 1x … Brush 20x) so ~22% of spins win (~78% lose); the house
 * rules then scale the paying rows so the default lands on its 90% target (verified by simulation,
 * free spins included). */
const DEFAULT_WEIGHTS: Record<RubberDuckSymbol, number> = {
  TRIPLE_7: 0.00001767,
  DOUBLE_7: 0.00003534,
  SEVEN: 0.00010309,
  BOAT: 0.00053016,
  GUN: 0.00117814,
  TOOL: 0.00206174,
  SHAMPOO: 0.00412348,
  TOWEL: 0.01178137,
  BRUSH: 0.04,
  SAFEGUARD: 0.1,
  CAP: 0.25,
  POT: 0.5,
  SOAP: 1.0,
  SPONGE: 2.0,
  BONUS: 5.985059,
  AVOCADO: 15.518585,
  BANANA: 15.518585,
  COCONUT: 15.518585,
  GRAPES: 15.518585,
  LEMON: 15.518585,
  STRAWBERRY: 15.518585,
};

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export interface RubberDuckTierRow {
  key: RubberDuckSymbol;
  frequencyPercent: number;
  /** null for BONUS and the 6 fruit symbols — only the 14 paying symbols have a direct payout. */
  payoutMultiplier: number | null;
}

export interface RubberDuckRtpConfig {
  targetRtpPercent: number;
  tiers: RubberDuckTierRow[];
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-rubberduck-rtp-config";
export const DEFAULT_RUBBERDUCK_TARGET_RTP_PERCENT = 90.0;

const ALL_SYMBOL_KEYS = Object.keys(DEFAULT_WEIGHTS) as RubberDuckSymbol[];

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["rubber-duck"] — the actual live odds
 * this game shipped with, built the same way the backend's own entry was: programmatically from
 * DEFAULT_WEIGHTS/DEFAULT_PAYOUTS rather than a hand-typed row list. */
const BASE_TIERS: RubberDuckTierRow[] = ALL_SYMBOL_KEYS.map((key) => ({
  key,
  frequencyPercent: DEFAULT_WEIGHTS[key],
  payoutMultiplier: (DEFAULT_PAYOUTS as Record<string, number | undefined>)[key] ?? null,
}));

export function getRubberDuckDefaultConfig(): RubberDuckRtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_RUBBERDUCK_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
  });
}

/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(input: RubberDuckRtpConfig): RubberDuckRtpConfig {
  const config: RubberDuckRtpConfig = {
    ...input,
    targetRtpPercent: capTargetRtp(input.targetRtpPercent),
    tiers: input.tiers.map((t) => ({ ...t, payoutMultiplier: wholeX(t.payoutMultiplier) })),
  };
  const rtp = computeRubberDuckRtpPercent(config);
  if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - config.targetRtpPercent) < 0.05) return config;
  return { ...config, tiers: fitRubberDuckTiersToTarget(config.tiers, config.targetRtpPercent) };
}

function isValidConfig(value: unknown): value is RubberDuckRtpConfig {
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
export function getRubberDuckRtpConfig(): RubberDuckRtpConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
  } catch {
    /* storage unavailable — use the default */
  }
  if (fittedCache && fittedCache.raw === raw) return fittedCache.config;
  let config = getRubberDuckDefaultConfig();
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
let fittedCache: { raw: string | null; config: RubberDuckRtpConfig } | null = null;

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setRubberDuckRtpConfig(config: RubberDuckRtpConfig): void {
  fittedCache = null;
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncRubberDuckRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("rubber-duck", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveRubberDuckRtpConfigToServer(config: RubberDuckRtpConfig): Promise<void> {
  return saveRtpConfigToServer("rubber-duck", config);
}

function nChooseK(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/**
 * Closed-form, not simulated. Each of the 5 reels independently draws from `tiers` (21 rows: 14
 * payers + BONUS + 6 loss fruits) — no matching/adjacency requirement, every reel that lands a
 * paying symbol adds its own payoutMultiplier to the spin's total:
 *
 *   perReelEV = Σ over the 14 payers of (weight_s/100 * payout_s)
 *   baseRtp   = REEL_COUNT * perReelEV        — reels are independent, exact, not an approximation
 *
 * BONUS contributes no direct cash — 3+ of the 5 reels showing it (probability via the Binomial
 * tail, exact) triggers FREE_SPINS_BASE free spins, each paying FREE_SPIN_WIN_MULTIPLIER×. A free
 * spin can itself retrigger (+FREE_SPINS_RETRIGGER more) — the expected extra spins from that
 * chain is a first-order approximation (mirrors Crazy 777's RESPIN extraRtp term): with `pTrig`
 * this small by construction, higher-order retrigger-of-a-retrigger chains are negligible. Ported
 * verbatim from paytableConfig.ts's computeRubberDuckRtpPercent.
 */
export function computeRubberDuckRtpPercent(config: RubberDuckRtpConfig): number {
  const weightOf = (symbol: string): number => config.tiers.find((t) => t.key === symbol)?.frequencyPercent ?? 0;
  const payoutOf = (symbol: string): number =>
    config.tiers.find((t) => t.key === symbol)?.payoutMultiplier ?? (DEFAULT_PAYOUTS as Record<string, number | undefined>)[symbol] ?? 0;

  const perReelEV = PAYING_SYMBOLS.reduce((sum, symbol) => sum + (weightOf(symbol) / 100) * payoutOf(symbol), 0);
  const baseRtp = REEL_COUNT * perReelEV;

  const pBonus = weightOf(BONUS_SYMBOL) / 100;
  let pTrig = 0;
  for (let k = FREE_SPIN_TRIGGER_COUNT; k <= REEL_COUNT; k++) {
    pTrig += nChooseK(REEL_COUNT, k) * Math.pow(pBonus, k) * Math.pow(1 - pBonus, REEL_COUNT - k);
  }

  const avgFreeSpins = FREE_SPINS_BASE * (1 + pTrig * FREE_SPINS_RETRIGGER);
  const freeSpinRtp = pTrig * avgFreeSpins * (FREE_SPIN_WIN_MULTIPLIER * baseRtp);

  // Round minimum: a round whose spins all paid nothing has its last spin land the cheapest paying
  // symbol that covers FREE_SPIN_ROUND_MIN_WIN_X (every paying symbol already covers it, so only an
  // all-blank round is affected). A free spin pays nothing when all 5 reels are fruit/BONUS.
  const payingWeight = PAYING_SYMBOLS.reduce((sum, symbol) => sum + (payoutOf(symbol) > 0 ? weightOf(symbol) : 0), 0) / 100;
  const pBlankSpin = Math.pow(1 - payingWeight, REEL_COUNT);
  const guaranteedPay = guaranteedSymbolPay(payoutOf, FREE_SPIN_ROUND_MIN_WIN_X);
  const minimumRtp = pTrig * Math.pow(pBlankSpin, FREE_SPINS_BASE) * guaranteedPay;

  return (baseRtp + freeSpinRtp + minimumRtp) * 100;
}

/** Free-spin x value of the cheapest paying symbol whose pay covers `shortfallX` (or the best one). */
function guaranteedSymbolPay(payoutOf: (symbol: string) => number, shortfallX: number): number {
  const symbol = cheapestCoveringSymbol(payoutOf, shortfallX);
  return symbol ? payoutOf(symbol) * FREE_SPIN_WIN_MULTIPLIER : 0;
}

function cheapestCoveringSymbol(payoutOf: (symbol: string) => number, shortfallX: number): PayingSymbol | null {
  const byPay = PAYING_SYMBOLS.filter((s) => payoutOf(s) > 0).sort((a, b) => payoutOf(a) - payoutOf(b));
  if (byPay.length === 0) return null;
  return byPay.find((s) => payoutOf(s) * FREE_SPIN_WIN_MULTIPLIER >= shortfallX - 1e-9) ?? byPay[byPay.length - 1];
}

/** Repeatedly rescales the paying rows until the RTP lands on `target` — the round-minimum term
 * isn't linear in the scale, so one proportional pass can miss slightly. */
export function fitRubberDuckTiersToTarget(tiers: RubberDuckTierRow[], target: number): RubberDuckTierRow[] {
  let current = tiers;
  for (let i = 0; i < 30; i++) {
    const rtp = computeRubberDuckRtpPercent({ targetRtpPercent: target, tiers: current });
    if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - target) < 0.005) break;
    current = rescaleRubberDuckTiers(current, target / rtp);
  }
  return current;
}

/** Rescales the 14 paying symbols' frequencies to land on a new target. Unlike most other games'
 * rescale, this lands exactly on target in a single pass: the free-spin RTP term above is
 * multiplicatively tied to baseRtp (not an independent additive term like Gems Deluxe's bonus
 * pool), since BONUS's own frequency is never touched here — so scaling baseRtp by `scale` scales
 * the whole formula by the same `scale`. Unlike every other game here, there's no single "loss"
 * key to absorb the remainder — the 6 fruit symbols jointly play that role, so the leftover is
 * split evenly across them (preserving their equal-weight symmetry from the shipped defaults).
 * BONUS's own frequency is never touched by this. */
export function rescaleRubberDuckTiers(tiers: RubberDuckTierRow[], scale: number): RubberDuckTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonFruitSum = scaled.reduce((sum, t) => (FRUIT_SYMBOLS.includes(t.key as FruitSymbol) ? sum : sum + t.frequencyPercent), 0);
  const fruitShare = Math.max(0, (100 - nonFruitSum) / FRUIT_SYMBOLS.length);
  return scaled.map((t) => (FRUIT_SYMBOLS.includes(t.key as FruitSymbol) ? { ...t, frequencyPercent: fruitShare } : t));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/RubberDuck/{engine,winCalc}.ts -

/** Weighted-random symbol pick from the admin-configured tiers table. */
function weightedSymbol(tiers: RubberDuckTierRow[]): RubberDuckSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier.key;
  }
  return tiers[tiers.length - 1].key;
}

/** Each of the 5 reels draws independently from the exact same weighted table — every symbol can
 * land anywhere. */
function drawReels(tiers: RubberDuckTierRow[]): RubberDuckSymbol[] {
  const reels: RubberDuckSymbol[] = [];
  for (let i = 0; i < REEL_COUNT; i++) reels.push(weightedSymbol(tiers));
  return capRepeatedFruits(reels);
}

/** The same never-paying fruit may show on at most this many reels in one spin. */
const MAX_SAME_FRUIT = 2;

/** No fruit (they never pay) shows more than MAX_SAME_FRUIT times on one spin — 3 matching fruits
 * would look like a win that pays nothing. Each extra copy becomes a different fruit that's still
 * under the cap (6 fruits, 5 reels, so there's always one). Fruit only ever swaps for fruit, so
 * what the spin pays, BONUS triggers and the RTP are all unchanged. */
function capRepeatedFruits(reels: RubberDuckSymbol[]): RubberDuckSymbol[] {
  const isFruit = (s: RubberDuckSymbol) => FRUIT_SYMBOLS.includes(s as FruitSymbol);
  const counts = new Map<RubberDuckSymbol, number>();
  return reels.map((symbol) => {
    if (!isFruit(symbol)) return symbol;
    let chosen = symbol;
    if ((counts.get(symbol) ?? 0) >= MAX_SAME_FRUIT) {
      const open = FRUIT_SYMBOLS.filter((f) => (counts.get(f) ?? 0) < MAX_SAME_FRUIT);
      chosen = open[Math.floor(Math.random() * open.length)] ?? symbol;
    }
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
    return chosen;
  });
}

function paytableFrom(config: RubberDuckRtpConfig): Partial<Record<PayingSymbol, number>> {
  const table: Partial<Record<PayingSymbol, number>> = { ...DEFAULT_PAYOUTS };
  for (const tier of config.tiers) {
    if (tier.payoutMultiplier !== null && (PAYING_SYMBOLS as string[]).includes(tier.key)) {
      table[tier.key as PayingSymbol] = tier.payoutMultiplier;
    }
  }
  return table;
}

/** Every reel is evaluated independently — no adjacency/matching requirement at all. BONUS never
 * contributes cash here; its only effect is bonusCount/triggered. */
function evaluateSpin(
  reels: RubberDuckSymbol[],
  paytable: Partial<Record<PayingSymbol, number>>,
  bet: number,
  isFreeSpin: boolean
): SpinEvaluation {
  const scale = isFreeSpin ? FREE_SPIN_WIN_MULTIPLIER : 1;
  const positionWins: PositionWin[] = [];
  const winningPositions: number[] = [];
  let bonusCount = 0;
  let finalWin = 0;

  reels.forEach((symbol, reelIndex) => {
    if (symbol === BONUS_SYMBOL) {
      bonusCount += 1;
      return;
    }
    const payout = paytable[symbol as PayingSymbol];
    if (!payout) return; // fruit symbol (or a paying symbol an admin zeroed out) — no win
    const win = Math.round(payout * bet * scale * 100) / 100;
    positionWins.push({ reelIndex, symbol: symbol as PayingSymbol, win });
    winningPositions.push(reelIndex);
    finalWin += win;
  });

  return {
    positionWins,
    winningPositions,
    bonusCount,
    triggered: bonusCount >= FREE_SPIN_TRIGGER_COUNT,
    finalWin: Math.round(finalWin * 100) / 100,
  };
}

// --- Free-spin round + spin resolution -------------------------------------------------------

/** Puts the cheapest paying symbol that covers `shortfallX` on one non-paying reel (a fruit if
 * there is one — never adding a BONUS, so it can't retrigger). */
function forceRoundMinimum(
  reels: RubberDuckSymbol[],
  paytable: Partial<Record<PayingSymbol, number>>,
  shortfallX: number
): RubberDuckSymbol[] {
  const symbol = cheapestCoveringSymbol((s) => paytable[s as PayingSymbol] ?? 0, shortfallX);
  if (!symbol) return reels;
  const next = [...reels];
  let slot = next.findIndex((s) => FRUIT_SYMBOLS.includes(s as FruitSymbol));
  if (slot < 0) slot = next.findIndex((s) => s === BONUS_SYMBOL);
  if (slot < 0) slot = 0;
  next[slot] = symbol;
  return next;
}

/** Mirrors the old backend's `FreeSpinRound` Mongo doc — module-level so it survives between
 * spinRequest calls within a round without threading extra state through RubberDuckGame.tsx's own
 * call site. Wiped on a page reload (no localStorage backing) — an abandoned round's remaining
 * free spins are lost on refresh instead of resuming, same category of behavior change as balance
 * no longer persisting across refresh once a game goes fully client-side. */
let activeRound: { remaining: number; totalWin: number; totalSpins: number } | null = null;

/** Runs one local, server-equivalent spin. `isFreeSpin` is only a hint — like the old backend
 * ("authoritative, not the client's own claim"), this derives the real answer from its own
 * `activeRound` state so the module's round bookkeeping and the component's React state can never
 * drift apart. `currentBalance` is the player's balance right before this spin — the new balance
 * (bet deducted, win credited) is computed here and returned. Resolves on the same tick (no
 * network involved), kept as an async function purely so call sites can keep using `await
 * spinRequest(...)` unchanged. */
export async function spinRequest(bet: number, isFreeSpin = false, currentBalance = 0): Promise<SpinResponse> {
  const actuallyFreeSpin = activeRound !== null && activeRound.remaining > 0;
  if (isFreeSpin !== actuallyFreeSpin) {
    console.warn(
      "RubberDuck spinRequest: isFreeSpin argument disagreed with local round state — using local state as authoritative."
    );
  }

  const config = getRubberDuckRtpConfig();
  let reels = drawReels(config.tiers);
  const paytable = paytableFrom(config);
  let evaluation = evaluateSpin(reels, paytable, bet, actuallyFreeSpin);

  // The round's last spin, still short of the round minimum → land a real paying symbol on one reel.
  if (actuallyFreeSpin && activeRound && activeRound.remaining === 1 && !evaluation.triggered && bet > 0) {
    const shortfallX = FREE_SPIN_ROUND_MIN_WIN_X - (activeRound.totalWin + evaluation.finalWin) / bet;
    if (shortfallX > 1e-9) {
      reels = forceRoundMinimum(reels, paytable, shortfallX);
      evaluation = evaluateSpin(reels, paytable, bet, true);
    }
  }

  let freeSpinsAwarded: number | null = null;
  let retriggered = false;
  let freeSpinRoundResult: SpinResponse["freeSpinRoundResult"] = null;

  if (actuallyFreeSpin && activeRound) {
    activeRound.totalWin += evaluation.finalWin;
    activeRound.remaining -= 1;

    // 3+ BONUS while already in a free-spins round adds 10 more to what's left, rather than
    // starting a fresh batch.
    if (evaluation.triggered) {
      activeRound.remaining += FREE_SPINS_RETRIGGER;
      activeRound.totalSpins += FREE_SPINS_RETRIGGER;
      retriggered = true;
    }

    if (activeRound.remaining <= 0) {
      freeSpinRoundResult = { totalWin: activeRound.totalWin, totalSpins: activeRound.totalSpins };
      activeRound = null;
    }
  } else if (evaluation.triggered) {
    // A base spin's own BONUS trigger starts the round others will play through.
    freeSpinsAwarded = FREE_SPINS_BASE;
    activeRound = { remaining: FREE_SPINS_BASE, totalWin: 0, totalSpins: FREE_SPINS_BASE };
  }

  const stakedAmount = actuallyFreeSpin ? 0 : bet;
  const balance = Math.round((currentBalance - stakedAmount + evaluation.finalWin) * 100) / 100;

  return {
    reels,
    evaluation,
    winAmount: evaluation.finalWin,
    freeSpinsAwarded,
    retriggered,
    freeSpinRoundResult,
    balance,
    meta: { forced: false },
  };
}

export async function getRubberDuckConfig(): Promise<RubberDuckConfigResponse> {
  const config = getRubberDuckRtpConfig();

  const paytable: PayoutRow[] = REFERENCE_PAYTABLE.map((row) => {
    const tier = config.tiers.find((t) => t.key === row.symbol);
    return { symbol: row.symbol, payout: tier?.payoutMultiplier ?? row.payout };
  });
  // The reel builds its own cosmetic scrolling filler client-side, so it needs these weights to
  // replicate the same symbol distribution the admin configured — the landed reels themselves
  // always come from spinRequest's own result, this is filler only.
  const symbolWeights = Object.fromEntries(config.tiers.map((t) => [t.key, t.frequencyPercent]));

  return {
    meta: {
      id: "rubber-duck",
      name: "Rubber Duck",
      description: "Single-line 5-reel bath-time slot — every symbol pays for itself, no matching needed",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    betLevels: BET_LEVELS,
    minBet: BET_LEVELS[0],
    maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    paytable,
    symbolWeights,
    freeSpins: {
      triggerCount: FREE_SPIN_TRIGGER_COUNT,
      base: FREE_SPINS_BASE,
      retrigger: FREE_SPINS_RETRIGGER,
      winMultiplier: FREE_SPIN_WIN_MULTIPLIER,
    },
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: RubberDuckSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/rubber-duck/spin-log", { ...params, tier: null });
}
