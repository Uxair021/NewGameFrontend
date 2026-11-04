import { Assets, Texture } from "pixi.js";
import { LifeOfLuxurySymbol } from "../api";

const ASSET_BASE = "/symbols/lifeOfLuxury";

/** daimond.webp is the WILD symbol — it substitutes for any of the 9 regular symbols in a payline
 * run (see backEnd/src/games/LifeOfLuxury/winCalc.ts's evaluatePayline) and only ever lands on
 * reels 2/3/4 (see WILD_ALLOWED_REELS in backEnd/src/games/LifeOfLuxury/config.ts). */
/** Every file is 288×288 — a reel cell is 250px and the canvas renders at ≤1.25× (see
 * gameRendererOptions), so larger art would only be GPU memory nobody sees: 11 × 288² × 4 bytes
 * ≈ 3.6 MB of textures, vs ≈ 11 MB at the old 500×500. */
const SYMBOL_FILES: Record<LifeOfLuxurySymbol, string> = {
  AEROPLANE: "aeroplane.webp",
  BOAT: "boat.webp",
  CAR: "car.webp",
  RING: "ring.webp",
  MONEY: "money.webp",
  WATCH: "watch.webp",
  GOLD_BAR: "goldBar.webp",
  SILVER_BAR: "silverBar.webp",
  BRONZE_BAR: "bronzeBar.webp",
  COIN: "coin.webp",
  WILD: "daimond.webp",
};

export async function loadSymbolTextures(): Promise<Record<LifeOfLuxurySymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [LifeOfLuxurySymbol, string][]).map(
      async ([symbol, file]) => [symbol, await Assets.load<Texture>(`${ASSET_BASE}/${file}`)] as const
    )
  );
  return Object.fromEntries(entries) as Record<LifeOfLuxurySymbol, Texture>;
}
