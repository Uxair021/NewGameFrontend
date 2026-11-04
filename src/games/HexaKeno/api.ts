/**
 * Hexa Keno runs fully client-side: draws are resolved in the browser by games/shared/keno.ts
 * with the admin's saved settings (admin/AdminKenoRtpPage.tsx), and the balance is updated
 * through AuthContext. Same function names as the old network calls, so HexaKenoGame.tsx
 * barely changed.
 */
import { DRAWN_COUNT, MAX_PICKS, MIN_PICKS, POOL_SIZE, getKenoRtpConfig, playKenoDraw } from "../shared/keno";
import { hexaKenoMeta } from "./meta";


export interface HexaKenoConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: number[][];
  betLevels: number[];
  poolSize: number;
  drawnCount: number;
  minPicks: number;
  maxPicks: number;
}

export interface HexaKenoSpinResponse {
  picks: number[];
  drawn: number[];
  matched: number[];
  multiplier: number;
  winAmount: number;
  balance: number;
}

export async function getHexaKenoConfig(): Promise<HexaKenoConfigResponse> {
  const settings = getKenoRtpConfig()["hexa-keno"];
  return {
    meta: {
      id: hexaKenoMeta.slug,
      name: hexaKenoMeta.name,
      description: hexaKenoMeta.description,
      minBet: Math.min(...settings.betLevels),
      maxBet: Math.max(...settings.betLevels),
    },
    paytable: settings.paytable,
    betLevels: settings.betLevels,
    poolSize: POOL_SIZE,
    drawnCount: DRAWN_COUNT,
    minPicks: MIN_PICKS,
    maxPicks: MAX_PICKS,
  };
}

export async function spinHexaKeno(betAmount: number, picks: number[], balance: number): Promise<HexaKenoSpinResponse> {
  const r = playKenoDraw("hexa-keno", betAmount, picks, balance);
  return {
    picks: r.picks,
    drawn: r.drawn,
    matched: r.matched,
    multiplier: r.multiplier,
    winAmount: r.winAmount,
    balance: r.balance,
  };
}
