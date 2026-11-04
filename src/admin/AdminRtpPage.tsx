import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import {
  adminApi,
  PaytableConfig,
  TierKey,
  TierRow,
  CelebrationTier,
  computeRtpPercent,
  computeVegasHitsStats,
  solveVegasHitsLossPercent,
  solveVegasHitsRtpPercent,
  VH_DEFAULT_WILD_RULES,
} from "./adminApi";
import { gameRegistry } from "../games/registry";

const CELEBRATION_OPTIONS: { value: CelebrationTier | null; label: string }[] = [
  { value: null, label: "Simple Win (no overlay)" },
  { value: "BIG WIN", label: "Big Win" },
  { value: "MEGA WIN", label: "Mega Win" },
  { value: "JACKPOT", label: "Jackpot" },
];

const TIER_LABELS: Record<TierKey, string> = {
  loss: "Loss",
  freeSpin: "Free Spin",
  simpleWin: "Simple Win",
  bigWin: "Big Win",
  megaWin: "Mega Win",
  jackpot: "Jackpot",
  zeroRespin: "Zero Respin",
  ten: "3x 10",
  jack: "3x Jack",
  queen: "3x Queen",
  king: "3x King",
  ace: "3x Ace",
  bull: "3x Bull",
  anyBar: "3x Any Bar",
  singleBar: "3x Single Bar",
  doubleBar: "3x Double Bar",
  tripleBar: "3x Triple Bar",
  moneyBag: "3x Money Bag",
  coin: "3x Gold Coins",
  sevenLow: "3x 7",
  sevenMid: "3x 77",
  sevenHigh: "3x 777",
  anySeven: "Any 3 Sevens (mixed)",
  anyGlobal: "Any mix of 7s & Bars",
  multiplier2x: "Special: 2X",
  multiplier5x: "Special: 5X",
  multiplier10x: "Special: 10X",
  dollarPlus: "Special: $+",
  doubleDollarPlus: "Special: $$+",
  respin: "Special: RESPIN",
  specialEmpty: "Special: — (no bonus)",
  multiplier4x: "Special: 4X",
  multiplier8x: "Special: 8X",
  whiteBar: "WHITE-BAR x3",
  sevenBar: "7-BAR (WHITE 7-BAR) x3",
  redBar: "RED-BAR x3",
  purpleBar: "PURPLE-BAR x3",
  red7: "RED-7 x3",
  purple7: "PURPLE-7 x3",
  blue7: "BLUE-7 x3",
  any3BarOnly: "Any 3 Bar (no 7-BAR, mixed)",
  any3BarWithSevenBar: "Any 3 Bar + 7-BAR (mixed)",
  any3Sevens: "Any 3 Sevens (mixed)",
  noCoin: "No coin (this reel)",
  coin2x: "2X coin",
  coin3x: "3X coin",
  coin4x: "4X coin",
  coin5x: "5X coin",
  RED_7: "RED 7 (weight + 3x pay)",
  BLUE_7: "BLUE 7 (weight + 3x pay)",
  BAR: "BAR (weight + 3x pay)",
  DOUBLE_BAR: "DOUBLE BAR (weight + 3x pay)",
  TRIPLE_BAR: "TRIPLE BAR (weight + 3x pay)",
  WILD_2X: "2X WILD (weight + 3-Wild pay)",
  BONUS: "BONUS (weight + scatter pay)",
  SEVEN_CLOVER: "7 Crystal Clover (weight + 3x pay)",
  WILD: "WILD (weight + pure-Wild pay)",
  MULTIPLIER_2X: "2X Multiplier (weight only)",
  apple: "3x Apple",
  lemon: "3x Lemon",
  orange: "3x Orange",
  peach: "3x Peach",
  pineapple: "3x Pineapple",
  grape: "3x Grape",
  watermelon: "3x Watermelon",
  dragonFruit: "3x Dragon Fruit",
  seven: "3x Seven",
  bar: "3x Bar",
  star: "3x Star",
  tenX: "3x 10X PAY",
  threeX: "3x 3X PAY",
  cherry: "3x Cherry",
  any3SevenSevenBar: "Any 3 (7 / 7-BAR mixed)",
  any3SingleBarSevenBar: "Any 3 (Single Bar / 7-BAR mixed)",
  any3BarFamilyMix: "Any 3 (Bar family mixed)",
  twoCherry: "2x Cherry (on the line)",
  oneCherry: "1x Cherry (on the line)",
  GREEN_7: "1 Green 7 (weight + 3x pay)",
  DOUBLE_GREEN_7: "2 Green 7s (weight + 3x pay)",
  TRIPLE_GREEN_7: "3 Green 7s (weight + 3x pay)",
  AEROPLANE: "Aeroplane (weight only)",
  BOAT: "Boat (weight only)",
  CAR: "Car (weight only)",
  RING: "Ring (weight only)",
  MONEY: "Money (weight only)",
  WATCH: "Watch (weight only)",
  GOLD_BAR: "Gold Bar (weight only)",
  SILVER_BAR: "Silver Bar (weight only)",
  BRONZE_BAR: "Bronze Bar (weight only)",
  COIN: "Coin (independent scatter chance)",
  TRIPLE_7: "Triple 7 (weight + direct pay)",
  DOUBLE_7: "Double 7 (weight + direct pay)",
  SEVEN: "Seven (weight + direct pay)",
  GUN: "Water Gun (weight + direct pay)",
  TOOL: "Tool (weight + direct pay)",
  SHAMPOO: "Shampoo (weight + direct pay)",
  TOWEL: "Towel (weight + direct pay)",
  BRUSH: "Brush (weight + direct pay)",
  SAFEGUARD: "Safeguard Soap (weight + direct pay)",
  CAP: "Cap (weight + direct pay)",
  POT: "Pot (weight + direct pay)",
  SOAP: "Soap (weight + direct pay)",
  SPONGE: "Sponge (weight + direct pay)",
  AVOCADO: "Avocado (loss fruit — weight only)",
  BANANA: "Banana (loss fruit — weight only)",
  COCONUT: "Coconut (loss fruit — weight only)",
  GRAPES: "Grapes (loss fruit — weight only)",
  LEMON: "Lemon (loss fruit — weight only)",
  STRAWBERRY: "Strawberry (loss fruit — weight only)",
  diamondOne: "1x Diamond (anywhere)",
  diamondTwo: "2x Diamond (anywhere)",
  diamondThree: "3x Diamond (anywhere)",
  dollarBonus: "$ Bonus Trigger",
  dollarPoolFive: "Bonus pool: $5",
  dollarPoolTen: "Bonus pool: $10",
  dollarPoolTwenty: "Bonus pool: $20",
  dollarPoolFifty: "Bonus pool: $50",
  dollarPoolHundred: "Bonus pool: $100",
  dollarPoolThousand: "Bonus pool: $1000",
};

