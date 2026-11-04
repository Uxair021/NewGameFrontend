/**
 * Hexa Keno and Super Keno Balls — shared draw engine and admin settings, all client-side like
 * the slot games: every draw is resolved in the browser and the balance is updated through
 * AuthContext. Ported from what used to live in backEnd/src/games/{HexaKeno,SuperKenoBalls}
 * (same pool, draw and paytables). No Big/Mega/Jackpot celebration tiers.
 *
 * Both games' settings live in one localStorage document, edited on one admin page
 * (admin/AdminKenoRtpPage.tsx). Every draw re-reads it, so a saved change applies to the next
 * draw.
 *
 * RTP is exact here, not simulated: P(k matches | p picks) is hypergeometric,
 * C(p,k)*C(80-p,20-k)/C(80,20). Super Keno Balls' bonus ball is the last number drawn, which
 * is uniform over the 20 drawn numbers, so given k matches it's one of the player's with
 * probability k/20 and multiplies the pay by the bonus multiplier.
 */

import { saveRtpConfigToServer, syncRtpConfigFromServer } from "./serverRtpConfig";
import { apiClient } from "../../api/client";

export const POOL_SIZE = 80;
export const DRAWN_COUNT = 20;
export const MIN_PICKS = 1;
export const MAX_PICKS = 10;

export type KenoGameId = "hexa-keno" | "super-keno-balls";

export const KENO_GAMES: { id: KenoGameId; name: string }[] = [
  { id: "hexa-keno", name: "Hexa Keno" },
  { id: "super-keno-balls", name: "Super Keno Balls" },
];

export interface KenoGameSettings {
  targetRtpPercent: number;
  /** Pay in x bet, indexed [picks][matches]; row 0 unused. */
  paytable: number[][];
  /** Super Keno Balls only: pay multiplier when the bonus ball is one of the matches. */
  bonusMultiplier: number | null;
  betLevels: number[];
}

export type KenoRtpConfig = Record<KenoGameId, KenoGameSettings>;

const RTP_CONFIG_STORAGE_KEY = "texas-slots-keno-rtp-config";
export const DEFAULT_KENO_TARGET_RTP_PERCENT = 90;

/** Fewest hits that can win for a pick count — fewer always pays nothing. 10 picks needs at
 * least 4 hits; every other pick count can win from any hit the paytable pays. */
const MIN_WINNING_HITS: Partial<Record<number, number>> = { 10: 4 };
export const minWinningHits = (picks: number): number => MIN_WINNING_HITS[picks] ?? 0;

const DEFAULT_BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];

/** Default paytables, 90% RTP per pick count with whole-number pays (balanceAllRows). Each row's
 * fewest paying hits is set so its loss rate sits as close to 75-80% as that pick count allows —
 * keno's odds only offer a few loss rates per pick count (e.g. 2 picks loses 56% or 94%), noted
 * per row. 1 and 2 picks can't land exactly on 90% with whole pays, so they sit at the closest
 * value below it. */
const DEFAULT_PAYTABLES: Record<KenoGameId, number[][]> = {
  "hexa-keno": [
    [],
    [0, 3], // loss 75.0%
    [0, 0, 15], // loss 94.0%
    [0, 0, 2, 45], // loss 84.7%
    [0, 0, 2, 5, 84], // loss 74.1%
    [0, 0, 0, 4, 20, 500], // loss 90.3%
    [0, 0, 0, 2, 4, 96, 1772], // loss 83.8%
    [0, 0, 0, 1, 3, 14, 389, 6665], // loss 76.3%
    [0, 0, 0, 1, 3, 9, 49, 820, 6565], // loss 68.3%
    [0, 0, 0, 0, 3, 5, 32, 210, 2455, 9887], // loss 84.7%
    [0, 0, 0, 0, 2, 5, 17, 66, 309, 772, 2059], // loss 78.8%
  ],
  "super-keno-balls": [
    [],
    [0, 3], // loss 75.0%
    [0, 0, 11], // loss 94.0%
    [0, 0, 1, 36], // loss 84.7%
    [0, 0, 1, 4, 76], // loss 74.1%
    [0, 0, 0, 1, 8, 552], // loss 90.3%
    [0, 0, 0, 1, 2, 62, 1160], // loss 83.8%
    [0, 0, 0, 1, 1, 9, 178, 3572], // loss 76.3%
    [0, 0, 0, 1, 1, 2, 35, 578, 4852], // loss 68.3%
    [0, 0, 0, 0, 1, 2, 26, 146, 1828, 7378], // loss 84.7%
    [0, 0, 0, 0, 1, 4, 8, 25, 131, 526, 1003], // loss 78.8%
  ],
};

