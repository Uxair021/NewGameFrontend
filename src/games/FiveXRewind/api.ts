/**
 * 5x Rewind's RNG, paytable, and balance are all computed entirely in the browser — RTP and odds
 * are configured client-side (see the RTP control below) and every spin resolves locally, on the
 * same tick, instead of over the network. Everything below (other than `logSpinResult`) is a
 * faithful port of what used to live in `backEnd/src/games/FiveXRewind/{config,engine}.ts` and
 * `backEnd/src/games/FiveXRewind/winCalc.ts`, using the exact same tier weights/payout
 * multipliers/coin-overlay odds/exact-enumeration RTP formula that previously came from
 * `backEnd/src/services/paytableConfig.ts`'s `DEFAULT_CONFIGS["5x-rewind"]` and its
 * `computeFiveXRewindRtpPercent`. Kept as the same exported function names/signatures as the old
 * network calls (`spinRequest`, `getFiveXRewindConfig`) so `FiveXRewindGame.tsx` didn't need type
 * changes — `spinRequest` gains one new parameter (`currentBalance`), the same shape every other
 * already-offline game's `spinRequest` uses, since this game's `SpinResponse` (like theirs)
 * already carries a `balance` field.
 *
 * There's no bonus-round state to track here at all — this game has no free spins/respins, so
 * `spinRequest` was already a single-shot, per-call function even on the backend.
 *
 * The one exception is `logSpinResult`: a write-only, fire-and-forget call to a minimal backend
 * endpoint (`backEnd/src/games/FiveXRewind/routes.ts`) that just records the already-decided
 * result into the same `SpinHistory` collection every other game uses, so 5x Rewind spins show up
 * in the admin dashboard (Earnings, Player Detail, Live Feed) like every other game's. It never
 * influences gameplay — the spin itself is fully decided above before this is called.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { capTargetRtp, fitFrequencies, makeConfigLoader, wholeX } from "../shared/rtpRules";
import { apiClient } from "../../api/client";

export type FiveXSymbol =
  | "WHITE_BAR"
  | "SEVEN_BAR"
  | "RED_BAR"
  | "PURPLE_BAR"
  | "RED_7"
  | "PURPLE_7"
  | "BLUE_7"
  | "COIN_2X"
  | "COIN_3X"
  | "COIN_4X"
  | "COIN_5X";

export type WinType = "SPECIAL_JACKPOT" | "SYMBOL_MATCH" | "SYMBOL_WITH_MULTIPLIERS" | "ANY3_MATCH" | "MULTIPLIER_ONLY" | "NO_WIN";

export interface WinResult {
  isWin: boolean;
  baseCombination: FiveXSymbol | "ANY3_BAR_WITH_7BAR" | "ANY3_BAR_ONLY" | "ANY3_SEVENS" | null;
  baseMultiplier: number;
  bonusMultipliers: number[];
  stackedMultiplier: number;
  finalMultiplier: number;
  payout: number;
  winType: WinType;
}

export interface SpinResponse {
  reels: [FiveXSymbol, FiveXSymbol, FiveXSymbol];
  /** Reels that stop between two symbols, leaving their spot on the payline empty — losses only
   * (see pickLossHalfStops). Purely visual: the payout is already decided from `reels`. */
  halfStopReels: [boolean, boolean, boolean];
  winResult: WinResult;
  winAmount: number;
  balance: number;
  meta: { forced: boolean };
}

export interface PayoutRow {
  label: string;
  payout: number;
}

export interface FiveXRewindConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: PayoutRow[];
  betLevels: number[];
}

// --- Game shape — ported verbatim from backEnd/src/games/FiveXRewind/{config,winCalc}.ts ----

const SYMBOLS: FiveXSymbol[] = [
  "WHITE_BAR",
  "SEVEN_BAR",
  "RED_BAR",
  "PURPLE_BAR",
  "RED_7",
  "PURPLE_7",
  "BLUE_7",
  "COIN_2X",
  "COIN_3X",
  "COIN_4X",
  "COIN_5X",
];

const COIN_VALUE: Partial<Record<FiveXSymbol, number>> = {
  COIN_2X: 2,
  COIN_3X: 3,
  COIN_4X: 4,
  COIN_5X: 5,
};