const SHAMROCK_RULE_LABELS: Record<string, string> = {
  WILD_JACKPOT: "3× Shamrock Spin (wild)",
  GREEN_SEVEN: "3× Green 7",
  ORANGE_SEVEN: "3× Orange 7",
  YELLOW_SEVEN: "3× Yellow 7",
  TRIPLE_BAR: "3× BAR BAR BAR",
  ANY_SEVENS: "Any 3 Sevens",
  ANY_BARS: "Any 3 BARs",
  SINGLE_BAR: "3× BAR",
  TWO_WILDS: "2 Wilds + Any",
  ONE_WILD: "1 Wild + Any + Any",
};

/** 7 Crystal Clover only — which symbol combo cosmetically renders for each rule id (see
 * backEnd/src/games/CrystalClover/config.ts's WIN_RULE_IDS) — purely decorative, payout comes
 * from whichever tier the rule is mapped to below, not from the id itself. */
const CRYSTAL_CLOVER_RULE_LABELS: Record<string, string> = {
  SEVEN_CLOVER: "3× 7 Crystal Clover",
  TRIPLE_BAR: "3× TRIPLE BAR",
  DOUBLE_BAR: "3× DOUBLE BAR",
  BAR: "3× BAR",
  ANY_BAR: "Any 3 Bars (mixed)",
  ONE_WILD: "1 Wild + Any + Any",
  TWO_WILD: "2 Wilds + Any",
  THREE_WILD: "3× WILD",
};

const CRYSTAL_CLOVER_RULE_IMAGES: Record<string, string> = {
  SEVEN_CLOVER: "/symbols/crystalClover/7clover.webp",
  TRIPLE_BAR: "/symbols/crystalClover/trippleBar.webp",
  DOUBLE_BAR: "/symbols/crystalClover/doubleBar.webp",
  BAR: "/symbols/crystalClover/bar.webp",
  ANY_BAR: "/symbols/crystalClover/bar.webp",
  ONE_WILD: "/symbols/crystalClover/wild.webp",
  TWO_WILD: "/symbols/crystalClover/wild.webp",
  THREE_WILD: "/symbols/crystalClover/wild.webp",
};

/** Buffalo 777 only — the actual reel symbol image for each tier, where one exists 1:1
 * ("Any Bar"/"Loss" have no single symbol, so no image). */
const TIER_IMAGES: Partial<Record<TierKey, string>> = {
  ten: "/symbols/buffalo777/10.png",
  jack: "/symbols/buffalo777/J.png",
  queen: "/symbols/buffalo777/Q.png",
  king: "/symbols/buffalo777/K.png",
  ace: "/symbols/buffalo777/A.png",
  anyBar: "/symbols/buffalo777/ANY.png",
  bull: "/symbols/buffalo777/bull.png",
  singleBar: "/symbols/buffalo777/SingleBar.png",
  doubleBar: "/symbols/buffalo777/DoubleBar.png",
  tripleBar: "/symbols/buffalo777/TripleBar.png",
  moneyBag: "/symbols/buffalo777/MoneyBag.png",
  coin: "/symbols/buffalo777/Coin.png",
  sevenLow: "/symbols/carzy777/7.webp",
  sevenMid: "/symbols/carzy777/77.webp",
  sevenHigh: "/symbols/carzy777/777.webp",
  multiplier2x: "/symbols/carzy777/2X.webp",
  multiplier5x: "/symbols/carzy777/5X.webp",
  multiplier10x: "/symbols/carzy777/10X.webp",
  dollarPlus: "/symbols/carzy777/singleDollar.webp",
  doubleDollarPlus: "/symbols/carzy777/doubleDollar.webp",
  respin: "/symbols/carzy777/respin.webp",
  whiteBar: "/symbols/5xRewind/WHITE-BAR.webp",
  sevenBar: "/symbols/5xRewind/7-BAR.webp",
  redBar: "/symbols/5xRewind/RED-BAR.webp",
  purpleBar: "/symbols/5xRewind/PURPLE-BAR.webp",
  red7: "/symbols/5xRewind/RED-7.webp",
  purple7: "/symbols/5xRewind/PURPLE-7.webp",
  blue7: "/symbols/5xRewind/BLUE-7.webp",
  coin2x: "/symbols/5xRewind/2X-coin.webp",
  coin3x: "/symbols/5xRewind/3X-coin.webp",
  coin4x: "/symbols/5xRewind/4X-coin.webp",
  coin5x: "/symbols/5xRewind/5X-coin.webp",
  any3BarOnly: "/symbols/5xRewind/WHITE-BAR.webp",
  any3BarWithSevenBar: "/symbols/5xRewind/7-BAR.webp",
  any3Sevens: "/symbols/5xRewind/RED-7.webp",
  RED_7: "/symbols/sizzling7s/red-7.png",
  BLUE_7: "/symbols/sizzling7s/blue-7.png",
  BAR: "/symbols/sizzling7s/bar.png",
  DOUBLE_BAR: "/symbols/sizzling7s/bar2.png",
  TRIPLE_BAR: "/symbols/sizzling7s/bar3.png",
  WILD_2X: "/symbols/sizzling7s/2xWild.png",
  BONUS: "/symbols/sizzling7s/bonus.png",
  SEVEN_CLOVER: "/symbols/crystalClover/7clover.webp",
  WILD: "/symbols/crystalClover/wild.webp",
  MULTIPLIER_2X: "/symbols/crystalClover/2X.webp",
  GREEN_7: "/symbols/vegasHit/Green7.webp",
  DOUBLE_GREEN_7: "/symbols/vegasHit/DoubleGreen7.webp",
  TRIPLE_GREEN_7: "/symbols/vegasHit/TripleGreen7.webp",
  AEROPLANE: "/symbols/lifeOfLuxury/aeroplane.webp",
  BOAT: "/symbols/lifeOfLuxury/boat.webp",
  CAR: "/symbols/lifeOfLuxury/car.webp",
  RING: "/symbols/lifeOfLuxury/ring.webp",
  MONEY: "/symbols/lifeOfLuxury/money.webp",
  WATCH: "/symbols/lifeOfLuxury/watch.webp",
  GOLD_BAR: "/symbols/lifeOfLuxury/goldBar.webp",
  SILVER_BAR: "/symbols/lifeOfLuxury/silverBar.webp",
  BRONZE_BAR: "/symbols/lifeOfLuxury/bronzeBar.webp",
  COIN: "/symbols/lifeOfLuxury/coin.webp",
  TRIPLE_7: "/symbols/rubberDuck/tripple7.webp",
  DOUBLE_7: "/symbols/rubberDuck/double7.webp",
  SEVEN: "/symbols/rubberDuck/7.webp",
  GUN: "/symbols/rubberDuck/gun.webp",
  TOOL: "/symbols/rubberDuck/tool.webp",
  SHAMPOO: "/symbols/rubberDuck/shampoo.webp",
  TOWEL: "/symbols/rubberDuck/towel.webp",
  BRUSH: "/symbols/rubberDuck/brush.webp",
  SAFEGUARD: "/symbols/rubberDuck/saveGaurd.webp",
  CAP: "/symbols/rubberDuck/cap.webp",
  POT: "/symbols/rubberDuck/pot.webp",
  SOAP: "/symbols/rubberDuck/soap.webp",
  SPONGE: "/symbols/rubberDuck/sponch.webp",
  AVOCADO: "/symbols/rubberDuck/avacado.webp",
  BANANA: "/symbols/rubberDuck/banana.webp",
  COCONUT: "/symbols/rubberDuck/coconut.webp",
  GRAPES: "/symbols/rubberDuck/grapes.webp",
  LEMON: "/symbols/rubberDuck/lemon.webp",
  STRAWBERRY: "/symbols/rubberDuck/strawberry.webp",
};

