import { apiClient } from "../api/client";
import { UserRole } from "../api/authApi";

export interface AdminUser {
  _id: string;
  email: string | null;
  username: string;
  /** Current plaintext password, decrypted server-side for admin viewing. Null for accounts
   * created before this feature shipped (their password was only ever hashed, never stored). */
  password: string | null;
  balance: number;
  role: UserRole;
  fullName: string | null;
  phone: string | null;
  disabled: boolean;
  deletedAt: string | null;
  createdAt: string;
  online?: boolean;
}

export interface BalanceAdjustmentEntry {
  _id: string;
  userId: string;
  previousBalance: number;
  newBalance: number;
  delta: number;
  createdBy: string;
  /** null on rows saved before types were recorded. */
  type: "admin_add" | "admin_remove" | "starting_balance" | "demo_credits" | null;
  createdByUsername: string | null;
  createdAt: string;
}

export type BalanceReportType = "all" | "admin" | "admin_add" | "admin_remove" | "starting_balance" | "demo_credits";

export interface BalanceReportFilters {
  type: BalanceReportType;
  player?: string;
  adminId?: string;
  /** ISO timestamps. */
  from?: string;
  to?: string;
}

export interface BalanceReportRow {
  _id: string;
  userId: string;
  username: string;
  fullName: string | null;
  /** False once the account has been purged — its record stays, but there's no page to link to. */
  playerExists: boolean;
  typeLabel: string;
  delta: number;
  previousBalance: number;
  newBalance: number;
  changedBy: string;
  createdAt: string;
}

export interface BalanceReportResponse {
  rows: BalanceReportRow[];
  page: number;
  pageSize: number;
  total: number;
  totals: { added: number; removed: number; net: number };
  admins: { _id: string; username: string }[];
}

export interface SpinEntry {
  _id: string;
  userId: string | { _id: string; username: string };
  gameId: string;
  betAmount: number;
  winAmount: number;
  reelSymbols: string[][];
  balanceAfter: number;
  tier: string | null;
  forced: boolean;
  createdAt: string;
}

export type ForcedOutcomeStatus = "pending" | "consumed" | "cancelled";

export interface ForcedOutcomeEntry {
  _id: string;
  userId: string;
  gameId: string;
  targetTier: string;
  status: ForcedOutcomeStatus;
  createdBy: string;
  consumedAt: string | null;
  consumedSpinId: string | null;
  createdAt: string;
}

/** Maintenance mode (admin dashboard → Overview). */
export interface MaintenanceState {
  enabled: boolean;
  message: string;
  updatedAt: string | null;
}

/** Country block (admin dashboard → Overview). */
export interface GeoBlockState {
  enabled: boolean;
  /** ISO 3166 alpha-2 codes, e.g. "PK" */
  countries: string[];
  /** IPs that are never blocked */
  allowIps: string[];
  updatedAt: string | null;
  updatedBy: string | null;
  /** GEOBLOCK_FORCE_OFF=true on the server overrides the dashboard */
  forcedOff: boolean;
  database: { loaded: boolean; buildDate: string | null; error: string | null; autoUpdate: boolean };
  /** the admin's own connection */
  you: { ip: string; country: string | null };
}

export interface AdminStats {
  totalPlayers: number;
  onlineNow: number;
  totalBalance: number;
  today: { spinCount: number; wagered: number; won: number };
  pendingForcedOutcomes: number;
}

export type EarningsRange = "today" | "week" | "month" | "year";

export interface EarningsResponse {
  range: EarningsRange;
  series: Array<{ bucket: string; wagered: number; totalWin: number; net: number; spinCount: number }>;
  summary: {
    wagered: number;
    paidOut: number;
    net: number;
    holdPercent: number;
    rtpActual: number;
    spinCount: number;
  };
}

export type TierKey =
  | "loss"
  | "freeSpin"
  | "simpleWin"
  | "bigWin"
  | "megaWin"
  | "jackpot"
  | "zeroRespin"
  // Buffalo 777 only — each maps 1:1 to a specific symbol/combo, so payouts stay exact
  // per-symbol rather than collapsed into the shared buckets above.
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
  | "coin"
  // Crazy 777 only — line-side tiers (reels 1-3): exact 3-of-a-kind (share singleBar/
  // doubleBar/loss above; these 3 are new) plus 3 mixed-family "ANY" tiers.
  | "sevenLow"
  | "sevenMid"
  | "sevenHigh"
  | "anySeven"
  | "anyGlobal"
  // Crazy 777 only — special-reel-side tiers (reel 4), an independent weighted table
  // stored in `specialReelTiers` below.
  | "multiplier2x"
  | "multiplier5x"
  | "multiplier10x"
  | "dollarPlus"
  | "doubleDollarPlus"
  | "respin"
  | "specialEmpty"
  // 7 Crystal Clover only — the MULTIPLIER_2X roll, stored in `specialReelTiers`, independent
  // from `tiers`. Reuses "multiplier2x"/"specialEmpty" above (specialEmpty = "no multiplier
  // this spin") — only these 2 are new.
  | "multiplier4x"
  | "multiplier8x"
  // 5x Rewind only — line tiers (stored in `tiers`, same as every other game): loss + each
  // exact 3-of-a-kind + the 3 "ANY-3 mixed" categories.
  | "whiteBar"
  | "sevenBar"
  | "redBar"
  | "purpleBar"
  | "red7"
  | "purple7"
  | "blue7"
  | "any3BarOnly"
  | "any3BarWithSevenBar"
  | "any3Sevens"
  // 5x Rewind only — coin-overlay tiers (stored in `specialReelTiers`, reusing Crazy 777's
  // second-table field, but rolled independently for *each* of the 3 reels instead of once
  // per spin — see backEnd/src/games/FiveXRewind/engine.ts).
  | "noCoin"
  | "coin2x"
  | "coin3x"
  | "coin4x"
  | "coin5x"
  // Sizzling 7s only — one row per reel symbol (stored in `tiers`), used as the reel-strip
  // weight table: frequencyPercent is that symbol's draw weight (all 7 sum to 100%),
  // payoutMultiplier is its 3-matching payout (WILD_2X's row holds only the 3-Wild pure
  // payout). See backEnd/src/games/SizzlingSevens/config.ts.
  | "RED_7"
  | "BLUE_7"
  | "BAR"
  | "DOUBLE_BAR"
  | "TRIPLE_BAR"
  | "WILD_2X"
  | "BONUS"
  // Vestigial — 7 Crystal Clover's old per-cell-weight tier model used these 3 as `tiers[].key`
  // (reusing "BAR"/"DOUBLE_BAR"/"TRIPLE_BAR" above) before it moved to the same outcome-first
  // loss/simpleWin/bigWin/megaWin/jackpot shape every other game uses (see
  // backEnd/src/games/CrystalClover/engine.ts's doc comment) — kept in the union only so
  // TIER_LABELS/TIER_IMAGES below don't need every game's map to drop these keys too.
  | "SEVEN_CLOVER"
  | "WILD"
  | "MULTIPLIER_2X"
  // 777 Fruity only — one row per payout symbol (stored in `tiers`, same "exact 3-of-a-kind"
  // pattern as Buffalo 777), plus reuses "freeSpin"/"loss" above for the Bonus feature.
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
  | "star"
  // Mega 10X Pay only — reuses "loss"/"seven"/"sevenBar"/"singleBar"/"doubleBar"/"tripleBar"
  // above; these are the new ones (see backEnd/src/games/Mega10XPay/config.ts).
  | "tenX"
  | "threeX"
  | "cherry"
  | "any3SevenSevenBar"
  | "any3SingleBarSevenBar"
  | "any3BarFamilyMix"
  | "twoCherry"
  | "oneCherry"
  // Vegas Hits only — one row per reel symbol (stored in `tiers`), same "reel-strip weight
  // table" shape as Sizzling 7s. Reuses "RED_7"/"BLUE_7" (Sizzling 7s), "WILD" (Crystal
  // Clover), and "BONUS" (Sizzling 7s) above — only these 3 are new: the game's 3 flagship
  // green-7 tiers. See backEnd/src/games/VegasHits/config.ts.
  | "GREEN_7"
  | "DOUBLE_GREEN_7"
  | "TRIPLE_GREEN_7"
  // Life of Luxury only — one row per reel symbol (stored in `tiers`), same "reel-strip weight
  // table" shape as Vegas Hits. Reuses "WILD" (Crystal Clover/Vegas Hits) above for its own
  // substituting wild, restricted to reels 2-4 — see WILD_ALLOWED_REELS. Every row's
  // payoutMultiplier stays unused/null — with 5 reels a single number can't represent a symbol's
  // 3/4/5-of-a-kind payouts, so those live in `symbolPayouts` instead, and COIN's own scatter
  // payout/free-spins live in `scatterRules`. See backEnd/src/games/LifeOfLuxury/config.ts.
  | "AEROPLANE"
  | "BOAT"
  | "CAR"
  | "RING"
  | "MONEY"
  | "WATCH"
  | "GOLD_BAR"
  | "SILVER_BAR"
  | "BRONZE_BAR"
  | "COIN"
  // Rubber Duck only — one row per reel symbol (stored in `tiers`), same "reel-strip weight
  // table" shape as Life of Luxury/Vegas Hits. Every row's payoutMultiplier IS used directly
  // here: a flat per-hit value, no 3/4/5-of-a-kind tiers — a symbol pays for itself the instant
  // it lands on any of the 5 reels, no matching required. Reuses "BOAT"/"BONUS" above.
  | "TRIPLE_7"
  | "DOUBLE_7"
  | "SEVEN"
  | "GUN"
  | "TOOL"
  | "SHAMPOO"
  | "TOWEL"
  | "BRUSH"
  | "SAFEGUARD"
  | "CAP"
  | "POT"
  | "SOAP"
  | "SPONGE"
  | "AVOCADO"
  | "BANANA"
  | "COCONUT"
  | "GRAPES"
  | "LEMON"
  | "STRAWBERRY"
  // Top Dollar only — reuses "loss"/"seven"/"tripleBar"/"doubleBar"/"singleBar"/"anyBar" above
  // (all already exist with matching semantics); these are the new ones: the 3 Diamond-count
  // tiers (Diamond pays just for showing up 1/2/3 times anywhere among the 3 reels) and the
  // bonus-trigger tier. See backEnd/src/games/TopDollar/engine.ts.
  | "diamondOne"
  | "diamondTwo"
  | "diamondThree"
  | "dollarBonus"
  // Top Dollar only — the bonus round's note-bundle value pool, stored in `specialReelTiers`.
  // Each row's payoutMultiplier holds a FLAT dollar amount (not bet-scaled) instead of the usual
  // bet-multiple — see backEnd/src/games/TopDollar/config.ts's REFERENCE_BONUS_POOL.
  | "dollarPoolFive"
  | "dollarPoolTen"
  | "dollarPoolTwenty"
  | "dollarPoolFifty"
  | "dollarPoolHundred"
  | "dollarPoolThousand";

