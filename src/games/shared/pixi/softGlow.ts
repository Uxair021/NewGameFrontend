import { CanvasSource, Graphics, Texture } from "pixi.js";

/** Filter-free stand-in for a BlurFilter'd rectangle: stacked rounded rects, each `feather /
 * steps` further inset and translucent, so the overlap builds a soft edge that fades outward.
 * Avoids BlurFilter's render targets (pooled at power-of-two sizes, kept alive in GPU memory) and
 * its extra render passes every frame. The rect's solid core sits at (x, y, w, h); the fade
 * reaches `feather` px outside it. */
export function drawSoftRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  feather: number,
  radius = 12,
  steps = 6
): Graphics {
  const stepPx = (feather * 2) / steps;
  const alpha = 1 - Math.pow(0.15, 1 / steps); // core ends up ~85% opaque
  for (let i = 0; i < steps; i++) {
    const grow = feather - i * stepPx;
    g.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, radius + Math.max(grow, 0));
    g.fill({ color, alpha });
  }
  return g;
}

/** Texture pixel density for the pre-blurred glows below — they're all soft gradients, so half
 * density is invisible and a quarter of the memory. */
const GLOW_TEXTURE_RES = 0.5;

function glowCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * GLOW_TEXTURE_RES));
  canvas.height = Math.max(1, Math.ceil(height * GLOW_TEXTURE_RES));
  // CPU canvas: only ever the upload source for the texture, so no GPU copy of its own.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(GLOW_TEXTURE_RES, GLOW_TEXTURE_RES);
  return [canvas, ctx];
}

/**
 * A truly blurred rectangular ring (like a stroked rect under a BlurFilter), drawn once with
 * Canvas2D's shadowBlur and baked into a small texture — show it as a Sprite and pulse its
 * alpha. No filter render targets or per-frame blur pass, and no visible banding (unlike
 * stacking translucent strokes). The ring's centre line is the `w` x `h` rect, offset by the
 * returned `pad` from the texture's top-left — place the sprite at (rectX - pad, rectY - pad).
 */
export function makeGlowRingTexture(w: number, h: number, lineWidth: number, blur: number, color: string): { texture: Texture; pad: number } {
  const pad = Math.ceil(lineWidth / 2 + blur * 1.5);
  const [canvas, ctx] = glowCanvas(w + pad * 2, h + pad * 2);
  // Draw the stroke far off-canvas and let only its shadow land in view: the shadow is the blur.
  const away = (w + pad * 2) * 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * 2 * GLOW_TEXTURE_RES; // shadowBlur ignores the transform, so scale it here
  ctx.shadowOffsetX = away * GLOW_TEXTURE_RES;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(pad - away, pad, w, h);
  return { texture: new Texture({ source: new CanvasSource({ resource: canvas, resolution: GLOW_TEXTURE_RES }) }), pad };
}

let glowDotTexture: Texture | null = null;

/** A soft white dot fading smoothly to transparent at its edge (a blurred circle), 128 design px
 * across — tint it to colour it and size the sprite to the glow's full diameter. Built once and
 * shared. */
export function getGlowDotTexture(): Texture {
  if (glowDotTexture && !glowDotTexture.destroyed) return glowDotTexture;
  const size = 128;
  const [canvas, ctx] = glowCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Gaussian-like falloff: a solid core, then a long smooth fade (no hard edge anywhere).
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // Minus the curve's own edge value (exp(-3.2) ≈ 0.041) × t, so it reaches exactly 0 at the rim —
    // otherwise the square texture's corners would show a faint box.
    const alpha = Math.max(0, Math.exp(-3.2 * t * t) - Math.exp(-3.2) * t);
    g.addColorStop(t, `rgba(255,255,255,${alpha.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowDotTexture = new Texture({ source: new CanvasSource({ resource: canvas, resolution: GLOW_TEXTURE_RES }) });
  return glowDotTexture;
}
