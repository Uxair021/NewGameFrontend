import { Texture } from "pixi.js";
import { GemsDeluxeSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/gemsDeluxe";

/** GPU-memory knobs: longest side (px) each texture is shrunk to on load. Symbols draw at ~300
 * design px and gems at ~190, and the canvas renders at ~0.55x (see MAX_BACKING_PIXELS in
 * GemsDeluxeGame), so the 500px art / 1672px backgrounds were mostly pixels never shown. */
const SYMBOL_TEXTURE_SIZE = 256;
const GEM_TEXTURE_SIZE = 256;
const SCREEN_TEXTURE_SIZE = 1040;

const SYMBOL_FILES: Record<GemsDeluxeSymbol, string> = {
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
 * cards, same technique already proven for Buffalo 777/Shamrock Spin/Cash Machine's source art. */
async function loadChromaKeyedTexture(url: string): Promise<Texture> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  // willReadFrequently: a CPU canvas (it's read back below and only ever a source for the
  // smaller texture), so it never takes GPU memory of its own.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) d[i + 3] = 0;
  }
  ctx.putImageData(imageData, 0, 0);

  return makeFittedTexture(canvas, SYMBOL_TEXTURE_SIZE);
}

export async function loadSymbolTextures(): Promise<Record<GemsDeluxeSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [GemsDeluxeSymbol, string][]).map(
      async ([symbol, file]) => [symbol, await loadChromaKeyedTexture(`${ASSET_BASE}/${file}`)] as const
    )
  );
  return Object.fromEntries(entries) as Record<GemsDeluxeSymbol, Texture>;
}

export async function loadBottomScreenTexture(): Promise<Texture> {
  const img = await loadImage(`${ASSET_BASE}/bottomScreen.webp`);
  return makeFittedTexture(img, SCREEN_TEXTURE_SIZE);
}

export async function loadTopScreenTexture(): Promise<Texture> {
  const img = await loadImage(`${ASSET_BASE}/topScreen.webp`);
  return makeFittedTexture(img, SCREEN_TEXTURE_SIZE);
}

/** Fixes the RGB of every fully-transparent pixel to match its nearest opaque neighbor (a few
 * passes of 4-connected flood fill), leaving alpha untouched. gem.webp's transparent pixels are
 * stored as plain black (0,0,0,0) — harmless at native size, but this sprite gets scaled well
 * down for the bonus-board grid, and the GPU's linear/mipmap filtering blends neighboring texels
 * together when minifying, pulling that black into the gem's outermost ring and reading as a
 * faint dark "shadow" border around every gem (confirmed by sampling the source file's raw pixel
 * data — the cutoff from full color straight to (0,0,0,0) is a hard edge with no antialiased
 * gray ramp of its own). Recoloring the transparent margin removes the bleed at the source
 * without touching the circular silhouette itself. */
function extendEdgeColorIntoTransparency(imageData: ImageData, passes: number): void {
  const { width, height, data } = imageData;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] !== 0) continue;
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          if (data[ni] === 0 && data[ni + 1] === 0 && data[ni + 2] === 0 && data[ni + 3] === 0) continue;
          data[i] = data[ni];
          data[i + 1] = data[ni + 1];
          data[i + 2] = data[ni + 2];
          break;
        }
      }
    }
  }
}

/** The single mystery-pick gem sprite, reused for all 8 cells of the bonus board's gem grid
 * (see GemsDeluxeScene's buildGemGrid). Unlike the reel symbol art, this file already ships with
 * real alpha transparency outside its circular silhouette — no chroma-key needed — but see
 * extendEdgeColorIntoTransparency above for the edge-bleed fix it does need. */
export async function loadGemTexture(): Promise<Texture> {
  const img = await loadImage(`${ASSET_BASE}/gem.webp`);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  extendEdgeColorIntoTransparency(imageData, 14);
  ctx.putImageData(imageData, 0, 0);

  // Shrunk after the edge fix, so the downscale blends in the recoloured margin, not black.
  return makeFittedTexture(canvas, GEM_TEXTURE_SIZE);
}