export interface TierRow {
  key: TierKey;
  /** Percent chance of this outcome on a single spin — all rows sum to 100. */
  frequencyPercent: number;
  /** Multiplier of bet credited when this tier hits. null for "loss" and "freeSpin". For
   * "zeroRespin" (Cash Machine) this is only an *estimated average* for the RTP preview — the
   * real payout is whatever value the respin reveals (see AmountThresholds.zeroRespinMin/Max). */
  payoutMultiplier: number | null;
  /** ShamrockSpin win-tiers only — used instead of payoutMultiplier during a free-spin bonus round. */
  freeSpinPayoutMultiplier: number | null;
}

export interface AmountThresholds {
  simpleWinMax: number;
  bigWinMin: number;
  megaWinMin: number;
  jackpotMin: number;
  /** Range of the digit value the "0 → respin" mechanic is allowed to reveal. */
  zeroRespinMin: number;
  zeroRespinMax: number;
}

export type CelebrationTier = "BIG WIN" | "MEGA WIN" | "JACKPOT";

export interface PaytableConfig {
  gameId: string;
  targetRtpPercent: number;
  /** Sizzling 7s and Vegas Hits only — target for the % of base spins that pay nothing at all
   * (see computeSizzlingSevensStats/solveSizzlingSevensLossPercent and
   * computeVegasHitsStats/solveVegasHitsLossPercent below). null for every other game. */
  targetLossPercent: number | null;
  /** ShamrockSpin only — bonus spins awarded when the "freeSpin" tier rolls. */
  freeSpinsGranted: number | null;
  tiers: TierRow[];
  /** ShamrockSpin only — which WIN_RULES render (cosmetically) for each win tier. */
  ruleTierMap: Record<string, string> | null;
  /** Which celebration overlay (if any) each win tier triggers. A tier missing from the
   * map, or mapped to null, just plays the plain win chime with no overlay. */
  celebrationMap: Partial<Record<TierKey, CelebrationTier | null>> | null;
  /** Cash Machine only — editable amount thresholds. */
  amountThresholds: AmountThresholds | null;
  /** Crazy 777 only — a second, fully independent weighted table for reel 4 (the special
   * reel), summing to 100% on its own, separate from `tiers`' 100% sum. */
  specialReelTiers: TierRow[] | null;
  /** Crazy 777 only — bounds for the RESPIN special-reel feature. */
  respinRange: { min: number; max: number } | null;
  /** Crystal Clover and Vegas Hits only — chance (0-100) a reel rolls its "1 symbol on the
   * center payline" state instead of "2 symbols on top+bottom". */
  reelStateConfig: { centerRowChancePercent: number } | null;
  /** Vegas Hits only — see games/VegasHits/config.ts's WildRules doc comment. */
  wildRules: VhWildRules | null;
  /** Life of Luxury only — each regular symbol's own 3/4/5-of-a-kind line payout (multiple of
   * line bet), keyed by symbol name. See backEnd/src/games/LifeOfLuxury/config.ts. */
  symbolPayouts: Record<string, { x3: number; x4: number; x5: number }> | null;
  /** Life of Luxury only — the COIN scatter's own independent per-cell chance, payout (multiple
   * of bet), and the free spins it awards on a base-spin 3+ (no retriggering). */
  scatterRules: { chancePercent: number; x3: number; x4: number; x5: number; freeSpinsAwarded: number } | null;
}

