import { useEffect, useState, CSSProperties, ReactNode } from "react";
import { ANIMATION_STYLES } from "./SimpleWinPopup";

const ENTER_MS = 600;
const EXIT_MS = 250;

/** Same lettering as SimpleWinPopup's win number: Impact, yellow→orange fill, red stroke. */
const LETTERING: CSSProperties = {
  fontFamily: "Impact, 'Arial Black', sans-serif",
  background: "linear-gradient(to bottom, #fff700 0%, #ff8c00 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  lineHeight: 1,
  padding: "16px", // Prevent clipping of shadows
  display: "inline-block",
};

const BIG: CSSProperties = { ...LETTERING, fontSize: "130px", WebkitTextStroke: "4px #d50000" };
const SMALL: CSSProperties = { ...LETTERING, fontSize: "64px", WebkitTextStroke: "3px #d50000" };

/**
 * Crazy 777's full-frame banner in the exact style of the plain-win popup (SimpleWinPopup):
 * bursts in, then pulses and glows until the player taps it (or `startRequested` is set), then
 * shrinks/fades out and calls onDismiss.
 */
function CrazyBanner({
  children,
  onDismiss,
  startRequested = false,
  ariaLabel,
}: {
  children: ReactNode;
  onDismiss: () => void;
  startRequested?: boolean;
  ariaLabel: string;
}) {
  const [phase, setPhase] = useState<"entering" | "holding" | "leaving">("entering");

  useEffect(() => {
    const timer = window.setTimeout(() => setPhase((p) => (p === "entering" ? "holding" : p)), ENTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (startRequested) setPhase("leaving");
  }, [startRequested]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(onDismiss, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onDismiss]);

  const popupAnimStyle: CSSProperties =
    phase === "entering"
      ? { animation: `crazyBurst ${ENTER_MS}ms ease-out forwards` }
      : phase === "holding"
        ? { animation: "crazyPulse 1.5s ease-in-out infinite alternate", transform: "scale(1.1)" }
        : { transform: "scale(0.6)", opacity: 0, transition: `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in` };

  const glowAnimStyle: CSSProperties =
    phase === "holding"
      ? { animation: "numberGlow 1.5s ease-in-out infinite alternate" }
      : { filter: "drop-shadow(0px 15px 10px rgba(0,0,0,0.7)) drop-shadow(0px 0px 15px rgba(255,0,0,0.5))" };

  return (
    <>
      <style>{ANIMATION_STYLES}</style>
      <div
        className="absolute inset-0 z-30 flex cursor-pointer select-none items-center justify-center bg-black/40"
        onClick={() => setPhase((p) => (p === "entering" ? p : "leaving"))}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
      >
        <div style={popupAnimStyle} className="flex items-center justify-center">
          <div style={glowAnimStyle} className="flex flex-col items-center">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

interface RespinIntroProps {
  count: number;
  onDismiss: () => void;
  /** Set true when the player presses SPIN — same exit as tapping the banner. */
  startRequested?: boolean;
}

/** "{count} RESPINS / SPIN TO START" — the respins begin once it's tapped or SPIN is pressed. */
export function RespinIntro({ count, onDismiss, startRequested = false }: RespinIntroProps) {
  return (
    <CrazyBanner onDismiss={onDismiss} startRequested={startRequested} ariaLabel="Start respins">
      <span className="font-black tracking-tighter" style={BIG}>
        {count} {count === 1 ? "RESPIN" : "RESPINS"}
      </span>
      <span className="-mt-6 font-black tracking-tight" style={SMALL}>
        SPIN TO START
      </span>
    </CrazyBanner>
  );
}

/** End of a respin round: "CONGRATULATIONS / YOU WIN / {total} / TAP ANYWHERE TO CONTINUE" —
 * the round's total is added to the balance when it's tapped away (see onDismiss's caller). */
export function RespinOutro({ total, onDismiss }: { total: number; onDismiss: () => void }) {
  return (
    <CrazyBanner onDismiss={onDismiss} ariaLabel="Respins complete - tap to continue">
      <span className="font-black tracking-tight" style={SMALL}>
        CONGRATULATIONS
      </span>
      <span className="-mt-6 font-black tracking-tight" style={SMALL}>
        YOU WIN
      </span>
      <span className="-mt-4 font-black tabular-nums tracking-tighter" style={BIG}>
        {total.toFixed(2)}
      </span>
      <span className="-mt-4 font-black tracking-tight" style={{ ...SMALL, fontSize: "44px" }}>
        TAP ANYWHERE TO CONTINUE
      </span>
    </CrazyBanner>
  );
}
