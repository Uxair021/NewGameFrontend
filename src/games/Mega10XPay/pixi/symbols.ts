import { Texture } from "pixi.js";
import { Mega10xSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/mega10x";

const SYMBOL_FILES: Record<Mega10xSymbol, string> = {
  TEN_X: "10x.webp",
  THREE_X: "3x.webp",
  SEVEN: "7.webp",
  SEVEN_BAR: "7Bar.webp",
  TRIPLE_BAR: "TripleBar.webp",
  DOUBLE_BAR: "doubleBar.webp",
  SINGLE_BAR: "singleBar.webp",
  CHERRY: "cherry.webp",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Symbols are 500px files but drawn at most ~230px (see Reel's SYMBOL_DISPLAY_SIZE + win pulse),
 * so each is shrunk to `maxSize` on load — only the small copy is ever uploaded to the GPU. */
export async function loadSymbolTextures(maxSize: number): Promise<Record<Mega10xSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [Mega10xSymbol, string][]).map(
      async ([symbol, file]) => [symbol, makeFittedTexture(await loadImage(`${ASSET_BASE}/${file}`), maxSize)] as const
    )
  );
  return Object.fromEntries(entries) as Record<Mega10xSymbol, Texture>;
}

export function loadBackgroundImage(): Promise<HTMLImageElement> {
  return loadImage(`${ASSET_BASE}/bg.webp`);
}