/** Crazy 777 only — mirrors crazy777FinalWinPerBet in the backend. */
function crazy777FinalWinPerBet(lineTier: TierRow, specialTier: TierRow): number {
  if (lineTier.key === "loss" || lineTier.payoutMultiplier === null) return 0;
  const baseWin = lineTier.payoutMultiplier;
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

/** Crazy 777 only — mirrors computeCrazy777RtpPercent in the backend (two independent
 * weighted tables, exact joint EV plus a first-order RESPIN retrigger term). */
function computeCrazy777RtpPercent(config: PaytableConfig): number {
  const specialTiers = config.specialReelTiers ?? [];
  let jointEV = 0;
  for (const line of config.tiers) {
    for (const special of specialTiers) {
      jointEV += (line.frequencyPercent / 100) * (special.frequencyPercent / 100) * crazy777FinalWinPerBet(line, special);
    }
  }

  const pLineWin =
    config.tiers.filter((t) => t.key !== "loss" && t.payoutMultiplier !== null).reduce((sum, t) => sum + t.frequencyPercent, 0) /
    100;
  const respinTier = specialTiers.find((t) => t.key === "respin");
  const pRespin = respinTier ? respinTier.frequencyPercent / 100 : 0;
  const range = config.respinRange ?? { min: 0, max: 0 };
  const avgRespins = (range.min + range.max) / 2;
  const extraRtp = pLineWin * pRespin * avgRespins * jointEV;

  return (jointEV + extraRtp) * 100;
}

/** 5x Rewind only — mirrors games/FiveXRewind/winCalc.ts's calculateWin (payout only, not
 * the full structured result — that's all the RTP preview needs). */
const FIVEX_SYMBOLS = [
  "WHITE_BAR", "SEVEN_BAR", "RED_BAR", "PURPLE_BAR", "RED_7", "PURPLE_7", "BLUE_7",
  "COIN_2X", "COIN_3X", "COIN_4X", "COIN_5X",
] as const;
type FiveXSymbol = (typeof FIVEX_SYMBOLS)[number];
const FIVEX_NON_COIN_SYMBOLS: FiveXSymbol[] = ["WHITE_BAR", "SEVEN_BAR", "RED_BAR", "PURPLE_BAR", "RED_7", "PURPLE_7", "BLUE_7"];
const FIVEX_COIN_VALUE: Partial<Record<FiveXSymbol, number>> = { COIN_2X: 2, COIN_3X: 3, COIN_4X: 4, COIN_5X: 5 };
const FIVEX_COIN_SET = new Set<FiveXSymbol>(["COIN_2X", "COIN_3X", "COIN_4X", "COIN_5X"]);
const FIVEX_BAR_FAMILY = new Set<FiveXSymbol>(["WHITE_BAR", "RED_BAR", "PURPLE_BAR", "SEVEN_BAR"]);
const FIVEX_BAR_ONLY = new Set<FiveXSymbol>(["WHITE_BAR", "RED_BAR", "PURPLE_BAR"]);
const FIVEX_SEVEN_FAMILY = new Set<FiveXSymbol>(["SEVEN_BAR", "RED_7", "PURPLE_7", "BLUE_7"]);
const FIVEX_DEFAULT_BASE_TIERS: Partial<Record<FiveXSymbol, number>> = {
  WHITE_BAR: 1, SEVEN_BAR: 10, RED_7: 20, PURPLE_7: 15, BLUE_7: 12, PURPLE_BAR: 6, RED_BAR: 5,
};
interface FiveXComboMultipliers {
  anyBarOnly: number;
  anyBarWithSevenBar: number;
  anySevens: number;
}
const FIVEX_DEFAULT_COMBO_MULTIPLIERS: FiveXComboMultipliers = {
  anyBarOnly: 2,
  anyBarWithSevenBar: 4,
  anySevens: 8,
};
const FIVEX_EXACT_TIER_TO_SYMBOL: Partial<Record<TierKey, FiveXSymbol>> = {
  whiteBar: "WHITE_BAR", sevenBar: "SEVEN_BAR", redBar: "RED_BAR", purpleBar: "PURPLE_BAR",
  red7: "RED_7", purple7: "PURPLE_7", blue7: "BLUE_7",
};
const FIVEX_COIN_TIER_TO_SYMBOL: Partial<Record<TierKey, FiveXSymbol>> = {
  coin2x: "COIN_2X", coin3x: "COIN_3X", coin4x: "COIN_4X", coin5x: "COIN_5X",
};

function fiveXIsGenuineLoss(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (s1 === s2 && s2 === s3) return false;
  if (FIVEX_BAR_FAMILY.has(s1) && FIVEX_BAR_FAMILY.has(s2) && FIVEX_BAR_FAMILY.has(s3)) return false;
  if (FIVEX_SEVEN_FAMILY.has(s1) && FIVEX_SEVEN_FAMILY.has(s2) && FIVEX_SEVEN_FAMILY.has(s3)) return false;
  return true;
}
function fiveXIsAny3BarOnly(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (!FIVEX_BAR_ONLY.has(s1) || !FIVEX_BAR_ONLY.has(s2) || !FIVEX_BAR_ONLY.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}
// WHITE_BAR + SEVEN_BAR only, mixed — confirmed with user: NOT "any bar family mixed with
// SEVEN_BAR" (RED_BAR/PURPLE_BAR don't count here — e.g. RED_BAR|PURPLE_BAR|SEVEN_BAR matches
// no rule and is a genuine loss).
const FIVEX_WHITE_OR_SEVEN = new Set<FiveXSymbol>(["WHITE_BAR", "SEVEN_BAR"]);
function fiveXIsAny3BarWithSevenBar(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (!FIVEX_WHITE_OR_SEVEN.has(s1) || !FIVEX_WHITE_OR_SEVEN.has(s2) || !FIVEX_WHITE_OR_SEVEN.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}
function fiveXIsAny3Sevens(s1: FiveXSymbol, s2: FiveXSymbol, s3: FiveXSymbol): boolean {
  if (!FIVEX_SEVEN_FAMILY.has(s1) || !FIVEX_SEVEN_FAMILY.has(s2) || !FIVEX_SEVEN_FAMILY.has(s3)) return false;
  return !(s1 === s2 && s2 === s3);
}

function fiveXPayout(
  reels: [FiveXSymbol, FiveXSymbol, FiveXSymbol],
  bet: number,
  baseTiers: Partial<Record<FiveXSymbol, number>>,
  comboMultipliers: FiveXComboMultipliers
): number {
  const [a, b, c] = reels;
  if (a === "COIN_2X" && b === "COIN_5X" && c === "COIN_2X") return bet * 1000;
  if (a === "COIN_2X" && b === "COIN_4X" && c === "COIN_2X") return bet * 400;

  const coins = reels.filter((s) => FIVEX_COIN_SET.has(s));
  const nonCoins = reels.filter((s) => !FIVEX_COIN_SET.has(s));
  const stacked = coins.reduce((p, s) => p * (FIVEX_COIN_VALUE[s] ?? 1), 1);
  const allMatch = nonCoins.length > 0 && nonCoins.every((s) => s === nonCoins[0]);
  const baseSymbol = allMatch ? nonCoins[0] : null;
  const baseMultiplier = baseSymbol ? baseTiers[baseSymbol] : undefined;
  if (baseSymbol && baseMultiplier !== undefined) return bet * baseMultiplier * stacked;

  if (coins.length === 0) {
    if (fiveXIsAny3BarOnly(a, b, c)) return bet * comboMultipliers.anyBarOnly;
    if (fiveXIsAny3BarWithSevenBar(a, b, c)) return bet * comboMultipliers.anyBarWithSevenBar;
    if (fiveXIsAny3Sevens(a, b, c)) return bet * comboMultipliers.anySevens;
  }
  if (coins.length > 0) return bet * stacked;
  return 0;
}

/** Every base (pre-coin) 3-symbol combo that structurally belongs to a given line tier,
 * uniformly weighted within it — mirrors the backend's fiveXLineCombos exactly. */
function fiveXLineCombos(tierKey: TierKey): [FiveXSymbol, FiveXSymbol, FiveXSymbol][] {
  const exactSymbol = FIVEX_EXACT_TIER_TO_SYMBOL[tierKey];
  if (exactSymbol) return [[exactSymbol, exactSymbol, exactSymbol]];

  const predicate =
    tierKey === "loss"
      ? fiveXIsGenuineLoss
      : tierKey === "any3BarOnly"
        ? fiveXIsAny3BarOnly
        : tierKey === "any3BarWithSevenBar"
          ? fiveXIsAny3BarWithSevenBar
          : tierKey === "any3Sevens"
            ? fiveXIsAny3Sevens
            : null;
  if (!predicate) return [];

  const combos: [FiveXSymbol, FiveXSymbol, FiveXSymbol][] = [];
  for (const s1 of FIVEX_NON_COIN_SYMBOLS) {
    for (const s2 of FIVEX_NON_COIN_SYMBOLS) {
      for (const s3 of FIVEX_NON_COIN_SYMBOLS) {
        if (predicate(s1, s2, s3)) combos.push([s1, s2, s3]);
      }
    }
  }
  return combos;
}

/**
 * 5x Rewind only — rolls one line tier per spin (loss + each named win category), then
 * independently rolls the coin-overlay table (`specialReelTiers`) 3 times, once per reel.
 * RTP is the exact EV: for each line tier, every structurally-valid base combo (uniformly
 * likely within that tier) x every one of the 5x5x5 = 125 coin-overlay combinations —
 * mirrors the backend's computeFiveXRewindRtpPercent exactly.
 */
function computeFiveXRewindRtpPercent(config: PaytableConfig): number {
  const baseTiers: Partial<Record<FiveXSymbol, number>> = { ...FIVEX_DEFAULT_BASE_TIERS };
  for (const tier of config.tiers) {
    const symbol = FIVEX_EXACT_TIER_TO_SYMBOL[tier.key];
    if (symbol && tier.payoutMultiplier !== null) baseTiers[symbol] = tier.payoutMultiplier;
  }
  const comboMultipliers: FiveXComboMultipliers = {
    anyBarOnly: config.tiers.find((t) => t.key === "any3BarOnly")?.payoutMultiplier ?? FIVEX_DEFAULT_COMBO_MULTIPLIERS.anyBarOnly,
    anyBarWithSevenBar:
      config.tiers.find((t) => t.key === "any3BarWithSevenBar")?.payoutMultiplier ?? FIVEX_DEFAULT_COMBO_MULTIPLIERS.anyBarWithSevenBar,
    anySevens: config.tiers.find((t) => t.key === "any3Sevens")?.payoutMultiplier ?? FIVEX_DEFAULT_COMBO_MULTIPLIERS.anySevens,
  };

  const coinTiers = config.specialReelTiers ?? [];
  const coinProb: number[] = [(coinTiers.find((t) => t.key === "noCoin")?.frequencyPercent ?? 0) / 100];
  const coinSymbol: (FiveXSymbol | null)[] = [null];
  for (const [key, symbol] of Object.entries(FIVEX_COIN_TIER_TO_SYMBOL) as [TierKey, FiveXSymbol][]) {
    coinSymbol.push(symbol);
    coinProb.push((coinTiers.find((t) => t.key === key)?.frequencyPercent ?? 0) / 100);
  }

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
            ev += p * fiveXPayout(reels, 1, baseTiers, comboMultipliers);
          }
        }
      }
    }
  }
  return ev * 100;
}

/** Sizzling 7s only — mirrors games/SizzlingSevens/{config,winCalc}.ts. Duplicated here (not
 * imported) since this file has no build-time link to the backend package — same convention
 * every other per-game RTP mirror in this file already follows. */
const SIZZ_SYMBOLS = ["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR", "WILD_2X", "BONUS"] as const;
type SizzSymbol = (typeof SIZZ_SYMBOLS)[number];
/** `null` = a blank slot — see sizzDrawGrid. */
type SizzCell = SizzSymbol | null;
const SIZZ_WILD: SizzSymbol = "WILD_2X";
const SIZZ_BONUS: SizzSymbol = "BONUS";
const SIZZ_WILD_SUB = new Set<SizzCell>(["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR"]);
const SIZZ_BAR_FAMILY: SizzSymbol[] = ["BAR", "DOUBLE_BAR", "TRIPLE_BAR"];
/** A payline where every symbol is a mix of SIZZ_BAR_FAMILY (not necessarily identical — Wild
 * substitutes in same as everywhere else) still wins, just at this flat rate rather than one of
 * the 3 higher exact-match BAR payouts above (see sizzEvaluateLine's candidateC). */
const SIZZ_ANY_BAR_SET = new Set<SizzCell>([...SIZZ_BAR_FAMILY, "WILD_2X"]);
const SIZZ_ANY_BAR_PAYOUT = 5;
/** Mirrors backend config.ts's DEFAULT_PAYTABLE — see its comment for why these are ~17.1x down
 * from the originally-requested round numbers (RED_7=250, BLUE_7=100, TRIPLE_BAR=50,
 * DOUBLE_BAR=30, BAR=25, BONUS=60): that scale floors out around ~725% RTP no matter how
 * weights are tuned, given this board's 27 fully-overlapping paylines plus the ANY_BAR rule. */
const SIZZ_DEFAULT_PAYTABLE: Record<Exclude<SizzSymbol, "WILD_2X">, number> = {
  RED_7: 14.1946,
  BLUE_7: 5.6779,
  TRIPLE_BAR: 2.8389,
  DOUBLE_BAR: 1.7034,
  BAR: 1.4195,
  BONUS: 3.4067,
};
const SIZZ_PURE_WILD_DEFAULT: Record<1 | 2 | 3, number> = { 1: 0.1163, 2: 0.4653, 3: 0.5678 };
/** A real spin's finalWin = basePayout * wildMultiplier * betMultiplier, where betMultiplier =
 * totalBet / LINE_COST (see games/SizzlingSevens/routes.ts) — betMultiplier is NOT the same
 * number as totalBet, they differ by exactly this factor. sizzCalculateSpinWin below computes
 * everything as if betMultiplier were fixed at 1 (no bet-scaling parameter at all), so
 * computeSizzlingSevensStats has to divide by LINE_COST itself to get the return for a genuine
 * 1-unit bet — omitting that previously over-reported RTP by exactly this factor (confirmed
 * against live spins). */
const SIZZ_LINE_COST = 30;
const SIZZ_WILD_MULT_BASE = 2;
const SIZZ_BONUS_TRIGGER_COUNT = 3;
const SIZZ_PAYLINES: [number, number, number][] = [
  [1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0],
  [1, 0, 1], [1, 2, 1], [2, 1, 2], [0, 1, 0], [0, 1, 1],
  [2, 1, 1], [1, 0, 0], [1, 2, 2], [0, 0, 1], [2, 2, 1],
  [1, 1, 0], [1, 1, 2], [0, 2, 0], [2, 0, 2], [0, 1, 2],
  [2, 2, 0], [0, 2, 2], [2, 0, 0], [1, 0, 2], [1, 2, 0],
  [0, 2, 1], [2, 0, 1],
];
const SIZZ_FREE_GAMES_AWARDS: Array<{ freeSpins: number; multiplierPool: number[]; weight: number }> = [
  { freeSpins: 5, multiplierPool: [30, 15, 8], weight: 30 },
  { freeSpins: 8, multiplierPool: [10, 8, 5], weight: 28 },
  { freeSpins: 10, multiplierPool: [8, 5, 3], weight: 24 },
  { freeSpins: 15, multiplierPool: [5, 3, 2], weight: 18 },
];
const SIZZ_MYSTERY_SPIN_COUNTS = [5, 8, 10, 15];
const SIZZ_MYSTERY_POOL = [2, 3, 5, 8, 10, 15, 30];
const SIZZ_MYSTERY_WEIGHT = 20;

