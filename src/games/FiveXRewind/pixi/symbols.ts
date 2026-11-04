import { Texture } from "pixi.js";
import { FiveXSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/5xRewind";

/** GPU-memory knob: longest side (px) each symbol texture is shrunk to on load. Symbols draw at
 * ~320 design px and the canvas renders at ~0.55x (see MAX_BACKING_PIXELS in FiveXRewindGame),
 * so the 500px art was mostly pixels the GPU held and never showed. */
const SYMBOL_TEXTURE_SIZE = 256;

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

const SYMBOL_FILES: Record<FiveXSymbol, string> = {
  WHITE_BAR: "WHITE-BAR.webp",
  SEVEN_BAR: "7-BAR.webp",
  RED_BAR: "RED-BAR.webp",
  PURPLE_BAR: "PURPLE-BAR.webp",
  RED_7: "RED-7.webp",
  PURPLE_7: "PURPLE-7.webp",
  BLUE_7: "BLUE-7.webp",
  COIN_2X: "2X-coin.webp",
  COIN_3X: "3X-coin.webp",
  COIN_4X: "4X-coin.webp",
  COIN_5X: "5X-coin.webp",
};

/** All 11 symbol PNGs already have real alpha transparency (confirmed against the source
 * files) — no chroma-keying needed here, unlike Buffalo777's flat-white-background assets. */
export async function loadSymbolTextures(): Promise<Record<FiveXSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [FiveXSymbol, string][]).map(
      async ([symbol, file]) => [symbol, makeFittedTexture(await loadImage(`${ASSET_BASE}/${file}`), SYMBOL_TEXTURE_SIZE)] as const
    )
  );
  return Object.fromEntries(entries) as Record<FiveXSymbol, Texture>;
}
