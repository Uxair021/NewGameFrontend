import { Texture } from "pixi.js";
import { FruitySymbol } from "../api";
import { loadImages } from "./flipbook";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/fruity777";

/** GPU-memory knob: longest side (px) the 300px symbol art is shrunk to on load. Reel symbols draw
 * at ~220px and the canvas renders at <= ~0.94x (see RENDER_QUALITY), so 224 loses nothing visible. */
const SYMBOL_TEXTURE_SIZE = 224;

// On-disk filenames as provided (kept as-is rather than renamed — note the two typos:
// "graps.webp"/"watermellon.webp").
const SYMBOL_FILES: Record<FruitySymbol, string> = {
  APPLE: "apple.webp",
  LEMON: "lemon.webp",
  ORANGE: "orange.webp",
  PEACH: "peach.webp",
  PINEAPPLE: "pineapple.webp",
  GRAPE: "graps.webp",
  WATERMELON: "watermellon.webp",
  DRAGON_FRUIT: "dragonFruit.webp",
  SEVEN: "7.webp",
  BAR: "bar.webp",
  STAR: "luckyStar.webp",
  BONUS: "bonus.webp",
};

/** Plain image URL for a symbol — used by the DOM rules/info screen (not Pixi). */
export function symbolUrl(symbol: FruitySymbol): string {
  return `${ASSET_BASE}/${SYMBOL_FILES[symbol]}`;
}

export async function loadSymbolTextures(): Promise<Record<FruitySymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [FruitySymbol, string][]).map(
      async ([symbol, file]) => {
        const [img] = await loadImages([`${ASSET_BASE}/${file}`]);
        return [symbol, makeFittedTexture(img, SYMBOL_TEXTURE_SIZE)] as const;
      }
    )
  );
  return Object.fromEntries(entries) as Record<FruitySymbol, Texture>;
}

/** The fairy's looping fly animation — 27 frames, already baked at the exact size she's drawn
 * (343x488, cropped + downscaled from the original 1640x2144 PNGs, which are in git history if
 * the frames ever need regenerating). Loaded as plain images, not textures — see Flipbook. */
const FAIRY_FRAME_COUNT = 27;

export function loadFairyFrames(): Promise<HTMLImageElement[]> {
  return loadImages(
    Array.from({ length: FAIRY_FRAME_COUNT }, (_, i) => `${ASSET_BASE}/fairy/fairy_${String(i).padStart(3, "0")}.webp`)
  );
}

/** The BONUS bell's swing animation — 30 frames (300x300, same canvas as bonus.webp), played on
 * the payline cells when 3 BONUS trigger free spins (see Reel.startBellEffect). Plain images,
 * not textures — see Flipbook. */
const BELL_FRAME_COUNT = 30;

export function loadBellFrames(): Promise<HTMLImageElement[]> {
  return loadImages(
    Array.from({ length: BELL_FRAME_COUNT }, (_, i) => `${ASSET_BASE}/bell/bell_${String(i).padStart(3, "0")}.webp`)
  );
}

/** Backgrounds — drawn as an HTML <img> under the (transparent) Pixi canvas, not as a texture. */
export const BG_URL = `${ASSET_BASE}/bg.webp`;
export const FREE_GAME_BG_URL = `${ASSET_BASE}/FreeGameBg.webp`;