type SizzPaytable = Record<Exclude<SizzSymbol, "WILD_2X">, number>;
type SizzPureWild = Record<1 | 2 | 3, number>;
type SizzGrid = SizzCell[][];

function sizzMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sizzEvaluateLine(
  grid: SizzGrid,
  line: [number, number, number],
  paytable: SizzPaytable,
  pureWild: SizzPureWild
): number {
  const symbols = line.map((row, reel) => grid[reel][row]);
  let leadingWilds = 0;
  while (leadingWilds < 3 && symbols[leadingWilds] === SIZZ_WILD) leadingWilds++;

  let candidateA = 0;
  if (leadingWilds < 3) {
    const winSym = symbols[leadingWilds];
    if (winSym !== null && winSym !== SIZZ_BONUS && SIZZ_WILD_SUB.has(winSym)) {
      let matchCount = 0;
      let wildCount = 0;
      for (let i = 0; i < 3; i++) {
        if (symbols[i] === SIZZ_WILD) {
          matchCount++;
          wildCount++;
        } else if (symbols[i] === winSym) {
          matchCount++;
        } else break;
      }
      if (matchCount >= 3) {
        candidateA = paytable[winSym as Exclude<SizzSymbol, "WILD_2X">] * Math.pow(SIZZ_WILD_MULT_BASE, wildCount);
      }
    }
  }

  let candidateB = 0;
  if (leadingWilds >= 1) {
    const capped = Math.min(leadingWilds, 3) as 1 | 2 | 3;
    candidateB = pureWild[capped];
  }

  const candidateC = symbols.every((s) => SIZZ_ANY_BAR_SET.has(s)) ? SIZZ_ANY_BAR_PAYOUT : 0;

  return Math.max(candidateA, candidateB, candidateC);
}

function sizzCalculateSpinWin(grid: SizzGrid, paytable: SizzPaytable, pureWild: SizzPureWild, freeMultiplier: number) {
  let lineTotal = 0;
  for (const line of SIZZ_PAYLINES) lineTotal += sizzEvaluateLine(grid, line, paytable, pureWild);

  let scatterCount = 0;
  for (const col of grid) for (const s of col) if (s === SIZZ_BONUS) scatterCount++;
  const scatterWin = scatterCount >= SIZZ_BONUS_TRIGGER_COUNT ? paytable.BONUS : 0;

  const beforeMultiplier = lineTotal + scatterWin;
  return { finalWin: beforeMultiplier * freeMultiplier, triggeredFreeGames: scatterCount >= SIZZ_BONUS_TRIGGER_COUNT };
}

function sizzWeightedSymbol(tiers: TierRow[], rng: () => number): SizzSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = rng() * total;
  for (const t of tiers) {
    roll -= t.frequencyPercent;
    if (roll < 0) return t.key as SizzSymbol;
  }
  return tiers[tiers.length - 1].key as SizzSymbol;
}

/** Mirrors the game's reel strip, which strictly alternates symbol / blank (see
 * games/SizzlingSevens/pixi/Reel.ts) — so each reel lands with equal odds on either 1 symbol in
 * the MIDDLE row or 2 symbols on TOP+BOTTOM, never 3. */
function sizzDrawGrid(tiers: TierRow[], rng: () => number): SizzGrid {
  const grid: SizzGrid = [];
  for (let reel = 0; reel < 3; reel++) {
    const col: SizzCell[] =
      rng() < 0.5
        ? [null, sizzWeightedSymbol(tiers, rng), null]
        : [sizzWeightedSymbol(tiers, rng), null, sizzWeightedSymbol(tiers, rng)];
    grid.push(col);
  }
  return grid;
}

function sizzTriggerFreeGames(rng: () => number): { freeSpins: number; multiplierPool: number[] } {
  const options = [...SIZZ_FREE_GAMES_AWARDS, { freeSpins: 0, multiplierPool: [] as number[], weight: SIZZ_MYSTERY_WEIGHT, isMystery: true }];
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = rng() * total;
  let picked = options[options.length - 1];
  for (const o of options) {
    roll -= o.weight;
    if (roll <= 0) {
      picked = o;
      break;
    }
  }
  if ("isMystery" in picked && picked.isMystery) {
    const freeSpins = SIZZ_MYSTERY_SPIN_COUNTS[Math.floor(rng() * SIZZ_MYSTERY_SPIN_COUNTS.length)];
    return { freeSpins, multiplierPool: SIZZ_MYSTERY_POOL };
  }
  return { freeSpins: picked.freeSpins, multiplierPool: picked.multiplierPool };
}

const SIZZ_SIMS = 200_000;
/** Lower-fidelity sim count used only while *searching* for a gamma that hits a requested
 * target (see solveSizzlingSevensLossPercent/solveSizzlingSevensRtpPercent below) — each search
 * needs several to a dozen-plus simulation passes, and running those at the full 200k count
 * would freeze the browser for several seconds. The final tiers those solvers return are always
 * re-checked at full SIZZ_SIMS fidelity by the caller's own live "Effective RTP/Loss" readout
 * (a plain computeSizzlingSevensStats(config) call, no override), so search-time precision only
 * needs to be good enough to land within the admin page's tolerance, not exact. */
const SIZZ_SEARCH_SIMS = 15_000;
const SIZZ_MAX_FREE_SPINS = 500;
/** Mirrors SizzlingSevensGame.tsx's FREE_GAMES_MIN_WIN_X — each Free Games round pays at least a
 * random [min, max] x the bet in total. In this sim's units the bet is SIZZ_LINE_COST. */
const SIZZ_FREE_GAMES_MIN_WIN_X: [number, number] = [3, 4];

export interface SizzlingSevensStats {
  rtpPercent: number;
  /** Percent of base spins (not counting free-spin rounds) that pay nothing — the closest
   * equivalent to every other game's admin-editable "Loss" row, except this is a *computed*
   * stat rather than an editable weight (Sizzling 7s has no dedicated loss symbol to draw). */
  lossPercent: number;
}

/** Sizzling 7s' RTP and loss frequency can't be exactly enumerated (3 reels x 3 rows x 27
 * overlapping lines x Wild/Bonus/Free-Games is combinatorially far too large) — estimated via
 * a fixed-seed Monte Carlo simulation instead, mirroring the backend's
 * computeSizzlingSevensStats exactly so both sides always agree. `sims` defaults to the full
 * SIZZ_SIMS (what's shown/validated) — pass SIZZ_SEARCH_SIMS explicitly for a cheaper estimate
 * while iterating toward a target (see the solvers below). */
