/**
 * Shamrock Spin's RNG, paytable, and balance are all computed entirely in the browser — RTP and
 * odds are configured client-side (see the RTP control below) and every spin resolves locally, on
 * the same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in
 * `backEnd/src/games/ShamrockSpin/{config,engine,winTiers}.ts`, using the exact same tier
 * weights/payout multipliers/rule-tier map that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["shamrock-spin"]`. Kept as the same
 * exported function names/signatures as the old network calls (`spinRequest`,
 * `getShamrockConfig`) so `ShamrockSpinGame.tsx` didn't need type changes — `spinRequest` gains
 * one new parameter (`currentBalance`), the same shape Life of Luxury's/SizzlingSevens' already-
 * offline `spinRequest` uses, since this game's `SpinResponse` (like theirs) already carries a
 * `balance` field.
 *
 * Unlike Life of Luxury, there's no free-spin *round* state to track here at all: the server
 * never tracked one either (no FreeSpinRound-equivalent doc) — free-spin remaining/total/winnings
 * bookkeeping has always lived entirely in ShamrockSpinGame.tsx's own React state, one spin at a
 * time, so this file stays a fully stateless, self-contained per-call function.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/ShamrockSpin/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so Shamrock Spin spins show
 * up in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type SlotSymbol =
  | "SHAMROCK_WILD"
  | "SHAMROCK_1"
  | "SHAMROCK_2"
  | "SHAMROCK_3"
  | "SHAMROCK_4"
  | "GREEN_SEVEN"
  | "ORANGE_SEVEN"
  | "YELLOW_SEVEN"
  | "TRIPLE_BAR"
  | "DOUBLE_BAR"
  | "SINGLE_BAR";

export type WinRuleId =
  | "WILD_JACKPOT"
  | "GREEN_SEVEN"
  | "ORANGE_SEVEN"
  | "YELLOW_SEVEN"
  | "TRIPLE_BAR"
  | "DOUBLE_BAR"
  | "SINGLE_BAR"
  | "ANY_SEVENS"
  | "ANY_BARS"
  | "TWO_WILDS"
  | "ONE_WILD";

/** Every winning line combo, in paytable order (highest pay first). */
export const WIN_RULE_IDS: WinRuleId[] = [
  "WILD_JACKPOT",
  "GREEN_SEVEN",
  "ORANGE_SEVEN",
  "YELLOW_SEVEN",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "SINGLE_BAR",
  "ANY_SEVENS",
  "ANY_BARS",
  "TWO_WILDS",
  "ONE_WILD",
];

export interface WinRule {
  id: WinRuleId;
  basePayout: number;
  freeSpinPayout: number;
}

export interface SpinResponse {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol][];
  lineSymbols: [SlotSymbol, SlotSymbol, SlotSymbol];
  winRuleId: WinRuleId | null;
  multiplier: number;
  winAmount: number;
  freeSpinsAwarded: number;
  balance: number;
  meta: { forced: boolean };
}

export interface ShamrockConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  winRules: WinRule[];
  betLevels: number[];
  maxTotalFreeSpins: number;
}

// --- Game shape — ported verbatim from backEnd/src/games/ShamrockSpin/config.ts ------------

export const DISPLAY_SYMBOLS: SlotSymbol[] = [
  "SHAMROCK_WILD",
  "SHAMROCK_1",
  "SHAMROCK_2",
  "SHAMROCK_3",
  "SHAMROCK_4",
  "GREEN_SEVEN",
  "ORANGE_SEVEN",
  "YELLOW_SEVEN",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "SINGLE_BAR",
];

/** All 5 Shamrock Spin variants are wild, substituting for Seven- and Bar-family symbols. */
const WILD_SYMBOLS: ReadonlySet<SlotSymbol> = new Set([
  "SHAMROCK_WILD",
  "SHAMROCK_1",
  "SHAMROCK_2",
  "SHAMROCK_3",
  "SHAMROCK_4",
]);

const SEVEN_SYMBOLS: ReadonlySet<SlotSymbol> = new Set(["GREEN_SEVEN", "ORANGE_SEVEN", "YELLOW_SEVEN"]);
const BAR_SYMBOLS: ReadonlySet<SlotSymbol> = new Set(["TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"]);

const BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
const MAX_TOTAL_FREE_SPINS = 29;

/** Odds of each Shamrock variant whenever a wild is placed on the reels (see `randomWild`), and
 * the free spins each one awards — shared with the RTP formula so it can count the free spins a
 * wild-containing line win also hands out. */
const WILD_WEIGHTS: { symbol: SlotSymbol; weight: number }[] = [
  { symbol: "SHAMROCK_1", weight: 0.35 },
  { symbol: "SHAMROCK_2", weight: 0.3 },
  { symbol: "SHAMROCK_3", weight: 0.2 },
  { symbol: "SHAMROCK_4", weight: 0.1 },
  { symbol: "SHAMROCK_WILD", weight: 0.05 },
];