// --- Exact RTP math --------------------------------------------------------------------------

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Probability of exactly `matches` of `picks` numbers being drawn. */
export function matchProbability(picks: number, matches: number): number {
  return (choose(picks, matches) * choose(POOL_SIZE - picks, DRAWN_COUNT - matches)) / choose(POOL_SIZE, DRAWN_COUNT);
}

/** Average pay factor from the bonus ball given `matches` (1 when there's no bonus ball). */
function bonusFactor(settings: KenoGameSettings, matches: number): number {
  if (!settings.bonusMultiplier) return 1;
  return 1 + (matches / DRAWN_COUNT) * (settings.bonusMultiplier - 1);
}

/** Exact RTP percent for players who pick `picks` numbers. */
export function rowRtpPercent(settings: KenoGameSettings, picks: number): number {
  let ev = 0;
  const row = settings.paytable[picks] ?? [];
  for (let m = 0; m <= picks; m++) ev += matchProbability(picks, m) * (row[m] ?? 0) * bonusFactor(settings, m);
  return ev * 100;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
/** Pays are whole numbers (e.g. 4x) — no decimal rewards. */
export const roundPay = (x: number) => Math.round(x);

/** True when pays never drop as hits go up (the 0-hit pay, if any, is left out). */
function isNonDecreasing(row: number[]): boolean {
  for (let m = 2; m < row.length; m++) if (row[m] < row[m - 1]) return false;
  return true;
}

/**
 * Scales one row's pays so it returns the target RTP, keeping their proportions, rounded to whole
 * numbers. Rounding alone can leave a row a few percent off, so it then fine-tunes greedily: each
 * pass applies the single nudge (±1, or ±5% of the pay for big pays) that brings the row closest
 * to the target while pays still rise with hits, until nothing improves or it's within 0.05%.
 * Landing over the target counts double, so a row that can't be exact settles just below it
 * rather than above. Small pays may drop to 0 — whole numbers can't go between 0 and 1x.
 */
export function balanceRow(settings: KenoGameSettings, picks: number): number[] {
  const minHits = minWinningHits(picks);
  const row = settings.paytable[picks].map((v, m) => (m < minHits ? 0 : v));
  const withRow = (r: number[]) => ({ ...settings, paytable: settings.paytable.map((x, p) => (p === picks ? r : x)) });
  const rtp = rowRtpPercent(withRow(row), picks);
  if (!(rtp > 0)) return row;
  const scale = settings.targetRtpPercent / rtp;
  let best = row.map((v) => roundPay(v * scale));
  const errorOf = (r: number[]) => {
    const diff = rowRtpPercent(withRow(r), picks) - settings.targetRtpPercent;
    return diff > 0 ? 2 * diff : -diff;
  };
  let bestErr = errorOf(best);

  for (let pass = 0; pass < 2000 && bestErr > 0.05; pass++) {
    let moved = false;
    let candidate = best;
    let candidateErr = bestErr;
    best.forEach((v, m) => {
      if (row[m] === 0) return; // keep pays the admin set to nothing at nothing
      for (const step of new Set([1, Math.max(1, Math.round(v * 0.05))])) {
        for (const next of [v + step, v - step]) {
          if (next < 0) continue;
          const trial = best.map((x, k) => (k === m ? next : x));
          if (!isNonDecreasing(trial)) continue;
          const err = errorOf(trial);
          if (err < candidateErr - 1e-9) {
            candidate = trial;
            candidateErr = err;
            moved = true;
          }
        }
      }
    });
    if (!moved) break;
    best = candidate;
    bestErr = candidateErr;
  }
  return best;
}

/**
 * How far from the target a row may land and still count as balanced: ±0.5%, or the smallest
 * RTP step a 1x change to one of its pays can make, if that's bigger. Only matters for rows with
 * very few pays — e.g. 1 pick, where 1x on its single pay moves RTP by 25%, so whole-number pays
 * can only land on 75% or 100%.
 */
export function rowTolerancePercent(settings: KenoGameSettings, picks: number): number {
  const row = settings.paytable[picks] ?? [];
  let smallestStep = Infinity;
  for (let m = 0; m <= picks; m++) {
    if (!(row[m] > 0)) continue;
    smallestStep = Math.min(smallestStep, matchProbability(picks, m) * bonusFactor(settings, m) * 100);
  }
  return Math.max(0.5, Number.isFinite(smallestStep) ? smallestStep : 0.5);
}

/** Every row scaled to the target — each pick count is a separate bet the player chooses, so
 * each must pay back the target on its own. */
export function balanceAllRows(settings: KenoGameSettings): number[][] {
  return settings.paytable.map((row, picks) => (picks === 0 ? row : balanceRow(settings, picks)));
}

// --- Settings storage ------------------------------------------------------------------------

export function getKenoDefaultConfig(): KenoRtpConfig {
  return {
    "hexa-keno": {
      targetRtpPercent: DEFAULT_KENO_TARGET_RTP_PERCENT,
      paytable: DEFAULT_PAYTABLES["hexa-keno"].map((r) => [...r]),
      bonusMultiplier: null,
      betLevels: [...DEFAULT_BET_LEVELS],
    },
    "super-keno-balls": {
      targetRtpPercent: DEFAULT_KENO_TARGET_RTP_PERCENT,
      paytable: DEFAULT_PAYTABLES["super-keno-balls"].map((r) => [...r]),
      bonusMultiplier: 4,
      betLevels: [...DEFAULT_BET_LEVELS],
    },
  };
}

const isWholePay = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

function isValidSettings(v: unknown, hasBonus: boolean): v is KenoGameSettings {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const table = s.paytable as unknown[] | undefined;
  const bets = s.betLevels as unknown[] | undefined;
  return (
    typeof s.targetRtpPercent === "number" &&
    Array.isArray(table) &&
    table.length === MAX_PICKS + 1 &&
    table.every((row, picks) => picks === 0 || (Array.isArray(row) &&
          row.length === picks + 1 &&
          row.every((v, m) => isWholePay(v) && (m >= minWinningHits(picks) || v === 0)))) &&
    Array.isArray(bets) &&
    bets.length > 0 &&
    bets.every((b) => typeof b === "number" && b > 0) &&
    (hasBonus ? typeof s.bonusMultiplier === "number" && s.bonusMultiplier >= 1 : s.bonusMultiplier === null)
  );
}

/** Reads the admin's saved keno settings — falls back to the defaults if nothing's been saved,
 * the stored value is malformed (including older saves with decimal pays, or 10-pick pays under
 * 4 hits), or localStorage is unavailable. */
export function getKenoRtpConfig(): KenoRtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getKenoDefaultConfig();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isValidSettings(parsed["hexa-keno"], false) || !isValidSettings(parsed["super-keno-balls"], true)) {
      return getKenoDefaultConfig();
    }
    return parsed as unknown as KenoRtpConfig;
  } catch {
    return getKenoDefaultConfig();
  }
}

