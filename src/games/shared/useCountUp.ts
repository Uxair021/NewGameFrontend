import { useEffect, useRef, useState } from "react";

/** Default count-up length for the controllers' WIN and BALANCE readouts. A game that credits the
 * balance only after WIN has finished counting waits this long. */
export const COUNT_UP_MS = 1000;

/**
 * A readout value that counts up: when `target` goes up it counts from whatever is currently
 * shown — never from 0 — to the new value with an ease-out (20 → 30 counts 20…30). A drop (a bet
 * taken, WIN reset for a new spin) snaps straight to the new value, cutting short any count still
 * running. With `snapFirstLoad`, the first non-zero value (the 0 placeholder → the user's loaded
 * balance) also snaps, so opening a game never counts its balance up from 0.
 */
export function useCountUp(target: number, durationMs = COUNT_UP_MS, snapFirstLoad = false): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const loaded = useRef(!snapFirstLoad || target !== 0);
  const raf = useRef<number>();

  useEffect(() => {
    // Only re-render when the shown cents actually change — a small win counting over 60 frames
    // would otherwise re-render the readout every frame for the same "0.40".
    const set = (v: number) => {
      const cents = Math.round(v * 100) / 100;
      if (cents === shownRef.current) return;
      shownRef.current = cents;
      setShown(cents);
    };
    if (raf.current) cancelAnimationFrame(raf.current);

    const from = shownRef.current;
    if (!loaded.current || target <= from || durationMs <= 0) {
      if (target !== 0) loaded.current = true;
      set(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      set(t < 1 ? from + (target - from) * eased : target);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return shown;
}

/** The player's balance as a controller shows it — see useCountUp; never counts up from 0 on load. */
export function useBalanceCountUp(target: number, durationMs = COUNT_UP_MS): number {
  return useCountUp(target, durationMs, true);
}