/** How many wilds each rule's line carries — every wild on the reels also awards free spins. */
const RULE_WILD_COUNT: Partial<Record<WinRuleId, number>> = { WILD_JACKPOT: 3, TWO_WILDS: 2, ONE_WILD: 1 };

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------
//
// Every winning line combo is its own row with its own frequency and its own x values — there is
// no Big/Mega/Jackpot grouping and no celebration overlay; a win simply pays its rule's x value.

export type OutcomeKey = "loss" | "freeSpin" | WinRuleId;

export interface ShamrockOutcomeRow {
  key: OutcomeKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
  freeSpinPayoutMultiplier: number | null;
}

export interface ShamrockRtpConfig {
  targetRtpPercent: number;
  freeSpinsGranted: number;
  outcomes: ShamrockOutcomeRow[];
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-shamrockspin-rtp-config";
export const DEFAULT_SHAMROCK_TARGET_RTP_PERCENT = 90;

/** Default per-symbol odds and x values — used exactly as written (no rescaling). Frequencies
 * sum to 100%. The Free Spin trigger frequency is solved so the default lands at 90% RTP, given
 * that its payline Shamrocks also pay a line win and every round wins at least once. */
const BASE_OUTCOMES: ShamrockOutcomeRow[] = [
  { key: "loss", frequencyPercent: 78.4193, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
  { key: "freeSpin", frequencyPercent: 5.5826, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
  { key: "WILD_JACKPOT", frequencyPercent: 0.0057, payoutMultiplier: 20, freeSpinPayoutMultiplier: 20 },
  { key: "GREEN_SEVEN", frequencyPercent: 0.0114, payoutMultiplier: 15, freeSpinPayoutMultiplier: 15 },
  { key: "ORANGE_SEVEN", frequencyPercent: 0.0171, payoutMultiplier: 12, freeSpinPayoutMultiplier: 12 },
  { key: "YELLOW_SEVEN", frequencyPercent: 0.0285, payoutMultiplier: 10, freeSpinPayoutMultiplier: 10 },
  { key: "TRIPLE_BAR", frequencyPercent: 0.5691, payoutMultiplier: 8, freeSpinPayoutMultiplier: 8 },
  { key: "DOUBLE_BAR", frequencyPercent: 1.1382, payoutMultiplier: 6, freeSpinPayoutMultiplier: 6 },
  { key: "SINGLE_BAR", frequencyPercent: 1.7074, payoutMultiplier: 4, freeSpinPayoutMultiplier: 4 },
  { key: "ANY_SEVENS", frequencyPercent: 2.2765, payoutMultiplier: 5, freeSpinPayoutMultiplier: 5 },
  { key: "ANY_BARS", frequencyPercent: 2.8456, payoutMultiplier: 3, freeSpinPayoutMultiplier: 3 },
  { key: "TWO_WILDS", frequencyPercent: 3.4147, payoutMultiplier: 2, freeSpinPayoutMultiplier: 2 },
  { key: "ONE_WILD", frequencyPercent: 3.9839, payoutMultiplier: 1, freeSpinPayoutMultiplier: 1 },
];

const DEFAULT_FREE_SPINS_GRANTED = 3;
/** Every free-spin round pays at least this x of its bet in total — fixed, not admin-editable. */
export const FREE_SPIN_MIN_WIN_MULTIPLIER = 1;

/** The round minimum (kept as a function of the config so callers needn't change if it ever is). */
export function getFreeSpinMinWin(_config?: ShamrockRtpConfig): number {
  return FREE_SPIN_MIN_WIN_MULTIPLIER;
}

/** How many x of the bet the round is still short of its minimum (0 = already met). When the last
 * free spin is reached with a shortfall, that spin lands a real winning line big enough to cover it
 * (see `guaranteedRuleFor`) — there is never a hidden top-up. */
export function getFreeSpinShortfallX(betAmount: number, roundWinnings: number): number {
  if (betAmount <= 0) return 0;
  const shortfall = FREE_SPIN_MIN_WIN_MULTIPLIER - roundWinnings / betAmount;
  return shortfall > 1e-9 ? shortfall : 0;
}

export function getShamrockDefaultConfig(): ShamrockRtpConfig {
  return fitConfigToItsTarget({
    targetRtpPercent: DEFAULT_SHAMROCK_TARGET_RTP_PERCENT,
    freeSpinsGranted: DEFAULT_FREE_SPINS_GRANTED,
    outcomes: BASE_OUTCOMES.map((o) => ({ ...o })),
  });
}

/** Old tier-based configs (with `tiers`/`ruleTierMap`) fail this and fall back to the default. */
function isValidConfig(value: unknown): value is ShamrockRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.targetRtpPercent !== "number" || typeof v.freeSpinsGranted !== "number") return false;
  if (!Array.isArray(v.outcomes)) return false;
  const keys = new Set((v.outcomes as ShamrockOutcomeRow[]).map((o) => o?.key));
  return keys.has("loss") && keys.has("freeSpin") && WIN_RULE_IDS.every((id) => keys.has(id));
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getShamrockRtpConfig(): ShamrockRtpConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
  } catch {
    /* storage unavailable — use the default */
  }
  if (fittedCache && fittedCache.raw === raw) return fittedCache.config;
  let config = getShamrockDefaultConfig();
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidConfig(parsed)) config = parsed;
    } catch {
      /* corrupt — use the default */
    }
  }
  config = fitConfigToItsTarget(config);
  fittedCache = { raw, config };
  return config;
}

