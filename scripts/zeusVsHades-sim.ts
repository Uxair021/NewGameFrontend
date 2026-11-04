/**
 * RTP simulator / tuner for Zeus vs Hades (src/games/ZeusVsHades/engine.ts).
 *
 *   node scripts/zeusVsHades-sim.ts            # measure current TUNING
 *   node scripts/zeusVsHades-sim.ts --solve    # solve the TUNING dials for TARGET_RTP, then measure
 *   node scripts/zeusVsHades-sim.ts --solve --write   # ...and save the solved dials into engine.ts
 *   options: --n=<base spins per measurement> --buyn=<free-spins rounds per measurement>
 *
 * Runs on Node 22.6+ (built-in TypeScript type stripping), no build step.
 */
import fs from "node:fs";
import {
  TUNING,
  COINS_PER_BET,
  BUY_COST_X,
  playRound,
  playBuyRound,
  SPECIAL_BET_COINS,
  type SpecialBet,
  type Profile,
  type BuyOption,
  type Rng,
} from "../src/games/ZeusVsHades/engine.ts";

const TARGET_RTP = 0.95;
const PROFILES: Profile[] = ["olympus", "hades"];
const BUYS: BuyOption[] = ["standard", "super"];

const args = process.argv.slice(2);
const SOLVE = args.includes("--solve");
const WRITE = args.includes("--write");

/** Rewrites the TUNING literal in engine.ts with the solved values. */
function writeTuning(): void {
  const r = (v: number) => +v.toFixed(4);
  const pair = (o: Record<Profile, number>) => `{ olympus: ${r(o.olympus)}, hades: ${r(o.hades)} }`;
  const fsLine = (p: Profile) => {
    const t = TUNING.freeSpins[p];
    return `    ${p}: { standard: ${r(t.standard)}, super: ${r(t.super)} },`;
  };
  const block = [
    "export const TUNING = {",
    `  base: ${pair(TUNING.base)},`,
    '  /** Free spins, per how the round was entered (natural trigger uses "standard"). */',
    "  freeSpins: {",
    fsLine("olympus"),
    fsLine("hades"),
    "  } as Record<Profile, Record<BuyOption, number>>,",
    `  super1: ${pair(TUNING.super1)},`,
    `  super2: ${pair(TUNING.super2)},`,
    "};",
  ].join("\n");
  const path = new URL("../src/games/ZeusVsHades/engine.ts", import.meta.url);
  const src = fs.readFileSync(path, "utf8");
  const next = src.replace(/export const TUNING = \{[\s\S]*?\n\};/, block);
  if (next === src) throw new Error("TUNING block not found in engine.ts");
  fs.writeFileSync(path, next);
  console.log("Wrote solved TUNING into engine.ts");
}
const N = Number(args.find((a) => a.startsWith("--n="))?.slice(4) ?? 1_000_000);
const BUY_N = Number(args.find((a) => a.startsWith("--buyn="))?.slice(7) ?? 100_000);

/** Seeded RNG so every measurement in a bisection sees the same random sequence (common random
 * numbers) — keeps the RTP-vs-dial curve smooth enough to bisect on. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stats {
  rtp: number;
  /** RTP from base-game line wins only (free spins excluded). */
  lineRtp: number;
  hitRate: number;
  fsRate: number;
  maxX: number;
}

function measureSpins(profile: Profile, n: number, rng: Rng = Math.random, special: SpecialBet = "none"): Stats {
  let won = 0;
  let lineWon = 0;
  let hits = 0;
  let fs = 0;
  let maxX = 0;
  for (let i = 0; i < n; i++) {
    const r = playRound(profile, special, rng);
    won += r.coins;
    lineWon += r.base?.coins ?? 0;
    if (r.coins > 0) hits++;
    if (r.freeSpins) fs++;
    maxX = Math.max(maxX, r.coins / COINS_PER_BET);
  }
  const cost = n * SPECIAL_BET_COINS[special];
  return { rtp: won / cost, lineRtp: lineWon / cost, hitRate: hits / n, fsRate: fs / n, maxX };
}

