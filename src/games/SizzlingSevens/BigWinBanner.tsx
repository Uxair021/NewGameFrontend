import { useEffect, useRef, useState } from "react";
import "./BigWinBanner.css";

const BIG_WIN_SRC = "/symbols/sizzling7s/BigWinBanner.webp";
const CONGRATS_SRC = "/symbols/sizzling7s/congratulations.webp";
/** Must match the .big-win-banner--entering animation duration in BigWinBanner.css. */
const ZOOM_IN_MS = 1000;
/** Must match the .big-win-banner--leaving animation duration in BigWinBanner.css. */
const ZOOM_OUT_MS = 450;
/** How long the number takes to count up from 0, starting as the zoom-in begins. */
const COUNT_UP_MS = 2000;
/** Clicks are ignored for this long after the banner lands full-screen, so the same click
 * that stopped the reels (or a quick double-tap) can't skip it before it's even been seen. */
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
  /** Smaller text lines under the number (e.g. "FREE SPINS"). */
  captions?: string[];
  onDismiss: () => void;
  /** Render inside the game card (absolute, design-pixel sized) instead of over the whole
   * viewport, so the game's own controls can sit above it. */
  contained?: boolean;
  /** Set true when the player presses the game's SPIN button — leaves exactly like a click. */
  startRequested?: boolean;
}

/**
 * Sizzling 7s' full-screen banner: the image grows out from the middle of the screen to full
 * size while `value` counts up from 0, then stays until the player clicks — which plays the
 * reverse (shrinks into the middle of the screen and fades), then calls onDismiss.
 */
function CelebrationBanner({ imageSrc, alt, value, format, captions = [], onDismiss, contained = false, startRequested = false }: CelebrationBannerProps) {
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

  // SPIN pressed — same as a click, once the banner's minimum hold has passed.
  useEffect(() => {
    if (!startRequested) return;
    const timer = window.setTimeout(() => {
      setDisplayValue(value);
      setPhase("leaving");
    }, Math.max(0, clickableAt.current - performance.now()));
    return () => window.clearTimeout(timer);
  }, [startRequested, value]);

  return (
    <div
      className={`big-win-banner big-win-banner--${phase} ${contained ? "big-win-banner--contained" : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <div className="big-win-banner-content">
        <img className="big-win-banner-image" src={imageSrc} alt={alt} draggable={false} />
        <div className={`big-win-banner-amount ${captions.length > 0 ? "big-win-banner-amount--with-caption" : ""}`}>
          {format(displayValue)}
        </div>
        {captions.map((text, i) => (
          <div key={i} className={`big-win-banner-caption big-win-banner-caption--${i}`}>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** BigWinBanner.webp with the win amount counting up. */
export function BigWinBanner({ winAmount, onDismiss, contained }: { winAmount: number; onDismiss: () => void; contained?: boolean }) {
  return (
    <CelebrationBanner imageSrc={BIG_WIN_SRC} alt="Big Win" value={winAmount} format={formatAmount} onDismiss={onDismiss} contained={contained} />
  );
}

/** congratulations.webp with the number of free spins awarded, plus that round's multipliers. */
export function FreeSpinsBanner({
  freeSpins,
  multiplierPool,
  onDismiss,
  contained,
  startRequested,
}: {
  freeSpins: number;
  multiplierPool: number[];
  onDismiss: () => void;
  contained?: boolean;
  startRequested?: boolean;
}) {
  return (
    <CelebrationBanner
      contained={contained}
      startRequested={startRequested}
      imageSrc={CONGRATS_SRC}
      alt="Congratulations"
      value={freeSpins}
      format={(n) => String(Math.round(n))}
      captions={["FREE SPINS", multiplierPool.map((m) => `x${m}`).join("  ")]}
      onDismiss={onDismiss}
    />
  );
}
