import type { Ticker } from "pixi.js";

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Minimal ticker-driven tween: calls `onUpdate` with the eased progress every frame for
 * `durationMs`, then resolves. Resolves immediately (after one final update) if `isAlive`
 * turns false — the scene passes its own "not destroyed" check so pending animations never
 * touch destroyed display objects.
 */
export function tween(
  ticker: Ticker,
  durationMs: number,
  onUpdate: (t: number) => void,
  easing: Easing = linear,
  isAlive: () => boolean = () => true
): Promise<void> {
  return new Promise((resolve) => {
    if (durationMs <= 0) {
      if (isAlive()) onUpdate(1);
      resolve();
      return;
    }
    let elapsed = 0;
    const step = (t: Ticker) => {
      if (!isAlive()) {
        ticker.remove(step);
        resolve();
        return;
      }
      elapsed += t.deltaMS;
      const p = Math.min(1, elapsed / durationMs);
      onUpdate(easing(p));
      if (p >= 1) {
        ticker.remove(step);
        resolve();
      }
    };
    ticker.add(step);
  });
}

export function wait(ticker: Ticker, ms: number, isAlive: () => boolean = () => true): Promise<void> {
  return tween(ticker, ms, () => {}, linear, isAlive);
}

/** CSS `cubic-bezier(x1, y1, x2, y2)` as an easing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (bez(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return bez((lo + hi) / 2, y1, y2);
  };
}

/** Linear interpolation between CSS-style keyframes [offset, value] (offsets ascending, 0..1). */
export function keyframes(frames: [number, number][], t: number): number {
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    const [t0, v0] = frames[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * ((t - t0) / (t1 - t0 || 1));
  }
  return frames[frames.length - 1][1];
}
