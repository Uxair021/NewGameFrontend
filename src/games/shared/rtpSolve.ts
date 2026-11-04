/**
 * Frequency-only RTP solver for games whose RTP can only be measured by simulation (house rule:
 * RTP is matched by changing weights, never the pays — see rtpRules.ts).
 *
 * The game supplies two weight "shapes" around the current config — `lean` (pays less: weight on
 * the cheapest outcomes) and `rich` (pays more) — and a `blend(a, b, t)` that slides frequencies
 * from a (t = 0) to b (t = 1), leaving every pay untouched. The solver measures the current
 * config, then bisects along the blend toward whichever side the target lies on. Measurements
 * reuse one seed, so the curve is smooth enough to bisect on even though each point is simulated.
 */

export interface BlendSolveOptions<C> {
  current: C;
  lean: C;
  rich: C;
  blend: (a: C, b: C, t: number) => C;
  /** RTP % of a config, simulated on a fixed seed. `onProgress` reports this one measurement. */
  measure: (config: C, onProgress?: (fraction: number) => void) => Promise<number>;
  target: number;
  /** Bisection steps (each one a measurement). */
  steps?: number;
  /** Stop once within this many RTP points. */
  tolerance?: number;
  onProgress?: (fraction: number) => void;
}

export interface BlendSolveResult<C> {
  config: C;
  /** RTP % of `config` on the solver's own seed. */
  rtpPercent: number;
  /** False when even the lean/rich end can't reach the target — `config` is then that end. */
  reachable: boolean;
}

export async function solveByBlend<C>(opts: BlendSolveOptions<C>): Promise<BlendSolveResult<C>> {
  const steps = opts.steps ?? 12;
  const tolerance = opts.tolerance ?? 0.15;
  const totalMeasurements = steps + 2;
  let done = 0;
  const measure = (config: C) =>
    opts.measure(config, (f) => opts.onProgress?.(Math.min(1, (done + f) / totalMeasurements))).then((rtp) => {
      done++;
      return rtp;
    });

  const startRtp = await measure(opts.current);
  if (Math.abs(startRtp - opts.target) <= tolerance) {
    opts.onProgress?.(1);
    return { config: opts.current, rtpPercent: startRtp, reachable: true };
  }

  const end = startRtp > opts.target ? opts.lean : opts.rich;
  const endRtp = await measure(end);
  const between = (opts.target - startRtp) * (opts.target - endRtp) <= 0;
  if (!between) {
    opts.onProgress?.(1);
    return { config: end, rtpPercent: endRtp, reachable: false };
  }

  // RTP moves monotonically from startRtp (t = 0) to endRtp (t = 1) along the blend.
  let lo = 0;
  let hi = 1;
  let best = { config: end, rtpPercent: endRtp };
  for (let i = 0; i < steps; i++) {
    const t = (lo + hi) / 2;
    const candidate = opts.blend(opts.current, end, t);
    const rtp = await measure(candidate);
    if (Math.abs(rtp - opts.target) < Math.abs(best.rtpPercent - opts.target)) best = { config: candidate, rtpPercent: rtp };
    if (Math.abs(rtp - opts.target) <= tolerance) break;
    // Still on the start's side of the target → move further toward `end`.
    if ((rtp - opts.target) * (startRtp - opts.target) > 0) lo = t;
    else hi = t;
  }
  opts.onProgress?.(1);
  return { ...best, reachable: true };
}

/** Linear blend of two frequency tables keyed by `key`, renormalised to sum to 100. */
export function blendFrequencies<R extends { key: string; frequencyPercent: number }>(a: R[], b: R[], t: number): R[] {
  const bByKey = new Map(b.map((r) => [r.key, r.frequencyPercent]));
  const mixed = a.map((r) => ({ ...r, frequencyPercent: r.frequencyPercent * (1 - t) + (bByKey.get(r.key) ?? r.frequencyPercent) * t }));
  const sum = mixed.reduce((s, r) => s + r.frequencyPercent, 0) || 1;
  return mixed.map((r) => ({ ...r, frequencyPercent: Math.round(((r.frequencyPercent / sum) * 100) * 10000) / 10000 }));
}
