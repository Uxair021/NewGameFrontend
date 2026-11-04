import { Texture } from "pixi.js";
import { CrystalCloverSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

/** GPU-memory knobs: longest side (px) textures are shrunk to on load. Symbols draw at most
 * ~485 design px wide and the 2012-wide frame fills the canvas, which renders at ~0.56x (see
 * MAX_BACKING_PIXELS in CrystalCloverGame) — so full-size art was mostly pixels never shown. */
const SYMBOL_TEXTURE_SIZE = 288;
const FRAME_TEXTURE_SIZE = 1150;

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

const SYMBOL_PATHS: Record<CrystalCloverSymbol, string> = {
  SEVEN_CLOVER: "/symbols/crystalClover/7clover.webp",
  TRIPLE_BAR: "/symbols/crystalClover/trippleBar.webp",
  DOUBLE_BAR: "/symbols/crystalClover/doubleBar.webp",
  BAR: "/symbols/crystalClover/bar.webp",
  WILD: "/symbols/crystalClover/wild.webp",
  MULTIPLIER_2X: "/symbols/crystalClover/2X.webp",
};

/** All symbol images already carry real alpha transparency (confirmed against the raw file
 * bytes) — unlike Buffalo777's older asset set, no chroma-keying needed here. */
export async function loadSymbolTextures(): Promise<Record<CrystalCloverSymbol, Texture>> {
  const entries = Object.entries(SYMBOL_PATHS) as [CrystalCloverSymbol, string][];
  const textures = await Promise.all(entries.map(async ([, path]) => makeFittedTexture(await loadImage(path), SYMBOL_TEXTURE_SIZE)));
  const result = {} as Record<CrystalCloverSymbol, Texture>;
  entries.forEach(([symbol], i) => (result[symbol] = textures[i]));
  return result;
}

export async function loadFrameTexture(): Promise<Texture> {
  return makeFittedTexture(await loadImage("/symbols/crystalClover/frame.webp"), FRAME_TEXTURE_SIZE);
}
