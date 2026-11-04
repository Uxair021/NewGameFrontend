import { useEffect, useRef, useState } from "react";

const TIPS = [
  "💰 Counting your jackpot...",
  "🎰 Warming up the reels...",
  "🌈 Chasing the pot of gold...",
  "🎩 Rolling out the VIP treatment...",
  "🃏 Shuffling a fresh deck...",
];

interface LoadingScreenProps {
  title: string;
  /** Whether the game is actually ready to play — the fake progress bar won't
   * dismiss the screen before this is true, so the canvas is never revealed early. */
  ready: boolean;
  onDone: () => void;
  /** Set when game initialization (WebGL context creation, asset loading) failed — shows a
   * retry affordance instead of sitting on the progress bar forever. Previously any such
   * failure was a silent, permanent hang: `ready` would just never become true and nothing
   * told the player (or us) anything had gone wrong — this is what showed up as games
   * "stuck on loading" with zero error on screen. */
  error?: string | null;
  onRetry?: () => void;
}

export function LoadingScreen({ title, ready, onDone, error, onRetry }: LoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    // Hold the fake progress bar in place while an error is showing — it also naturally
    // restarts from 0% once `error` clears on retry (this effect re-runs), which doubles as
    // a visible "trying again" cue with no extra state needed.
    if (error) return;

    const start = Date.now();
    const duration = 2200;
    let doneCalled = false;
    let waitId = 0;

    function finishWhenReady() {
      if (doneCalled) return;
      if (readyRef.current) {
        doneCalled = true;
        window.setTimeout(onDone, 250);
      } else {
        waitId = window.setTimeout(finishWhenReady, 100);
      }
    }

    const id = window.setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - start) / duration) * 100));
      setProgress(pct);
      if (pct >= 100) {
        window.clearInterval(id);
        finishWhenReady();
      }
    }, 60);

    return () => {
      window.clearInterval(id);
      window.clearTimeout(waitId);
    };
  }, [onDone, error]);

  useEffect(() => {
    const id = window.setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 900);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="loading-screen-root fixed inset-0 z-50 flex flex-col items-center justify-end overflow-hidden bg-slate-950">
      <img
        src="/images/loadingPage.webp"
        alt=""
        loading="eager"
        decoding="sync"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "center 30%" }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-slate-950/10" />

      <div className="relative z-10 mb-14 flex w-full max-w-md flex-col items-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-extrabold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          Loading {title}
        </h1>

        {error ? (
          <>
            <p className="text-sm font-semibold text-rose-300 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">{error}</p>
            <button
              onClick={onRetry}
              className="mt-1 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-orange-500 px-6 py-2 text-sm font-bold text-slate-950 shadow-lg active:scale-95"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-amber-300 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
              {TIPS[tipIndex]}
            </p>

            <div className="mt-1 w-full">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/50 ring-1 ring-amber-400/30">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-orange-500 transition-[width] duration-150 ease-linear"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-center text-xs font-bold tracking-wider text-amber-200">{progress}%</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