/** 7 Crystal Clover reuses Sizzling 7s' "BAR"/"DOUBLE_BAR"/"TRIPLE_BAR" tier keys (each game's
 * `tiers` array is independent — see backend models/PaytableConfig.ts), but the two games have
 * their own distinct bar artwork, so TIER_IMAGES (a flat, game-agnostic map) can't hold both at
 * once for the same key. This per-game override wins over TIER_IMAGES when present — see
 * tierImage() below, used everywhere TIER_IMAGES would otherwise be looked up directly. */
const GAME_TIER_IMAGE_OVERRIDES: Partial<Record<string, Partial<Record<TierKey, string>>>> = {
  "crystal-clover": {
    BAR: "/symbols/crystalClover/bar.webp",
    DOUBLE_BAR: "/symbols/crystalClover/doubleBar.webp",
    TRIPLE_BAR: "/symbols/crystalClover/trippleBar.webp",
    // specialReelTiers (the MULTIPLIER_2X roll) — same icon at every level, the row label
    // already says which multiplier it is.
    specialEmpty: "/symbols/crystalClover/2X.webp",
    multiplier2x: "/symbols/crystalClover/2X.webp",
    multiplier4x: "/symbols/crystalClover/2X.webp",
    multiplier8x: "/symbols/crystalClover/2X.webp",
  },
  // Vegas Hits reuses Sizzling 7s' "RED_7"/"BLUE_7"/"BONUS" and Crystal Clover's "WILD" tier
  // keys, but has its own distinct artwork for all 4.
  "vegas-hits": {
    RED_7: "/symbols/vegasHit/Red7.webp",
    BLUE_7: "/symbols/vegasHit/Blue7.webp",
    WILD: "/symbols/vegasHit/redHot.webp",
    BONUS: "/symbols/vegasHit/Bonus.webp",
  },
  // Life of Luxury's own wild (daimond.png), distinct from Crystal Clover/Vegas Hits' artwork.
  "life-of-luxury": {
    WILD: "/symbols/lifeOfLuxury/daimond.webp",
  },
  // Final Thing is a replica of Life of Luxury under a new name/id — same tier keys, artwork
  // served from its own symbols folder (frontEnd/public/symbols/theFinerThing/).
  "the-finer-thing": {
    AEROPLANE: "/symbols/theFinerThing/aeroplane.webp",
    BOAT: "/symbols/theFinerThing/boat.webp",
    CAR: "/symbols/theFinerThing/car.webp",
    RING: "/symbols/theFinerThing/ring.webp",
    MONEY: "/symbols/theFinerThing/money.webp",
    WATCH: "/symbols/theFinerThing/watch.webp",
    GOLD_BAR: "/symbols/theFinerThing/goldBar.webp",
    SILVER_BAR: "/symbols/theFinerThing/silverBar.webp",
    BRONZE_BAR: "/symbols/theFinerThing/bronzeBar.webp",
    COIN: "/symbols/theFinerThing/coin.webp",
    WILD: "/symbols/theFinerThing/daimond.webp",
  },
  // Rubber Duck reuses Life of Luxury's "BOAT" and Sizzling 7s' "BONUS" tier keys, but has its
  // own distinct artwork for both.
  "rubber-duck": {
    BOAT: "/symbols/rubberDuck/boat.webp",
    BONUS: "/symbols/rubberDuck/bonus.webp",
  },
  // Top Dollar reuses "seven"/"tripleBar"/"doubleBar"/"singleBar"/"anyBar" from Buffalo 777 /
  // 777 Fruity / 5x Rewind's shared tier keys, but has its own distinct artwork for all of them
  // (frontEnd/public/symbols/dollarGame/) — without this override those rows fell back to
  // TIER_IMAGES' Buffalo 777 art (or, for "seven", no image at all). diamondOne/Two/Three and
  // dollarBonus/dollarPool* are Top Dollar-only keys with no TIER_IMAGES entry to fall back to.
  "top-dollar": {
    seven: "/symbols/dollarGame/7.webp",
    tripleBar: "/symbols/dollarGame/TripleBar.webp",
    doubleBar: "/symbols/dollarGame/doubleBar.webp",
    singleBar: "/symbols/dollarGame/singleBar.webp",
    anyBar: "/symbols/dollarGame/singleBar.webp",
    diamondOne: "/symbols/dollarGame/daimond.webp",
    diamondTwo: "/symbols/dollarGame/daimond.webp",
    diamondThree: "/symbols/dollarGame/daimond.webp",
    dollarBonus: "/symbols/dollarGame/dollar.webp",
    dollarPoolFive: "/symbols/dollarGame/dollar.webp",
    dollarPoolTen: "/symbols/dollarGame/dollar.webp",
    dollarPoolTwenty: "/symbols/dollarGame/dollar.webp",
    dollarPoolFifty: "/symbols/dollarGame/dollar.webp",
    dollarPoolHundred: "/symbols/dollarGame/dollar.webp",
    dollarPoolThousand: "/symbols/dollarGame/dollar.webp",
  },
  // Gems Deluxe is a duplicate of Top Dollar under a new name/id — same tier keys, same
  // placeholder artwork, now served from its own symbols folder (frontEnd/public/symbols/
  // gemsDeluxe/) until real gem art replaces it.
  "gems-deluxe": {
    seven: "/symbols/gemsDeluxe/7.webp",
    tripleBar: "/symbols/gemsDeluxe/TripleBar.webp",
    doubleBar: "/symbols/gemsDeluxe/doubleBar.webp",
    singleBar: "/symbols/gemsDeluxe/singleBar.webp",
    anyBar: "/symbols/gemsDeluxe/singleBar.webp",
    diamondOne: "/symbols/gemsDeluxe/daimond.webp",
    diamondTwo: "/symbols/gemsDeluxe/daimond.webp",
    diamondThree: "/symbols/gemsDeluxe/daimond.webp",
    dollarBonus: "/symbols/gemsDeluxe/dollar.webp",
    dollarPoolFive: "/symbols/gemsDeluxe/dollar.webp",
    dollarPoolTen: "/symbols/gemsDeluxe/dollar.webp",
    dollarPoolTwenty: "/symbols/gemsDeluxe/dollar.webp",
    dollarPoolFifty: "/symbols/gemsDeluxe/dollar.webp",
    dollarPoolHundred: "/symbols/gemsDeluxe/dollar.webp",
    dollarPoolThousand: "/symbols/gemsDeluxe/dollar.webp",
  },
};