function measureBuy(profile: Profile, option: BuyOption, n: number, rng: Rng = Math.random): Stats {
  let won = 0;
  let maxX = 0;
  for (let i = 0; i < n; i++) {
    const r = playBuyRound(profile, option, rng);
    won += r.coins;
    maxX = Math.max(maxX, r.coins / COINS_PER_BET);
  }
  const rtp = won / (n * BUY_COST_X[profile][option] * COINS_PER_BET);
  return { rtp, lineRtp: rtp, hitRate: 1, fsRate: 1, maxX };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** RTP is monotone in the dial; bisection copes with the (mild) non-linearity sticky wilds add. */
function bisect(set: (p: number) => void, measure: () => number, label: string): number {
  let lo = 0;
  let hi = 1;
  set(lo);
  const atLo = measure();
  set(hi);
  const atHi = measure();
  if (TARGET_RTP < atLo || TARGET_RTP > atHi) {
    console.warn(`  ! ${label}: target ${pct(TARGET_RTP)} outside reachable ${pct(atLo)}..${pct(atHi)}`);
    const p = TARGET_RTP < atLo ? 0 : 1;
    set(p);
    return p;
  }
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (measure() < TARGET_RTP) lo = mid;
    else hi = mid;
  }
  const p = (lo + hi) / 2;
  set(p);
  return p;
}

/** Single-spin modes are exactly linear in the dial: measure both ends and interpolate. */
function solveLinear(set: (p: number) => void, measure: () => number, label: string, target = TARGET_RTP): number {
  set(0);
  const cold = measure();
  set(1);
  const hot = measure();
  if (target < cold || target > hot) {
    console.warn(`  ! ${label}: target ${pct(target)} outside reachable ${pct(cold)}..${pct(hot)}`);
  }
  const p = clamp01((target - cold) / (hot - cold));
  set(p);
  return p;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

if (SOLVE) {
  console.log("Solving free-spins dials (buy RTP)...");
  for (const profile of PROFILES) {
    for (const option of BUYS) {
      const p = bisect(
        (v) => (TUNING.freeSpins[profile][option] = v),
        () => measureBuy(profile, option, BUY_N, seeded(7)).rtp,
        `${profile} buy ${option}`
      );
      console.log(`  freeSpins.${profile}.${option} = ${p.toFixed(4)}`);
    }
  }
  console.log("Solving base-game dials...");
  for (const profile of PROFILES) {
    // Natural free spins are worth exactly TARGET_RTP x the standard buy price (that dial was
    // just solved), so only the line-win part of the base game needs sampling.
    const fsRate = measureSpins(profile, N, seeded(11)).fsRate;
    const fsShare = fsRate * TARGET_RTP * BUY_COST_X[profile].standard;
    const lineTarget = TARGET_RTP - fsShare;
    console.log(`  ${profile}: FS 1 in ${Math.round(1 / fsRate)} -> FS share ${pct(fsShare)}, line target ${pct(lineTarget)}`);
    const pb = solveLinear(
      (v) => (TUNING.base[profile] = v),
      () => measureSpins(profile, N, seeded(13)).lineRtp,
      `${profile} base`,
      lineTarget
    );
    console.log(`  base.${profile} = ${pb.toFixed(4)}`);
    for (const special of ["super1", "super2"] as const) {
      const ps = solveLinear(
        (v) => (TUNING[special][profile] = v),
        () => measureSpins(profile, N / 2, seeded(17), special).rtp,
        `${profile} ${special}`
      );
      console.log(`  ${special}.${profile} = ${ps.toFixed(4)}`);
    }
  }
  if (WRITE) writeTuning();
  else console.log("\nSolved (re-run with --write to save into engine.ts):\n" + JSON.stringify(TUNING, null, 2));
}

console.log("\nVerification (fresh random numbers):");
for (const profile of PROFILES) {
  const buys = BUYS.map((option) => [option, measureBuy(profile, option, BUY_N)] as const);
  const b = measureSpins(profile, N);
  // Sampled base RTP is dominated by a handful of free-spins rounds; the "expected" figure
  // replaces those with the measured average free-spins value.
  const fsValue = buys[0][1].rtp * BUY_COST_X[profile].standard;
  const expected = b.lineRtp + b.fsRate * fsValue;
  console.log(
    `  ${profile.padEnd(7)} base     RTP ${pct(expected)} expected, ${pct(b.rtp)} sampled (lines ${pct(b.lineRtp)})  hit ${pct(b.hitRate)}  FS 1 in ${Math.round(1 / b.fsRate)} avg ${fsValue.toFixed(1)}x  max ${b.maxX.toFixed(0)}x`
  );
  for (const special of ["super1", "super2"] as const) {
    const s = measureSpins(profile, N / 2, Math.random, special);
    console.log(`  ${profile.padEnd(7)} ${special.padEnd(8)} RTP ${pct(s.rtp)}  hit ${pct(s.hitRate)}  max ${s.maxX.toFixed(0)}x`);
  }
  for (const [option, s] of buys) {
    console.log(`  ${profile.padEnd(7)} buy ${option.padEnd(8)} RTP ${pct(s.rtp)}  max ${s.maxX.toFixed(0)}x`);
  }
}
