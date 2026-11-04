import { useEffect, useRef, useState } from "react";
import "./BigWinBanner.css";

const BIG_WIN_SRC = "/symbols/vegasHit/bigWinCelebration.webp";
const FREE_SPINS_SRC = "/symbols/vegasHit/FreeSpins.webp";
/** Must match the .vh-big-win--entering animation duration in BigWinBanner.css. */
const ZOOM_IN_MS = 1000;
/** Must match the .vh-big-win--leaving animation duration in BigWinBanner.css. */
const ZOOM_OUT_MS = 450;
/** How long the number takes to count up from 0, starting as the zoom-in begins. */
const COUNT_UP_MS = 2000;
/** Clicks are ignored for this long after the banner lands full-screen, so the same click
 * that started the spin (or a quick double-tap) can't skip it before it's even been seen. */
const MIN_HOLD_MS = 1000;

type Phase = "entering" | "holding" | "leaving";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CelebrationBannerProps {
  imageSrc: string;
  alt: string;
  /** Counted up from 0 to this. */
  value: number;
  format: (n: number) => string;
  /** Smaller text line under the number (e.g. "FREE SPINS"). */
  caption?: string;
  onDismiss: () => void;
}

/**
 * Vegas Hits' full-screen banner (same behaviour as Sizzling 7s'): the image grows out from the
 * middle of the screen while `value` counts up from 0 inside its purple plaque, then stays until
 * the player clicks — which plays the reverse, then calls onDismiss.
 */
function CelebrationBanner({ imageSrc, alt, value, format, caption, onDismiss }: CelebrationBannerProps) {
  const [phase, setPhase] = useState<Phase>("entering");
  const [displayValue, setDisplayValue] = useState(0);
  const clickableAt = useRef(performance.now() + ZOOM_IN_MS + MIN_HOLD_MS);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(Math.max((now - start) / COUNT_UP_MS, 0), 1);
      setDisplayValue(easeOutCubic(t) * value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const landed = window.setTimeout(() => setPhase((p) => (p === "entering" ? "holding" : p)), ZOOM_IN_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(landed);
    };
  }, [value]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(onDismiss, ZOOM_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onDismiss]);

  function handleClick() {
    if (phase === "leaving" || performance.now() < clickableAt.current) return;
    setDisplayValue(value);
    setPhase("leaving");
  }

  return (
    <div className={`vh-big-win vh-big-win--${phase}`} onClick={handleClick} role="button" tabIndex={0}>
      <div className="vh-big-win-content">
        <img className="vh-big-win-image" src={imageSrc} alt={alt} draggable={false} />
        <div className={`vh-big-win-amount ${caption ? "vh-big-win-amount--with-caption" : ""}`}>{format(displayValue)}</div>
        {caption && <div className="vh-big-win-caption">{caption}</div>}
      </div>
    </div>
  );
}

/** bigWinCelebration.png with the win amount counting up. */
export function BigWinBanner({ winAmount, onDismiss }: { winAmount: number; onDismiss: () => void }) {
  return <CelebrationBanner imageSrc={BIG_WIN_SRC} alt="Big Win" value={winAmount} format={formatAmount} onDismiss={onDismiss} />;
}

/** FreeSpins.png ("CONGRATULATIONS") with the number of free spins awarded. */
export function FreeSpinsBanner({ freeSpins, onDismiss }: { freeSpins: number; onDismiss: () => void }) {
  return (
    <CelebrationBanner
      imageSrc={FREE_SPINS_SRC}
      alt="Congratulations"
      value={freeSpins}
      format={(n) => String(Math.round(n))}
      caption="FREE SPINS"
      onDismiss={onDismiss}
    />
  );
}