export function computeSizzlingSevensStats(config: PaytableConfig, sims: number = SIZZ_SIMS): SizzlingSevensStats {
  const paytable: SizzPaytable = { ...SIZZ_DEFAULT_PAYTABLE };
  for (const tier of config.tiers) {
    if (tier.key === SIZZ_WILD || tier.payoutMultiplier === null) continue;
    if (tier.key in paytable) (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
  }
  const wildRow = config.tiers.find((t) => t.key === SIZZ_WILD);
  const pureWild: SizzPureWild = { 1: SIZZ_PURE_WILD_DEFAULT[1], 2: SIZZ_PURE_WILD_DEFAULT[2], 3: wildRow?.payoutMultiplier ?? SIZZ_PURE_WILD_DEFAULT[3] };

  const rng = sizzMulberry32(0xc0ffee);
  let total = 0;
  let lossCount = 0;
  for (let i = 0; i < sims; i++) {
    const grid = sizzDrawGrid(config.tiers, rng);
    const ev = sizzCalculateSpinWin(grid, paytable, pureWild, 1);
    total += ev.finalWin;
    if (ev.finalWin === 0) lossCount++;

    if (ev.triggeredFreeGames) {
      let award = sizzTriggerFreeGames(rng);
      let remaining = award.freeSpins;
      let pool = award.multiplierPool;
      let played = 0;
      let roundTotal = 0;
      while (remaining > 0 && played < SIZZ_MAX_FREE_SPINS) {
        remaining--;
        played++;
        const freeGrid = sizzDrawGrid(config.tiers, rng);
        const freeMultiplier = pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : 1;
        const freeEv = sizzCalculateSpinWin(freeGrid, paytable, pureWild, freeMultiplier);
        total += freeEv.finalWin;
        roundTotal += freeEv.finalWin;
        if (freeEv.triggeredFreeGames) {
          award = sizzTriggerFreeGames(rng);
          remaining += award.freeSpins;
          pool = award.multiplierPool;
        }
      }
      const [minX, maxX] = SIZZ_FREE_GAMES_MIN_WIN_X;
      const floor = (minX + rng() * (maxX - minX)) * SIZZ_LINE_COST;
      if (roundTotal < floor) total += floor - roundTotal;
    }
  }
  return { rtpPercent: (total / SIZZ_LINE_COST / sims) * 100, lossPercent: (lossCount / sims) * 100 };
}

/** Reshapes all 7 symbol weights via a single power-law exponent, renormalized back to sum to
 * 100 — gamma > 1 concentrates weight further onto whichever symbols already have the most
 * (pushes loss% down, verified monotonic in that direction down toward 0); gamma < 1 flattens
 * the distribution toward uniform. Payout multipliers are left untouched. */
function sizzReweightByGamma(tiers: TierRow[], gamma: number): TierRow[] {
  const total = tiers.reduce((sum, t) => sum + Math.pow(t.frequencyPercent, gamma), 0);
  return tiers.map((t) => ({ ...t, frequencyPercent: (Math.pow(t.frequencyPercent, gamma) / total) * 100 }));
}

/** A wide log-spaced sweep of gamma (see sizzReweightByGamma), roughly 0.005 to 200 — covers
 * both "flatten toward uniform" and "concentrate further" without needing to know in advance
 * which direction a target sits in, since both RTP and loss% move non-monotonically with gamma
 * (each has its own interior extreme point, verified empirically — RTP dips to a minimum around
 * gamma≈1-2 then rises both directions away from it; loss% peaks around gamma≈0.75 then falls
 * both directions). A plain "assume monotonic, bisect" search would silently pick the wrong
 * branch depending on which side of that extreme the target falls on. */
const SIZZ_GAMMA_GRID: number[] = (() => {
  const points: number[] = [];
  const steps = 28;
  const logMin = Math.log(0.005);
  const logMax = Math.log(200);
  for (let i = 0; i <= steps; i++) points.push(Math.exp(logMin + ((logMax - logMin) * i) / steps));
  return points;
})();

/** Finds the gamma (see sizzReweightByGamma) whose resulting weights get `evaluate` closest to
 * `target`, via a coarse log-spaced grid pass followed by a local refine around the best point.
 * Shared by both solvers below — weights are the only thing either one ever touches, payout
 * multipliers stay exactly as the admin set them. */
function sizzSearchGamma(config: PaytableConfig, evaluate: (c: PaytableConfig) => number, target: number): TierRow[] {
  let bestGamma = 1;
  let bestDiff = Infinity;
  for (const gamma of SIZZ_GAMMA_GRID) {
    const diff = Math.abs(evaluate({ ...config, tiers: sizzReweightByGamma(config.tiers, gamma) }) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestGamma = gamma;
    }
  }
  for (const factor of [0.7, 0.85, 1.18, 1.4]) {
    const gamma = bestGamma * factor;
    const diff = Math.abs(evaluate({ ...config, tiers: sizzReweightByGamma(config.tiers, gamma) }) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestGamma = gamma;
    }
  }
  return sizzReweightByGamma(config.tiers, bestGamma);
}

/**
 * Finds a reweighting of Sizzling 7s' 7 symbol weights (see sizzReweightByGamma) that gets the
 * computed loss% close to `targetLossPercent`, leaving every payoutMultiplier untouched — the
 * admin's payout table is fixed, deliberate input, never something this page rescales on its
 * own. Effective RTP shifts as a side effect (weights drive both stats at once) and is left for
 * the admin to re-set afterward via Target RTP % if they want it back — see
 * solveSizzlingSevensRtpPercent, which searches the very same weight space for the opposite
 * target.
 *
 * Sizzling 7s' 27-fully-overlapping-payline structure (every possible 3-row combination across
 * the 3x3 grid is a live line) puts a hard structural ceiling on how loss-heavy this game can
 * ever be for a given payout table — confirmed empirically across several different reweighting
 * families. A target beyond what's achievable lands as close as the search can get, not at the
 * literal number requested; the caller's own full-fidelity "Effective Loss" readout after
 * calling this is the real source of truth for whether it actually landed close enough.
 */
export function solveSizzlingSevensLossPercent(config: PaytableConfig, targetLossPercent: number): TierRow[] {
  return sizzSearchGamma(config, (c) => computeSizzlingSevensStats(c, SIZZ_SEARCH_SIMS).lossPercent, targetLossPercent);
}

/**
 * Finds a reweighting of Sizzling 7s' 7 symbol weights that gets the computed RTP close to
 * `targetRtpPercent`, leaving every payoutMultiplier untouched (see solveSizzlingSevensLossPercent's
 * doc comment — same principle, same search, opposite target). Unlike every other game, Sizzling
 * 7s has no dedicated "loss" tier for a plain proportional-frequency rescale to absorb slack
 * into (every one of its 7 rows is a real, always-drawn symbol, and scaling all of them by the
 * same factor is a no-op for RTP — the weighted draw only cares about *relative* weight — while
 * also breaking the "frequencies sum to 100%" invariant), so this reshapes the *distribution*
 * (gamma) instead of naively scaling it.
 *
 * A large payout on even one symbol can put a real, high floor under how low RTP can go no
 * matter how its weight is reduced — every one of the 27 (fully overlapping) paylines gets an
 * independent shot at drawing that symbol on any given spin, and 3x3=9 cells is too small a
 * board for "make it very rare" to fully offset "27 chances to hit it anyway." If the target is
 * below that floor, this search lands on the lowest-RTP weighting it can find, not the literal
 * target — the caller's own full-fidelity "Effective RTP" readout is what actually tells you
 * whether it landed close enough.
 */
export function solveSizzlingSevensRtpPercent(config: PaytableConfig, targetRtpPercent: number): TierRow[] {
  return sizzSearchGamma(config, (c) => computeSizzlingSevensStats(c, SIZZ_SEARCH_SIMS).rtpPercent, targetRtpPercent);
}

function computeSizzlingSevensRtpPercent(config: PaytableConfig): number {
  return computeSizzlingSevensStats(config).rtpPercent;
}

/** Vegas Hits only — mirrors games/VegasHits/{config,winCalc}.ts. Duplicated here (not
 * imported) since this file has no build-time link to the backend package — same convention
 * every other per-game RTP mirror in this file already follows. */
const VH_SYMBOLS = ["GREEN_7", "DOUBLE_GREEN_7", "TRIPLE_GREEN_7", "RED_7", "BLUE_7", "WILD", "BONUS"] as const;
type VhSymbol = (typeof VH_SYMBOLS)[number];
const VH_WILD: VhSymbol = "WILD";
const VH_BONUS: VhSymbol = "BONUS";
const VH_WILD_SUB = new Set<VhSymbol>(["GREEN_7", "DOUBLE_GREEN_7", "TRIPLE_GREEN_7", "RED_7", "BLUE_7"]);
/** Mirrors games/VegasHits/config.ts's DEFAULT_PAYTABLE — scaled ~0.235x down from the spec's
 * originally-requested round numbers (100/50/20/12/15), see that file's comment for why. */
const VH_DEFAULT_PAYTABLE: Record<Exclude<VhSymbol, "WILD" | "BONUS">, number> = {
  TRIPLE_GREEN_7: 23.5 * 30,
  DOUBLE_GREEN_7: 11.75 * 30,
  GREEN_7: 4.7 * 30,
  RED_7: 2.82 * 30,
  BLUE_7: 3.525 * 30,
};
/** Mirrors games/VegasHits/config.ts's DEFAULT_WILD_RULES. */
export interface VhWildRules {
  onePureBet: number;
  twoPureBet: number;
  threePureBet: number;
  oneCompleteMultiplier: number;
  twoCompleteMultiplier: number;
  anyMixBet: number;
}
/** Exported so AdminRtpPage.tsx can backfill a saved config whose document predates this field
 * (still `null` from the DB) into something immediately editable, instead of just hiding the
 * whole Wild Rules panel — same "GET response is never null for a field this game actually
 * uses" guarantee every other per-game admin panel here relies on. */
export const VH_DEFAULT_WILD_RULES: VhWildRules = {
  onePureBet: 0.47 * 30,
  twoPureBet: 1.41 * 30,
  threePureBet: 117.5 * 30,
  oneCompleteMultiplier: 3,
  twoCompleteMultiplier: 6,
  anyMixBet: 0.705 * 30,
};
const VH_LINE_COST = 30;
const VH_BONUS_TRIGGER_COUNT = 3;
const VH_SCATTER_PAYOUT_MULTIPLE_OF_BET = 1;
const VH_FREE_SPINS_PER_TRIGGER = 7;
const VH_MAX_TOTAL_FREE_SPINS = 700;
const VH_CHILI_POOL = [2, 3, 4, 5, 6, 7];
const VH_PAYLINES: [number, number, number][] = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

type VhPaytable = Record<Exclude<VhSymbol, "WILD" | "BONUS">, number>;
/** `null` means that reel has no symbol on this row — every reel shows either 1 symbol on the
 * middle row or 2 on the top+bottom rows, never all 3 (same 2-state shape as 7 Crystal Clover —
 * see games/VegasHits/engine.ts's rollReelState). */
type VhGrid = (VhSymbol | null)[][];

/** A payline is exactly 3 stops. Up to 3 candidates, highest wins — mirrors
 * games/VegasHits/winCalc.ts's evaluatePayline exactly: A) Wild(s) complete an actual matching
 * real symbol (that symbol's payout x1/oneCompleteMultiplier/twoCompleteMultiplier);
 * C) 0 Wilds, but the 3 real symbols don't all match — a flat anyMixBet. Returns
 * [finalWin, involvesWild]. */
function vhEvaluateLine(grid: VhGrid, line: [number, number, number], paytable: VhPaytable, wildRules: VhWildRules): [number, boolean] {
  const rawSymbols = line.map((row, reel) => grid[reel][row]);
  if (rawSymbols.some((s) => s === null || s === VH_BONUS)) return [0, false];
  const symbols = rawSymbols as VhSymbol[];

  const nonWild = symbols.filter((s) => s !== VH_WILD);
  const wildCount = symbols.length - nonWild.length;

  let candidateA: number | null = null;
  if (nonWild.length > 0 && nonWild.every((s) => s === nonWild[0]) && VH_WILD_SUB.has(nonWild[0])) {
    const mult = wildCount === 0 ? 1 : wildCount === 1 ? wildRules.oneCompleteMultiplier : wildRules.twoCompleteMultiplier;
    candidateA = paytable[nonWild[0] as Exclude<VhSymbol, "WILD" | "BONUS">] * mult;
  }

  const candidateC: number | null = wildCount === 0 && nonWild.length > 0 && !nonWild.every((s) => s === nonWild[0]) ? wildRules.anyMixBet : null;

  const candidates = [candidateA, candidateC].filter((c): c is number => c !== null);
  if (candidates.length === 0) return [0, false];
  return [Math.max(...candidates), wildCount > 0];
}

/** Chili Multiplier scales every win except one a Wild substituted into (see
 * games/VegasHits/winCalc.ts's calculateSpinWin) — `chiliMultiplier` is 1 for a base spin. */
function vhCalculateSpinWin(
  grid: VhGrid,
  paytable: VhPaytable,
  wildRules: VhWildRules,
  chiliMultiplier: number,
  totalBetUnits: number
): { finalWin: number; triggeredFreeGames: boolean } {
  let nonWildTotal = 0;
  let wildTotal = 0;
  for (const line of VH_PAYLINES) {
    const [win, involvesWild] = vhEvaluateLine(grid, line, paytable, wildRules);
    if (involvesWild) wildTotal += win;
    else nonWildTotal += win;
  }

  // Wilds also pay wherever they land on screen, by count (1/2/3+) — mirrors
  // games/VegasHits/api.ts's wildScatterPayout. Not Chili-multiplied, like any Wild win.
  let wildCount = 0;
  for (const col of grid) for (const s of col) if (s === VH_WILD) wildCount++;
  if (wildCount > 0) wildTotal += wildCount === 1 ? wildRules.onePureBet : wildCount === 2 ? wildRules.twoPureBet : wildRules.threePureBet;

  let scatterCount = 0;
  for (const col of grid) for (const s of col) if (s === VH_BONUS) scatterCount++;
  const scatterWin = scatterCount >= VH_BONUS_TRIGGER_COUNT ? VH_SCATTER_PAYOUT_MULTIPLE_OF_BET * totalBetUnits : 0;

  const finalWin = (nonWildTotal + scatterWin) * chiliMultiplier + wildTotal;
  return { finalWin, triggeredFreeGames: scatterCount >= VH_BONUS_TRIGGER_COUNT };
}

function vhWeightedSymbol(tiers: TierRow[], rng: () => number): VhSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = rng() * total;
  for (const t of tiers) {
    roll -= t.frequencyPercent;
    if (roll < 0) return t.key as VhSymbol;
  }
  return tiers[tiers.length - 1].key as VhSymbol;
}