function tierImage(gameId: string, key: TierKey): string | undefined {
  return GAME_TIER_IMAGE_OVERRIDES[gameId]?.[key] ?? TIER_IMAGES[key];
}

/** Shamrock Spin only — the reel symbol image for each win rule. */
const SHAMROCK_RULE_IMAGES: Record<string, string> = {
  WILD_JACKPOT: "/symbols/shamrockSpin/Shamrock Spin.webp",
  GREEN_SEVEN: "/symbols/shamrockSpin/Green 7.webp",
  ORANGE_SEVEN: "/symbols/shamrockSpin/Orange 7.webp",
  YELLOW_SEVEN: "/symbols/shamrockSpin/Yellow 7.webp",
  TRIPLE_BAR: "/symbols/shamrockSpin/BAR BAR BAR.webp",
  ANY_SEVENS: "/symbols/shamrockSpin/Green 7.webp",
  ANY_BARS: "/symbols/shamrockSpin/BAR.webp",
  SINGLE_BAR: "/symbols/shamrockSpin/BAR.webp",
  TWO_WILDS: "/symbols/shamrockSpin/Shamrock Spin.webp",
  ONE_WILD: "/symbols/shamrockSpin/Shamrock Spin.webp",
};

const WIN_TIER_KEYS: TierKey[] = ["simpleWin", "bigWin", "megaWin", "jackpot"];

/** Vegas Hits only — expresses every payoutMultiplier relative to a fixed internal LINE_COST
 * reference (see its own backend config.ts), not as a direct bet multiplier the way every
 * other game's payoutMultiplier is. The "Payout (x bet)" column below edits that raw internal
 * number as-is (it's what's actually stored), but shows the real x-bet conversion
 * (payoutMultiplier / LINE_COST) alongside it so it doesn't read as a multiplier ~30x too
 * large. */
const LINE_COST_BY_GAME: Partial<Record<string, number>> = {
  "vegas-hits": 30,
};

