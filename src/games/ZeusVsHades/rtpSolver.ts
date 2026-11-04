/**
 * Zeus vs Hades — in-browser RTP measurement and solver, used by the admin page
 * (admin/AdminZeusVsHadesRtpPage.tsx) through rtpSolver.worker.ts. Same method as
 * scripts/zeusVsHades-sim.ts: every RTP dial is the chance a spin uses the hot reel set instead of
 * its cold partner, so RTP is monotone in each dial and each one can be solved on its own.
 *
 * The work is split into independent jobs (one per buy option, plus one per profile for the
 * base game and super spins) so the page can run them in parallel workers. Each job solves on a
 * seeded sample (common random numbers keep RTP-vs-dial smooth), then re-measures on fresh seeds
 * so the reported RTP is an honest estimate, not the sample it was fitted to.
 *
 * Works on the engine's own TUNING object, so it must run in its own module instance (a
 * worker) — never in the page that's playing the game.
 */
import {
  BUY_COST_X,
  COINS_PER_BET,
  PAYTABLES,
  playBuyRound,
  playRound,
  RULES,
  SPECIAL_BET_COINS,
  TUNING,
  type BuyOption,
  type Profile,
  type Rng,
  type SpecialBet,
} from "./engine";

/** [3, 4, 5 of a kind] pays in x total bet. */
export type PaysX = [number, number, number];

/** Everything the admin page can change: every price, pay and round rule, plus the RTP dials
 * that keep each paid mode at the target RTP whatever those are set to. */
export type ZeusTuning = {
  /** Buy-feature prices, x total bet. */
  buyCostX: Record<Profile, Record<BuyOption, number>>;
  /** Special-bet prices per spin, x total bet. */
  specialBetX: { super1: number; super2: number };
  /** Line pays per profile and symbol (wild + the 10 paying symbols). */
  paysX: Record<Profile, Record<number, PaysX>>;
  freeSpinsAwarded: number;
  maxWinX: number;
  // RTP dials: chance a spin uses the hot reel set, per mode.
  base: Record<Profile, number>;
  freeSpins: Record<Profile, Record<BuyOption, number>>;
  super1: Record<Profile, number>;
  super2: Record<Profile, number>;
};

/** One row per independently-tuned game mode. */
export type ModeKey =
  | "base.olympus"
  | "base.hades"
  | "super1.olympus"
  | "super1.hades"
  | "super2.olympus"
  | "super2.hades"
  | "buyStandard.olympus"
  | "buyStandard.hades"
  | "buySuper.olympus"
  | "buySuper.hades";

export const MODE_KEYS: ModeKey[] = [
  "base.olympus",
  "base.hades",
  "super1.olympus",
  "super1.hades",
  "super2.olympus",
  "super2.hades",
  "buyStandard.olympus",
  "buyStandard.hades",
  "buySuper.olympus",
  "buySuper.hades",
];

/** RTP percent per mode, as last measured. */
export type ZeusMeasured = Record<ModeKey, number>;

export function getDial(tuning: ZeusTuning, key: ModeKey): number {
  const [mode, profile] = key.split(".") as [string, Profile];
  if (mode === "buyStandard") return tuning.freeSpins[profile].standard;
  if (mode === "buySuper") return tuning.freeSpins[profile].super;
  return tuning[mode as "base" | "super1" | "super2"][profile];
}

export function withDial(tuning: ZeusTuning, key: ModeKey, value: number): ZeusTuning {
  const next = cloneTuning(tuning);
  const [mode, profile] = key.split(".") as [string, Profile];
  if (mode === "buyStandard") next.freeSpins[profile].standard = value;
  else if (mode === "buySuper") next.freeSpins[profile].super = value;
  else next[mode as "base" | "super1" | "super2"][profile] = value;
  return next;
}

export function cloneTuning(t: ZeusTuning): ZeusTuning {
  return JSON.parse(JSON.stringify(t)) as ZeusTuning;
}

/** Copies a tuning into the engine's live objects (prices, paytables, rules and dials). */
export function applyTuning(t: ZeusTuning): void {
  BUY_COST_X.olympus = { ...t.buyCostX.olympus };
  BUY_COST_X.hades = { ...t.buyCostX.hades };
  SPECIAL_BET_COINS.super1 = t.specialBetX.super1 * COINS_PER_BET;
  SPECIAL_BET_COINS.super2 = t.specialBetX.super2 * COINS_PER_BET;
  for (const profile of ["olympus", "hades"] as const) {
    const pays = {} as Record<number, PaysX>;
    for (const [sym, x] of Object.entries(t.paysX[profile])) {
      pays[Number(sym)] = x.map((v) => v * COINS_PER_BET) as PaysX;
    }
    PAYTABLES[profile] = pays;
  }
  RULES.freeSpinsAwarded = t.freeSpinsAwarded;
  RULES.maxWinX = t.maxWinX;
  TUNING.base = { ...t.base };
  TUNING.freeSpins = {
    olympus: { ...t.freeSpins.olympus },
    hades: { ...t.freeSpins.hades },
  };
  TUNING.super1 = { ...t.super1 };
  TUNING.super2 = { ...t.super2 };
}