/** Mirrors games/VegasHits/engine.ts's rollReelState exactly — each reel independently shows
 * either 1 symbol on the middle row or 2 on the top+bottom rows, never all 3. */
function vhDrawGrid(tiers: TierRow[], centerRowChancePercent: number, rng: () => number): VhGrid {
  const grid: VhGrid = [];
  for (let reel = 0; reel < 3; reel++) {
    const col: (VhSymbol | null)[] = [null, null, null];
    if (rng() * 100 < centerRowChancePercent) {
      col[1] = vhWeightedSymbol(tiers, rng);
    } else {
      col[0] = vhWeightedSymbol(tiers, rng);
      col[2] = vhWeightedSymbol(tiers, rng);
    }
    grid.push(col);
  }
  return grid;
}

function vhPaytableFrom(tiers: TierRow[]): VhPaytable {
  const paytable: VhPaytable = { ...VH_DEFAULT_PAYTABLE };
  for (const tier of tiers) {
    if (tier.key === VH_WILD || tier.key === VH_BONUS || tier.payoutMultiplier === null) continue;
    if (tier.key in paytable) (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
  }
  return paytable;
}

function vhWildRulesFrom(config: PaytableConfig): VhWildRules {
  return config.wildRules ?? VH_DEFAULT_WILD_RULES;
}

const VH_SIMS = 200_000;
const VH_SEARCH_SIMS = 15_000;

export interface VegasHitsStats {
  rtpPercent: number;
  lossPercent: number;
}

/** Vegas Hits' RTP and loss frequency are estimated via Monte Carlo simulation, mirroring the
 * backend's computeVegasHitsStats exactly so both sides always agree. `sims` defaults to the
 * full VH_SIMS (what's shown/validated) — pass VH_SEARCH_SIMS for a cheaper estimate while
 * iterating toward a target (see the solvers below). */
export function computeVegasHitsStats(config: PaytableConfig, sims: number = VH_SIMS): VegasHitsStats {
  const paytable = vhPaytableFrom(config.tiers);
  const wildRules = vhWildRulesFrom(config);
  const centerRowChancePercent = config.reelStateConfig?.centerRowChancePercent ?? 50;
  const rng = sizzMulberry32(0xc0ffee);
  const totalBetUnits = VH_LINE_COST;

  let total = 0;
  let lossCount = 0;
  for (let i = 0; i < sims; i++) {
    const grid = vhDrawGrid(config.tiers, centerRowChancePercent, rng);
    const ev = vhCalculateSpinWin(grid, paytable, wildRules, 1, totalBetUnits);
    total += ev.finalWin;
    if (ev.finalWin === 0) lossCount++;

    if (ev.triggeredFreeGames) {
      let remaining = VH_FREE_SPINS_PER_TRIGGER;
      let totalAwarded = VH_FREE_SPINS_PER_TRIGGER;
      let played = 0;
      while (remaining > 0 && totalAwarded <= VH_MAX_TOTAL_FREE_SPINS) {
        remaining--;
        played++;
        const freeGrid = vhDrawGrid(config.tiers, centerRowChancePercent, rng);
        const chili = VH_CHILI_POOL[Math.floor(rng() * VH_CHILI_POOL.length)];
        const freeEv = vhCalculateSpinWin(freeGrid, paytable, wildRules, chili, totalBetUnits);
        total += freeEv.finalWin;
        if (freeEv.triggeredFreeGames && totalAwarded + VH_FREE_SPINS_PER_TRIGGER <= VH_MAX_TOTAL_FREE_SPINS) {
          remaining += VH_FREE_SPINS_PER_TRIGGER;
          totalAwarded += VH_FREE_SPINS_PER_TRIGGER;
        }
        if (played > 5000) break; // safety
      }
    }
  }
  return { rtpPercent: (total / VH_LINE_COST / sims) * 100, lossPercent: (lossCount / sims) * 100 };
}

/** Reshapes all 7 symbol weights via a single power-law exponent, renormalized back to sum to
 * 100 — same mechanism as Sizzling 7s' sizzReweightByGamma (Vegas Hits has no dedicated "loss"
 * tier either: every one of its 7 rows is a real, always-drawn symbol, so a plain proportional
 * rescale can't absorb slack without breaking the sum-to-100% invariant). */
function vhReweightByGamma(tiers: TierRow[], gamma: number): TierRow[] {
  const total = tiers.reduce((sum, t) => sum + Math.pow(t.frequencyPercent, gamma), 0);
  return tiers.map((t) => ({ ...t, frequencyPercent: (Math.pow(t.frequencyPercent, gamma) / total) * 100 }));
}

/** Shared by both solvers below — weights are the only thing either one ever touches, payout
 * multipliers stay exactly as the admin set them. Mirrors Sizzling 7s' sizzSearchGamma exactly. */
function vhSearchGamma(config: PaytableConfig, evaluate: (c: PaytableConfig) => number, target: number): TierRow[] {
  let bestGamma = 1;
  let bestDiff = Infinity;
  for (const gamma of SIZZ_GAMMA_GRID) {
    const diff = Math.abs(evaluate({ ...config, tiers: vhReweightByGamma(config.tiers, gamma) }) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestGamma = gamma;
    }
  }
  for (const factor of [0.7, 0.85, 1.18, 1.4]) {
    const gamma = bestGamma * factor;
    const diff = Math.abs(evaluate({ ...config, tiers: vhReweightByGamma(config.tiers, gamma) }) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestGamma = gamma;
    }
  }
  return vhReweightByGamma(config.tiers, bestGamma);
}

/**
 * Finds a reweighting of Vegas Hits' 7 symbol weights that gets the computed RTP close to
 * `targetRtpPercent`, leaving every payoutMultiplier untouched — same principle/search as
 * solveSizzlingSevensRtpPercent (see its doc comment). A target beyond what the board can
 * structurally reach lands as close as the search can get, not at the literal number
 * requested — the caller's own full-fidelity "Effective RTP" readout is the real source of
 * truth for whether it landed close enough.
 */
export function solveVegasHitsRtpPercent(config: PaytableConfig, targetRtpPercent: number): TierRow[] {
  return vhSearchGamma(config, (c) => computeVegasHitsStats(c, VH_SEARCH_SIMS).rtpPercent, targetRtpPercent);
}

/**
 * Finds a reweighting of Vegas Hits' 7 symbol weights that gets the computed loss% (percent of
 * base spins that pay nothing at all) close to `targetLossPercent`, leaving every
 * payoutMultiplier untouched — same principle/search as solveSizzlingSevensLossPercent (see its
 * doc comment); Vegas Hits has the same "no dedicated loss row to rescale into" structural
 * constraint Sizzling 7s does (every one of its 7 rows is a real, always-drawn symbol). Effective
 * RTP shifts as a side effect (weights drive both stats at once) and is left for the admin to
 * re-set afterward via Target RTP % if they want it back.
 */
export function solveVegasHitsLossPercent(config: PaytableConfig, targetLossPercent: number): TierRow[] {
  return vhSearchGamma(config, (c) => computeVegasHitsStats(c, VH_SEARCH_SIMS).lossPercent, targetLossPercent);
}

function computeVegasHitsRtpPercent(config: PaytableConfig): number {
  return computeVegasHitsStats(config).rtpPercent;
}

/** 7 Crystal Clover only — mirrors the backend's computeCrystalCloverRtpPercent
 * (services/paytableConfig.ts) exactly. Crystal Clover is outcome-first (see
 * backEnd/src/games/CrystalClover/engine.ts's doc comment): one discrete tier rolled from
 * `tiers` (loss/simpleWin/bigWin/megaWin/jackpot), then an independent MULTIPLIER_2X roll from
 * `specialReelTiers` applied as a flat multiplier on top — both plain weighted rolls over
 * admin-set frequencies/payouts, so RTP is exact closed-form arithmetic, no simulation needed. */
function computeCrystalCloverRtpPercent(config: PaytableConfig): number {
  const baseRtp = config.tiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0), 0);
  const specialTiers = config.specialReelTiers ?? [];
  const multiplierEV = specialTiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 1), 0) || 1;
  return baseRtp * multiplierEV * 100;
}