/** Persists new keno settings — applies to the next draw. Silently no-ops if localStorage
 * isn't available. */
export function setKenoRtpConfig(config: KenoRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable — nothing to persist to.
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads, before its loading screen finishes. */
export function syncKenoRtpConfigFromServer(): Promise<boolean> {
  return syncRtpConfigFromServer("keno", RTP_CONFIG_STORAGE_KEY);
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveKenoRtpConfigToServer(config: KenoRtpConfig): Promise<void> {
  return saveRtpConfigToServer("keno", config);
}

// --- Draw ------------------------------------------------------------------------------------

/** Uniform integer in [0, max) from the crypto RNG, rejection-sampled to avoid modulo bias. */
function secureRandomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** Draws DRAWN_COUNT unique numbers from 1..POOL_SIZE (partial Fisher-Yates — the last one
 * drawn is uniform over all drawn numbers, which the bonus-ball math relies on). */
function drawNumbers(): number[] {
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => i + 1);
  for (let i = 0; i < DRAWN_COUNT; i++) {
    const j = i + secureRandomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DRAWN_COUNT);
}

/** Returns an error message if `picks` is malformed, otherwise null. */
export function validatePicks(picks: number[]): string | null {
  if (picks.length < MIN_PICKS || picks.length > MAX_PICKS) return `Pick between ${MIN_PICKS} and ${MAX_PICKS} numbers`;
  if (!picks.every((p) => Number.isInteger(p) && p >= 1 && p <= POOL_SIZE)) {
    return `Picks must be whole numbers between 1 and ${POOL_SIZE}`;
  }
  if (new Set(picks).size !== picks.length) return "Picks must be unique";
  return null;
}

export interface KenoDrawResult {
  picks: number[];
  drawn: number[];
  matched: number[];
  /** Super Keno Balls only (the last number drawn). */
  bonusBall: number | null;
  bonusHit: boolean;
  multiplier: number;
  winAmount: number;
  balance: number;
}

/** Plays one draw with the saved settings, charging `betAmount` against `balance`. Throws a
 * user-facing Error for an invalid bet, picks or insufficient balance. */
export function playKenoDraw(gameId: KenoGameId, betAmount: number, picks: number[], balance: number): KenoDrawResult {
  const settings = getKenoRtpConfig()[gameId];
  const minBet = Math.min(...settings.betLevels);
  const maxBet = Math.max(...settings.betLevels);
  if (!Number.isFinite(betAmount) || betAmount < minBet || betAmount > maxBet) {
    throw new Error(`Bet must be between ${minBet} and ${maxBet}`);
  }
  const picksError = validatePicks(picks);
  if (picksError) throw new Error(picksError);
  if (balance < betAmount) throw new Error("Insufficient balance");

  const drawn = drawNumbers();
  const drawnSet = new Set(drawn);
  const matched = picks.filter((p) => drawnSet.has(p));
  const bonusBall = settings.bonusMultiplier ? drawn[drawn.length - 1] : null;
  const bonusHit = bonusBall !== null && matched.includes(bonusBall);
  const base = settings.paytable[picks.length]?.[matched.length] ?? 0;
  const multiplier = bonusHit ? base * settings.bonusMultiplier! : base;
  const winAmount = round2(multiplier * betAmount);

  return {
    picks,
    drawn,
    matched,
    bonusBall,
    bonusHit,
    multiplier,
    winAmount,
    balance: round2(balance - betAmount + winAmount),
  };
}

/** Fire-and-forget: reports a draw that already happened (in the browser) to the game's backend
 * spin-log, which records it and applies it (-bet +win) to the player's stored balance so the
 * balance survives a refresh. Gameplay never waits on it. */
export async function logKenoDraw(
  gameId: KenoGameId,
  params: { betAmount: number; winAmount: number; picks: number[]; drawn: number[]; matched: number[] }
): Promise<void> {
  await apiClient.post(`/api/games/${gameId}/spin-log`, params);
}