/** Last config read, keyed by the raw stored string — spinRequest reads the config every spin. */
let fittedCache: { raw: string | null; config: ShamrockRtpConfig } | null = null;

/** Keeps a config's real RTP on its own target: a config saved before the free-spin round minimum
 * was fixed at 1x (or the built-in default) pays a little differently now, so its winning rows are
 * rescaled back onto targetRtpPercent. A config already on target is returned untouched. */
function fitConfigToItsTarget(input: ShamrockRtpConfig): ShamrockRtpConfig {
  // House rules (see shared/rtpRules.ts): whole-number pays, target capped at 90%.
  const config: ShamrockRtpConfig = {
    ...input,
    targetRtpPercent: capTargetRtp(input.targetRtpPercent),
    outcomes: input.outcomes.map((o) => ({
      ...o,
      payoutMultiplier: wholeX(o.payoutMultiplier),
      freeSpinPayoutMultiplier: wholeX(o.freeSpinPayoutMultiplier),
    })),
  };
  const rtp = computeRtpFromOutcomes(config.outcomes, config.freeSpinsGranted, FREE_SPIN_MIN_WIN_MULTIPLIER);
  if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - config.targetRtpPercent) < 0.05) return config;
  const outcomes = fitShamrockOutcomesToTarget(config.outcomes, config.freeSpinsGranted, FREE_SPIN_MIN_WIN_MULTIPLIER, config.targetRtpPercent);
  return { ...config, outcomes };
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setShamrockRtpConfig(config: ShamrockRtpConfig): void {
  fittedCache = null;
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncShamrockRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("shamrock-spin", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveShamrockRtpConfigToServer(config: ShamrockRtpConfig): Promise<void> {
  return saveRtpConfigToServer("shamrock-spin", config);
}

/** The x value a rule pays in the base game or during free spins. */
export function getRulePayout(config: ShamrockRtpConfig, ruleId: WinRuleId, freeSpin: boolean): number {
  const row = config.outcomes.find((o) => o.key === ruleId);
  if (!row) return 0;
  return (freeSpin ? row.freeSpinPayoutMultiplier ?? row.payoutMultiplier : row.payoutMultiplier) ?? 0;
}

/** The numbered Shamrocks the Free Spin trigger puts on the payline to award `granted` spins —
 * each option is the face values of the Shamrocks placed (1-3 of them), with its own odds. Shared
 * by buildFreeSpinGrid and the RTP formula, which needs it because Shamrocks are wild: the
 * trigger's Shamrocks always form a line win too (1 = ONE_WILD, 2 = TWO_WILDS, 3 = WILD_JACKPOT). */
function freeSpinTriggerCombos(granted: number): { values: number[]; weight: number }[] {
  const n = Math.min(Math.max(Math.round(granted) || 3, 1), 12);
  switch (n) {
    case 1:
      return [{ values: [1], weight: 1 }];
    case 2:
      return [
        { values: [2], weight: 0.5 },
        { values: [1, 1], weight: 0.5 },
      ];
    case 3:
      return [
        { values: [3], weight: 0.5 },
        { values: [1, 2], weight: 0.5 },
      ];
    case 4:
      return [
        { values: [4], weight: 0.5 },
        { values: [2, 2], weight: 0.5 },
      ];
    default: {
      // 5-12: fewest Shamrocks that can hold n (each worth at most 4), split as evenly as possible.
      const count = Math.ceil(n / 4);
      const values = Array.from({ length: count }, (_, i) => Math.floor(n / count) + (i < n % count ? 1 : 0));
      return [{ values, weight: 1 }];
    }
  }
}

const RULE_FOR_WILD_COUNT: Record<number, WinRuleId> = { 1: "ONE_WILD", 2: "TWO_WILDS", 3: "WILD_JACKPOT" };

/** Average x value the Free Spin trigger's own payline pays (see freeSpinTriggerCombos). */
function triggerLinePayout(outcomes: ShamrockOutcomeRow[], freeSpinsGranted: number, freeSpin: boolean): number {
  return freeSpinTriggerCombos(freeSpinsGranted).reduce((sum, c) => {
    const row = outcomes.find((o) => o.key === RULE_FOR_WILD_COUNT[c.values.length]);
    const pay = (freeSpin ? row?.freeSpinPayoutMultiplier ?? row?.payoutMultiplier : row?.payoutMultiplier) ?? 0;
    return sum + c.weight * pay;
  }, 0);
}

const AVG_FREE_SPINS_PER_WILD = WILD_WEIGHTS.reduce((sum, w) => sum + w.weight * getShamrockFreeSpinsValue(w.symbol), 0);

/** Expected free spins awarded by one spin rolled from `outcomes` (frequencies as fractions of
 * `total`): the Free Spin trigger itself plus the wilds any wild-containing line win carries. */
function expectedFreeSpinsPerSpin(
  outcomes: ShamrockOutcomeRow[],
  freeSpinsGranted: number,
  freeSpinWeight: number
): { spins: number; total: number } {
  const total = outcomes.reduce((sum, o) => sum + (o.key === "freeSpin" ? o.frequencyPercent * freeSpinWeight : o.frequencyPercent), 0);
  if (total <= 0) return { spins: 0, total: 1 };
  let spins = 0;
  for (const o of outcomes) {
    if (o.key === "freeSpin") spins += ((o.frequencyPercent * freeSpinWeight) / total) * freeSpinsGranted;
    else if (o.key !== "loss") spins += (o.frequencyPercent / total) * (RULE_WILD_COUNT[o.key] ?? 0) * AVG_FREE_SPINS_PER_WILD;
  }
  return { spins, total };
}

/** Odds of how many free spins `wilds` randomly drawn wilds award together (see WILD_WEIGHTS). */
function wildSpinsDistribution(wilds: number): Map<number, number> {
  let dist = new Map<number, number>([[0, 1]]);
  for (let i = 0; i < wilds; i++) {
    const next = new Map<number, number>();
    for (const [spins, p] of dist) {
      for (const w of WILD_WEIGHTS) {
        const k = spins + getShamrockFreeSpinsValue(w.symbol);
        next.set(k, (next.get(k) ?? 0) + p * w.weight);
      }
    }
    dist = next;
  }
  return dist;
}

function rulePayX(outcomes: ShamrockOutcomeRow[], ruleId: WinRuleId, freeSpin: boolean): number {
  const row = outcomes.find((o) => o.key === ruleId);
  return (freeSpin ? row?.freeSpinPayoutMultiplier ?? row?.payoutMultiplier : row?.payoutMultiplier) ?? 0;
}

/** The line a short free-spin round's last spin is forced to land: the lowest-paying rule whose
 * free-spin x value covers `shortfallX` — or, if none does, the highest-paying one. */
export function guaranteedRuleFor(outcomes: ShamrockOutcomeRow[], shortfallX: number): WinRuleId {
  const byPay = WIN_RULE_IDS.map((id) => ({ id, pay: rulePayX(outcomes, id, true) }))
    .filter((r) => r.pay > 0)
    .sort((a, b) => a.pay - b.pay);
  if (byPay.length === 0) return "ONE_WILD";
  return (byPay.find((r) => r.pay >= shortfallX - 1e-9) ?? byPay[byPay.length - 1]).id;
}

/** RTP of one base-game spin plus the free-spin round it may start (retriggers included — free
 * spins roll the Free Spin trigger at half weight, see `rollOutcome`). A round still under
 * `freeSpinMinWin` going into its last spin gets that spin forced to the cheapest real line that
 * covers it (see guaranteedRuleFor), which this models exactly, assuming every winning combo pays
 * at least the minimum. The 29-free-spin cap is ignored, so this slightly overestimates when retriggers are
 * frequent. */
function computeRtpFromOutcomes(outcomes: ShamrockOutcomeRow[], freeSpinsGranted: number, freeSpinMinWin: number): number {
  const base = expectedFreeSpinsPerSpin(outcomes, freeSpinsGranted, 1);
  const free = expectedFreeSpinsPerSpin(outcomes, freeSpinsGranted, 0.5);
  const freeWeight = (o: ShamrockOutcomeRow) => (o.key === "freeSpin" ? o.frequencyPercent * 0.5 : o.frequencyPercent);
  // The trigger's payline Shamrocks are wild, so the trigger also pays a line win.
  const linePay = (o: ShamrockOutcomeRow, freeSpin: boolean): number =>
    o.key === "freeSpin"
      ? triggerLinePayout(outcomes, freeSpinsGranted, freeSpin)
      : ((freeSpin ? o.freeSpinPayoutMultiplier ?? o.payoutMultiplier : o.payoutMultiplier) ?? 0);
  const spinsAwarded = (o: ShamrockOutcomeRow): number =>
    o.key === "freeSpin" ? freeSpinsGranted : o.key === "loss" ? 0 : (RULE_WILD_COUNT[o.key] ?? 0) * AVG_FREE_SPINS_PER_WILD;

  let baseRtp = 0;
  let freeSpinRtp = 0;
  for (const o of outcomes) {
    baseRtp += (o.frequencyPercent / base.total) * linePay(o, false);
    freeSpinRtp += (freeWeight(o) / free.total) * linePay(o, true);
  }
  // Value of one free spin plus every free spin it retriggers — geometric series.
  const perSpin = free.spins < 1 ? freeSpinRtp / (1 - free.spins) : Infinity;

  // Value of a round with k spins left that hasn't won yet: a Loss keeps it un-won; any win
  // settles it (every later spin is then worth `perSpin`); the last un-won spin is the guaranteed
  // line (the cheapest one paying at least the minimum).
  const pLoss = (outcomes.find((o) => o.key === "loss")?.frequencyPercent ?? 0) / free.total;
  const guaranteedPay = rulePayX(outcomes, guaranteedRuleFor(outcomes, freeSpinMinWin), true);
  const roundValue = (k: number): number => {
    if (k <= 0) return 0;
    if (freeSpinMinWin <= 0) return k * perSpin;
    let value = guaranteedPay;
    for (let n = 2; n <= k; n++) {
      let wonValue = 0;
      for (const o of outcomes) {
        if (o.key === "loss") continue;
        wonValue += (freeWeight(o) / free.total) * (linePay(o, true) + (n - 1 + spinsAwarded(o)) * perSpin);
      }
      value = pLoss * value + wonValue;
    }
    return value;
  };

  // Rounds start from the Free Spin trigger or from a wild line win (one spin per wild's number).
  // The round's total starts from that triggering spin's own win (ShamrockSpinGame's roundWinRef),
  // so when it already pays the minimum the guarantee never fires and every spin is just `perSpin`.
  const valueFrom = (o: ShamrockOutcomeRow, k: number) =>
    linePay(o, false) >= freeSpinMinWin - 1e-9 ? k * perSpin : roundValue(k);
  let roundsRtp = 0;
  for (const o of outcomes) {
    const p = o.frequencyPercent / base.total;
    if (o.key === "freeSpin") roundsRtp += p * valueFrom(o, freeSpinsGranted);
    const wilds = o.key === "loss" || o.key === "freeSpin" ? 0 : RULE_WILD_COUNT[o.key] ?? 0;
    if (wilds > 0) {
      for (const [k, pk] of wildSpinsDistribution(wilds)) roundsRtp += p * pk * valueFrom(o, k);
    }
  }
  return (baseRtp + roundsRtp) * 100;
}

export function computeShamrockRtpPercent(config: ShamrockRtpConfig): number {
  return computeRtpFromOutcomes(config.outcomes, config.freeSpinsGranted, getFreeSpinMinWin(config));
}

/** Scales every winning row's frequency by `scale` (clamped at 0; `freeSpin` is untouched), then
 * `loss` absorbs whatever's left so frequencies still sum to exactly 100%. */
export function rescaleShamrockOutcomes(outcomes: ShamrockOutcomeRow[], scale: number): ShamrockOutcomeRow[] {
  const scaled = outcomes.map((o) =>
    o.payoutMultiplier !== null ? { ...o, frequencyPercent: Math.max(0, o.frequencyPercent * scale) } : o
  );
  const nonLossSum = scaled.reduce((sum, o) => (o.key === "loss" ? sum : sum + o.frequencyPercent), 0);
  return scaled.map((o) => (o.key === "loss" ? { ...o, frequencyPercent: Math.max(0, 100 - nonLossSum) } : o));
}

/** Repeatedly rescales the winning rows until the RTP lands on `target` — RTP isn't linear in the
 * scale (wild wins also award free spins), so a single proportional rescale can miss slightly. */
export function fitShamrockOutcomesToTarget(
  outcomes: ShamrockOutcomeRow[],
  freeSpinsGranted: number,
  freeSpinMinWin: number,
  target: number
): ShamrockOutcomeRow[] {
  let current = rescaleShamrockOutcomes(outcomes, 1);
  for (let i = 0; i < 30; i++) {
    const rtp = computeRtpFromOutcomes(current, freeSpinsGranted, freeSpinMinWin);
    if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - target) < 0.01) break;
    current = rescaleShamrockOutcomes(current, target / rtp);
  }
  const round = (o: ShamrockOutcomeRow) => ({ ...o, frequencyPercent: Math.round(o.frequencyPercent * 10000) / 10000 });
  return rescaleShamrockOutcomes(current.map(round), 1).map(round);
}

