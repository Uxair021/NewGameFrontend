import { useEffect, useRef, useState, type ReactNode } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import {
  DEFAULT_ZEUS_TARGET_RTP_PERCENT,
  ZeusRtpConfig,
  getZeusDefaultConfig,
  getZeusRtpConfig,
  setZeusRtpConfig,
  saveZeusRtpConfigToServer,
  syncZeusRtpConfigFromServer,
} from "../games/ZeusVsHades/api";
import { COINS_PER_BET, type BuyOption, type Profile } from "../games/ZeusVsHades/engine";
import { SYMBOL_NAMES, symbolUrl } from "../games/ZeusVsHades/art";
import {
  JOB_KEYS,
  JobKey,
  JobResult,
  MODE_KEYS,
  ModeKey,
  ZeusMeasured,
  ZeusTuning,
  baseRtpPercent,
  cloneTuning,
  getDial,
  withDial,
} from "../games/ZeusVsHades/rtpSolver";
import type { SolverRequest, SolverResponse } from "../games/ZeusVsHades/rtpSolver.worker";

const PROFILES: { id: Profile; name: string }[] = [
  { id: "olympus", name: "Olympus (Zeus)" },
  { id: "hades", name: "Hades" },
];

const MODE_LABELS: Record<ModeKey, string> = {
  "base.olympus": "Normal spin — Olympus",
  "base.hades": "Normal spin — Hades",
  "super1.olympus": "Super Spin 1 — Olympus",
  "super1.hades": "Super Spin 1 — Hades",
  "super2.olympus": "Super Spin 2 — Olympus",
  "super2.hades": "Super Spin 2 — Hades",
  "buyStandard.olympus": "Buy free spins — Olympus",
  "buyStandard.hades": "Buy free spins — Hades",
  "buySuper.olympus": "Buy super free spins — Olympus",
  "buySuper.hades": "Buy super free spins — Hades",
};

/** Wild first, then the paying symbols highest first. */
const PAYING_SYMBOLS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** Symbols with no line pay of their own, listed so every symbol is on the page. */
const SPECIAL_SYMBOLS: { id: number; note: string }[] = [
  { id: 1, note: "No line pay — 3 on reels 1, 3 and 5 trigger the free spins." },
  { id: 13, note: "No line pay — expands to cover its reel as a wild with a random multiplier." },
];

/** Measured RTP is a simulation estimate (the game's wins are heavy-tailed), so it's allowed a
 * wider band than the exact-math pages' ±0.5%. */
const RTP_TOLERANCE = 2.0;

function inputClass(invalid = false, width = "w-24"): string {
  return `${width} rounded-lg border bg-white px-2 py-1.5 text-sm text-slate-800 ${
    invalid ? "border-rose-500" : "border-slate-300"
  }`;
}

/** Price of a mode in x total bet, for the results table. */
function modePriceX(t: ZeusTuning, key: ModeKey): number {
  const [mode, profile] = key.split(".") as [string, Profile];
  if (mode === "buyStandard") return t.buyCostX[profile].standard;
  if (mode === "buySuper") return t.buyCostX[profile].super;
  if (mode === "super1" || mode === "super2") return t.specialBetX[mode];
  return 1;
}

type Run = { kind: "solve" | "measure"; fractions: Record<JobKey, number>; label: string };

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 text-sm font-semibold text-slate-800">{title}</div>
      {children}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  step,
  min,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  min: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500">{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={`${inputClass(!(value >= min), "w-full")} mt-1`}
      />
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

/**
 * Zeus vs Hades runs fully client-side (no backend), so like the other dedicated pages this
 * control lives in localStorage and the saved config is what games/ZeusVsHades/api.ts plays with
 * on the next spin.
 *
 * The admin sets one target RTP and every price, pay and round rule. "Solve" then tunes each paid
 * feature (normal spin, both special bets, both buys, per profile) to pay back the target RTP at
 * those prices — through that feature's reel dial, the chance a spin uses the "hot" reel set
 * instead of its "cold" partner. RTP can't be computed exactly for a reel slot like this, so it's
 * measured by simulation, split into independent jobs that each run in their own Web Worker
 * (games/ZeusVsHades/rtpSolver.worker.ts).
 */