const COIN_SYMBOLS: ReadonlySet<FiveXSymbol> = new Set(["COIN_2X", "COIN_3X", "COIN_4X", "COIN_5X"]);

/** The 7 non-coin symbols — the alphabet a line tier's base (pre-coin-overlay) symbols are
 * drawn from. */
const NON_COIN_SYMBOLS: FiveXSymbol[] = SYMBOLS.filter((s) => !COIN_SYMBOLS.has(s));

const BAR_FAMILY: ReadonlySet<FiveXSymbol> = new Set(["WHITE_BAR", "RED_BAR", "PURPLE_BAR", "SEVEN_BAR"]);

/** Any mix of the 4 "seven-family" symbols (SEVEN_BAR + the 3 colored sevens). SEVEN_BAR is
 * deliberately also a BAR_FAMILY member — the two ANY-3 categories never actually overlap for a
 * real spin, since which one applies depends on what SEVEN_BAR is paired *with*. */
const SEVEN_FAMILY: ReadonlySet<FiveXSymbol> = new Set(["SEVEN_BAR", "RED_7", "PURPLE_7", "BLUE_7"]);

interface ComboMultipliers {
  anyBarOnly: number;
  anyBarWithSevenBar: number;
  anySevens: number;
}

const DEFAULT_COMBO_MULTIPLIERS: ComboMultipliers = {
  anyBarOnly: 2,
  anyBarWithSevenBar: 4,
  anySevens: 8,
};

const DEFAULT_BASE_TIERS: Partial<Record<FiveXSymbol, number>> = {
  WHITE_BAR: 1,
  SEVEN_BAR: 10,
  RED_7: 20,
  PURPLE_7: 15,
  BLUE_7: 12,
  PURPLE_BAR: 6,
  RED_BAR: 5,
};

/** Structural predicates for the 3 "ANY-3 mixed" line-tier categories (plus "genuine loss") —
 * independent of any admin-configured payout values, these only ask "does this triple
 * structurally belong to this category". */
function isGenuineLoss(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (s1 === s2 && s2 === s3) return false;
  if (BAR_FAMILY.has(s1) && BAR_FAMILY.has(s2) && BAR_FAMILY.has(s3)) return false;
  if (SEVEN_FAMILY.has(s1) && SEVEN_FAMILY.has(s2) && SEVEN_FAMILY.has(s3)) return false;
  return true;
}

const BAR_ONLY: ReadonlySet<FiveXSymbol> = new Set(["WHITE_BAR", "RED_BAR", "PURPLE_BAR"]);