// --- Win-line and Shamrock Free Spin logic ----------------------------------

const REGULAR_SYMBOLS: SlotSymbol[] = [
  "GREEN_SEVEN",
  "ORANGE_SEVEN",
  "YELLOW_SEVEN",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "SINGLE_BAR",
];

function randomRegularSymbol(): SlotSymbol {
  return REGULAR_SYMBOLS[Math.floor(Math.random() * REGULAR_SYMBOLS.length)];
}

function randomWild(): SlotSymbol {
  let roll = Math.random();
  for (const w of WILD_WEIGHTS) {
    roll -= w.weight;
    if (roll < 0) return w.symbol;
  }
  return WILD_WEIGHTS[WILD_WEIGHTS.length - 1].symbol;
}

function randomSeven(exclude?: SlotSymbol): SlotSymbol {
  const sevens = [...SEVEN_SYMBOLS].filter((s) => s !== exclude);
  return sevens[Math.floor(Math.random() * sevens.length)];
}

function randomBar(exclude?: SlotSymbol): SlotSymbol {
  const bars = [...BAR_SYMBOLS].filter((s) => s !== exclude);
  return bars[Math.floor(Math.random() * bars.length)];
}

export function isShamrockSymbol(symbol: SlotSymbol): boolean {
  return WILD_SYMBOLS.has(symbol);
}

