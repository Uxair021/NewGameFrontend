import { Texture } from "pixi.js";
import { CashSymbol } from "../api";

const ASSET_BASE = "/symbols/moneyMachine";

const SYMBOL_FILES: Record<CashSymbol, string> = {
  null: "null.webp",
  "0": "0.webp",
  "1": "1.webp",
  "2": "2.webp",
  "5": "5.webp",
  "10": "10.webp",
};

/** Loads and fully decodes the image up front (during the loading screen), so the first frame
 * that draws it doesn't stall on decoding mid-spin. */
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

/** These WebPs already ship with transparent backgrounds — no chroma-keying needed. They're
 * pre-sized to fit 500x500 (they're drawn at ~150-240px), keeping GPU memory small. */
export async function loadSymbolTextures(): Promise<Record<CashSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [CashSymbol, string][]).map(
      async ([symbol, file]) => [symbol, Texture.from(await loadImage(`${ASSET_BASE}/${file}`))] as const
    )
  );
  return Object.fromEntries(entries) as Record<CashSymbol, Texture>;
}

export async function loadBackgroundTexture(): Promise<Texture> {
  const img = await loadImage(`${ASSET_BASE}/bg.webp`);
  return Texture.from(img);
}

/**
 * Same composition as bg.webp but with the oval/shield reel windows cut out to real
 * transparency. Rendered *above* the reels so the ornate frame's opaque pixels occlude
 * any symbol/glow overflow past the window's curve, while the transparent cutouts let
 * the reel content show through in exactly the frame's true oval/shield shape — bg.webp
 * underneath still provides the silver window fill since both share the same layout.
 */
export async function loadForegroundTexture(): Promise<Texture> {
  // Routed through a canvas (like the chroma-keyed symbol textures) rather than
  // Texture.from(img) directly — the direct-image upload path rendered this
  // particular file's transparent cutouts as opaque black instead of see-through,
  // even though the source pixel data itself is genuinely alpha=0 there.
  const img = await loadImage(`${ASSET_BASE}/bg2.webp`);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  // willReadFrequently keeps this canvas in CPU memory, so the frame isn't held on the GPU
  // twice (once as an accelerated canvas, once as the Pixi texture).
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return Texture.from(canvas);
}
