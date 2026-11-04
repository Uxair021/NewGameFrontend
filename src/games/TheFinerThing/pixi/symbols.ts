import { Texture } from "pixi.js";
import { TheFinerThingSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/theFinerThing";

/** GPU-memory knob: longest side (px) each symbol texture is shrunk to on load. A reel cell is
 * 200×157 design px and the canvas renders at most ~1.4× (see MAX_RESOLUTION in
 * TheFinerThingGame.tsx), so the files' up-to-500px art was mostly pixels the GPU held and never
 * showed: 11 symbols ≈ 2.7 MB of textures at 288px vs ≈ 5.6 MB at full size. */
const SYMBOL_TEXTURE_SIZE = 288;

/** Loads and fully decodes an image (decode() runs off the main thread). */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error(`Failed to load image: ${url}`);
  }
  return img;
}

/** daimond.webp is the WILD symbol — it substitutes for any of the 9 regular symbols in a payline
 * run (see backEnd/src/games/TheFinerThing/winCalc.ts's evaluatePayline) and only ever lands on
 * reels 2/3/4 (see WILD_ALLOWED_REELS in backEnd/src/games/TheFinerThing/config.ts). */
const SYMBOL_FILES: Record<TheFinerThingSymbol, string> = {
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

export async function loadSymbolTextures(): Promise<Record<TheFinerThingSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [TheFinerThingSymbol, string][]).map(
      async ([symbol, file]) => [symbol, makeFittedTexture(await loadImage(`${ASSET_BASE}/${file}`), SYMBOL_TEXTURE_SIZE)] as const
    )
  );
  return Object.fromEntries(entries) as Record<TheFinerThingSymbol, Texture>;
}