/** Rubber Duck's 14 paying symbols and BONUS's own key — mirrors games/RubberDuck/config.ts. */
const RD_PAYING_SYMBOLS: TierKey[] = [
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
const RD_REEL_COUNT = 5;
const RD_FREE_SPIN_TRIGGER_COUNT = 3;
const RD_FREE_SPINS_BASE = 15;
const RD_FREE_SPINS_RETRIGGER = 10;
const RD_FREE_SPIN_WIN_MULTIPLIER = 3;

function rdNChooseK(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/** Mirrors the backend's computeRubberDuckRtpPercent (services/paytableConfig.ts) exactly —
 * closed-form, no simulation. Each of the 5 reels independently draws from `tiers`; every reel
 * landing a paying symbol adds that symbol's own payoutMultiplier, no matching required. See the
 * backend function's doc comment for the full derivation (base RTP + first-order free-spin/
 * retrigger EV term). */
function computeRubberDuckRtpPercent(config: PaytableConfig): number {
  const weightOf = (symbol: string) => config.tiers.find((t) => t.key === symbol)?.frequencyPercent ?? 0;
  const payoutOf = (symbol: string) => config.tiers.find((t) => t.key === symbol)?.payoutMultiplier ?? 0;

  const perReelEV = RD_PAYING_SYMBOLS.reduce((sum, symbol) => sum + (weightOf(symbol) / 100) * payoutOf(symbol), 0);
  const baseRtp = RD_REEL_COUNT * perReelEV;

  const pBonus = weightOf("BONUS") / 100;
  let pTrig = 0;
  for (let k = RD_FREE_SPIN_TRIGGER_COUNT; k <= RD_REEL_COUNT; k++) {
    pTrig += rdNChooseK(RD_REEL_COUNT, k) * Math.pow(pBonus, k) * Math.pow(1 - pBonus, RD_REEL_COUNT - k);
  }

  const avgFreeSpins = RD_FREE_SPINS_BASE * (1 + pTrig * RD_FREE_SPINS_RETRIGGER);
  const freeSpinRtp = pTrig * avgFreeSpins * (RD_FREE_SPIN_WIN_MULTIPLIER * baseRtp);

  return (baseRtp + freeSpinRtp) * 100;
}

/** Top Dollar only — how many pool draws get summed into one bonus offer (not admin-tunable,
 * kept as an engine constant on both sides — mirrors backEnd/src/games/TopDollar/config.ts's
 * OFFER_DRAW_COUNT_WEIGHTS). */
const TOP_DOLLAR_OFFER_DRAW_COUNT_WEIGHTS = [
  { count: 1, weight: 40 },
  { count: 2, weight: 40 },
  { count: 3, weight: 20 },
];

/** Top Dollar only — the lowest bet level, used as the reference bet the bonus round's flat
 * (non-bet-scaled) payouts get expressed relative to, same convention the backend's
 * computeTopDollarRtpPercent uses (see backEnd/src/services/paytableConfig.ts). */
const TOP_DOLLAR_MIN_BET = 10;

/** Mirrors the backend's computeTopDollarRtpPercent (backEnd/src/services/paytableConfig.ts) —
 * a plain line-tier EV plus the bonus round's own expected value (dollarBonus's trigger chance
 * times the bonus pool's mean offer, expressed relative to the minimum bet since bonus payouts
 * are flat dollar amounts, not bet-scaled). Without this branch, Top Dollar fell through to the
 * generic `specialReelTiers` check below and got evaluated by computeCrazy777RtpPercent, whose
 * tier keys don't match Top Dollar's dollarPool* pool — silently dropping the bonus round's
 * contribution from the displayed RTP. */
function computeTopDollarRtpPercent(config: PaytableConfig): number {
  const lineEV = config.tiers.reduce(
    (sum, t) => sum + (t.payoutMultiplier !== null ? (t.frequencyPercent / 100) * t.payoutMultiplier : 0),
    0
  );

  const bonusTier = config.tiers.find((t) => t.key === "dollarBonus");
  const bonusProb = (bonusTier?.frequencyPercent ?? 0) / 100;

  const pool = config.specialReelTiers ?? [];
  const poolTotal = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const poolMean =
    poolTotal > 0 ? pool.reduce((sum, t) => sum + (t.frequencyPercent / poolTotal) * (t.payoutMultiplier ?? 0), 0) : 0;
  const drawCountTotal = TOP_DOLLAR_OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  const eDrawCount =
    drawCountTotal > 0
      ? TOP_DOLLAR_OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + (w.weight / drawCountTotal) * w.count, 0)
      : 0;
  const eOffer = eDrawCount * poolMean;

  const bonusRtp = TOP_DOLLAR_MIN_BET > 0 ? (bonusProb * eOffer) / TOP_DOLLAR_MIN_BET : 0;

  return (lineEV + bonusRtp) * 100;
}

/** Gems Deluxe only — a duplicate of Top Dollar under a new name/id, same mechanics. Mirrors
 * TOP_DOLLAR_OFFER_DRAW_COUNT_WEIGHTS above (backEnd/src/games/GemsDeluxe/config.ts's
 * OFFER_DRAW_COUNT_WEIGHTS). */
const GEMS_DELUXE_OFFER_DRAW_COUNT_WEIGHTS = [
  { count: 1, weight: 40 },
  { count: 2, weight: 40 },
  { count: 3, weight: 20 },
];

/** Gems Deluxe only — mirrors TOP_DOLLAR_MIN_BET above. */
const GEMS_DELUXE_MIN_BET = 10;

/** Mirrors the backend's computeGemsDeluxeRtpPercent (backEnd/src/services/paytableConfig.ts) —
 * identical formula to computeTopDollarRtpPercent above, since Gems Deluxe is a duplicate game. */
function computeGemsDeluxeRtpPercent(config: PaytableConfig): number {
  const lineEV = config.tiers.reduce(
    (sum, t) => sum + (t.payoutMultiplier !== null ? (t.frequencyPercent / 100) * t.payoutMultiplier : 0),
    0
  );

  const bonusTier = config.tiers.find((t) => t.key === "dollarBonus");
  const bonusProb = (bonusTier?.frequencyPercent ?? 0) / 100;

  const pool = config.specialReelTiers ?? [];
  const poolTotal = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const poolMean =
    poolTotal > 0 ? pool.reduce((sum, t) => sum + (t.frequencyPercent / poolTotal) * (t.payoutMultiplier ?? 0), 0) : 0;
  const drawCountTotal = GEMS_DELUXE_OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  const eDrawCount =
    drawCountTotal > 0
      ? GEMS_DELUXE_OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + (w.weight / drawCountTotal) * w.count, 0)
      : 0;
  const eOffer = eDrawCount * poolMean;

  const bonusRtp = GEMS_DELUXE_MIN_BET > 0 ? (bonusProb * eOffer) / GEMS_DELUXE_MIN_BET : 0;

  return (lineEV + bonusRtp) * 100;
}

/**
 * Mirrors the backend's computeRtpPercent (backEnd/src/services/paytableConfig.ts) so the
 * admin page can show the effective RTP live, before the admin ever hits Save.
 */
export function computeRtpPercent(config: PaytableConfig): number {
  if (config.gameId === "top-dollar") {
    return computeTopDollarRtpPercent(config);
  }

  if (config.gameId === "gems-deluxe") {
    return computeGemsDeluxeRtpPercent(config);
  }

  if (config.gameId === "rubber-duck") {
    return computeRubberDuckRtpPercent(config);
  }

  if (config.gameId === "5x-rewind") {
    return computeFiveXRewindRtpPercent(config);
  }

  if (config.gameId === "sizzling-7s") {
    return computeSizzlingSevensRtpPercent(config);
  }

  if (config.gameId === "crystal-clover") {
    return computeCrystalCloverRtpPercent(config);
  }

  if (config.gameId === "vegas-hits") {
    return computeVegasHitsRtpPercent(config);
  }

  if (config.specialReelTiers) {
    return computeCrazy777RtpPercent(config);
  }

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

  return (baseRtp + freeSpinRtp) * 100;
}

