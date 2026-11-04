import { Texture } from "pixi.js";
import { AnimatedGIF } from "@pixi/gif";
import { BuffaloSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

const ASSET_BASE = "/symbols/buffalo777";

/** GPU-memory knobs: longest side (px) every symbol / win-animation frame texture is shrunk to
 * on load. A reel cell is ~257 design px and the canvas renders at <= ~0.94x (see RENDER_QUALITY),
 * so the 500-1080px source art was mostly pixels the GPU held and never showed. The bull's frames
 * get a bit more because its padded frame is drawn larger than the cell (the card fills it). */
const SYMBOL_TEXTURE_SIZE = 256;
const WIN_FRAME_TEXTURE_SIZE = 256;
const BULL_FRAME_TEXTURE_SIZE = 300;

const SYMBOL_FILES: Record<BuffaloSymbol, string> = {
  TEN: "10.webp",
  JACK: "J.webp",
  QUEEN: "Q.webp",
  KING: "K.webp",
  ACE: "A.webp",
  BULL: "bull.webp",
  SINGLE_BAR: "SingleBar.webp",
  DOUBLE_BAR: "DoubleBar.webp",
  TRIPLE_BAR: "TripleBar.webp",
  MONEY_BAG: "MoneyBag.webp",
  COIN: "Coin.webp",
};

/** Symbols whose art is trimmed to its visible pixels and then stretched to fill the reel cell
 * edge to edge (instead of contain-fit, which leaves side gaps for near-square art in the wider
 * cells). Add more symbols here if their art should fill the cell too. */
export const FILL_CELL_SYMBOLS: Partial<Record<BuffaloSymbol, true>> = {
  BULL: true,
};

/** Symbols with a bonus win animation — plays in place of the static image on the payline
 * cell when that symbol lands as part of a win. Add more here as more .gifs are provided. */
const WIN_GIF_FILES: Partial<Record<BuffaloSymbol, string>> = {};

/** Symbols whose bonus win animation is a numbered sequence of WebP frames (1.webp, 2.webp, ...)
 * in its own folder, played as a PIXI.AnimatedSprite instead of a decoded .gif — add more here
 * as more frame sets are provided. Takes priority over WIN_GIF_FILES for the same symbol. */
type FrameSetSpec = {
  dir: string;
  frameCount: number;
  /** File name for 0-based frame index `i` — defaults to `${i + 1}.webp`. */
  fileName?: (i: number) => string;
  /** Play the frames backwards (last file first), looping last → first → last again. */
  reverse?: boolean;
};

const WIN_FRAME_SETS: Partial<Record<BuffaloSymbol, FrameSetSpec>> = {
  // Plays backwards: 22.webp → 21.webp → … → 1.webp, then again from 22.webp.
  TEN: { dir: "10 symbole sprite", frameCount: 22, reverse: true },
  JACK: { dir: "J symbole sprite", frameCount: 20 },
  KING: { dir: "K symbole sprite", frameCount: 23 },
  BULL: { dir: "bull", frameCount: 70, fileName: (i) => `bull_${String(i).padStart(5, "0")}.webp` },
  QUEEN: { dir: "Q symbol sprite", frameCount: 45, fileName: (i) => `Q_${String(i).padStart(3, "0")}.webp` },
  SINGLE_BAR: { dir: "SingleBar", frameCount: 79, fileName: (i) => `SingleBar_${String(i).padStart(3, "0")}.webp` },
  DOUBLE_BAR: { dir: "DoubleBar", frameCount: 41, fileName: (i) => `DoubleBar_${String(i).padStart(3, "0")}.webp` },
  TRIPLE_BAR: { dir: "TripleBar", frameCount: 35, fileName: (i) => `TripleBar_${String(i).padStart(3, "0")}.webp` },
  // Spinning 3D A generated from A.webp in the K/J style (36 frames = one full turn).
  ACE: { dir: "ASpin", frameCount: 36, fileName: (i) => `ASpin_${String(i).padStart(3, "0")}.webp` },
  // Spinning coin generated from Coin.webp (36 frames = one full turn, loops seamlessly).
  COIN: { dir: "coinSpin", frameCount: 36, fileName: (i) => `coinSpin_${String(i).padStart(3, "0")}.webp` },
};

/** Symbols whose frame animation plays once from frame 0 as an intro, then loops only from this
 * frame index to the last one (instead of looping the whole set) until the win glow stops. */
export const WIN_FRAME_LOOP_START: Partial<Record<BuffaloSymbol, number>> = {
  BULL: 20,
};

/** Rect (as fractions of the frame's width/height, so it holds at any texture size) of the gold card inside each frame (frames are padded squares with the card
 * offset right/bottom and horns sticking out above it). When set, the animation is scaled so this
 * card — not the whole padded frame — fills the reel column, and it's left unmasked so the horns
 * can pop out above the payline row instead of being clipped. */
export const WIN_FRAME_CONTENT_RECT: Partial<Record<BuffaloSymbol, { x: number; y: number; w: number; h: number }>> = {
  BULL: { x: 94 / 1080, y: 187 / 1080, w: 935 / 1080, h: 888 / 1080 },
};

/** Symbols whose win animation shows without the yellow glow backdrop/pulsing border. */
export const WIN_FRAME_NO_GLOW: Partial<Record<BuffaloSymbol, true>> = {
  BULL: true,
};

/** Per-symbol AnimatedSprite speed override (default 0.2 in Reel.ts). */
export const WIN_FRAME_SPEED: Partial<Record<BuffaloSymbol, number>> = {
  BULL: 0.4,
  // These five replaced 30fps .gifs — 0.5 plays them at the same 30fps (0.5 × 60fps ticker).
  QUEEN: 0.5,
  SINGLE_BAR: 0.5,
  DOUBLE_BAR: 0.5,
  TRIPLE_BAR: 0.5,
  COIN: 0.5,
  // 36 frames at 18fps ≈ 2s per turn, about the same pace as the K/J/10 sprites.
  ACE: 0.3,
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Strips near-white pixels to transparent — matches the technique already proven for
 * Shamrock Spin/Cash Machine's source art, which ships on opaque white/near-white cards. */
async function loadChromaKeyedTexture(url: string, trim = false): Promise<Texture> {
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

  if (trim) {
    // Crop away fully transparent margins so only the visible art gets scaled into the cell.
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (d[(y * canvas.width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const trimmed = document.createElement("canvas");
      trimmed.width = maxX - minX + 1;
      trimmed.height = maxY - minY + 1;
      trimmed.getContext("2d", { willReadFrequently: true })!.drawImage(canvas, -minX, -minY);
      return makeFittedTexture(trimmed, SYMBOL_TEXTURE_SIZE);
    }
  }

  return makeFittedTexture(canvas, SYMBOL_TEXTURE_SIZE);
}

export async function loadSymbolTextures(): Promise<Record<BuffaloSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [BuffaloSymbol, string][]).map(
      async ([symbol, file]) =>
        [symbol, await loadChromaKeyedTexture(`${ASSET_BASE}/${file}`, !!FILL_CELL_SYMBOLS[symbol])] as const
    )
  );
  return Object.fromEntries(entries) as Record<BuffaloSymbol, Texture>;
}

export function loadBackgroundImage(): Promise<HTMLImageElement> {
  return loadImage(`${ASSET_BASE}/bg.webp`);
}

/** Background shown for the whole Gold Coin free spins bonus (same layout as bg.webp). */
export function loadBonusBackgroundImage(): Promise<HTMLImageElement> {
  return loadImage(`${ASSET_BASE}/BonusSpinBg.webp`);
}

/** Decoded (but not playing) template `AnimatedGIF` per symbol that has a win animation —
 * the actual GIF parse + frame-decompress (expensive: this art is ~9MB/161 frames) happens
 * exactly once here, up front. Reel.ts clones this template (cheap — just a frame-array
 * reference copy + a fresh canvas) every time a win animation is needed, instead of
 * re-decoding the raw file on every win. */
export async function loadWinGifAnimations(): Promise<Partial<Record<BuffaloSymbol, AnimatedGIF>>> {
  const entries = await Promise.all(
    (Object.entries(WIN_GIF_FILES) as [BuffaloSymbol, string][]).map(async ([symbol, file]) => {
      // Caught per-symbol so one missing/corrupt .gif can't take every other symbol's
      // animation down with it — this whole call sits inside a single Promise.all alongside
      // loadWinFrameAnimations (see Buffalo777Scene's loadWinAnimationsInBackground), and an
      // uncaught rejection here would fail that entire batch, silently.
      try {
        const res = await fetch(`${ASSET_BASE}/${file}`);
        const buffer = await res.arrayBuffer();
        const template = AnimatedGIF.fromBuffer(buffer, { loop: true, autoPlay: false });
        return [symbol, template] as const;
      } catch (err) {
        console.error(`Buffalo777: failed to load win .gif for ${symbol} (${file})`, err);
        return [symbol, undefined] as const;
      }
    })
  );
  return Object.fromEntries(entries.filter(([, template]) => template)) as Partial<Record<BuffaloSymbol, AnimatedGIF>>;
}

/* Win-animation frames are decoded a few at a time, not all ~420 at once. Each frame decodes at
 * full size (500–512px, ~1MB) before it's shrunk to its texture size, so firing every frame in
 * parallel briefly held 400+MB of decoded images — fine on desktop, but on phones the browser
 * ran out of memory and dropped the WebGL context, leaving the canvas blank (only the DOM
 * controls showed). With a small cap, peak memory stays at a few MB. */
const FRAME_DECODE_CONCURRENCY = 6;
let frameDecodeActive = 0;
const frameDecodeQueue: (() => void)[] = [];
async function withFrameDecodeSlot<T>(job: () => Promise<T>): Promise<T> {
  if (frameDecodeActive >= FRAME_DECODE_CONCURRENCY) {
    await new Promise<void>((resolve) => frameDecodeQueue.push(resolve));
  }
  frameDecodeActive++;
  try {
    return await job();
  } finally {
    frameDecodeActive--;
    frameDecodeQueue.shift()?.();
  }
}

async function loadFrameSet({ dir, frameCount, fileName, reverse }: FrameSetSpec, maxSize: number): Promise<Texture[]> {
  const frames = await Promise.all(
    Array.from({ length: frameCount }, (_, i) =>
      withFrameDecodeSlot(async () => {
        const img = await loadImage(`${ASSET_BASE}/${dir}/${fileName ? fileName(i) : `${i + 1}.webp`}`);
        const texture = makeFittedTexture(img, maxSize);
        // Shrunk into its own canvas → the full-size decoded image is no longer needed; drop it
        // now instead of waiting for GC (it's still the texture's source when it wasn't shrunk).
        if (texture.source.resource !== img) img.src = "";
        return texture;
      })
    )
  );
  return reverse ? frames.reverse() : frames;
}

/** Decoded frame `Texture[]` per symbol in WIN_FRAME_SETS — same one-time-cost reasoning as
 * loadWinGifAnimations above: every frame is loaded exactly once here, then Reel.ts builds a
 * fresh `AnimatedSprite` from the shared array on every win (cheap — the textures are already
 * decoded, an AnimatedSprite is just a thin player around them). */
export async function loadWinFrameAnimations(): Promise<Partial<Record<BuffaloSymbol, Texture[]>>> {
  const entries = await Promise.all(
    (Object.entries(WIN_FRAME_SETS) as [BuffaloSymbol, FrameSetSpec][]).map(
      async ([symbol, spec]) => {
        // Same per-symbol isolation as loadWinGifAnimations above — a single bad/missing frame
        // (e.g. frameCount drifting out of sync with what's actually in the folder) only drops
        // that one symbol's animation instead of rejecting every symbol's.
        try {
          const size = symbol === "BULL" ? BULL_FRAME_TEXTURE_SIZE : WIN_FRAME_TEXTURE_SIZE;
          return [symbol, await loadFrameSet(spec, size)] as const;
        } catch (err) {
          console.error(`Buffalo777: failed to load win frame animation for ${symbol} (${spec.dir})`, err);
          return [symbol, undefined] as const;
        }
      }
    )
  );
  return Object.fromEntries(entries.filter(([, frames]) => frames)) as Partial<Record<BuffaloSymbol, Texture[]>>;
}
