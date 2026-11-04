/**
 * Runs one Zeus vs Hades RTP job (rtpSolver.ts) off the main thread. The admin page starts one
 * worker per job so they run in parallel. Each worker has its own copy of engine.ts, so changing
 * TUNING here never touches a game being played in the same tab.
 */
import { applyTuning, runJob, type JobKey, type JobResult, type ZeusTuning } from "./rtpSolver";

export interface SolverRequest {
  job: JobKey;
  tuning: ZeusTuning;
  /** Solve for this RTP, or null to only measure the given tuning. */
  targetPercent: number | null;
}

export type SolverResponse =
  | { type: "progress"; fraction: number; label: string }
  | { type: "done"; result: JobResult }
  | { type: "error"; message: string };

const ctx = self as unknown as {
  postMessage(message: SolverResponse): void;
  onmessage: ((e: MessageEvent<SolverRequest>) => void) | null;
};

ctx.onmessage = (e) => {
  const { job, tuning, targetPercent } = e.data;
  try {
    applyTuning(tuning);
    const result = runJob(job, targetPercent, (fraction, label) => ctx.postMessage({ type: "progress", fraction, label }));
    ctx.postMessage({ type: "done", result });
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