export function AdminZeusVsHadesRtpPage() {
  const [config, setConfig] = useState<ZeusRtpConfig>(() => getZeusRtpConfig());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** True until the server's saved config has been fetched — the page then shows that (the live
   * config every player loads), not just whatever this browser had. */
  const [loadingServer, setLoadingServer] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void syncZeusRtpConfigFromServer().then(() => {
      if (cancelled) return;
      const next = getZeusRtpConfig();
      const changed = JSON.stringify(next) !== JSON.stringify(config);
      if (changed) setConfig(next);
      setLoadingServer(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [savedOk, setSavedOk] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paysProfile, setPaysProfile] = useState<Profile>("olympus");
  const workersRef = useRef<Worker[]>([]);

  useEffect(() => () => workersRef.current.forEach((w) => w.terminate()), []);

  const t = config.tuning;
  const running = run !== null;
  const progress = run ? JOB_KEYS.reduce((sum, k) => sum + run.fractions[k], 0) / JOB_KEYS.length : 0;
  const prices = [t.specialBetX.super1, t.specialBetX.super2, ...PROFILES.flatMap((p) => Object.values(t.buyCostX[p.id]))];
  const pays = PROFILES.flatMap((p) => Object.values(t.paysX[p.id]).flat());
  const inputsValid =
    config.targetRtpPercent > 0 &&
    prices.every((v) => v > 0) &&
    pays.every((v) => v >= 0) &&
    Number.isInteger(t.freeSpinsAwarded) &&
    t.freeSpinsAwarded >= 1 &&
    t.maxWinX > 0;
  const offTarget = config.measured
    ? MODE_KEYS.filter((k) => Math.abs(config.measured![k] - config.targetRtpPercent) > RTP_TOLERANCE)
    : [];

  /** Any change to a price, pay or rule invalidates the measurement — RTP must be re-solved. */
  function edit(mutate: (t: ZeusTuning) => void) {
    setSavedOk(false);
    setConfig((prev) => {
      const tuning = cloneTuning(prev.tuning);
      mutate(tuning);
      return { ...prev, tuning, measured: null };
    });
  }

  function stopWorkers() {
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];
  }

  function start(kind: Run["kind"]) {
    stopWorkers();
    setSavedOk(false);
    setError(null);
    const fractions = Object.fromEntries(JOB_KEYS.map((k) => [k, 0])) as Record<JobKey, number>;
    setRun({ kind, fractions, label: "Starting..." });

    const tuning = config.tuning;
    const targetPercent = kind === "solve" ? config.targetRtpPercent : null;
    const results = new Map<JobKey, JobResult>();

    for (const job of JOB_KEYS) {
      const worker = new Worker(new URL("../games/ZeusVsHades/rtpSolver.worker.ts", import.meta.url), {
        type: "module",
      });
      workersRef.current.push(worker);
      worker.onmessage = (e: MessageEvent<SolverResponse>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setRun((prev) => prev && { ...prev, fractions: { ...prev.fractions, [job]: msg.fraction }, label: msg.label });
          return;
        }
        if (msg.type === "error") {
          stopWorkers();
          setRun(null);
          setError(msg.message);
          return;
        }
        worker.terminate();
        results.set(job, msg.result);
        if (results.size < JOB_KEYS.length) return;

        // All jobs done — merge dials and measurements. Normal-spin RTP needs the standard-buy
        // measurement (from another job) to value the free spins it triggers.
        let nextTuning = tuning;
        const measured = {} as ZeusMeasured;
        for (const r of results.values()) {
          for (const [k, v] of Object.entries(r.dials)) nextTuning = withDial(nextTuning, k as ModeKey, v);
          Object.assign(measured, r.measured);
        }
        for (const r of results.values()) {
          if (r.base) measured[`base.${r.base.profile}`] = baseRtpPercent(r.base, measured[`buyStandard.${r.base.profile}`]);
        }
        workersRef.current = [];
        setConfig((prev) => ({ ...prev, tuning: nextTuning, measured }));
        if (kind === "solve") setWarnings([...results.values()].flatMap((r) => r.warnings));
        setRun(null);
      };
      worker.postMessage({ job, tuning, targetPercent } satisfies SolverRequest);
    }
  }

  function cancel() {
    stopWorkers();
    setRun(null);
  }

  /** Saves to the database (every player's game loads it from there) and to this browser. */
  async function save() {
    if (!inputsValid || config.measured === null) return;
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveZeusRtpConfigToServer(config);
    } catch (err) {
      setSaveError(err instanceof Error ? `Couldn't save to the server: ${err.message}` : "Couldn't save to the server.");
      return;
    } finally {
      setSaving(false);
    }
    setZeusRtpConfig(config);
    setSavedOk(true);
    window.setTimeout(() => setSavedOk(false), 2000);
  }

  function resetToDefault() {
    setSavedOk(false);
    setWarnings([]);
    setConfig(getZeusDefaultConfig());
  }

  return (
    <div>
      <AdminPageHeader
        title="Zeus vs Hades RTP"
        gameSlugs={["zeus-vs-hades"]}
        description="Set one target RTP and every price and pay — Solve tunes every paid feature (normal spin, special bets, bought free spins) to pay back that RTP. Saved to the server — every player's game loads it each time it opens."
      />

      <div className="max-w-5xl space-y-5">
        {/* Target RTP + solve */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-slate-800">Target RTP %</label>
            <input
              type="number"
              step="0.01"
              value={config.targetRtpPercent}
              onChange={(e) => {
                setSavedOk(false);
                setConfig((prev) => ({ ...prev, targetRtpPercent: Number(e.target.value) }));
              }}
              disabled={running}
              className={inputClass(!(config.targetRtpPercent > 0) || offTarget.length > 0)}
            />
            <button
              onClick={() => start("solve")}
              disabled={running || !inputsValid}
              className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
            >
              Solve for target
            </button>
            <button
              onClick={() => start("measure")}
              disabled={running || !inputsValid}
              className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Measure current
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            After changing the target or any price, pay or rule below, click "Solve for target" — it simulates millions of
            spins to re-balance every feature to this RTP (about a minute). "Measure current" only re-checks the current
            setup.
          </p>

          {run && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {run.kind === "solve" ? "Solving" : "Measuring"} — {run.label}
                </span>
                <span className="flex items-center gap-3">
                  {Math.round(progress * 100)}%
                  <button onClick={cancel} className="font-medium text-rose-600 hover:underline">
                    Cancel
                  </button>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}

          {!running && config.measured === null && (
            <p className="mt-3 text-sm text-amber-600">
              Not balanced yet for the current settings — click "Solve for target" before saving.
            </p>
          )}
          {!running && config.measured !== null && offTarget.length === 0 && (
            <p className="mt-3 text-sm font-medium text-emerald-600">
              Every feature pays back within ±{RTP_TOLERANCE}% of the target ✓
            </p>
          )}
          {!running && offTarget.length > 0 && (
            <p className="mt-3 text-sm text-rose-600">
              {offTarget.length} feature{offTarget.length > 1 ? "s are" : " is"} more than ±{RTP_TOLERANCE}% away from
              the target — click "Solve for target".
            </p>
          )}
          {warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <div className="font-semibold">
                These features can't reach the target at the current prices and pays — change their price or the pays:
              </div>
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-rose-600">Simulation failed: {error}</p>}
        </div>

        <Card title="Prices & rules (x total bet)">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NumberField
              label="Super Spin 1 — price per spin"
              hint={`Shown in game as BET MULTIPLIER ${+(t.specialBetX.super1 * COINS_PER_BET).toFixed(2)}x`}
              value={t.specialBetX.super1}
              step={0.5}
              min={0.01}
              disabled={running}
              onChange={(v) => edit((n) => (n.specialBetX.super1 = v))}
            />
            <NumberField
              label="Super Spin 2 — price per spin"
              hint={`Shown in game as BET MULTIPLIER ${+(t.specialBetX.super2 * COINS_PER_BET).toFixed(2)}x`}
              value={t.specialBetX.super2}
              step={1}
              min={0.01}
              disabled={running}
              onChange={(v) => edit((n) => (n.specialBetX.super2 = v))}
            />
            <NumberField
              label="Free spins awarded"
              value={t.freeSpinsAwarded}
              step={1}
              min={1}
              disabled={running}
              onChange={(v) => edit((n) => (n.freeSpinsAwarded = Math.round(v)))}
            />
            <NumberField
              label="Max win per round"
              value={t.maxWinX}
              step={100}
              min={1}
              disabled={running}
              onChange={(v) => edit((n) => (n.maxWinX = v))}
            />
            {PROFILES.flatMap((p) =>
              (["standard", "super"] as BuyOption[]).map((option) => (
                <NumberField
                  key={`${p.id}-${option}`}
                  label={`${p.name} — buy ${option === "standard" ? "free spins" : "super free spins"}`}
                  value={t.buyCostX[p.id][option]}
                  step={1}
                  min={0.01}
                  disabled={running}
                  onChange={(v) => edit((n) => (n.buyCostX[p.id][option] = v))}
                />
              ))
            )}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            A normal spin always costs the player's bet (1x). Natural and bought free spins both play the number of free
            spins set above.
          </p>
        </Card>

        <Card title="Symbol pays (x total bet, for 3 / 4 / 5 of a kind on a line)">
          <div className="mb-3 flex w-fit gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPaysProfile(p.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  paysProfile === p.id ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">3 of a kind</th>
                  <th className="px-3 py-2">4 of a kind</th>
                  <th className="px-3 py-2">5 of a kind</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {PAYING_SYMBOLS.map((sym) => (
                  <tr key={sym} className="border-t border-slate-200 even:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <img src={symbolUrl(sym, paysProfile)} alt="" className="h-10 w-12 rounded bg-slate-800 object-contain p-0.5" />
                        <span className="font-medium text-slate-800">{SYMBOL_NAMES[paysProfile][sym]}</span>
                      </div>
                    </td>
                    {[0, 1, 2].map((i) => {
                      const v = t.paysX[paysProfile][sym][i];
                      return (
                        <td key={i} className="px-3 py-2">
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            value={v}
                            onChange={(e) => edit((n) => (n.paysX[paysProfile][sym][i] = Number(e.target.value)))}
                            disabled={running}
                            className={inputClass(!(v >= 0))}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {SPECIAL_SYMBOLS.map(({ id, note }) => (
                  <tr key={id} className="border-t border-slate-200 even:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <img src={symbolUrl(id, paysProfile)} alt="" className="h-10 w-12 rounded bg-slate-800 object-contain p-0.5" />
                        <span className="font-medium text-slate-800">{SYMBOL_NAMES[paysProfile][id]}</span>
                      </div>
                    </td>
                    <td colSpan={3} className="px-3 py-2 text-xs text-slate-500">
                      {note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            The Wild substitutes for every symbol except the Scatter, and pays its own row when the line starts with Wilds.
          </p>
        </Card>

        <Card title="RTP per feature">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
                <tr>
                  <th className="px-3 py-2">Feature</th>
                  <th className="px-3 py-2">Price (x bet)</th>
                  <th className="px-3 py-2">Measured RTP</th>
                  <th className="px-3 py-2">Reel dial (set by Solve)</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {MODE_KEYS.map((key) => {
                  const measured = config.measured?.[key];
                  const ok = measured !== undefined && Math.abs(measured - config.targetRtpPercent) <= RTP_TOLERANCE;
                  return (
                    <tr key={key} className="border-t border-slate-200 even:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{MODE_LABELS[key]}</td>
                      <td className="px-3 py-2 text-slate-600">{modePriceX(t, key)}x</td>
                      <td className="px-3 py-2">
                        {measured === undefined ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className={`font-medium ${ok ? "text-emerald-600" : "text-rose-600"}`}>
                            {measured.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{getDial(t, key).toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            RTP is the long-run average each feature pays back — single sessions still win or lose freely. Measured figures
            are simulation estimates and wobble by 1–2% between runs, since a handful of huge wins move the average. Normal
            spin RTP includes the free spins it triggers. The reel dial is how often that feature uses the hot reel set
            (more wilds); Solve sets it.
          </p>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={!inputsValid || running || config.measured === null || saving || loadingServer}
            className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40"
          >
            {saving ? "Saving…" : loadingServer ? "Loading…" : "Save"}
          </button>
          <button
            onClick={resetToDefault}
            disabled={running}
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Reset to default ({DEFAULT_ZEUS_TARGET_RTP_PERCENT}%)
          </button>
          {config.measured === null && !running && (
            <span className="text-xs text-slate-500">Save unlocks after Solve (or Measure).</span>
          )}
          {savedOk && (
            <div className="text-sm font-medium text-emerald-600">Saved to the server — players get it the next time the game loads.</div>
          )}
          {saveError && <div className="text-sm font-medium text-rose-600">{saveError}</div>}
        </div>
      </div>
    </div>
  );
}
