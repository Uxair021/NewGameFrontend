import { Texture } from "pixi.js";
import { CrazySymbol, SpecialSymbol } from "../api";
import { makeScaledTexture } from "../../shared/pixi/scaledTexture";

// Note: the actual asset folder on disk is spelled "carzy777" (not "crazy777").
const ASSET_BASE = "/symbols/carzy777";

const SYMBOL_FILES: Record<CrazySymbol, string> = {
  SEVEN_LOW: "7.webp",
  SEVEN_MID: "77.webp",
  SEVEN_HIGH: "777.webp",
  SINGLE_BAR: "BAR1.webp",
  DOUBLE_BAR: "doubleBar.webp",
};

const SPECIAL_SYMBOL_FILES: Record<SpecialSymbol, string> = {
  MULT_2X: "2X.webp",
  MULT_5X: "5X.webp",
  MULT_10X: "10X.webp",
  DOLLAR_PLUS: "singleDollar.webp",
  DOUBLE_DOLLAR_PLUS: "doubleDollar.webp",
  RESPIN: "respin.webp",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Picks the texture scale (≤ 1 of the art's own size) for one symbol's image — lets the
 * scene size each texture to what's actually drawn on screen instead of uploading full art. */
export type TextureScaleFor<S extends string> = (symbol: S, img: HTMLImageElement) => number;

async function loadScaledTextures<S extends string>(files: Record<S, string>, scaleFor: TextureScaleFor<S>): Promise<Record<S, Texture>> {
  const entries = await Promise.all(
    (Object.entries(files) as [S, string][]).map(async ([symbol, file]) => {
      const img = await loadImage(`${ASSET_BASE}/${file}`);
      return [symbol, makeScaledTexture(img, scaleFor(symbol, img))] as const;
    })
  );
  return Object.fromEntries(entries) as Record<S, Texture>;
}

export function loadSymbolTextures(scaleFor: TextureScaleFor<CrazySymbol>): Promise<Record<CrazySymbol, Texture>> {
  return loadScaledTextures(SYMBOL_FILES, scaleFor);
}

export function loadSpecialSymbolTextures(scaleFor: TextureScaleFor<SpecialSymbol>): Promise<Record<SpecialSymbol, Texture>> {
  return loadScaledTextures(SPECIAL_SYMBOL_FILES, scaleFor);
}

export function loadBackgroundImage(): Promise<HTMLImageElement> {
  return loadImage(`${ASSET_BASE}/bg.webp`);
}

/** The respin-round background — same size/layout as bg.webp, recoloured. */
export function loadFreeSpinBackgroundImage(): Promise<HTMLImageElement> {
  return loadImage(`${ASSET_BASE}/freespinBg.webp`);
}