function isAny3BarOnly(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (!BAR_ONLY.has(s1) || !BAR_ONLY.has(s2) || !BAR_ONLY.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

/** WHITE_BAR + SEVEN_BAR only, mixed — RED_BAR/PURPLE_BAR don't count here at all. */
const WHITE_OR_SEVEN: ReadonlySet<FiveXSymbol> = new Set(["WHITE_BAR", "SEVEN_BAR"]);

function isAny3BarWithSevenBar(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (!WHITE_OR_SEVEN.has(s1) || !WHITE_OR_SEVEN.has(s2) || !WHITE_OR_SEVEN.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

function isAny3Sevens(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (!SEVEN_FAMILY.has(s1) || !SEVEN_FAMILY.has(s2) || !SEVEN_FAMILY.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

function noWin(): WinResult {
  return {
    isWin: false,
    baseCombination: null,
    baseMultiplier: 0,
    bonusMultipliers: [],
    stackedMultiplier: 1,
    finalMultiplier: 0,
    payout: 0,
    winType: "NO_WIN",
  };
}

/** Ported verbatim from winCalc.ts's calculateWin. */
function calculateWin(
  reels: [FiveXSymbol, FiveXSymbol, FiveXSymbol],
  bet: number,
  baseTiers: Partial<Record<FiveXSymbol, number>> = DEFAULT_BASE_TIERS,
  comboMultipliers: ComboMultipliers = DEFAULT_COMBO_MULTIPLIERS
): WinResult {
  const [a, b, c] = reels;

  // Special jackpots — exact reel position required (2X|5X|2X etc. does NOT qualify unless
  // it's this literal left-to-right arrangement).
  if (a === "COIN_2X" && b === "COIN_5X" && c === "COIN_2X") {
    return {
      isWin: true,
      baseCombination: null,
      baseMultiplier: 1000,
      bonusMultipliers: [],
      stackedMultiplier: 1,
      finalMultiplier: 1000,
      payout: bet * 1000,
      winType: "SPECIAL_JACKPOT",
    };
  }
  if (a === "COIN_2X" && b === "COIN_4X" && c === "COIN_2X") {
    return {
      isWin: true,
      baseCombination: null,
      baseMultiplier: 400,
      bonusMultipliers: [],
      stackedMultiplier: 1,
      finalMultiplier: 400,
      payout: bet * 400,
      winType: "SPECIAL_JACKPOT",
    };
  }

  const coins = reels.filter((s) => COIN_SYMBOLS.has(s));
  const nonCoins = reels.filter((s) => !COIN_SYMBOLS.has(s));
  const bonusMultipliers = coins.map((s) => COIN_VALUE[s] ?? 1);
  const stackedMultiplier = bonusMultipliers.reduce((p, v) => p * v, 1);

  // Exact 3-of-a-kind, with coins substituting for any missing copies (0, 1, or 2 coins present
  // — substitution only completes an exact match, never the ANY-3 mixed-bar categories below).
  const allNonCoinsMatch = nonCoins.length > 0 && nonCoins.every((s) => s === nonCoins[0]);
  const baseSymbol = allNonCoinsMatch ? nonCoins[0] : null;
  const baseMultiplier = baseSymbol ? baseTiers[baseSymbol] : undefined;

  if (baseSymbol && baseMultiplier !== undefined) {
    const finalMultiplier = baseMultiplier * stackedMultiplier;
    return {
      isWin: true,
      baseCombination: baseSymbol,
      baseMultiplier,
      bonusMultipliers,
      stackedMultiplier,
      finalMultiplier,
      payout: bet * finalMultiplier,
      winType: coins.length > 0 ? "SYMBOL_WITH_MULTIPLIERS" : "SYMBOL_MATCH",
    };
  }

  // ANY-3 mixed categories — only when there are no coins at all.
  if (coins.length === 0) {
    if (isAny3BarOnly(a, b, c)) {
      const anyMultiplier = comboMultipliers.anyBarOnly;
      return {
        isWin: true,
        baseCombination: "ANY3_BAR_ONLY",
        baseMultiplier: anyMultiplier,
        bonusMultipliers: [],
        stackedMultiplier: 1,
        finalMultiplier: anyMultiplier,
        payout: bet * anyMultiplier,
        winType: "ANY3_MATCH",
      };
    }
    if (isAny3BarWithSevenBar(a, b, c)) {
      const anyMultiplier = comboMultipliers.anyBarWithSevenBar;
      return {
        isWin: true,
        baseCombination: "ANY3_BAR_WITH_7BAR",
        baseMultiplier: anyMultiplier,
        bonusMultipliers: [],
        stackedMultiplier: 1,
        finalMultiplier: anyMultiplier,
        payout: bet * anyMultiplier,
        winType: "ANY3_MATCH",
      };
    }
    if (isAny3Sevens(a, b, c)) {
      const anyMultiplier = comboMultipliers.anySevens;
      return {
        isWin: true,
        baseCombination: "ANY3_SEVENS",
        baseMultiplier: anyMultiplier,
        bonusMultipliers: [],
        stackedMultiplier: 1,
        finalMultiplier: anyMultiplier,
        payout: bet * anyMultiplier,
        winType: "ANY3_MATCH",
      };
    }
  }

  // Multiplier-only win: 1, 2, or 3 coins present but no valid symbol completion above.
  if (coins.length > 0) {
    return {
      isWin: true,
      baseCombination: null,
      baseMultiplier: 0,
      bonusMultipliers,
      stackedMultiplier,
      finalMultiplier: stackedMultiplier,
      payout: bet * stackedMultiplier,
      winType: "MULTIPLIER_ONLY",
    };
  }

  return noWin();
}

const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];

/** Static reference paytable for the rules popup — cosmetic/display only, matches the backend's
 * own REFERENCE_PAYTABLE exactly (the real payout always comes from calculateWin, and this
 * doesn't read the live RTP config, same as the backend's /config route never did either). */
const REFERENCE_PAYTABLE: PayoutRow[] = [
  { label: "2X | 5X | 2X (exact order)", payout: 1000 },
  { label: "2X | 4X | 2X (exact order)", payout: 400 },
  { label: "RED-7 x3", payout: DEFAULT_BASE_TIERS.RED_7 ?? 0 },
  { label: "PURPLE-7 x3", payout: DEFAULT_BASE_TIERS.PURPLE_7 ?? 0 },
  { label: "BLUE-7 x3", payout: DEFAULT_BASE_TIERS.BLUE_7 ?? 0 },
  { label: "7-BAR x3", payout: DEFAULT_BASE_TIERS.SEVEN_BAR ?? 0 },
  { label: "PURPLE-BAR x3", payout: DEFAULT_BASE_TIERS.PURPLE_BAR ?? 0 },
  { label: "RED-BAR x3", payout: DEFAULT_BASE_TIERS.RED_BAR ?? 0 },
  { label: "WHITE-BAR x3", payout: DEFAULT_BASE_TIERS.WHITE_BAR ?? 0 },
  { label: "Any 3 sevens (mixed)", payout: 8 },
  { label: "ANY 3 BAR + 7-BAR (mixed)", payout: 4 },
  { label: "ANY 3 BAR (mixed, no 7-BAR)", payout: 2 },
  { label: "Any 1 or 2 coins: BET x coin multiplier (stacked)", payout: 0 },
  { label: "3 coins: BET x stacked multiplier", payout: 0 },
];

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export type LineTierKey =
  | "loss"
  | "whiteBar"
  | "sevenBar"
  | "redBar"
  | "purpleBar"
  | "red7"
  | "purple7"
  | "blue7"
  | "any3BarOnly"
  | "any3BarWithSevenBar"
  | "any3Sevens";

export type CoinTierKey = "noCoin" | "coin2x" | "coin3x" | "coin4x" | "coin5x";

export interface LineTierRow {
  key: LineTierKey;
  frequencyPercent: number;
  payoutMultiplier: number | null;
}

export interface CoinTierRow {
  key: CoinTierKey;
  frequencyPercent: number;
}

export interface FiveXRtpConfig {
  targetRtpPercent: number;
  tiers: LineTierRow[];
  coinTiers: CoinTierRow[];
  /** Cosmetic only — the real payout is the continuous finalMultiplier from calculateWin. These
   * are just the win-size cutoffs (as a multiple of bet) that decide which celebration overlay
   * (Big Win / Mega Win / Jackpot) a spin shows. */
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-5xrewind-rtp-config";
export const DEFAULT_FIVEX_TARGET_RTP_PERCENT = 90.0;

/** Ported verbatim from paytableConfig.ts's DEFAULT_CONFIGS["5x-rewind"] — the actual live odds
 * this game shipped with. Frequencies found via numeric search to land close to the 90% target. */
const BASE_TIERS: LineTierRow[] = [
  { key: "loss", frequencyPercent: 89.0, payoutMultiplier: null },
  { key: "whiteBar", frequencyPercent: 6.0, payoutMultiplier: 1 },
  { key: "redBar", frequencyPercent: 1.2, payoutMultiplier: 5 },
  { key: "purpleBar", frequencyPercent: 0.8, payoutMultiplier: 6 },
  { key: "sevenBar", frequencyPercent: 0.3, payoutMultiplier: 10 },
  { key: "red7", frequencyPercent: 0.08, payoutMultiplier: 20 },
  { key: "purple7", frequencyPercent: 0.15, payoutMultiplier: 15 },
  { key: "blue7", frequencyPercent: 0.25, payoutMultiplier: 12 },
  { key: "any3BarOnly", frequencyPercent: 5.0, payoutMultiplier: 2 },
  { key: "any3BarWithSevenBar", frequencyPercent: 1.5, payoutMultiplier: 4 },
  { key: "any3Sevens", frequencyPercent: 1.22, payoutMultiplier: 8 },
];

/** Coin-overlay table — rolled independently for *each* of the 3 reels, deciding whether a coin
 * replaces that reel's line symbol. */
const BASE_COIN_TIERS: CoinTierRow[] = [
  { key: "noCoin", frequencyPercent: 97.3662 },
  { key: "coin2x", frequencyPercent: 1.5803 },
  { key: "coin3x", frequencyPercent: 0.7901 },
  { key: "coin4x", frequencyPercent: 0.2195 },
  { key: "coin5x", frequencyPercent: 0.0439 },
];

export function getFiveXDefaultConfig(): FiveXRtpConfig {
  return applyHouseRules({
    targetRtpPercent: DEFAULT_FIVEX_TARGET_RTP_PERCENT,
    tiers: BASE_TIERS.map((t) => ({ ...t })),
    coinTiers: BASE_COIN_TIERS.map((t) => ({ ...t })),
  });
}

function isValidConfig(value: unknown): value is FiveXRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.targetRtpPercent === "number" &&
    Array.isArray(v.tiers) &&
    v.tiers.length > 0 &&
    Array.isArray(v.coinTiers) &&
    v.coinTiers.length > 0
  );
}

/** Reads the admin's saved RTP config from localStorage — falls back to the fresh default if
 * nothing's been saved yet, the stored value is corrupt/malformed, or localStorage itself is
 * unavailable (private browsing, etc.). */
export function getFiveXRtpConfig(): FiveXRtpConfig {
  return loadConfig();
}

/** Saved config (or the default) with the house rules applied — cached per stored string. */
const loadConfig = makeConfigLoader<FiveXRtpConfig>(
  RTP_CONFIG_STORAGE_KEY,
  (raw) => {
    if (raw === null) return getFiveXDefaultConfig();
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isValidConfig(parsed) ? parsed : getFiveXDefaultConfig();
    } catch {
      return getFiveXDefaultConfig();
    }
  },
  applyHouseRules
);


/** House rules (see shared/rtpRules.ts): every pay a whole-number x of the bet, target capped at
 * 90%, and the RTP matched by re-fitting frequencies (never the pays) — applied to the default and
 * to any saved config, so one saved before these rules still plays by them. */
function applyHouseRules(config: FiveXRtpConfig): FiveXRtpConfig {
  const targetRtpPercent = capTargetRtp(config.targetRtpPercent);
  const whole: FiveXRtpConfig = {
    ...config,
    targetRtpPercent,
    tiers: config.tiers.map((r) => (r.payoutMultiplier === null ? r : { ...r, payoutMultiplier: wholeX(r.payoutMultiplier) })),
  };
  if (Math.abs(computeFiveXRtpPercent(whole) - targetRtpPercent) < 0.05) return whole;
  return { ...whole, tiers: fitFrequencies(whole.tiers, (r) => computeFiveXRtpPercent({ ...whole, tiers: r }), rescaleFiveXTiers, targetRtpPercent) };
}

/** Persists a new RTP config — takes effect on the very next spin (spinRequest re-reads this on
 * every call, see below), no reload or cross-tab wiring needed. Silently no-ops if localStorage
 * isn't available. */
export function setFiveXRtpConfig(config: FiveXRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private browsing / storage disabled — setting just won't persist */
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncFiveXRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("5x-rewind", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveFiveXRtpConfigToServer(config: FiveXRtpConfig): Promise<void> {
  return saveRtpConfigToServer("5x-rewind", config);
}

const EXACT_TIER_TO_SYMBOL: Partial<Record<LineTierKey, FiveXSymbol>> = {
  whiteBar: "WHITE_BAR",
  sevenBar: "SEVEN_BAR",
  redBar: "RED_BAR",
  purpleBar: "PURPLE_BAR",
  red7: "RED_7",
  purple7: "PURPLE_7",
  blue7: "BLUE_7",
};

const COIN_TIER_TO_SYMBOL: Record<CoinTierKey, FiveXSymbol | null> = {
  noCoin: null,
  coin2x: "COIN_2X",
  coin3x: "COIN_3X",
  coin4x: "COIN_4X",
  coin5x: "COIN_5X",
};

/** Every base (pre-coin) 3-symbol combo that structurally belongs to a given line tier,
 * uniformly weighted within it — a single combo for the 7 exact-match tiers, every
 * structurally-matching combo (from the 7-symbol non-coin alphabet) for "loss" and the 3
 * "mixed" categories. Mirrors exactly what the spin function's rejection sampler can produce. */
function fiveXLineCombos(tierKey: LineTierKey): [FiveXSymbol, FiveXSymbol, FiveXSymbol][] {
  const exactSymbol = EXACT_TIER_TO_SYMBOL[tierKey];
  if (exactSymbol) return [[exactSymbol, exactSymbol, exactSymbol]];

  const predicate =
    tierKey === "loss"
      ? isGenuineLoss
      : tierKey === "any3BarOnly"
        ? isAny3BarOnly
        : tierKey === "any3BarWithSevenBar"
          ? isAny3BarWithSevenBar
          : tierKey === "any3Sevens"
            ? isAny3Sevens
            : null;
  if (!predicate) return [];

  const combos: [FiveXSymbol, FiveXSymbol, FiveXSymbol][] = [];
  for (const s1 of NON_COIN_SYMBOLS) {
    for (const s2 of NON_COIN_SYMBOLS) {
      for (const s3 of NON_COIN_SYMBOLS) {
        if (predicate(s1, s2, s3)) combos.push([s1, s2, s3]);
      }
    }
  }
  return combos;
}

/**
 * 5x Rewind rolls one line tier per spin (loss + each named win category), then independently
 * rolls the coin-overlay table (reused 3 times, once per reel) to decide whether a coin replaces
 * each reel's line symbol. RTP is the exact EV: for each line tier, every one of its
 * structurally-valid base combos (uniformly likely within that tier) × every one of the 5×5×5 =
 * 125 coin-overlay combinations, evaluated through the same calculateWin real spins use. Ported
 * verbatim from paytableConfig.ts's computeFiveXRewindRtpPercent.
 */
export function computeFiveXRtpPercent(config: FiveXRtpConfig): number {
  const baseTiers: Partial<Record<FiveXSymbol, number>> = { ...DEFAULT_BASE_TIERS };
  for (const tier of config.tiers) {
    const symbol = EXACT_TIER_TO_SYMBOL[tier.key];
    if (symbol && tier.payoutMultiplier !== null) baseTiers[symbol] = tier.payoutMultiplier;
  }
  const find = (key: LineTierKey) => config.tiers.find((t) => t.key === key)?.payoutMultiplier;
  const comboMultipliers: ComboMultipliers = {
    anyBarOnly: find("any3BarOnly") ?? DEFAULT_COMBO_MULTIPLIERS.anyBarOnly,
    anyBarWithSevenBar: find("any3BarWithSevenBar") ?? DEFAULT_COMBO_MULTIPLIERS.anyBarWithSevenBar,
    anySevens: find("any3Sevens") ?? DEFAULT_COMBO_MULTIPLIERS.anySevens,
  };

  const coinProb: number[] = []; // index 0 = "no coin", 1-4 = the 4 coin values
  const coinSymbol: (FiveXSymbol | null)[] = [null];
  const noCoinTier = config.coinTiers.find((t) => t.key === "noCoin");
  coinProb.push((noCoinTier?.frequencyPercent ?? 0) / 100);
  (["coin2x", "coin3x", "coin4x", "coin5x"] as CoinTierKey[]).forEach((key) => {
    coinSymbol.push(COIN_TIER_TO_SYMBOL[key]);
    coinProb.push((config.coinTiers.find((t) => t.key === key)?.frequencyPercent ?? 0) / 100);
  });

  let ev = 0;
  for (const tier of config.tiers) {
    const combos = fiveXLineCombos(tier.key);
    if (combos.length === 0) continue;
    const pCombo = tier.frequencyPercent / 100 / combos.length;
    if (pCombo === 0) continue;

    for (const [b1, b2, b3] of combos) {
      for (let i1 = 0; i1 < coinProb.length; i1++) {
        if (coinProb[i1] === 0) continue;
        for (let i2 = 0; i2 < coinProb.length; i2++) {
          if (coinProb[i2] === 0) continue;
          for (let i3 = 0; i3 < coinProb.length; i3++) {
            if (coinProb[i3] === 0) continue;
            const reels: [FiveXSymbol, FiveXSymbol, FiveXSymbol] = [
              coinSymbol[i1] ?? b1,
              coinSymbol[i2] ?? b2,
              coinSymbol[i3] ?? b3,
            ];
            const p = pCombo * coinProb[i1] * coinProb[i2] * coinProb[i3];
            ev += p * calculateWin(reels, 1, baseTiers, comboMultipliers).payout;
          }
        }
      }
    }
  }

  return ev * 100;
}

/** Rescales the line tiers to land on a new target — identical technique to the generic admin
 * page's own `rescaleLineTiers`: every tier with a real payoutMultiplier has its frequency scaled
 * by `scale` (clamped at 0), then `loss` absorbs whatever's left so frequencies still sum to
 * exactly 100%. RTP here is linear in each line tier's own frequency (the coin-overlay
 * distribution is independent of which line tier rolled), so a single pass lands exactly on
 * target — no iteration needed, unlike Crazy 777. The coin table itself is never auto-rescaled,
 * same as every other game's specialReelTiers-equivalent table. */
export function rescaleFiveXTiers(tiers: LineTierRow[], scale: number): LineTierRow[] {
  const scaled = tiers.map((t) =>
    t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
  );
  const nonLossSum = scaled.reduce((sum, t) => (t.key === "loss" ? sum : sum + t.frequencyPercent), 0);
  return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: Math.max(0, 100 - nonLossSum) } : t));
}

// --- Win-line logic — ported verbatim from backEnd/src/games/FiveXRewind/engine.ts ----------

function randomNonCoinSymbol(): FiveXSymbol {
  return NON_COIN_SYMBOLS[Math.floor(Math.random() * NON_COIN_SYMBOLS.length)];
}

const MAX_SAMPLE_ATTEMPTS = 500;

/** Rejection-samples 3 symbols from the non-coin alphabet until `predicate` holds — used for
 * "loss" and the 3 "mixed" line tiers, whose base symbols aren't a single fixed combo. */
function sampleMatching(
  predicate: (s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol) => boolean
): [FiveXSymbol, FiveXSymbol, FiveXSymbol] {
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt++) {
    const s1 = randomNonCoinSymbol();
    const s2 = randomNonCoinSymbol();
    const s3 = randomNonCoinSymbol();
    if (predicate(s1, s2, s3)) return [s1, s2, s3];
  }
  // Astronomically unlikely given each category's real acceptance rate — last-resort fallback.
  return [randomNonCoinSymbol(), randomNonCoinSymbol(), randomNonCoinSymbol()];
}

/** Weighted-random pick of one tier by frequencyPercent. */
function rollTier<T extends { frequencyPercent: number }>(tiers: T[]): T {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return tiers[tiers.length - 1];
}

/** Constructs this line tier's base (pre-coin-overlay) 3 symbols. */
function buildLineSymbols(tierKey: LineTierKey): [FiveXSymbol, FiveXSymbol, FiveXSymbol] {
  const exactSymbol = EXACT_TIER_TO_SYMBOL[tierKey];
  if (exactSymbol) return [exactSymbol, exactSymbol, exactSymbol];

  switch (tierKey) {
    case "any3BarOnly":
      return sampleMatching(isAny3BarOnly);
    case "any3BarWithSevenBar":
      return sampleMatching(isAny3BarWithSevenBar);
    case "any3Sevens":
      return sampleMatching(isAny3Sevens);
    default:
      return sampleMatching(isGenuineLoss);
  }
}

/** How a loss can show on the reels, like Mega 10X Pay: how many reels stop between two
 * symbols (their payline spot left empty), as a percent of losing spins. A loss here never has a
 * coin on the line (any coin pays — see calculateWin's multiplier-only win), so an empty spot next
 * to the other plain symbols can never look like a win. Count 0 = all three land squarely. */
const LOSS_HALF_STOP_ODDS: { count: number; percent: number }[] = [
  { count: 0, percent: 40 },
  { count: 1, percent: 35 },
  { count: 2, percent: 18 },
  { count: 3, percent: 7 },
];

/** Picks which reels half-stop on a losing spin (see LOSS_HALF_STOP_ODDS). */
function pickLossHalfStops(): [boolean, boolean, boolean] {
  let roll = Math.random() * 100;
  let count = 0;
  for (const o of LOSS_HALF_STOP_ODDS) {
    roll -= o.percent;
    if (roll < 0) {
      count = o.count;
      break;
    }
  }
  const order = [0, 1, 2].sort(() => Math.random() - 0.5);
  return [0, 1, 2].map((i) => order.indexOf(i) < count) as [boolean, boolean, boolean];
}

/** Rolls the coin-overlay table once for a single reel — null means "no coin, keep the line
 * symbol"; a coin symbol means it replaces that reel's line symbol entirely. */
function rollCoinForReel(coinTiers: CoinTierRow[]): FiveXSymbol | null {
  if (coinTiers.length === 0) return null;
  const tier = rollTier(coinTiers);
  return COIN_TIER_TO_SYMBOL[tier.key];
}

/** Runs one local spin: the line tier is decided first (by frequency), giving 3 base symbols,
 * then the coin-overlay table is independently rolled for each of the 3 reels — a coin can
 * replace any reel's line symbol regardless of what the line tier rolled, which is what makes
 * the position-sensitive special jackpots and coin substitution/stacking possible. `betAmount` is
 * the total bet. `currentBalance` is the player's balance right before this spin — the new
 * balance (bet deducted, win credited) is computed here and returned. Resolves on the same tick
 * (no network involved), kept as an async function purely so call sites can keep using
 * `await spinRequest(...)` unchanged. */
export async function spinRequest(betAmount: number, currentBalance = 0): Promise<SpinResponse> {
  const config = getFiveXRtpConfig();
  const lineTier = rollTier(config.tiers);
  const lineSymbols = buildLineSymbols(lineTier.key);
  const reels: [FiveXSymbol, FiveXSymbol, FiveXSymbol] = [
    rollCoinForReel(config.coinTiers) ?? lineSymbols[0],
    rollCoinForReel(config.coinTiers) ?? lineSymbols[1],
    rollCoinForReel(config.coinTiers) ?? lineSymbols[2],
  ];

  const baseTiers: Partial<Record<FiveXSymbol, number>> = { ...DEFAULT_BASE_TIERS };
  for (const tier of config.tiers) {
    const symbol = EXACT_TIER_TO_SYMBOL[tier.key];
    if (symbol && tier.payoutMultiplier !== null) baseTiers[symbol] = tier.payoutMultiplier;
  }
  const find = (key: LineTierKey) => config.tiers.find((t) => t.key === key)?.payoutMultiplier;
  const comboMultipliers: ComboMultipliers = {
    anyBarOnly: find("any3BarOnly") ?? DEFAULT_COMBO_MULTIPLIERS.anyBarOnly,
    anyBarWithSevenBar: find("any3BarWithSevenBar") ?? DEFAULT_COMBO_MULTIPLIERS.anyBarWithSevenBar,
    anySevens: find("any3Sevens") ?? DEFAULT_COMBO_MULTIPLIERS.anySevens,
  };

  const winResult = calculateWin(reels, betAmount, baseTiers, comboMultipliers);
  const halfStopReels: [boolean, boolean, boolean] = winResult.isWin ? [false, false, false] : pickLossHalfStops();

  const balance = Math.round((currentBalance - betAmount + winResult.payout) * 100) / 100;

  return {
    reels,
    halfStopReels,
    winResult,
    winAmount: winResult.payout,
    balance,
    meta: { forced: false },
  };
}

export async function getFiveXRewindConfig(): Promise<FiveXRewindConfigResponse> {
  return {
    meta: {
      id: "5x-rewind",
      name: "5x Rewind",
      description: "Classic 3-reel slot with stacking multiplier coins",
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
  reelSymbols: FiveXSymbol[][];
  balanceAfter: number;
}): Promise<void> {
  // No Big/Mega/Jackpot celebration tiers in this game — always logged as a plain win.
  await apiClient.post("/api/games/5x-rewind/spin-log", { ...params, tier: null });
}
