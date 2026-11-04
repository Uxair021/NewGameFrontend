import { useEffect, useRef, useState } from "react";
import "./ShamrockFx.css";

const TITLES = { 1: "BIG WIN", 2: "HUGE WIN", 3: "MEGA WIN" } as const;
const DURATION_MS = { 1: 2200, 2: 3000, 3: 3800 } as const;
/** The amount finishes counting up this far through the overlay's time on screen. */
const COUNT_UP_FRACTION = 0.65;

interface BigWinOverlayProps {
  amount: number;
  tier: 1 | 2 | 3;
  /** Height of the control bar it stops above, so SPIN stays reachable. */
  bottom: number;
  onDone: () => void;
}

/** Count-up banner over the reels for a large base-game win; tap to skip. Display only — the win
 * has already been paid into the balance by the time this shows. */
export function BigWinOverlay({ amount, tier, bottom, onDone }: BigWinOverlayProps) {
  const [shown, setShown] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const duration = DURATION_MS[tier];
    const countUp = duration * COUNT_UP_FRACTION;
    const start = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const t = Math.min(Math.max((now - start) / countUp, 0), 1);
      setShown(amount * (1 - Math.pow(1 - t, 3)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const timer = window.setTimeout(() => onDoneRef.current(), duration);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [amount, tier]);

  return (
    <div
      className="shamrock-bigwin"
      style={{ bottom }}
      onClick={onDone}
      role="button"
      tabIndex={0}
      aria-label={`${TITLES[tier]}: ${amount.toFixed(2)}. Tap to close`}
    >
      <div className="shamrock-rays" aria-hidden />
      <div className="shamrock-bigwin-content">
        <div className={`shamrock-bigwin-title shamrock-bigwin-title--${tier}`}>{TITLES[tier]}</div>
        <div className="shamrock-bigwin-amount">${shown.toFixed(2)}</div>
      </div>
    </div>
  );
}
