import { Texture } from "pixi.js";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";
import { RubberDuckSymbol } from "../api";

const ASSET_BASE = "/symbols/rubberDuck";

const SYMBOL_FILES: Record<RubberDuckSymbol, string> = {
  TRIPLE_7: "tripple7.webp",
  DOUBLE_7: "double7.webp",
  SEVEN: "7.webp",
  BOAT: "boat.webp",
  GUN: "gun.webp",
  TOOL: "tool.webp",
  SHAMPOO: "shampoo.webp",
  TOWEL: "towel.webp",
  BRUSH: "brush.webp",
  SAFEGUARD: "saveGaurd.webp",
  CAP: "cap.webp",
  POT: "pot.webp",
  SOAP: "soap.webp",
  SPONGE: "sponch.webp",
  BONUS: "bonus.webp",
  AVOCADO: "avacado.webp",
  BANANA: "banana.webp",
  COCONUT: "coconut.webp",
  GRAPES: "grapes.webp",
  LEMON: "lemon.webp",
  STRAWBERRY: "strawberry.webp",
};

/** Textures are stored at the size they actually appear on screen (their display size in design
 * px x the canvas resolution, plus a little headroom), never above the source art — so they look
 * the same while using far less GPU memory than the 500px files. Bounds keep them sane. */
const TEXTURE_HEADROOM = 1.05;
const MIN_TEXTURE_SIZE = 160;
const MAX_SYMBOL_TEXTURE_SIZE = 320;
const MAX_FRAME_TEXTURE_SIZE = 480;

function textureSize(displayPx: number, max: number): number {
  return Math.round(Math.min(max, Math.max(MIN_TEXTURE_SIZE, displayPx * TEXTURE_HEADROOM)));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

/** Symbol textures, each downscaled (through a CPU canvas) to fit `displayPx` (a cell's on-screen
 * size in device px) before upload — sprites fit themselves to their cell from the texture's size,
 * so they draw exactly as before. */
export async function loadSymbolTextures(displayPx: number): Promise<Record<RubberDuckSymbol, Texture>> {
  const size = textureSize(displayPx, MAX_SYMBOL_TEXTURE_SIZE);
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [RubberDuckSymbol, string][]).map(
      async ([symbol, file]) => [symbol, makeFittedTexture(await loadImage(`${ASSET_BASE}/${file}`), size)] as const
    )
  );
  return Object.fromEntries(entries) as Record<RubberDuckSymbol, Texture>;
}

/** The background art — shown as a plain <img> behind the (cropped) canvas, see RubberDuckGame. */
export const BG_URL = `${ASSET_BASE}/bg.webp`;

/** Ornamental frame shown around a reel's symbol whenever it lands on BONUS — see Reel.ts's
 * updateBonusFrame. */
export async function loadFrameTexture(displayPx: number): Promise<Texture> {
  return makeFittedTexture(await loadImage(`${ASSET_BASE}/frame.webp`), textureSize(displayPx, MAX_FRAME_TEXTURE_SIZE));
}
