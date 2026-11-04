import { Texture } from "pixi.js";
import { TopDollarSymbol } from "../api";
import { makeScaledTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/dollarGame";

const SYMBOL_FILES: Record<TopDollarSymbol, string> = {
  SEVEN: "7.webp",
  TRIPLE_BAR: "TripleBar.webp",
  DOUBLE_BAR: "doubleBar.webp",
  SINGLE_BAR: "singleBar.webp",
  DIAMOND: "daimond.webp",
  DOLLAR: "dollar.webp",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Strips near-white pixels to transparent — this game's symbol art ships on opaque white
 * cards, same technique already proven for Buffalo 777/Shamrock Spin/Cash Machine's source art.
 * Keyed at the art's full size (so edges match the original exactly), then downscaled to
 * `scale` so only the smaller copy is kept and uploaded to the GPU. */
async function loadChromaKeyedTexture(url: string, scale: number): Promise<Texture> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) d[i + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);

  if (scale >= 0.98) return Texture.from(canvas);
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  const smallCtx = small.getContext("2d")!;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(canvas, 0, 0, small.width, small.height);
  // Release the full-size canvas's pixel buffer right away rather than waiting on GC.
  canvas.width = canvas.height = 0;
  return Texture.from(small);
}

/** `scale` is the texture size as a fraction of the 500x500 source art (≤ 1) — see
 * TopDollarScene's symbolTextureScale. */
export async function loadSymbolTextures(scale = 1): Promise<Record<TopDollarSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [TopDollarSymbol, string][]).map(
      async ([symbol, file]) => [symbol, await loadChromaKeyedTexture(`${ASSET_BASE}/${file}`, scale)] as const
    )
  );
  return Object.fromEntries(entries) as Record<TopDollarSymbol, Texture>;
}

/** Background art for the two screens — shown as plain <img>s behind the canvas (see
 * TopDollarGame), not as Pixi textures, so they cost no WebGL memory. */
export const BOTTOM_SCREEN_URL = `${ASSET_BASE}/bottomScreen.webp`;
export const TOP_SCREEN_URL = `${ASSET_BASE}/topScreen.webp`;

/** Fetches + decodes both backgrounds so they're cached before the loading screen hands off —
 * the <img>s then show them instantly instead of popping in after the game appears. */
export async function preloadBackgrounds(): Promise<void> {
  await Promise.all(
    [BOTTOM_SCREEN_URL, TOP_SCREEN_URL].map(async (url) => {
      const img = await loadImage(url);
      await img.decode().catch(() => {});
    })
  );
}

/** A single stack-of-bills prop, reused (gradient-tinted per position, see TopDollarScene's
 * buildBonusBundles) for each of the 10 note-bundle spots on the bonus board — ships with a
 * real alpha channel already (no chroma-key needed, unlike the symbol card art). The source is
 * 1754px wide but only ever drawn ~355px wide, so `scale` shrinks it to that. */
export async function loadNoteBundleTexture(scale = 1): Promise<Texture> {
  return makeScaledTexture(await loadImage(`${ASSET_BASE}/notes.webp`), scale);
}
