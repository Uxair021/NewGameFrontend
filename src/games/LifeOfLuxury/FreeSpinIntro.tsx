import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

const ZOOM_IN_S = 0.45;
const ZOOM_OUT_S = 0.35;

interface FreeSpinIntroProps {
  onDismiss: () => void;
  /** Set true when the player presses SPIN — same exit as tapping the banner. */
  startRequested?: boolean;
}

/** "You've won free spins" banner over the game card — just the game's own freespin.webp art (it
 * already bakes in the spin count text). The art zooms in on arrival and zooms back out on the
 * way out (the backdrop just fades). Stays up until the player taps it or presses SPIN — the
 * round never starts on its own. The footer is raised above it so SPIN stays pressable. */
export function FreeSpinIntro({ onDismiss, startRequested = false }: FreeSpinIntroProps) {
  const [dismissing, setDismissing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Zoom in on arrival.
  useEffect(() => {
    if (!imgRef.current) return;
    gsap.fromTo(imgRef.current, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: ZOOM_IN_S, ease: "back.out(1.6)" });
  }, []);

  useEffect(() => {
    if (startRequested) setDismissing(true);
  }, [startRequested]);

  // Zoom back out, then actually dismiss once that animation (not a fixed timer) finishes.
  useEffect(() => {
    if (!dismissing) return;
    if (!imgRef.current) {
      onDismiss();
      return;
    }
    gsap.to(imgRef.current, { scale: 0.4, opacity: 0, duration: ZOOM_OUT_S, ease: "power2.in", onComplete: onDismiss });
  }, [dismissing, onDismiss]);

  return (
    <div
      className={`absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-black/75 transition-opacity duration-300 ${
        dismissing ? "opacity-0" : "opacity-100"
      }`}
      onClick={() => setDismissing(true)}
      role="button"
      tabIndex={0}
      aria-label="Start Free Spins"
    >
      <img
        ref={imgRef}
        src="/symbols/lifeOfLuxury/freespin.webp"
        alt="Free Spins"
        className="max-h-[80%] max-w-[90%] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
      />
    </div>
  );
}
