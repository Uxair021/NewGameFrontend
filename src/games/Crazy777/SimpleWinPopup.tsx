import { useEffect, useRef, useState, CSSProperties, RefObject } from "react";

interface SimpleWinPopupProps {
  winAmount: number;
  targetRef: RefObject<HTMLElement | null>;
  onComplete: () => void;
  /** Fires halfway through the popup's whole animation (enter + hold + drop). */
  onHalfway?: () => void;
}

const COUNT_UP_MS = 700;
const ENTER_MS = 600; // longer for the multi-stage burst
/** Enter + hold ≈ 1.6s on screen before it drops into the WIN box. */
const HOLD_MS = 1000;
const DROP_MS = 450;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

type Phase = "entering" | "holding" | "dropping";

export const ANIMATION_STYLES = `
  @keyframes crazyBurst {
    0% { transform: scale(0.1) rotate(-15deg); opacity: 0; }
    40% { transform: scale(1.5) rotate(10deg); opacity: 1; }
    70% { transform: scale(0.9) rotate(-3deg); opacity: 1; }
    100% { transform: scale(1.1) rotate(0deg); opacity: 1; }
  }
  @keyframes crazyPulse {
    0%, 100% { transform: scale(1.1); }
    50% { transform: scale(1.18) translateY(-5px); }
  }
  @keyframes numberGlow {
    0%, 100% { filter: drop-shadow(0px 15px 10px rgba(0,0,0,0.7)) drop-shadow(0px 0px 15px rgba(255,0,0,0.5)); }
    50% { filter: drop-shadow(0px 15px 10px rgba(0,0,0,0.7)) drop-shadow(0px 0px 35px rgba(255,215,0,0.9)); }
  }
`;

/**
 * Crazy 777 only: for a plain win (no BIG/MEGA/JACKPOT overlay), a big count-up number
 * zooms in at the center of the game frame, holds briefly, then drops/shrinks into the
 * WIN box in the control bar. `onComplete` fires exactly when it arrives there — Crazy777 then
 * lets the WIN box count up, and only after that adds the win to the balance.
 */
export function SimpleWinPopup({ winAmount, targetRef, onComplete, onHalfway }: SimpleWinPopupProps) {
  const [displayAmount, setDisplayAmount] = useState(0);
  const [phase, setPhase] = useState<Phase>("entering");
  const [dropStyle, setDropStyle] = useState<CSSProperties>({});
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Halfway through the whole popup animation — the WIN box starts its own animation then.
  const onHalfwayRef = useRef(onHalfway);
  onHalfwayRef.current = onHalfway;
  useEffect(() => {
    const timer = window.setTimeout(() => onHalfwayRef.current?.(), (ENTER_MS + HOLD_MS + DROP_MS) / 2);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(Math.max((now - start) / COUNT_UP_MS, 0), 1);
      setDisplayAmount(easeOutCubic(t) * winAmount);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [winAmount]);

  useEffect(() => {
    if (phase !== "entering") return;
    const timer = window.setTimeout(() => setPhase("holding"), ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "holding") return;
    const timer = window.setTimeout(() => setPhase("dropping"), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "dropping") return;
    const popup = popupRef.current;
    const target = targetRef.current;
    if (!popup || !target) {
      onComplete();
      return;
    }
    const popupRect = popup.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    // We calculate from the current center of the popup
    const dx = targetRect.left + targetRect.width / 2 - (popupRect.left + popupRect.width / 2);
    const dy = targetRect.top + targetRect.height / 2 - (popupRect.top + popupRect.height / 2);
    
    // Switch to inline transition for the drop
    setDropStyle({
      transform: `translate(${dx}px, ${dy}px) scale(0.2)`,
      opacity: 0,
      transition: `transform ${DROP_MS}ms cubic-bezier(0.55, 0, 0.85, 0.35), opacity ${DROP_MS}ms ease-in`,
    });
    
    const timer = window.setTimeout(onComplete, DROP_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Determine dynamic animation styles based on phase
  const popupAnimStyle: CSSProperties = phase === "entering"
    ? { animation: `crazyBurst ${ENTER_MS}ms ease-out forwards` }
    : phase === "holding"
    ? { animation: `crazyPulse 1.5s ease-in-out infinite alternate`, transform: "scale(1.1)" }
    : dropStyle;

  const glowAnimStyle: CSSProperties = phase === "holding"
    ? { animation: `numberGlow 1.5s ease-in-out infinite alternate` }
    : { filter: "drop-shadow(0px 15px 10px rgba(0,0,0,0.7)) drop-shadow(0px 0px 15px rgba(255,0,0,0.5))" };

  return (
    <>
      <style>{ANIMATION_STYLES}</style>
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div ref={popupRef} style={popupAnimStyle} className="relative z-10 flex items-center justify-center">
          {/* Wrapper handles the drop shadow so it applies to the text + stroke as one shape */}
          <div style={glowAnimStyle}>
            <span
              className="font-black tabular-nums tracking-tighter"
              style={{
                fontSize: "130px", // Huge font size
                fontFamily: "Impact, 'Arial Black', sans-serif",
                background: "linear-gradient(to bottom, #fff700 0%, #ff8c00 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                WebkitTextStroke: "4px #d50000",
                lineHeight: 1,
                padding: "20px", // Prevent clipping of shadows
                display: "inline-block", // Required for filters/transforms on spans sometimes
              }}
            >
              {displayAmount.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}