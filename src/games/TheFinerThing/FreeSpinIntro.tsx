import { useEffect, useRef, useState, type CSSProperties } from "react";
import gsap from "gsap";

/** freespin-1.webp / freespin-2.webp are two frames of the same banner (only the coins shift) —
 * flipped back and forth at this cadence for the whole time the banner is up. */
const FRAME_SOURCES = ["/symbols/theFinerThing/freespin-1.webp", "/symbols/theFinerThing/freespin-2.webp"];
const FRAME_MS = 220;
const ZOOM_IN_S = 0.45;
const ZOOM_OUT_S = 0.35;

interface FreeSpinIntroProps {
  onDismiss: () => void;
  /** Set true when the player presses the cabinet's PLAY button — same exit as tapping the banner. */
  startRequested?: boolean;
  /** Where the banner sits inside the game card (design pixels) — kept clear of the cabinet's
   * button row so PLAY stays visible and pressable while the banner is up. */
  frameStyle?: CSSProperties;
}

/** "You've won free spins" banner — the game's own two-frame freespin-1/-2 art (it already bakes
 * in the spin count text), alternated as a flip-book animation. The art zooms in on arrival and
 * zooms back out on the way out (the backdrop just fades). Stays up until the player taps it or
 * presses PLAY — the round never starts on its own. */
export function FreeSpinIntro({ onDismiss, startRequested = false, frameStyle }: FreeSpinIntroProps) {
  const [dismissing, setDismissing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    // Preload the second frame so the first flip doesn't flash blank.
    FRAME_SOURCES.forEach((src) => {
      new Image().src = src;
    });
    const id = window.setInterval(() => setFrame((f) => (f + 1) % FRAME_SOURCES.length), FRAME_MS);
    return () => window.clearInterval(id);
  }, []);

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
      className={`absolute z-30 flex cursor-pointer items-center justify-center bg-black/75 transition-opacity duration-300 ${
        dismissing ? "opacity-0" : "opacity-100"
      }`}
      style={frameStyle ?? { inset: 0 }}
      onClick={() => setDismissing(true)}
      role="button"
      tabIndex={0}
      aria-label="Start Free Spins"
    >
      <img
        ref={imgRef}
        src={FRAME_SOURCES[frame]}
        alt="Free Spins"
        className="max-h-[92%] max-w-[90%] drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]"
      />
    </div>
  );
}