export function readTuning(): ZeusTuning {
  const paysX = (profile: Profile) => {
    const out = {} as Record<number, PaysX>;
    for (const [sym, coins] of Object.entries(PAYTABLES[profile])) {
      out[Number(sym)] = coins.map((c) => c / COINS_PER_BET) as PaysX;
    }
    return out;
  };
  return cloneTuning({
    ...TUNING,
    buyCostX: BUY_COST_X,
    specialBetX: { super1: SPECIAL_BET_COINS.super1 / COINS_PER_BET, super2: SPECIAL_BET_COINS.super2 / COINS_PER_BET },
    paysX: { olympus: paysX("olympus"), hades: paysX("hades") },
    freeSpinsAwarded: RULES.freeSpinsAwarded,
    maxWinX: RULES.maxWinX,
  });
}

// ---------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------

export type JobKey =
  | "buy.olympus.standard"
  | "buy.olympus.super"
  | "buy.hades.standard"
  | "buy.hades.super"
  | "spins.olympus"
  | "spins.hades";

export const JOB_KEYS: JobKey[] = [
  "buy.olympus.standard",
  "buy.olympus.super",
  "buy.hades.standard",
  "buy.hades.super",
  "spins.olympus",
  "spins.hades",
];

export interface JobResult {
  /** Solved dial values (empty when only measuring). */
  dials: Partial<Record<ModeKey, number>>;
  /** Measured RTP percent for every mode the job covers except the base game, which needs the
   * standard-buy result from another job — see `baseRtpPercent`. */
  measured: Partial<Record<ModeKey, number>>;
  /** Base-game line-win RTP (fraction), free-spins trigger rate and the standard buy price it
   * was measured with, for spins jobs. */
  base?: { profile: Profile; lineRtp: number; fsRate: number; buyStandardCostX: number };
  /** Modes whose target lies outside what their dial can reach (dial pinned at 0 or 1). */
  warnings: string[];
}

/** Base-game RTP: sampled line wins plus the trigger rate times the average free-spins value
 * (the standard buy's measured RTP times its price) — a raw base sample is dominated by a
 * handful of free-spins rounds. */
export function baseRtpPercent(
  base: NonNullable<JobResult["base"]>,
  buyStandardRtpPercent: number
): number {
  const fsValueX = (buyStandardRtpPercent / 100) * base.buyStandardCostX;
  return (base.lineRtp + base.fsRate * fsValueX) * 100;
}

/** Sample sizes. Everything here is heavy-tailed — a 15,000x max win against a 10-15x buy price,
 * and stacked wild-reel multipliers in the base game — so RTP swings ~12-16x the stake per
 * round and these sizes are what ~1-2% accuracy costs. */
const BUY_N: Record<BuyOption, number> = { standard: 400_000, super: 300_000 };
const SPIN_N = 2_000_000;
const SPECIAL_N = 400_000;
const MAX_ITERATIONS = 6;
/** Stop iterating once the solving sample is this close to the target (fraction). */
const SOLVE_TOLERANCE = 0.002;

/** Seeded RNG so every measurement while solving sees the same random sequence (common random
 * numbers) — keeps the RTP-vs-dial curve smooth enough to root-find on. */
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

/** Fresh seed for the honest re-measurement after solving. */
const freshSeed = () => Math.floor(Math.random() * 2 ** 31);

interface SpinStats {
  rtp: number;
  lineRtp: number;
  fsRate: number;
}

function measureSpins(profile: Profile, n: number, rng: Rng, special: SpecialBet = "none"): SpinStats {
  let won = 0;
  let lineWon = 0;
  let fs = 0;
  for (let i = 0; i < n; i++) {
    const r = playRound(profile, special, rng);
    won += r.coins;
    lineWon += r.base?.coins ?? 0;
    if (r.freeSpins) fs++;
  }
  const cost = n * SPECIAL_BET_COINS[special];
  return { rtp: won / cost, lineRtp: lineWon / cost, fsRate: fs / n };
}

function measureBuy(profile: Profile, option: BuyOption, n: number, rng: Rng): number {
  let won = 0;
  for (let i = 0; i < n; i++) won += playBuyRound(profile, option, rng).coins;
  return won / (n * BUY_COST_X[profile][option] * COINS_PER_BET);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export type Progress = (fraction: number, label: string) => void;

/**
 * Finds the dial in [0, 1] where measure(dial) = goal. RTP rises with the dial, so this is a
 * bracketed root-find (regula falsi, Illinois variant): far fewer measurements than bisection,
 * which matters when one measurement is several seconds. If the goal is out of reach the dial is
 * pinned at 0 or 1 and a warning added.
 */
function solveDial(
  set: (p: number) => void,
  measure: () => number,
  goal: number,
  label: string,
  warnings: string[],
  tick: () => void
): void {
  let lo = 0;
  set(lo);
  let fLo = measure() - goal;
  tick();
  let hi = 1;
  set(hi);
  let fHi = measure() - goal;
  tick();
  if (fLo > 0 || fHi < 0) {
    warnings.push(`${label}: target ${pct(goal)} outside reachable ${pct(fLo + goal)} – ${pct(fHi + goal)}`);
    set(fLo > 0 ? 0 : 1);
    return;
  }
  let side = 0;
  let p = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    p = clamp01(lo - (fLo * (hi - lo)) / (fHi - fLo));
    set(p);
    const f = measure() - goal;
    tick();
    if (Math.abs(f) < SOLVE_TOLERANCE) break;
    if (f < 0) {
      lo = p;
      fLo = f;
      if (side === -1) fHi /= 2;
      side = -1;
    } else {
      hi = p;
      fHi = f;
      if (side === 1) fLo /= 2;
      side = 1;
    }
  }
  set(p);
}

