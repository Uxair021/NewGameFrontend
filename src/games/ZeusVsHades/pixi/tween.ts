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
