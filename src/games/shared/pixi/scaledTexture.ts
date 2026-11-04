import { Texture } from "pixi.js";

/** A plain 2D canvas kept in CPU memory: `willReadFrequently` stops Chrome from GPU-accelerating
 * it, so the art isn't held on the GPU twice (once as the canvas, once as the Pixi texture). */
function cpuCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

/** Texture at `scale` of the art's own size (1 = full size). Below 1 it's drawn through a
 * canvas first, so only the smaller copy is ever uploaded to the GPU. Sprites that fit themselves
 * to a box from the texture's size draw at the same on-screen size either way. */
export function makeScaledTexture(img: HTMLImageElement, scale: number): Texture {
  if (scale >= 0.98) return Texture.from(img);
  const [canvas, ctx] = cpuCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
  if (!ctx) return Texture.from(img);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}

/** Texture whose longest side is at most `maxSize` px (aspect kept) — for art that's always drawn
 * smaller than its file, e.g. 512px symbols shown in a ~250px reel cell. */
export function makeFittedTexture(src: HTMLImageElement | HTMLCanvasElement, maxSize: number): Texture {
  const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const h = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  const scale = maxSize / Math.max(w, h);
  if (scale >= 0.98) return Texture.from(src);
  const [canvas, ctx] = cpuCanvas(w * scale, h * scale);
  if (!ctx) return Texture.from(src);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}
