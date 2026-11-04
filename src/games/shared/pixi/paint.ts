import { CanvasSource, Texture } from "pixi.js";

/**
 * Canvas2D helpers for building Pixi textures that reproduce CSS looks (multi-stop gradients,
 * inset bevel bands, blurred glows) far more faithfully than Pixi Graphics can.
 */

export type Stops = [number, string][];
export type Ctx = CanvasRenderingContext2D;
export type Side = "top" | "bottom" | "left" | "right";
/** An inset bevel band, like a CSS `inset` box-shadow with no blur: [side, thickness, color]. */
export type Band = [Side, number, string];

/** Texture pixel density. 1 matches the keno canvases' backing resolution (capped below 1 by
 * their GPU-memory budget — see budgetResolution in appOptions.ts), so more would only be
 * downsampled away while costing 4x the GPU memory. */
const RES = 1;

/**
 * Paints a w x h texture with Canvas2D. `pad` adds a transparent margin on every side (for
 * glows and drop shadows); `draw` still works in the w x h box.
 */
export function paint(w: number, h: number, draw: (ctx: Ctx) => void, pad = 0, res = RES): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((w + pad * 2) * res);
  canvas.height = Math.ceil((h + pad * 2) * res);
  // willReadFrequently keeps the canvas in CPU memory, so the art isn't held on the GPU twice
  // (once as the accelerated canvas, once as the Pixi texture).
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  ctx.scale(res, res);
  ctx.translate(pad, pad);
  draw(ctx);
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: res }) });
}

export function withStops(g: CanvasGradient, stops: Stops): CanvasGradient {
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  return g;
}

/** Exact CSS `linear-gradient(<deg>, ...)` semantics for a box. */
export function cssLinear(ctx: Ctx, x: number, y: number, w: number, h: number, deg: number, stops: Stops): CanvasGradient {
  const a = (deg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return withStops(ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half), stops);
}

/** CSS `radial-gradient(circle at <fx> <fy>, ...)` (farthest-corner) for a box; fx/fy are fractions. */
export function cssRadial(ctx: Ctx, x: number, y: number, w: number, h: number, fx: number, fy: number, stops: Stops): CanvasGradient {
  const cx = x + w * fx;
  const cy = y + h * fy;
  const r = Math.hypot(Math.max(fx, 1 - fx) * w, Math.max(fy, 1 - fy) * h);
  return withStops(ctx.createRadialGradient(cx, cy, 0, cx, cy, r), stops);
}

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function polygonPath(ctx: Ctx, points: [number, number][]) {
  ctx.beginPath();
  points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

/** Paints inset bevel bands inside a box. Listed like CSS box-shadow: the first band ends up on top. */
export function insetBands(ctx: Ctx, x: number, y: number, w: number, h: number, bands: Band[]) {
  for (const [side, size, color] of [...bands].reverse()) {
    ctx.fillStyle = color;
    if (side === "top") ctx.fillRect(x, y, w, size);
    else if (side === "bottom") ctx.fillRect(x, y + h - size, w, size);
    else if (side === "left") ctx.fillRect(x, y, size, h);
    else ctx.fillRect(x + w - size, y, size, h);
  }
}

/**
 * Edge bevels in the style of CSS `linear-gradient(to <side>, a 0, b <size>px, transparent <size>px)`
 * stacked backgrounds: each edge gets a `size`-thick strip shading from `from` at the edge to `to`.
 * Listed like CSS backgrounds: the first one ends up on top.
 */
export function edgeBevels(ctx: Ctx, x: number, y: number, w: number, h: number, edges: [Side, number, string, string][]) {
  for (const [side, size, from, to] of [...edges].reverse()) {
    let g: CanvasGradient;
    if (side === "top") g = ctx.createLinearGradient(0, y, 0, y + size);
    else if (side === "bottom") g = ctx.createLinearGradient(0, y + h, 0, y + h - size);
    else if (side === "left") g = ctx.createLinearGradient(x, 0, x + size, 0);
    else g = ctx.createLinearGradient(x + w, 0, x + w - size, 0);
    ctx.fillStyle = withStops(g, [
      [0, from],
      [1, to],
    ]);
    if (side === "top") ctx.fillRect(x, y, w, size);
    else if (side === "bottom") ctx.fillRect(x, y + h - size, w, size);
    else if (side === "left") ctx.fillRect(x, y, size, h);
    else ctx.fillRect(x + w - size, y, size, h);
  }
}

type Corner = "tl" | "tr" | "bl" | "br";

/**
 * Corner bevels in the style of CSS `linear-gradient(<45|135|225|315>deg, a 0, b <size>px, transparent <size>px)`:
 * a right triangle in each corner, `size` px deep along the diagonal, shading from `from` to `to`.
 */
export function cornerBevels(ctx: Ctx, x: number, y: number, w: number, h: number, corners: [Corner, number, string, string][]) {
  for (const [corner, size, from, to] of [...corners].reverse()) {
    const leg = size * Math.SQRT2;
    const cx = corner === "tl" || corner === "bl" ? x : x + w;
    const cy = corner === "tl" || corner === "tr" ? y : y + h;
    const sx = cx === x ? 1 : -1;
    const sy = cy === y ? 1 : -1;
    polygonPath(ctx, [
      [cx, cy],
      [cx + sx * leg, cy],
      [cx, cy + sy * leg],
    ]);
    ctx.fillStyle = withStops(ctx.createLinearGradient(cx, cy, cx + (sx * leg) / 2, cy + (sy * leg) / 2), [
      [0, from],
      [1, to],
    ]);
    ctx.fill();
  }
}