function inputClass(invalid = false): string {
  return `w-24 rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

// Buffalo777, Sizzling 7s, Life of Luxury, and Shamrock Spin all run fully client-side now (no
// backend paytable document to fetch/save — see their own dedicated AdminBuffaloRtpPage/
// AdminSizzlingRtpPage/AdminLifeOfLuxuryRtpPage/AdminShamrockRtpPage, which read and write
// localStorage instead), so this page — which only knows how to talk to the backend paytable
// service — would 404/500 on any of them. Excluded here rather than left to be discovered by a
// broken tab click. (Crystal Clover still uses this page's own ruleTierMap/celebrationMap/
// freeSpinsGranted JSX blocks below — those stay generic/shared, not deleted.)
const OFFLINE_GAME_SLUGS = new Set([
  "buffalo-777",
  "sizzling-7s",
  "life-of-luxury",
  "the-finer-thing",
  "shamrock-spin",
  "crazy-777",
  "5x-rewind",
  "cash-machine",
  "crystal-clover",
  "fruity-777",
  "gems-deluxe",
  "mega-10x-pay",
  "rubber-duck",
  "vegas-hits",
  "top-dollar",
]);
const RTP_CONTROLLED_GAMES = gameRegistry.filter((g) => !OFFLINE_GAME_SLUGS.has(g.slug));

export function AdminRtpPage() {
  const [gameId, setGameId] = useState(RTP_CONTROLLED_GAMES[0]?.slug ?? "");
  const [config, setConfig] = useState<PaytableConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedOk, setSavedOk] = useState(false);
  // Sizzling 7s' RTP/loss solvers (see adminApi.ts) run a dozen-plus Monte Carlo passes
  // synchronously — cheap enough not to need a Web Worker, but slow enough (up to ~1-2s) to
  // want a visible "Solving..." state rather than just freezing the page with no feedback.
  const [solving, setSolving] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    setConfig(null);
    setSaveErrors([]);
    setSavedOk(false);
    adminApi.getPaytable(gameId).then((res) => {
      // A document saved before wildRules/reelStateConfig existed still has them as `null` from
      // the DB — the live game itself falls back fine (see games/VegasHits/engine.ts), but this
      // page's panels for them are gated on the field being non-null, so without this backfill
      // they'd just silently not render instead of showing editable defaults.
      const config =
        gameId === "vegas-hits"
          ? {
              ...res.config,
              wildRules: res.config.wildRules ?? VH_DEFAULT_WILD_RULES,
              reelStateConfig: res.config.reelStateConfig ?? { centerRowChancePercent: 50 },
            }
          : res.config;
      setConfig(config);
    });
  }, [gameId]);

  const hasFreeSpin = config?.tiers.some((t) => t.key === "freeSpin") ?? false;
  // Vegas Hits has no dedicated "loss" tier (every row is a real, always-drawn reel symbol —
  // see its own config.ts comment), so its RTP and loss% both come from the same (expensive,
  // 200k-sim) Monte Carlo pass — compute it once here and reuse, rather than calling
  // computeRtpPercent (which would re-run the whole simulation a second time) separately below.
  const simStats = config && gameId === "vegas-hits" ? computeVegasHitsStats(config) : null;
  const computedRtp = simStats ? simStats.rtpPercent : config ? computeRtpPercent(config) : 0;
  const frequencySum = config ? config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0) : 0;
  const frequencyValid = Math.abs(frequencySum - 100) <= 0.01;
  const rtpValid = config ? Math.abs(computedRtp - config.targetRtpPercent) <= 0.5 : false;
  // null targetLossPercent means the admin hasn't set one yet (or this doc predates the
  // feature) — nothing to validate against, so it doesn't block Save, mirroring the backend's
  // own "null = feature unused" check in validatePaytableConfig.
  const lossValid =
    !simStats || config?.targetLossPercent === null || config?.targetLossPercent === undefined
      ? true
      : Math.abs(simStats.lossPercent - config.targetLossPercent) <= 1.0;
  const specialFrequencySum = config?.specialReelTiers?.reduce((sum, t) => sum + t.frequencyPercent, 0) ?? 100;
  const specialFrequencyValid = !config?.specialReelTiers || Math.abs(specialFrequencySum - 100) <= 0.01;
  const isValid = frequencyValid && rtpValid && lossValid && specialFrequencyValid && !solving;

  // Plain, direct field edit — frequency and payout ("x bet") values are the admin's own fixed
  // truth and are never auto-touched by anything else on this page. Target RTP %/Target Loss %
  // are the only fields that trigger an automatic solve (see setTargetRtp/setTargetLoss below),
  // and for Vegas Hits that solve only ever reshapes the *weights*, never the payouts.
  function updateTier(key: TierKey, patch: Partial<TierRow>) {
    if (!config) return;
    setSavedOk(false);
    setConfig({
      ...config,
      tiers: config.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    });
  }

  function updateCelebration(key: TierKey, value: CelebrationTier | null) {
    if (!config) return;
    setSavedOk(false);
    setConfig({ ...config, celebrationMap: { ...config.celebrationMap, [key]: value } });
  }

  // Crazy 777 only — specialReelTiers is a fully independent weighted table (reel 4), so it
  // gets its own update helper and its own 100%-sum check, separate from `tiers`.
  function updateSpecialTier(key: TierKey, patch: Partial<TierRow>) {
    if (!config?.specialReelTiers) return;
    setSavedOk(false);
    setConfig({
      ...config,
      specialReelTiers: config.specialReelTiers.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    });
  }

  function updateRespinRange(patch: Partial<{ min: number; max: number }>) {
    if (!config?.respinRange) return;
    setSavedOk(false);
    setConfig({ ...config, respinRange: { ...config.respinRange, ...patch } });
  }

  function updateReelStateConfig(patch: Partial<{ centerRowChancePercent: number }>) {
    if (!config?.reelStateConfig) return;
    setSavedOk(false);
    setConfig({ ...config, reelStateConfig: { ...config.reelStateConfig, ...patch } });
  }

  function updateWildRules(
    patch: Partial<{
      onePureBet: number;
      twoPureBet: number;
      threePureBet: number;
      oneCompleteMultiplier: number;
      twoCompleteMultiplier: number;
      anyMixBet: number;
    }>
  ) {
    if (!config?.wildRules) return;
    setSavedOk(false);
    setConfig({ ...config, wildRules: { ...config.wildRules, ...patch } });
  }

  // Changing the Target RTP re-scales the win-tier frequencies (proportionally, keeping their
  // relative rarity the same) so the config is instantly valid again at the new target — the
  // freeSpin row's own trigger frequency and every payout multiplier are left untouched, since
  // RTP is linear in the win-tier frequencies alone (see computeRtpPercent). Editing a tier's
  // frequency/payout directly (via updateTier) still shows the real-time error as before.
  //
  // Crazy 777 (config.specialReelTiers present) is the one exception to "linear": its RESPIN
  // retrigger term depends on pLineWin *and* jointEV, both of which move when we scale line
  // frequencies, so a single rescale pass lands close but not exact (a small quadratic
  // residual). Iterating the same rescale step a few times converges on the target almost
  // exactly — each pass shrinks the residual by roughly the same factor that caused it.
  function rescaleLineTiers(tiers: TierRow[], scale: number): TierRow[] {
    let scaled = tiers.map((t) =>
      t.payoutMultiplier !== null ? { ...t, frequencyPercent: Math.max(0, t.frequencyPercent * scale) } : t
    );
    const nonLossSum = scaled.filter((t) => t.key !== "loss").reduce((sum, t) => sum + t.frequencyPercent, 0);
    const newLoss = Math.max(0, 100 - nonLossSum);
    return scaled.map((t) => (t.key === "loss" ? { ...t, frequencyPercent: newLoss } : t));
  }

  function setTargetRtp(newTarget: number) {
    if (!config) return;
    setSavedOk(false);

    // Vegas Hits has no dedicated "loss" tier for rescaleLineTiers' proportional-frequency
    // rescale to absorb slack into (all 7 rows are real, always-drawn symbols — scaling them all
    // by the same factor is a no-op for RTP and breaks the sum-to-100% invariant) — reshape the
    // weight *distribution* instead, via the same gamma search Target Loss % uses, and never
    // touch payout multipliers (those are the admin's own fixed numbers). Runs a couple dozen
    // Monte Carlo passes, so defer it a tick behind a "Solving..." state instead of freezing.
    if (gameId === "vegas-hits") {
      setSolving(true);
      window.setTimeout(() => {
        const tiers = solveVegasHitsRtpPercent(config, newTarget);
        setConfig({ ...config, targetRtpPercent: newTarget, tiers });
        setSolving(false);
      }, 0);
      return;
    }

    const oldRtp = computeRtpPercent(config);
    if (!Number.isFinite(oldRtp) || oldRtp <= 0) {
      setConfig({ ...config, targetRtpPercent: newTarget });
      return;
    }

    // Scale every tier that actually contributes to RTP — same condition computeRtpPercent
    // itself uses, so this works for any game's tier set, not just the shared simpleWin/
    // bigWin/megaWin/jackpot bucket names (Buffalo 777's tiers are named differently).
    let tiers = rescaleLineTiers(config.tiers, newTarget / oldRtp);

    if (config.specialReelTiers) {
      for (let i = 0; i < 6; i++) {
        const current = computeRtpPercent({ ...config, tiers });
        if (!Number.isFinite(current) || current <= 0 || Math.abs(current - newTarget) < 0.005) break;
        tiers = rescaleLineTiers(tiers, newTarget / current);
      }
    }

    setConfig({ ...config, targetRtpPercent: newTarget, tiers });
  }

  // Vegas Hits only — see solveVegasHitsLossPercent's doc comment for the mechanism (reshapes
  // symbol weights, leaves payouts untouched) and its structural ceiling caveat.
  function setTargetLoss(newTarget: number) {
    if (!config) return;
    setSavedOk(false);
    setSolving(true);
    window.setTimeout(() => {
      const tiers = solveVegasHitsLossPercent(config, newTarget);
      setConfig({ ...config, targetLossPercent: newTarget, tiers });
      setSolving(false);
    }, 0);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setSaveErrors([]);
    try {
      const res = await adminApi.updatePaytable(gameId, config);
      setConfig(res.config);
      setSavedOk(true);
    } catch (err: unknown) {
      const errors =
        (err as { response?: { data?: { errors?: string[]; error?: string } } })?.response?.data?.errors ??
        [(err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Save failed"];
      setSaveErrors(errors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="RTP Control"
        description="Set exact odds and payouts per outcome tier — this is the RTP control for both games now."
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 max-w-7xl">
        {RTP_CONTROLLED_GAMES.map((g) => (
          <button
            key={g.slug}
            onClick={() => setGameId(g.slug)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              gameId === g.slug ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>

      {!config ? (
        <div className="text-sm text-slate-500">Loading...</div>
      ) : (
        <div className="max-w-3xl space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-slate-800">Target RTP %</label>
              <input
                type="number"
                step="0.01"
                value={config.targetRtpPercent}
                onChange={(e) => setTargetRtp(Number(e.target.value))}
                disabled={solving}
                className={inputClass(!rtpValid)}
              />
              <div className={`text-sm font-medium ${rtpValid ? "text-emerald-600" : "text-rose-600"}`}>
                Effective RTP: {computedRtp.toFixed(2)}%
                {rtpValid ? " ✓" : ""}
              </div>
              {solving && <div className="text-sm font-medium text-slate-500">Solving...</div>}
            </div>

            {!frequencyValid && (
              <p className="mt-3 text-sm text-rose-600">
                Frequencies must sum to 100% — currently {frequencySum.toFixed(2)}%.
              </p>
            )}
            {frequencyValid && !rtpValid && (
              <p className="mt-3 text-sm text-rose-600">
                Computed RTP ({computedRtp.toFixed(2)}%) doesn't match the target ({config.targetRtpPercent.toFixed(2)}%,
                ±0.5%). Adjust frequencies or payout multipliers below.
              </p>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Frequency %</th>
                  <th className="px-3 py-2">Payout (x bet)</th>
                  {hasFreeSpin && <th className="px-3 py-2">Free-spin payout (x bet)</th>}
                </tr>
              </thead>
              <tbody>
                {config.tiers.map((tier) => (
                  <tr key={tier.key} className="border-t border-slate-200">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        {tierImage(config.gameId, tier.key) && (
                          <img src={tierImage(config.gameId, tier.key)} alt="" className="h-8 w-8 rounded object-contain bg-slate-100" />
                        )}
                        {TIER_LABELS[tier.key]}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={tier.frequencyPercent}
                        onChange={(e) => updateTier(tier.key, { frequencyPercent: Number(e.target.value) })}
                        className={inputClass(!frequencyValid)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {tier.payoutMultiplier === null ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <div>
                          <input
                            type="number"
                            step="0.01"
                            value={tier.payoutMultiplier}
                            onChange={(e) => updateTier(tier.key, { payoutMultiplier: Number(e.target.value) })}
                            className={inputClass()}
                          />
                          {config.gameId === "cash-machine" && (
                            <div className="mt-1 text-[11px] text-slate-500">
                              Estimate only — real payout is the number shown on the reels (range below)
                            </div>
                          )}
                          {LINE_COST_BY_GAME[config.gameId] !== undefined && (
                            <div className="mt-1 text-[11px] text-slate-500">
                              = x{(tier.payoutMultiplier / LINE_COST_BY_GAME[config.gameId]!).toFixed(4)} of the player's real bet
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    {hasFreeSpin && (
                      <td className="px-3 py-2">
                        {tier.freeSpinPayoutMultiplier === null ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <input
                            type="number"
                            step="0.01"
                            value={tier.freeSpinPayoutMultiplier}
                            onChange={(e) =>
                              updateTier(tier.key, { freeSpinPayoutMultiplier: Number(e.target.value) })
                            }
                            className={inputClass()}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {simStats && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <label className="text-sm font-semibold text-slate-800">Target Loss %</label>
                <input
                  type="number"
                  step="0.01"
                  value={config.targetLossPercent ?? Number(simStats.lossPercent.toFixed(2))}
                  onChange={(e) => setTargetLoss(Number(e.target.value))}
                  disabled={solving}
                  className={inputClass(!lossValid)}
                />
                <div className={`text-sm font-medium ${lossValid ? "text-emerald-600" : "text-rose-600"}`}>
                  Effective Loss: {simStats.lossPercent.toFixed(2)}%
                  {lossValid ? " ✓" : ""}
                </div>
                {solving && <div className="text-sm font-medium text-slate-500">Solving...</div>}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Percent of base spins (the outcomes above, not free games) that pay nothing at all — editing this
                reshapes the symbol weights above to chase it, same as Target RTP % does, and never touches any
                payout value.
              </p>
              {!lossValid && (
                <p className="mt-2 text-xs text-rose-600">
                  Vegas Hits' overlapping paylines put a hard ceiling on how loss-heavy this game can ever be for the
                  current payout table — a target beyond that lands as close as the weights can get, not exactly on
                  it.
                </p>
              )}
            </div>
          )}

          <details className="rounded-xl border border-slate-200 bg-white p-5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              Which celebration each win shows (cosmetic only — payout comes from the table above)
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {config.tiers
                .filter((t) => t.payoutMultiplier !== null)
                .map((tier) => (
                  <div key={tier.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      {tierImage(config.gameId, tier.key) && (
                        <img src={tierImage(config.gameId, tier.key)} alt="" className="h-6 w-6 rounded object-contain bg-slate-100" />
                      )}
                      {TIER_LABELS[tier.key]}
                    </span>
                    <select
                      value={config.celebrationMap?.[tier.key] ?? ""}
                      onChange={(e) => updateCelebration(tier.key, (e.target.value || null) as CelebrationTier | null)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                    >
                      {CELEBRATION_OPTIONS.map((opt) => (
                        <option key={opt.label} value={opt.value ?? ""}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          </details>

          {hasFreeSpin && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <label className="text-sm font-semibold text-slate-800">Free spins granted</label>
              <p className="mt-1 text-xs text-slate-500">
                Bonus spins awarded when the "Free Spin" tier hits. Each bonus spin independently rolls its own
                outcome using the frequencies above (with the free-spin payout column).
              </p>
              <input
                type="number"
                step="1"
                value={config.freeSpinsGranted ?? 0}
                onChange={(e) => setConfig({ ...config, freeSpinsGranted: Number(e.target.value) })}
                className={`${inputClass()} mt-2`}
              />
            </div>
          )}

          {config.ruleTierMap && (
            <details className="rounded-xl border border-slate-200 bg-white p-5">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                Which symbols render for each tier (cosmetic only — payout comes from the table above)
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(config.ruleTierMap).map(([ruleId, tierKey]) => {
                  const ruleImages = config.gameId === "crystal-clover" ? CRYSTAL_CLOVER_RULE_IMAGES : SHAMROCK_RULE_IMAGES;
                  const ruleLabels = config.gameId === "crystal-clover" ? CRYSTAL_CLOVER_RULE_LABELS : SHAMROCK_RULE_LABELS;
                  return (
                  <div key={ruleId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      {ruleImages[ruleId] && (
                        <img src={ruleImages[ruleId]} alt="" className="h-6 w-6 rounded object-contain bg-slate-100" />
                      )}
                      {ruleLabels[ruleId] ?? ruleId}
                    </span>
                    <select
                      value={tierKey}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          ruleTierMap: { ...config.ruleTierMap, [ruleId]: e.target.value },
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                    >
                      {WIN_TIER_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {TIER_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  );
                })}
              </div>
            </details>
          )}

          {config.amountThresholds && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-800">
                {config.gameId === "cash-machine" ? "Amount thresholds" : "Celebration thresholds"}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {config.gameId === "cash-machine"
                  ? "The value range for each tier — this is the real payout control: whatever number the reels land on within a tier's range is exactly what gets paid (scaled by bet). The payout \"x\" fields above are only an estimate for the RTP preview."
                  : "Cosmetic only — the real payout comes from the frequency/payout table above. These are just the win-size cutoffs (as a multiple of total bet) that decide which celebration overlay (Big Win / Mega Win / Jackpot) a spin shows."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  config.gameId === "cash-machine"
                    ? ([
                        ["simpleWinMax", "Simple Win max"],
                        ["bigWinMin", "Big Win min"],
                        ["megaWinMin", "Mega Win min"],
                        ["jackpotMin", "Jackpot min"],
                        ["zeroRespinMin", "Zero Respin min"],
                        ["zeroRespinMax", "Zero Respin max"],
                      ] as const)
                    : ([
                        ["bigWinMin", "Big Win min (x bet)"],
                        ["megaWinMin", "Mega Win min (x bet)"],
                        ["jackpotMin", "Jackpot min (x bet)"],
                      ] as const)
                ).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs text-slate-500">{label}</label>
                    <input
                      type="number"
                      value={config.amountThresholds![field]}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          amountThresholds: { ...config.amountThresholds!, [field]: Number(e.target.value) },
                        })
                      }
                      className={`${inputClass()} mt-1 w-full`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.specialReelTiers && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-800">
                {config.gameId === "5x-rewind"
                  ? "Coin overlay (rolled per reel)"
                  : config.gameId === "crystal-clover"
                    ? "MULTIPLIER_2X roll"
                    : "Special reel (reel 4)"}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {config.gameId === "5x-rewind"
                  ? "Rolled independently for each of the 3 reels — a coin can replace that reel's line symbol regardless of what the line tier above rolled. Frequencies here must separately sum to 100%."
                  : config.gameId === "crystal-clover"
                    ? "Fully independent from the table above — rolled every spin regardless of win/loss, applied as a flat multiplier on top of whatever the table above pays. Frequencies here must separately sum to 100%."
                    : "Fully independent from the table above — this is reel 4's own odds and effects, applied on top of the base win whenever reels 1-2-3 win. Frequencies here must separately sum to 100%."}
              </p>
              {!specialFrequencyValid && (
                <p className="mt-2 text-sm text-rose-600">
                  Special reel frequencies must sum to 100% — currently {specialFrequencySum.toFixed(2)}%.
                </p>
              )}
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                    <tr>
                      <th className="px-3 py-2">Symbol</th>
                      <th className="px-3 py-2">Frequency %</th>
                      <th className="px-3 py-2">Effect value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.specialReelTiers.map((tier) => (
                      <tr key={tier.key} className="border-t border-slate-200">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          <div className="flex items-center gap-2">
                            {tierImage(config.gameId, tier.key) && (
                              <img src={tierImage(config.gameId, tier.key)} alt="" className="h-8 w-8 rounded object-contain bg-slate-100" />
                            )}
                            {TIER_LABELS[tier.key]}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={tier.frequencyPercent}
                            onChange={(e) => updateSpecialTier(tier.key, { frequencyPercent: Number(e.target.value) })}
                            className={inputClass(!specialFrequencyValid)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {tier.payoutMultiplier === null ? (
                            <span className="text-slate-600">
                              {config.gameId === "5x-rewind" ? "—" : "— (respin count set below)"}
                            </span>
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              value={tier.payoutMultiplier}
                              onChange={(e) => updateSpecialTier(tier.key, { payoutMultiplier: Number(e.target.value) })}
                              className={inputClass()}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {config.gameId !== "5x-rewind" && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Multiplier symbols (2X/5X/10X): effect value is the ×N applied to base win. Dollar symbols
                  ($+/$$+): effect value is a flat ×bet bonus added on top of base win.
                </p>
              )}

              {config.respinRange && (
                <div className="mt-4">
                  <label className="text-sm font-semibold text-slate-800">Respin count range</label>
                  <p className="mt-1 text-xs text-slate-500">
                    When RESPIN lands, the player is awarded a random number of free re-spins within this range.
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <div>
                      <label className="block text-xs text-slate-500">Min</label>
                      <input
                        type="number"
                        step="1"
                        value={config.respinRange.min}
                        onChange={(e) => updateRespinRange({ min: Number(e.target.value) })}
                        className={`${inputClass()} mt-1`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">Max</label>
                      <input
                        type="number"
                        step="1"
                        value={config.respinRange.max}
                        onChange={(e) => updateRespinRange({ max: Number(e.target.value) })}
                        className={`${inputClass()} mt-1`}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {(config.gameId === "crystal-clover" || config.gameId === "vegas-hits") && config.reelStateConfig && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-800">Reel state chance</div>
              <p className="mt-1 text-xs text-slate-500">
                Each reel always shows either 1 symbol on the center payline or 2 symbols on the top+bottom
                paylines — never all 3. This is the chance it picks the center-only state.
              </p>
              <div className="mt-3">
                <label className="block text-xs text-slate-500">Center-row chance (%)</label>
                <input
                  type="number"
                  step="1"
                  min={0}
                  max={100}
                  value={config.reelStateConfig.centerRowChancePercent}
                  onChange={(e) => updateReelStateConfig({ centerRowChancePercent: Number(e.target.value) })}
                  className={`${inputClass()} mt-1 w-32`}
                />
              </div>
            </div>
          )}

          {config.gameId === "vegas-hits" && config.wildRules && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-sm font-semibold text-slate-800">RED HOT 3X wild rules</div>
              <p className="mt-1 text-xs text-slate-500">
                None of these correspond to a reel symbol above — they're the wild's own payout rules (see the
                paytable modal in-game for the plain-English version). The 4 "bet" fields use the same internal
                LINE_COST=30 reference every symbol payout above does (hence the x-bet conversion shown under
                each); the 2 multiplier fields are plain ratios applied to whatever real symbol the wild helped
                complete.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs text-slate-500">1 Wild, no match (bet)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={config.wildRules.onePureBet}
                    onChange={(e) => updateWildRules({ onePureBet: Number(e.target.value) })}
                    className={`${inputClass()} mt-1 w-32`}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">= x{(config.wildRules.onePureBet / LINE_COST_BY_GAME["vegas-hits"]!).toFixed(4)} bet</div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500">2 Wild, no match (bet)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={config.wildRules.twoPureBet}
                    onChange={(e) => updateWildRules({ twoPureBet: Number(e.target.value) })}
                    className={`${inputClass()} mt-1 w-32`}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">= x{(config.wildRules.twoPureBet / LINE_COST_BY_GAME["vegas-hits"]!).toFixed(4)} bet</div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500">3 Wild (bet)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={config.wildRules.threePureBet}
                    onChange={(e) => updateWildRules({ threePureBet: Number(e.target.value) })}
                    className={`${inputClass()} mt-1 w-32`}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">= x{(config.wildRules.threePureBet / LINE_COST_BY_GAME["vegas-hits"]!).toFixed(4)} bet</div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500">Any 7 mixed, no Wild (bet)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={config.wildRules.anyMixBet}
                    onChange={(e) => updateWildRules({ anyMixBet: Number(e.target.value) })}
                    className={`${inputClass()} mt-1 w-32`}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">= x{(config.wildRules.anyMixBet / LINE_COST_BY_GAME["vegas-hits"]!).toFixed(4)} bet</div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500">1 Wild completes a match (x)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.wildRules.oneCompleteMultiplier}
                    onChange={(e) => updateWildRules({ oneCompleteMultiplier: Number(e.target.value) })}
                    className={`${inputClass()} mt-1 w-32`}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">2 Wild complete a match (x)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.wildRules.twoCompleteMultiplier}
                    onChange={(e) => updateWildRules({ twoCompleteMultiplier: Number(e.target.value) })}
                    className={`${inputClass()} mt-1 w-32`}
                  />
                </div>
              </div>
            </div>
          )}

          {saveErrors.length > 0 && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
              {saveErrors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
          {savedOk && <div className="text-sm font-medium text-emerald-600">Saved.</div>}

          <button
            onClick={save}
            disabled={!isValid || saving}
            className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
