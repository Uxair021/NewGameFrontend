/**
 * Super Keno Balls runs fully client-side: draws are resolved in the browser by
 * games/shared/keno.ts with the admin's saved settings (admin/AdminKenoRtpPage.tsx), and the
 * balance is updated through AuthContext. Same function names as the old network calls, so
 * SuperKenoBallsGame.tsx barely changed.
 */
import { DRAWN_COUNT, MAX_PICKS, MIN_PICKS, POOL_SIZE, getKenoRtpConfig, playKenoDraw } from "../shared/keno";
import { superKenoBallsMeta } from "./meta";


export interface SuperKenoBallsConfigResponse {
  meta: { id: string; name: string; description: string; minBet: number; maxBet: number };
  paytable: number[][];
  betLevels: number[];
  poolSize: number;
  drawnCount: number;
  minPicks: number;
  maxPicks: number;
  bonusMultiplier: number;
}

export interface SuperKenoBallsSpinResponse {
  picks: number[];
  drawn: number[];
  matched: number[];
  bonusBall: number;
  bonusHit: boolean;
  multiplier: number;
  winAmount: number;
  balance: number;
}

export async function getSuperKenoBallsConfig(): Promise<SuperKenoBallsConfigResponse> {
  const settings = getKenoRtpConfig()["super-keno-balls"];
  return {
    meta: {
      id: superKenoBallsMeta.slug,
      name: superKenoBallsMeta.name,
      description: superKenoBallsMeta.description,
      minBet: Math.min(...settings.betLevels),
      maxBet: Math.max(...settings.betLevels),
    },
    paytable: settings.paytable,
    betLevels: settings.betLevels,
    poolSize: POOL_SIZE,
    drawnCount: DRAWN_COUNT,
    minPicks: MIN_PICKS,
    maxPicks: MAX_PICKS,
    bonusMultiplier: settings.bonusMultiplier ?? 1,
  };
}

export async function spinSuperKenoBalls(
  betAmount: number,
  picks: number[],
  balance: number
): Promise<SuperKenoBallsSpinResponse> {
  const r = playKenoDraw("super-keno-balls", betAmount, picks, balance);
  return {
    picks: r.picks,
    drawn: r.drawn,
    matched: r.matched,
    bonusBall: r.bonusBall!,
    bonusHit: r.bonusHit,
    multiplier: r.multiplier,
    winAmount: r.winAmount,
    balance: r.balance,
  };
}
