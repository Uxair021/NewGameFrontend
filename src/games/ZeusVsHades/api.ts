/**
 * Zeus vs Hades runs fully client-side, like Buffalo777: every round is resolved locally by
 * engine.ts (the same code the RTP simulator in scripts/zeusVsHades-sim.ts measures) and the
 * balance is updated through AuthContext. There's no backend route for this game.
 *
 * Amounts: the engine works in coins, with one bet = 10 coins. This module converts to money
 * with coinValue = bet / 10.
 *
 * RTP: the engine's TUNING dials and the buy-feature prices can be overridden from the admin page
 * (admin/AdminZeusVsHadesRtpPage.tsx), which saves them to localStorage. Every round and every
 * price lookup re-reads that, so a saved change takes effect on the next spin.
 */
import { saveRtpConfigToServer, syncRtpConfigFromServer } from "../shared/serverRtpConfig";
import { apiClient } from "../../api/client";
import {
  COINS_PER_BET,
  playBuyRound,
  playRound,
  SPECIAL_BET_COINS,
  type BuyOption,
  type SpecialBet,
  type Profile,
  type RoundResult,
} from "./engine";
import { applyTuning, readTuning, type ZeusMeasured, type ZeusTuning } from "./rtpSolver";

export const BET_LEVELS = [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100];
export const DEFAULT_BET_INDEX = 6;

export interface PlayedRound {
  result: RoundResult;
  bet: number;
  coinValue: number;
  cost: number;
  win: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function coinValueFor(bet: number): number {
  return bet / COINS_PER_BET;
}

/** What one spin costs at this bet with a special bet active. */
export function spinCost(bet: number, special: SpecialBet): number {
  return round2(coinValueFor(bet) * SPECIAL_BET_COINS[special]);
}

/** Buy-feature price in x total bet, as set on the admin page. */
export function buyCostX(profile: Profile, option: BuyOption): number {
  return getZeusRtpConfig().tuning.buyCostX[profile][option];
}

export function buyCost(bet: number, profile: Profile, option: BuyOption): number {
  return round2(bet * buyCostX(profile, option));
}

// --- Admin-adjustable RTP control (fully client-side — no backend for this game) ------------

export interface ZeusRtpConfig {
  targetRtpPercent: number;
  tuning: ZeusTuning;
  /** RTP per mode as measured for `tuning`, or null if the dials changed since. */
  measured: ZeusMeasured | null;
}

const RTP_CONFIG_STORAGE_KEY = "texas-slots-zeusvshades-rtp-config";
export const DEFAULT_ZEUS_TARGET_RTP_PERCENT = 95;
/** The dials and prices engine.ts ships with, captured before any saved config is applied. */
const DEFAULT_TUNING = readTuning();

export function getZeusDefaultConfig(): ZeusRtpConfig {
  return {
    targetRtpPercent: DEFAULT_ZEUS_TARGET_RTP_PERCENT,
    tuning: JSON.parse(JSON.stringify(DEFAULT_TUNING)) as ZeusTuning,
    measured: null,
  };
}

/** True if `value` has every numeric field `shape` has (extra fields are ignored), all finite
 * and not negative. */
function matchesShape(shape: unknown, value: unknown): boolean {
  if (typeof shape === "number") return typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (!shape || typeof shape !== "object") return true;
  if (!value || typeof value !== "object") return false;
  return Object.entries(shape).every(([k, v]) => matchesShape(v, (value as Record<string, unknown>)[k]));
}

function isValidConfig(value: unknown): value is ZeusRtpConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.targetRtpPercent !== "number" || !matchesShape(DEFAULT_TUNING, v.tuning)) return false;
  const t = v.tuning as ZeusTuning;
  const dials = [t.base, t.super1, t.super2, t.freeSpins.olympus, t.freeSpins.hades].flatMap((o) => Object.values(o));
  const prices = [t.specialBetX, t.buyCostX.olympus, t.buyCostX.hades].flatMap((o) => Object.values(o));
  return dials.every((d) => d <= 1) && prices.every((p) => p > 0) && t.freeSpinsAwarded >= 1 && t.maxWinX > 0;
}

/** Reads the admin's saved RTP config from localStorage — falls back to the default if nothing's
 * been saved yet, the stored value is malformed, or localStorage is unavailable. */
export function getZeusRtpConfig(): ZeusRtpConfig {
  try {
    const raw = localStorage.getItem(RTP_CONFIG_STORAGE_KEY);
    if (raw === null) return getZeusDefaultConfig();
    const parsed = JSON.parse(raw) as unknown;
    return isValidConfig(parsed) ? parsed : getZeusDefaultConfig();
  } catch {
    return getZeusDefaultConfig();
  }
}

/** Persists a new RTP config — takes effect on the next spin. Silently no-ops if localStorage
 * isn't available. */
export function setZeusRtpConfig(config: ZeusRtpConfig): void {
  try {
    localStorage.setItem(RTP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable — nothing to persist to.
  }
}

/** Fetches the admin-saved config from the server into localStorage (see
 * shared/serverRtpConfig.ts) — called while the game loads — and puts its tuning into the engine. */
export async function syncZeusRtpConfigFromServer(): Promise<boolean> {
  const stored = await syncRtpConfigFromServer("zeus-vs-hades", RTP_CONFIG_STORAGE_KEY);
  if (stored) applyTuning(getZeusRtpConfig().tuning);
  return stored;
}

/** Admin page: saves the config to the server — every player's game loads it from there. */
export function saveZeusRtpConfigToServer(config: ZeusRtpConfig): Promise<void> {
  return saveRtpConfigToServer("zeus-vs-hades", config);
}

// The game's labels (free spins count, max win, special-bet prices) read the engine's live
// values, so apply the saved config as soon as the game loads, not only on the first spin.
applyTuning(getZeusRtpConfig().tuning);

export function playSpin(bet: number, profile: Profile, special: SpecialBet): PlayedRound {
  applyTuning(getZeusRtpConfig().tuning);
  const result = playRound(profile, special);
  const coinValue = coinValueFor(bet);
  return { result, bet, coinValue, cost: spinCost(bet, special), win: round2(result.coins * coinValue) };
}

export function playBuy(bet: number, profile: Profile, option: BuyOption): PlayedRound {
  applyTuning(getZeusRtpConfig().tuning);
  const result = playBuyRound(profile, option);
  const coinValue = coinValueFor(bet);
  return { result, bet, coinValue, cost: buyCost(bet, profile, option), win: round2(result.coins * coinValue) };
}

/** Fire-and-forget: reports a round that was already decided in the browser to the backend's
 * spin-log, which records it and applies it (-cost +win) to the player's stored balance, so the
 * balance survives a refresh. Sent when the round starts — its whole outcome (free spins
 * included) is known then — so leaving mid-animation can't lose it. */
export async function logSpinResult(played: PlayedRound, balanceAfter: number): Promise<void> {
  const r = played.result;
  await apiClient.post("/api/games/zeus-vs-hades/spin-log", {
    betAmount: played.cost,
    winAmount: played.win,
    reelSymbols: [[r.profile, r.base ? "spin" : "buy", `${r.costCoins} coins`, r.freeSpins ? "free spins" : "no free spins"]],
    balanceAfter: Math.max(0, balanceAfter),
    tier: null,
  });
}
