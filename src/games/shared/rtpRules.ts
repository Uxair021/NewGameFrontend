/**
 * House rules every slot game's RTP config follows (agreed 2026-10-17):
 *
 * - Every pay is a WHOLE-NUMBER multiple of the player's total bet — what the info screen shows is
 *   exactly what's paid. Pays under 1x round up to 1x; 0 (switched off) stays 0.
 * - The target RTP is at most MAX_TARGET_RTP_PERCENT (games set lower keep theirs).
 * - RTP is matched by changing frequencies/weights, never by scaling the pays.
 *
 * Each game's config loader runs its saved (or default) config through these, and its admin page
 * only accepts whole-number pays and targets up to the cap.
 */

export const MAX_TARGET_RTP_PERCENT = 90;

/** A pay as a whole-number x of the bet: under 1 → 1, otherwise nearest; 0/null/invalid kept. */
export function wholeX(x: number): number;
export function wholeX(x: number | null): number | null;
export function wholeX(x: number | null): number | null {
  if (x === null || !Number.isFinite(x) || x <= 0) return x === null ? null : 0;
  return Math.max(1, Math.round(x));
}

/** Same as wholeX for a pay stored in "line units" (pay / unitsPerBet = x of the total bet):
 * rounds the x of the bet, then converts back. */
export function wholeXInUnits(units: number, unitsPerBet: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return wholeX(units / unitsPerBet) * unitsPerBet;
}

export function capTargetRtp(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return MAX_TARGET_RTP_PERCENT;
  return Math.min(target, MAX_TARGET_RTP_PERCENT);
}

/** Repeatedly applies a frequency-only `rescale` until `rtpOf` lands on `target` (within
 * `tolerance` points). Returns the input untouched if it's already there or can't be measured. */
export function fitFrequencies<T>(
  rows: T,
  rtpOf: (rows: T) => number,
  rescale: (rows: T, scale: number) => T,
  target: number,
  tolerance = 0.005
): T {
  let current = rows;
  for (let i = 0; i < 40; i++) {
    const rtp = rtpOf(current);
    if (!Number.isFinite(rtp) || rtp <= 0 || Math.abs(rtp - target) < tolerance) break;
    current = rescale(current, target / rtp);
  }
  return current;
}

/** Reads a game's config from localStorage under `key`, parsing with `parse` (which returns the
 * default for a missing/invalid value) and then applying `houseRules`. The result is cached per
 * raw stored string, so the (possibly costly) rules run once per saved config, not on every spin. */
export function makeConfigLoader<C>(key: string, parse: (raw: string | null) => C, houseRules: (config: C) => C): () => C {
  let cache: { raw: string | null; config: C } | null = null;
  return () => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      /* storage unavailable — use the default */
    }
    if (cache && cache.raw === raw) return cache.config;
    const config = houseRules(parse(raw));
    cache = { raw, config };
    return config;
  };
}

/** Input handler helper for admin pages: a typed pay → the whole number it will be saved as. */
export function parseWholeX(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? wholeX(n) : 0;
}
