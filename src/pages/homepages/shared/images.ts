/** Static image paths shared by /home1, /home2, and /home3 — served from public/images/homepages
 * (copied over from the source GameFun project), not bundled as ES module imports, matching how
 * every other page in this app references its own /images and /symbols assets. */

const BASE = "/images/homepages";

export const CARD_IMAGES = [
  `${BASE}/card-1.webp`,
  `${BASE}/card-2.webp`,
  `${BASE}/card-3.webp`,
  `${BASE}/card-4.webp`,
  `${BASE}/card-5.webp`,
  `${BASE}/card-6.webp`,
];

/** All 15 filler card images the source project's Home page pulls in via a glob import — kept
 * as an explicit list here since Vite's import.meta.glob only resolves module (src/) assets, not
 * public/ ones. */
export const SMALL_CARD_IMAGES = Array.from({ length: 15 }, (_, i) => `${BASE}/small-card-${i + 1}.webp`);

export const HOME_IMAGES = {
  backgroundBody: `${BASE}/background-body.webp`,
  firstImage: `${BASE}/first-image.webp`,
  gameUserAvatar: `${BASE}/game-user.webp`,
  bonusReward: `${BASE}/bonus-reward.webp`,
  cashPrize: `${BASE}/cash-prize.webp`,
  settings: `${BASE}/settings.webp`,
  trophy: `${BASE}/trophy.webp`,
  notification: `${BASE}/notification.webp`,
  amount: `${BASE}/amount.webp`,
  level: `${BASE}/level.webp`,
  fav: `${BASE}/fav.webp`,
  all: `${BASE}/all.webp`,
  reels: `${BASE}/reels.webp`,
  share: `${BASE}/share.webp`,
  fish: `${BASE}/fish.webp`,
  others: `${BASE}/others.webp`,
  dailyBonus: `${BASE}/daily-bonus.webp`,
  heroBg: `${BASE}/image-1.webp`,
  promo1Bg: `${BASE}/image-2.webp`,
  promo2Bg: `${BASE}/image-3.webp`,
  promo3Bg: `${BASE}/image-4.webp`,
  adventureCard: `${BASE}/small-card-10.webp`,
  heroQuestCard: `${BASE}/small-card-13.webp`,
  gamingBackground: `${BASE}/gaming-background-2.webp`,
} as const;