export const adminApi = {
  stats: async (): Promise<AdminStats> => (await apiClient.get("/api/admin/stats")).data,

  getMaintenance: async (): Promise<MaintenanceState> => (await apiClient.get("/api/admin/maintenance")).data,

  setMaintenance: async (enabled: boolean, message: string): Promise<MaintenanceState> =>
    (await apiClient.put("/api/admin/maintenance", { enabled, message })).data,

  getGeoBlock: async (): Promise<GeoBlockState> => (await apiClient.get("/api/admin/geo-block")).data,

  setGeoBlock: async (update: { enabled?: boolean; countries?: string[]; allowIps?: string[] }): Promise<GeoBlockState> =>
    (await apiClient.put("/api/admin/geo-block", update)).data,

  updateGeoDatabase: async (): Promise<GeoBlockState> =>
    (await apiClient.post("/api/admin/geo-block/update-database")).data,

  listUsers: async (status: "active" | "deleted" | "all" = "active"): Promise<AdminUser[]> =>
    (await apiClient.get("/api/admin/users", { params: { status } })).data.users,

  onlineNow: async (): Promise<AdminUser[]> =>
    (await apiClient.get("/api/admin/users/online-now")).data.users,

  createUser: async (payload: {
    fullName?: string;
    phone?: string;
    email?: string;
    startingBalance?: number;
  }): Promise<{ user: AdminUser; credentials: { username: string; password: string } }> =>
    (await apiClient.post("/api/admin/users", payload)).data,

  getUser: async (
    id: string
  ): Promise<{
    user: AdminUser;
    balanceHistory: BalanceAdjustmentEntry[];
    spins: SpinEntry[];
    pendingForcedOutcomes: ForcedOutcomeEntry[];
  }> => (await apiClient.get(`/api/admin/users/${id}`)).data,

  updateUser: async (
    id: string,
    payload: { fullName?: string | null; phone?: string | null; email?: string | null }
  ): Promise<AdminUser> => (await apiClient.patch(`/api/admin/users/${id}`, payload)).data.user,

  resetPassword: async (id: string): Promise<{ username: string; password: string }> =>
    (await apiClient.post(`/api/admin/users/${id}/reset-password`)).data.credentials,

  disableUser: async (id: string, disabled: boolean): Promise<AdminUser> =>
    (await apiClient.patch(`/api/admin/users/${id}/disable`, { disabled })).data.user,

  deleteUser: async (id: string): Promise<AdminUser> =>
    (await apiClient.patch(`/api/admin/users/${id}/delete`)).data.user,

  purgeUser: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/admin/users/${id}/purge`);
  },

  adjustBalance: async (id: string, action: "add" | "remove", amount: number): Promise<AdminUser> =>
    (await apiClient.post(`/api/admin/users/${id}/balance-adjustments`, { action, amount })).data.user,

  getBalanceReport: async (filters: BalanceReportFilters, page: number): Promise<BalanceReportResponse> =>
    (await apiClient.get("/api/admin/balance-report", { params: { ...filters, page } })).data,

  exportBalanceReport: async (filters: BalanceReportFilters): Promise<Blob> =>
    (await apiClient.get("/api/admin/balance-report/export", { params: filters, responseType: "blob" })).data,

  createForcedOutcome: async (userId: string, gameId: string, targetTier: string): Promise<ForcedOutcomeEntry> =>
    (await apiClient.post("/api/admin/forced-outcomes", { userId, gameId, targetTier })).data.forcedOutcome,

  listForcedOutcomes: async (filter?: {
    userId?: string;
    gameId?: string;
    status?: ForcedOutcomeStatus;
  }): Promise<ForcedOutcomeEntry[]> =>
    (await apiClient.get("/api/admin/forced-outcomes", { params: filter })).data.forcedOutcomes,

  cancelForcedOutcome: async (id: string): Promise<ForcedOutcomeEntry> =>
    (await apiClient.patch(`/api/admin/forced-outcomes/${id}/cancel`)).data.forcedOutcome,

  getGameSettings: async (gameId: string): Promise<{ gameId: string; rtpMultiplier: number }> =>
    (await apiClient.get(`/api/admin/game-settings/${gameId}`)).data,

  updateGameSettings: async (
    gameId: string,
    rtpMultiplier: number
  ): Promise<{ gameId: string; rtpMultiplier: number }> =>
    (await apiClient.patch(`/api/admin/game-settings/${gameId}`, { rtpMultiplier })).data,

  getEarnings: async (range: EarningsRange, gameId?: string): Promise<EarningsResponse> =>
    (await apiClient.get("/api/admin/earnings", { params: { range, gameId } })).data,

  recentSpins: async (filter?: { username?: string; gameId?: string; limit?: number }): Promise<SpinEntry[]> =>
    (await apiClient.get("/api/admin/spins/recent", { params: filter })).data.spins,

  getSseTicket: async (): Promise<string> => (await apiClient.get("/api/admin/sse-events-ticket")).data.ticket,

  getPaytable: async (
    gameId: string
  ): Promise<{ config: PaytableConfig; computedRtpPercent: number; valid: boolean }> =>
    (await apiClient.get(`/api/admin/paytable/${gameId}`)).data,

  updatePaytable: async (
    gameId: string,
    config: PaytableConfig
  ): Promise<{ config: PaytableConfig; computedRtpPercent: number; valid: boolean }> =>
    (await apiClient.put(`/api/admin/paytable/${gameId}`, config)).data,

  getFishGameConfig: async (): Promise<FishGameAdminConfig> =>
    (await apiClient.get("/api/admin/fish-game/config")).data,

  updateFishGameConfig: async (
    rtpPercent: number,
    speciesMultipliers: Record<string, number>
  ): Promise<FishGameAdminConfig> =>
    (await apiClient.put("/api/admin/fish-game/config", { rtpPercent, speciesMultipliers })).data,

  getFishGameStats: async (range: FishStatsRange): Promise<FishGameStats> =>
    (await apiClient.get("/api/admin/fish-game/stats", { params: { range } })).data,

  listFishGameSessions: async (range: FishStatsRange, limit = 50): Promise<FishGameSessionRow[]> =>
    (await apiClient.get("/api/admin/fish-game/sessions", { params: { range, limit } })).data.sessions,

  getJackpotOverview: async (): Promise<JackpotOverview> => (await apiClient.get("/api/admin/jackpot")).data,

  updateJackpotSettings: async (settings: JackpotSettings): Promise<void> => {
    await apiClient.put("/api/admin/jackpot/settings", settings);
  },

  createJackpotHit: async (payload: JackpotHitInput & { tier: JackpotTierKey }): Promise<void> => {
    await apiClient.post("/api/admin/jackpot/hits", payload);
  },

  updateJackpotHit: async (id: string, payload: JackpotHitInput): Promise<void> => {
    await apiClient.patch(`/api/admin/jackpot/hits/${id}`, payload);
  },

  updateJackpotAuto: async (tier: JackpotTierKey, payload: { enabled: boolean; userId: string | null }): Promise<void> => {
    await apiClient.put(`/api/admin/jackpot/auto/${tier}`, payload);
  },

  retryJackpotHit: async (id: string): Promise<void> => {
    await apiClient.patch(`/api/admin/jackpot/hits/${id}/retry`);
  },

  cancelJackpotHit: async (id: string): Promise<void> => {
    await apiClient.patch(`/api/admin/jackpot/hits/${id}/cancel`);
  },

  listJackpotHistory: async (): Promise<JackpotHistoryEntry[]> =>
    (await apiClient.get("/api/admin/jackpot/history")).data.history,
};

export type JackpotTierKey = "jackpot" | "mega" | "major" | "mini";

export interface JackpotSettings {
  amounts: Record<JackpotTierKey, number>;
  baseContributionPercent: number;
  poolGames: string[];
}

export type JackpotHitStatus = "scheduled" | "locked";

export interface JackpotActiveHit {
  _id: string;
  amount: number;
  scheduledAt: string;
  status: JackpotHitStatus;
  /** date: scheduled by an admin; auto: created when the tier reached its max in Auto mode. */
  trigger: "date" | "auto";
  /** A payout try was rejected; it waits for an admin Retry (the tier keeps its balance). */
  paymentFailed: boolean;
  lastError: string | null;
  winnerMode: "random" | "player";
  userId: string | null;
  username: string | null;
}

export interface JackpotTierOverview {
  key: JackpotTierKey;
  label: string;
  /** Auto mode: hits by itself every time the tier reaches its max. `userId` is the next round's
   * picked winner (null = random). */
  auto: { enabled: boolean; userId: string | null; username: string | null };
  /** The tier's max — it stops filling here. */
  amount: number;
  /** Collected so far — what a winner would get right now. */
  balance: number;
  fillPercent: number;
  /** Estimated minutes until it reaches its max at the current rate; null when nothing is coming in. */
  minutesToFull: number | null;
  hit: JackpotActiveHit | null;
}

export interface JackpotOverview {
  settings: JackpotSettings;
  contributionPercent: number;
  wagerPerMinute: number;
  tiers: JackpotTierOverview[];
  poolPlayers: { userId: string; username: string; gameId: string }[];
}

export interface JackpotHitInput {
  scheduledAt?: string;
  winnerMode?: "random" | "player";
  userId?: string | null;
}

export interface JackpotHistoryEntry {
  _id: string;
  tier: JackpotTierKey;
  label: string;
  amount: number;
  winnerMode: "random" | "player";
  trigger: "date" | "auto";
  userId: string | null;
  username: string | null;
  gameId: string | null;
  scheduledAt: string;
  paidAt: string | null;
  /** paid; failed = waiting for an admin Retry; retrying = retried, waiting for the winner. */
  result: "paid" | "failed" | "retrying";
  attempts: { at: string; gameId: string | null; ok: boolean; amount: number | null; reason: string | null }[];
}

export interface FishGameSessionRow {
  id: string;
  userId: string | null;
  username: string;
  status: "active" | "closed";
  closeReason: "exit" | "idle" | "timeout" | "replaced" | null;
  startBalance: number;
  endBalance: number | null;
  hits: number;
  kills: number;
  wagered: number;
  won: number;
  startedAt: string;
  endedAt: string | null;
  lastActivityAt: string;
}

export interface FishGameAdminConfig {
  rtpPercent: number;
  species: { id: string; name: string; multiplier: number; defaultMultiplier: number }[];
  limits: { minRtpPercent: number; maxRtpPercent: number; minMultiplier: number; maxMultiplier: number };
}

export type FishStatsRange = "today" | "week" | "month" | "all";

export interface FishGameStats {
  range: FishStatsRange;
  totals: {
    hits: number;
    kills: number;
    wagered: number;
    paidOut: number;
    net: number;
    rtpActual: number;
    sessions: number;
    activeSessions: number;
  };
  species: { speciesId: string; hits: number; kills: number; wagered: number; paidOut: number; rtpActual: number }[];
}