/** Single-spin modes are exactly linear in their dial (the dial just picks which reel set a spin
 * uses), so two measurements — all cold, all hot — and an interpolation solve them. */
function solveLinearDial(
  set: (p: number) => void,
  measure: () => number,
  goal: number,
  label: string,
  warnings: string[],
  tick: () => void
): void {
  set(0);
  const cold = measure();
  tick();
  set(1);
  const hot = measure();
  tick();
  if (goal < cold || goal > hot) warnings.push(`${label}: target ${pct(goal)} outside reachable ${pct(cold)} – ${pct(hot)}`);
  // hot <= cold only if the pays are degenerate (e.g. all zero) — the dial can't help either way.
  set(hot > cold ? clamp01((goal - cold) / (hot - cold)) : 1);
}

/** Total progress ticks a job reports, so callers can show a smooth bar. */
function jobSteps(job: JobKey, solve: boolean): number {
  const solveSteps = 2 + MAX_ITERATIONS;
  if (job.startsWith("buy.")) return (solve ? solveSteps : 0) + 1;
  // spins: fsRate + 3 linear dials (2 measurements each) when solving; then 3 measurements.
  return (solve ? 1 + 3 * 2 : 0) + 3;
}

/**
 * Runs one job against the engine's current TUNING. With a target it solves that job's dials
 * first (leaving them in TUNING); either way it then measures them on fresh random numbers.
 */
export function runJob(job: JobKey, targetPercent: number | null, onProgress: Progress = () => {}): JobResult {
  const solve = targetPercent !== null;
  const target = (targetPercent ?? 0) / 100;
  const total = jobSteps(job, solve);
  let step = 0;
  let label = "";
  const tick = () => onProgress(Math.min(++step / total, 1), label);
  const warnings: string[] = [];
  const dials: JobResult["dials"] = {};
  const measured: JobResult["measured"] = {};

  const parts = job.split(".");
  const profile = parts[1] as Profile;

  if (parts[0] === "buy") {
    const option = parts[2] as BuyOption;
    const mode: ModeKey = option === "standard" ? `buyStandard.${profile}` : `buySuper.${profile}`;
    const n = BUY_N[option];
    label = `${profile} buy ${option}`;
    onProgress(0, label);
    if (solve) {
      solveDial(
        (v) => (TUNING.freeSpins[profile][option] = v),
        () => measureBuy(profile, option, n, seeded(7)),
        target,
        label,
        warnings,
        tick
      );
      dials[mode] = TUNING.freeSpins[profile][option];
    }
    measured[mode] = measureBuy(profile, option, n, seeded(freshSeed())) * 100;
    tick();
    return { dials, measured, warnings };
  }

  label = `${profile} base game`;
  onProgress(0, label);
  if (solve) {
    // Natural free spins are worth target x the standard buy price once the buy jobs are solved,
    // so only the line-win part of the base game needs solving. The trigger rate doesn't depend
    // on the base dial (hot and cold reel sets carry the same scatters).
    // A quarter sample is plenty: free spins are only ~4-5% of base RTP.
    const fsRate = measureSpins(profile, SPIN_N / 4, seeded(11)).fsRate;
    tick();
    const lineTarget = target - fsRate * target * BUY_COST_X[profile].standard;
    solveLinearDial(
      (v) => (TUNING.base[profile] = v),
      () => measureSpins(profile, SPIN_N, seeded(13)).lineRtp,
      lineTarget,
      label,
      warnings,
      tick
    );
    dials[`base.${profile}`] = TUNING.base[profile];
    for (const special of ["super1", "super2"] as const) {
      label = `${profile} ${special}`;
      solveLinearDial(
        (v) => (TUNING[special][profile] = v),
        () => measureSpins(profile, SPECIAL_N, seeded(17), special).rtp,
        target,
        label,
        warnings,
        tick
      );
      dials[`${special}.${profile}`] = TUNING[special][profile];
    }
  }

  label = `${profile} measuring`;
  const b = measureSpins(profile, SPIN_N, seeded(freshSeed()));
  tick();
  for (const special of ["super1", "super2"] as const) {
    measured[`${special}.${profile}`] = measureSpins(profile, SPECIAL_N, seeded(freshSeed()), special).rtp * 100;
    tick();
  }
  const buyStandardCostX = BUY_COST_X[profile].standard;
  return { dials, measured, base: { profile, lineRtp: b.lineRtp, fsRate: b.fsRate, buyStandardCostX }, warnings };
}