/**
 * Returns the free spins awarded by a Shamrock symbol.
 * Numbered shamrocks award their face value (1 to 4).
 * The plain Shamrock Spin wild is only a wild — it never awards free spins.
 */
export function getShamrockFreeSpinsValue(symbol: SlotSymbol): number {
  switch (symbol) {
    case "SHAMROCK_1":
      return 1;
    case "SHAMROCK_2":
      return 2;
    case "SHAMROCK_3":
      return 3;
    case "SHAMROCK_4":
      return 4;
    default:
      return 0;
  }
}

export interface ShamrockSpinEvaluation {
  totalFreeSpins: number;
  shamrockCount: number;
  shamrockPositions: { reelIndex: number; rowIndex: number; symbol: SlotSymbol; spins: number }[];
  rowCounts: [number, number, number]; // [row0, row1, row2]
}

/**
 * Evaluates the payline (middle row) for qualifying Shamrock Spin Free Spin triggers — Shamrocks
 * above or below the payline never award anything.
 *
 * Each Shamrock Spin image containing numbers 1, 2, 3, or 4 awards free spins equal
 * to its face value:
 * - SHAMROCK_1 = 1 Free Spin
 * - SHAMROCK_2 = 2 Free Spins
 * - SHAMROCK_3 = 3 Free Spins
 * - SHAMROCK_4 = 4 Free Spins
 * - SHAMROCK_WILD = no free spins (wild only)
 *
 * Multiple Shamrock Spin images are summed together.
 * If no Shamrock Spin image is present, 0 free spins are awarded.
 */
