import { lazy } from "react";
import { 
  Clover,
  // Coins, 
  Fish, Grid3x3, House, 
  // ShipWheel, Spade,
  type LucideIcon } from "lucide-react";
import { shamrockSpinMeta } from "./ShamrockSpin/meta";
import { cashMachineMeta } from "./CashMachine/meta";
// import { buffalo777Meta } from "./Buffalo777/meta";
// import { crazy777Meta } from "./Crazy777/meta";
// import { fiveXRewindMeta } from "./FiveXRewind/meta";
import { sizzlingSevensMeta } from "./SizzlingSevens/meta";
// import { crystalCloverMeta } from "./CrystalClover/meta";
import { fruity777Meta } from "./Fruity777/meta";
// import { mega10xPayMeta } from "./Mega10XPay/meta";
import { vegasHitsMeta } from "./VegasHits/meta";
// import { lifeOfLuxuryMeta } from "./LifeOfLuxury/meta";
// import { theFinerThingMeta } from "./TheFinerThing/meta";
// import { rubberDuckMeta } from "./RubberDuck/meta";
// import { topDollarMeta } from "./TopDollar/meta";
// import { gemsDeluxeMeta } from "./GemsDeluxe/meta";
// import { hexaKenoMeta } from "./HexaKeno/meta";
// import { superKenoBallsMeta } from "./SuperKenoBalls/meta";
// import { fishGameMeta } from "./FishGame/meta";
// import { zeusVsHadesMeta } from "./ZeusVsHades/meta";

export type GameCategory = "slots" | "keno" | "table" | "live" | "jackpots" | "fishing";
/** Lobby card badges. Admin picks one per game on the "Lobby Games" page; keep in sync with
 * LOBBY_TAGS in backEnd/src/models/LobbyGame.ts. */
export const GAME_TAGS = [
  { id: "HOT", label: "Hot", className: "bg-red-500 text-white" },
  { id: "NEW", label: "New", className: "bg-emerald-500 text-white" },
  { id: "TOP", label: "Top", className: "bg-sky-500 text-white" },
  { id: "JACKPOT", label: "Jackpot", className: "bg-amber-400 text-slate-900" },
  { id: "EXCLUSIVE", label: "Exclusive", className: "bg-fuchsia-500 text-white" },
] as const;
export type GameTag = (typeof GAME_TAGS)[number]["id"];

export interface GameRegistryEntry {
  slug: string;
  name: string;
  description: string;
  category: GameCategory;
  tag?: GameTag;
  /** Omitted (live) unless marked otherwise — a "coming-soon" entry has no `component`
   * and renders as a locked preview card instead of a playable link. */
  status?: "coming-soon";
  /** Warm-gradient Tailwind classes + an emoji glyph, used instead of a thumbnail image
   * for entries that don't have real art yet (currently just the "coming soon" ones). */
  thumbnailGradient?: string;
  icon?: string;
  component?: ReturnType<typeof lazy>;
}

/** Sidebar categories, in display order — a category with no games yet still shows up
 * (matching an empty "no games match" state) so new games can slot into it later. */
export const CATEGORIES: { id: "all" | GameCategory; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "Lobby", icon: House },
  { id: "slots", label: "Slots", icon: Clover },
  { id: "keno", label: "Keno", icon: Grid3x3 },
  // { id: "table", label: "Table Games", icon: Spade },
  // { id: "live", label: "Live Casino", icon: ShipWheel },
  // { id: "jackpots", label: "Jackpots", icon: Coins },
  { id: "fishing", label: "Fishing", icon: Fish },
];

