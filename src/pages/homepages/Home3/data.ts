import type { GameTag } from "../../../games/registry";

/** One card in the Popular Games carousel — a real game from the live lobby list (see
 * Home3Page), so the admin's Lobby Games page controls which cards show and their badges. */
export interface PopularGame {
  /** The game's slug. */
  id: string;
  title: string;
  /** Thumbnail art; "coming soon" placeholders have none and use gradient + icon instead. */
  image?: string;
  gradient?: string;
  icon?: string;
  badge: GameTag | null;
  comingSoon: boolean;
}

export type PromoAccent = "violet" | "gold" | "green";

export interface PromoCardData {
  id: "daily-bonus" | "vip-club" | "lucky-wheel";
  title: string;
  description: string;
  cta: string;
  accent: PromoAccent;
}

export const promoCards: PromoCardData[] = [
  {
    id: "daily-bonus",
    title: "Play & Win",
    description: "Spin, match, and play your way through exciting challenges!",
    cta: "Play Now",
    accent: "violet",
  },
  {
    id: "vip-club",
    title: "Feel the Thrill",
    description: "Fast-paced gameplay, exciting rounds, and big winning moments!",
    cta: "Play Now",
    accent: "gold",
  },
  {
    id: "lucky-wheel",
    title: "Your Next Game",
    description: "Pick a game, test your luck, and see if you can hit the jackpot!",
    cta: "Play Now",
    accent: "green",
  },
];