export function evaluateFreeSpins(
  reels: [SlotSymbol, SlotSymbol, SlotSymbol][]
): ShamrockSpinEvaluation {
  const qualifyingPositions: { reelIndex: number; rowIndex: number; symbol: SlotSymbol; spins: number }[] = [];
  let totalFreeSpins = 0;
  const rowCounts: [number, number, number] = [0, 0, 0];

  const r = 1; // the payline
  for (let c = 0; c < 3; c++) {
    const sym = reels[c][r];
    if (isShamrockSymbol(sym)) {
      const spins = getShamrockFreeSpinsValue(sym);
      if (spins > 0) {
        totalFreeSpins += spins;
        qualifyingPositions.push({ reelIndex: c, rowIndex: r, symbol: sym, spins });
        rowCounts[r]++;
      }
    }
  }

  return {
    totalFreeSpins,
    shamrockCount: qualifyingPositions.length,
    shamrockPositions: qualifyingPositions,
    rowCounts,
  };
}

/** 3 wilds and 2 wilds + anything pay their own rules; a single wild substitutes for a Seven- or
 * Bar-family symbol (never bridging the two families), otherwise it pays ONE_WILD. */
function evaluateLine(line: [SlotSymbol, SlotSymbol, SlotSymbol]): WinRuleId | null {
  const wildCount = line.filter((s) => WILD_SYMBOLS.has(s)).length;
  if (wildCount === 3) return "WILD_JACKPOT";
  if (wildCount === 2) return "TWO_WILDS";

  const nonWild = line.filter((s) => !WILD_SYMBOLS.has(s));
  const allSevenFamily = nonWild.every((s) => SEVEN_SYMBOLS.has(s));
  if (allSevenFamily && nonWild.length > 0) {
    const distinctColors = new Set(nonWild);
    if (distinctColors.size === 1) {
      const color = nonWild[0];
      if (color === "GREEN_SEVEN") return "GREEN_SEVEN";
      if (color === "ORANGE_SEVEN") return "ORANGE_SEVEN";
      if (color === "YELLOW_SEVEN") return "YELLOW_SEVEN";
    }
    return "ANY_SEVENS";
  }

  const allBarFamily = nonWild.every((s) => BAR_SYMBOLS.has(s));
  if (allBarFamily && nonWild.length > 0) {
    const distinctBars = new Set(nonWild);
    if (distinctBars.size === 1) {
      const bar = nonWild[0];
      if (bar === "TRIPLE_BAR") return "TRIPLE_BAR";
      if (bar === "DOUBLE_BAR") return "DOUBLE_BAR";
      if (bar === "SINGLE_BAR") return "SINGLE_BAR";
    }
    return "ANY_BARS";
  }

  if (wildCount === 1) return "ONE_WILD";
  return null;
}

/** A line that genuinely matches nothing on the payline, with no wild symbols. */
function buildLossLine(): [SlotSymbol, SlotSymbol, SlotSymbol] {
  let line: [SlotSymbol, SlotSymbol, SlotSymbol];
  do {
    line = [randomRegularSymbol(), randomRegularSymbol(), randomRegularSymbol()];
  } while (evaluateLine(line) !== null);
  return line;
}

/** A complete 3x3 grid with no line win and zero Shamrocks anywhere. */
function buildLossGrid(): [SlotSymbol, SlotSymbol, SlotSymbol][] {
  const line = buildLossLine();
  return [
    [randomRegularSymbol(), line[0], randomRegularSymbol()],
    [randomRegularSymbol(), line[1], randomRegularSymbol()],
    [randomRegularSymbol(), line[2], randomRegularSymbol()],
  ];
}