// Add each new game's meta + lazy component here as it's built.
export const gameRegistry: GameRegistryEntry[] = [
  {
    slug: shamrockSpinMeta.slug,
    name: shamrockSpinMeta.name,
    description: shamrockSpinMeta.description,
    category: "slots",
    component: lazy(() =>
      import("./ShamrockSpin/ShamrockSpinGame").then((m) => ({ default: m.ShamrockSpinGame }))
    ),
  },
  {
    slug: cashMachineMeta.slug,
    name: cashMachineMeta.name,
    description: cashMachineMeta.description,
    category: "slots",
    component: lazy(() =>
      import("./CashMachine/CashMachineGame").then((m) => ({ default: m.CashMachineGame }))
    ),
  },
  // {
  //   slug: buffalo777Meta.slug,
  //   name: buffalo777Meta.name,
  //   description: buffalo777Meta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./Buffalo777/Buffalo777Game").then((m) => ({ default: m.Buffalo777Game }))
  //   ),
  // },
  // {
  //   slug: crazy777Meta.slug,
  //   name: crazy777Meta.name,
  //   description: crazy777Meta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./Crazy777/Crazy777Game").then((m) => ({ default: m.Crazy777Game }))
  //   ),
  // },
  // {
  //   slug: fiveXRewindMeta.slug,
  //   name: fiveXRewindMeta.name,
  //   description: fiveXRewindMeta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./FiveXRewind/FiveXRewindGame").then((m) => ({ default: m.FiveXRewindGame }))
  //   ),
  // },
  {
    slug: sizzlingSevensMeta.slug,
    name: sizzlingSevensMeta.name,
    description: sizzlingSevensMeta.description,
    category: "slots",
    component: lazy(() =>
      import("./SizzlingSevens/SizzlingSevensGame").then((m) => ({ default: m.SizzlingSevensGame }))
    ),
  },
  // {
  //   slug: crystalCloverMeta.slug,
  //   name: crystalCloverMeta.name,
  //   description: crystalCloverMeta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./CrystalClover/CrystalCloverGame").then((m) => ({ default: m.CrystalCloverGame }))
  //   ),
  // },
  {
    slug: fruity777Meta.slug,
    name: fruity777Meta.name,
    description: fruity777Meta.description,
    category: "slots",
    component: lazy(() =>
      import("./Fruity777/Fruity777Game").then((m) => ({ default: m.Fruity777Game }))
    ),
  },
  // {
  //   slug: mega10xPayMeta.slug,
  //   name: mega10xPayMeta.name,
  //   description: mega10xPayMeta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./Mega10XPay/Mega10XPayGame").then((m) => ({ default: m.Mega10XPayGame }))
  //   ),
  // },
  {
    slug: vegasHitsMeta.slug,
    name: vegasHitsMeta.name,
    description: vegasHitsMeta.description,
    category: "slots",
    component: lazy(() =>
      import("./VegasHits/VegasHitsGame").then((m) => ({ default: m.VegasHitsGame }))
    ),
  },
  // {
  //   slug: lifeOfLuxuryMeta.slug,
  //   name: lifeOfLuxuryMeta.name,
  //   description: lifeOfLuxuryMeta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./LifeOfLuxury/LifeOfLuxuryGame").then((m) => ({ default: m.LifeOfLuxuryGame }))
  //   ),
  // },
  // {
  //   slug: theFinerThingMeta.slug,
  //   name: theFinerThingMeta.name,
  //   description: theFinerThingMeta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./TheFinerThing/TheFinerThingGame").then((m) => ({ default: m.TheFinerThingGame }))
  //   ),
  // },
  // {
  //   slug: rubberDuckMeta.slug,
  //   name: rubberDuckMeta.name,
  //   description: rubberDuckMeta.description,
  //   category: "slots",
  //   component: lazy(() =>
  //     import("./RubberDuck/RubberDuckGame").then((m) => ({ default: m.RubberDuckGame }))
  //   ),
  // },
  // {
  //   slug: topDollarMeta.slug,
  //   name: topDollarMeta.name,
  //   description: topDollarMeta.description,
  //   category: "slots",
  //   tag: "HOT",
  //   component: lazy(() =>
  //     import("./TopDollar/TopDollarGame").then((m) => ({ default: m.TopDollarGame }))
  //   ),
  // },
  // {
  //   slug: gemsDeluxeMeta.slug,
  //   name: gemsDeluxeMeta.name,
  //   description: gemsDeluxeMeta.description,
  //   category: "slots",
  //   tag: "NEW",
  //   component: lazy(() =>
  //     import("./GemsDeluxe/GemsDeluxeGame").then((m) => ({ default: m.GemsDeluxeGame }))
  //   ),
  // },
  // {
  //   slug: hexaKenoMeta.slug,
  //   name: hexaKenoMeta.name,
  //   description: hexaKenoMeta.description,
  //   category: "keno",
  //   tag: "NEW",
  //   component: lazy(() =>
  //     import("./HexaKeno/HexaKenoGame").then((m) => ({ default: m.HexaKenoGame }))
  //   ),
  // },
  // {
  //   slug: superKenoBallsMeta.slug,
  //   name: superKenoBallsMeta.name,
  //   description: superKenoBallsMeta.description,
  //   category: "keno",
  //   tag: "NEW",
  //   component: lazy(() =>
  //     import("./SuperKenoBalls/SuperKenoBallsGame").then((m) => ({ default: m.SuperKenoBallsGame }))
  //   ),
  // },
  // {
  //   slug: fishGameMeta.slug,
  //   name: fishGameMeta.name,
  //   description: fishGameMeta.description,
  //   category: "fishing",
  //   tag: "NEW",
  //   component: lazy(() =>
  //     import("./FishGame/FishGameGame").then((m) => ({ default: m.FishGameGame }))
  //   ),
  // },
  // {
  //   slug: zeusVsHadesMeta.slug,
  //   name: zeusVsHadesMeta.name,
  //   description: zeusVsHadesMeta.description,
  //   category: "slots",
  //   tag: "NEW",
  //   component: lazy(() =>
  //     import("./ZeusVsHades/ZeusVsHadesGame").then((m) => ({ default: m.ZeusVsHadesGame }))
  //   ),
  // },
  // Fishing games are still in development — these are placeholder cards (no
  // component, no route) so the category isn't empty in the lobby while they're built.
  // {
  //   slug: "fish-hunter",
  //   name: "Fish Hunter",
  //   description: "Lock onto a target and blast your way through the reef for a payout.",
  //   category: "fishing",
  //   status: "coming-soon",
  //   thumbnailGradient: "from-amber-500 via-orange-600 to-red-700",
  //   icon: "🎣",
  // },
  // {
  //   slug: "deep-sea-reels",
  //   name: "Deep Sea Reels",
  //   description: "Cast your line into the depths and reel in escalating multipliers.",
  //   category: "fishing",
  //   status: "coming-soon",
  //   thumbnailGradient: "from-orange-500 via-red-600 to-rose-700",
  //   icon: "🐟",
  // },
  // {
  //   slug: "golden-catch",
  //   name: "Golden Catch",
  //   description: "Chase the rarest catch of the day for the biggest payout in the reef.",
  //   category: "fishing",
  //   status: "coming-soon",
  //   thumbnailGradient: "from-yellow-500 via-amber-600 to-orange-700",
  //   icon: "🐠",
  // },
];

export function getGameBySlug(slug: string): GameRegistryEntry | undefined {
  return gameRegistry.find((g) => g.slug === slug);
}

/** Games with a real backend counterpart — excludes "coming soon" preview cards, which have
 * no route/RTP/paytable to manage. Admin game pickers (RTP, force-outcome, earnings, live
 * feed) should use this instead of the full registry. */
export const playableGames: GameRegistryEntry[] = gameRegistry.filter((g) => g.status !== "coming-soon");

/** Playable games that use the slot-style paytable/force-outcome admin tools. Fishing games are
 * managed separately on their own admin page (admin/AdminFishGamePage.tsx). */
export const slotGames: GameRegistryEntry[] = playableGames.filter((g) => g.category !== "fishing");