/** Constructs the exact 3-symbol line for a given payline rule. */
function buildLineForRule(ruleId: WinRuleId): [SlotSymbol, SlotSymbol, SlotSymbol] {
  switch (ruleId) {
    case "WILD_JACKPOT":
      return [randomWild(), randomWild(), randomWild()];
    case "GREEN_SEVEN":
      return ["GREEN_SEVEN", "GREEN_SEVEN", "GREEN_SEVEN"];
    case "ORANGE_SEVEN":
      return ["ORANGE_SEVEN", "ORANGE_SEVEN", "ORANGE_SEVEN"];
    case "YELLOW_SEVEN":
      return ["YELLOW_SEVEN", "YELLOW_SEVEN", "YELLOW_SEVEN"];
    case "TRIPLE_BAR":
      return ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"];
    case "DOUBLE_BAR":
      return ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"];
    case "SINGLE_BAR":
      return ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"];
    case "ANY_SEVENS": {
      const a = randomSeven();
      const b = randomSeven(a);
      return [a, b, a];
    }
    case "ANY_BARS": {
      const a = randomBar();
      const b = randomBar(a);
      return [a, b, a];
    }
    case "TWO_WILDS":
      return [randomWild(), randomWild(), Math.random() < 0.5 ? randomSeven() : randomBar()];
    case "ONE_WILD": {
      const positions: SlotSymbol[] = [randomWild(), randomSeven(), randomBar()];
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      return positions as [SlotSymbol, SlotSymbol, SlotSymbol];
    }
  }
}

const NUMBERED_SHAMROCK: Record<number, SlotSymbol> = { 1: "SHAMROCK_1", 2: "SHAMROCK_2", 3: "SHAMROCK_3", 4: "SHAMROCK_4" };

/**
 * Builds a 3x3 reel grid for the Free Spin trigger: numbered Shamrocks whose face values add up to
 * the admin's free-spins-granted land on the payline (free spins only ever count there). Shamrocks
 * are wild, so the line also pays — with a single Shamrock the other two payline symbols are one
 * Seven and one BAR, so it pays ONE_WILD rather than substituting into a bigger win.
 */
function buildFreeSpinGrid(adminGranted = 3): [SlotSymbol, SlotSymbol, SlotSymbol][] {
  const grid = buildLossGrid();
  const combos = freeSpinTriggerCombos(adminGranted);
  let roll = Math.random();
  const combo = combos.find((c) => (roll -= c.weight) < 0) ?? combos[combos.length - 1];

  const cols = [0, 1, 2].sort(() => Math.random() - 0.5);
  const shamrockCols = cols.slice(0, combo.values.length);
  const otherCols = cols.slice(combo.values.length);
  shamrockCols.forEach((col, i) => (grid[col][1] = NUMBERED_SHAMROCK[combo.values[i]]));
  if (otherCols.length === 2) {
    grid[otherCols[0]][1] = randomSeven();
    grid[otherCols[1]][1] = randomBar();
  }
  return grid;
}

/** TESTING ONLY — true = every paid spin triggers free spins; the first TEST_RETRIGGERS_PER_ROUND
 * free spins of each round each retrigger free spins (+3), then the rest follow a repeating win,
 * loss, loss pattern (wins land a Seven or BAR line — wild lines are left out so they can't add
 * extra retriggers). MUST be false before going live. */
export const TEST_FREE_SPINS_MODE = false;
const TEST_RETRIGGERS_PER_ROUND = 3;
let testRetriggersLeft = 0;
let testFreeSpinIndex = 0;

/** The forced outcome for TEST_FREE_SPINS_MODE (see above). */
function testModeOutcome(outcomes: ShamrockOutcomeRow[], freeSpin: boolean): ShamrockOutcomeRow {
  const trigger = outcomes.find((o) => o.key === "freeSpin")!;
  if (!freeSpin) {
    testRetriggersLeft = TEST_RETRIGGERS_PER_ROUND;
    testFreeSpinIndex = 0;
    return trigger;
  }
  if (testRetriggersLeft > 0) {
    testRetriggersLeft--;
    return trigger;
  }
  // After the retriggers: win, loss, loss, win, loss, loss, ...
  const isWinSlot = testFreeSpinIndex++ % 3 === 0;
  if (!isWinSlot) return outcomes.find((o) => o.key === "loss")!;
  const wins = outcomes.filter(
    (o) => o.key !== "loss" && o.key !== "freeSpin" && !RULE_WILD_COUNT[o.key] && (o.freeSpinPayoutMultiplier ?? 0) > 0
  );
  return wins.length > 0 ? rollOutcome(wins, true) : rollOutcome(outcomes, true);
}

/** Weighted-random pick of one outcome row by frequencyPercent. */
function rollOutcome(outcomes: ShamrockOutcomeRow[], isFreeSpinRound: boolean): ShamrockOutcomeRow {
  let pool: ShamrockOutcomeRow[];
  if (isFreeSpinRound) {
    // During free spin bonus rounds, allow retriggers at reduced weight
    pool = outcomes.map((o) => (o.key === "freeSpin" ? { ...o, frequencyPercent: o.frequencyPercent * 0.5 } : o));
  } else {
    pool = outcomes;
  }
  const total = pool.reduce((sum, o) => sum + o.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const outcome of pool) {
    roll -= outcome.frequencyPercent;
    if (roll < 0) return outcome;
  }
  return pool[pool.length - 1];
}

/** The guaranteed free-spin win for `ruleId`, built only from the plain Shamrock Spin wild (which
 * awards no free spins) so the forced spin can't also retrigger. "1 Wild" pairs it with one Seven
 * and one BAR so it can't substitute into more. */
function buildGuaranteedGrid(ruleId: WinRuleId): [SlotSymbol, SlotSymbol, SlotSymbol][] {
  let line: SlotSymbol[];
  if (ruleId === "ONE_WILD") line = ["SHAMROCK_WILD", randomSeven(), randomBar()];
  else if (ruleId === "TWO_WILDS") line = ["SHAMROCK_WILD", "SHAMROCK_WILD", Math.random() < 0.5 ? randomSeven() : randomBar()];
  else if (ruleId === "WILD_JACKPOT") line = ["SHAMROCK_WILD", "SHAMROCK_WILD", "SHAMROCK_WILD"];
  else line = buildLineForRule(ruleId);
  line.sort(() => Math.random() - 0.5);
  return line.map((s) => [randomRegularSymbol(), s, randomRegularSymbol()] as [SlotSymbol, SlotSymbol, SlotSymbol]);
}

/** Runs one local, outcome-first spin. The reel grid is generated and evaluated directly so that
 * visible Shamrock symbols on the payline always govern free spins awarded. `guaranteeShortfallX`
 * (free spins only — see getFreeSpinShortfallX) skips the roll and lands the cheapest real line
 * that covers it. */
export async function spinRequest(
  betAmount: number,
  freeSpin = false,
  currentBalance = 0,
  guaranteeShortfallX = 0
): Promise<SpinResponse> {
  const config = getShamrockRtpConfig();
  const outcome = TEST_FREE_SPINS_MODE ? testModeOutcome(config.outcomes, freeSpin) : rollOutcome(config.outcomes, freeSpin);

  let reels: [SlotSymbol, SlotSymbol, SlotSymbol][];

  if (freeSpin && guaranteeShortfallX > 0) {
    reels = buildGuaranteedGrid(guaranteedRuleFor(config.outcomes, guaranteeShortfallX));
  } else if (outcome.key === "loss") {
    reels = buildLossGrid();
  } else if (outcome.key === "freeSpin") {
    reels = buildFreeSpinGrid(config.freeSpinsGranted);
  } else {
    const lineSymbols = buildLineForRule(outcome.key);
    reels = [
      [randomRegularSymbol(), lineSymbols[0], randomRegularSymbol()],
      [randomRegularSymbol(), lineSymbols[1], randomRegularSymbol()],
      [randomRegularSymbol(), lineSymbols[2], randomRegularSymbol()],
    ];
  }

  // --- Strict Single-Source-of-Truth Evaluation from the actual 3x3 reel grid ---
  const lineSymbols: [SlotSymbol, SlotSymbol, SlotSymbol] = [reels[0][1], reels[1][1], reels[2][1]];
  const winRuleId = evaluateLine(lineSymbols);
  const { totalFreeSpins } = evaluateFreeSpins(reels);
  const freeSpinsAwarded = totalFreeSpins;

  // Pays the x value of the rule the visible line actually forms.
  const multiplier = winRuleId !== null ? getRulePayout(config, winRuleId, freeSpin) : 0;

  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const stakedAmount = freeSpin ? 0 : betAmount;
  const balance = Math.round((currentBalance - stakedAmount + winAmount) * 100) / 100;

  return {
    reels,
    lineSymbols,
    winRuleId,
    multiplier,
    winAmount,
    freeSpinsAwarded,
    balance,
    meta: { forced: false },
  };
}

export async function getShamrockConfig(): Promise<ShamrockConfigResponse> {
  const config = getShamrockRtpConfig();
  return {
    meta: {
      id: "shamrock-spin",
      name: "Shamrock Spin",
      description: "Classic 3-reel, single-payline slot",
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
    },
    winRules: WIN_RULE_IDS.map((id) => ({
      id,
      basePayout: getRulePayout(config, id, false),
      freeSpinPayout: getRulePayout(config, id, true),
    })),
    betLevels: BET_LEVELS,
    maxTotalFreeSpins: MAX_TOTAL_FREE_SPINS,
  };
}

/** Fire-and-forget: records a spin that already happened (locally) into the backend's
 * SpinHistory, purely for admin record-keeping — see the module doc comment above. */
export async function logSpinResult(params: {
  betAmount: number;
  winAmount: number;
  reelSymbols: SlotSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/shamrock-spin/spin-log", { ...params, tier: null });
}
