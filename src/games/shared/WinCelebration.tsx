import { useEffect, useMemo, useRef, useState } from "react";
import { useFitScale } from "./useFitScale";
import "./WinCelebration.css";

/** Shared across every game's api.ts — all games use the same 3 tier names. */
export type WinTierName = "BIG WIN" | "MEGA WIN" | "JACKPOT";

interface WinCelebrationProps {
  tier: WinTierName;
  winAmount: number;
  onDismiss: () => void;
}

const TIER_CONFIG: Record<WinTierName, { countUpMs: number; holdMs: number; particleCount: number }> = {
  "BIG WIN": { countUpMs: 1600, holdMs: 2500, particleCount: 400 },
  "MEGA WIN": { countUpMs: 2400, holdMs: 3500, particleCount: 480 },
  JACKPOT: { countUpMs: 3200, holdMs: 5000, particleCount: 620 },
};

const TIER_IMAGES: Record<WinTierName, string> = {
  "BIG WIN": "/images/bigwin.png",
  "MEGA WIN": "/images/megaWin.png",
  JACKPOT: "/images/jackpot.png",
};

const PARTICLE_COLORS = ["#ffe066", "#ff9f1c", "#ff5ec4", "#66d9ff", "#9dff8f", "#ffe066", "#ff9f1c"];

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface Particle {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
}

/**
 * Full-screen tiered win celebration: an animated count-up of `winAmount`,
 * a CSS-only confetti burst, and tier-specific styling (BIG WIN < MEGA WIN
 * < JACKPOT in both visual drama and duration). Auto-dismisses after the
 * count-up + a hold period, or immediately on click/tap. Shared across every
 * game — the tier art/timings aren't themed to any one game.
 */
export function WinCelebration({ tier, winAmount, onDismiss }: WinCelebrationProps) {
  const config = TIER_CONFIG[tier];
  const [displayAmount, setDisplayAmount] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const fitScale = useFitScale([contentRef]);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: config.particleCount }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.8 + Math.random() * 1.2,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        rotate: Math.random() * 360,
      })),
    [config.particleCount]
  );

  useEffect(() => {
    let raf: number;
    const start = performance.now();

    function tick(now: number) {
      // Clamped to >=0: requestAnimationFrame's timestamp can be marginally earlier than
      // a performance.now() captured just before scheduling it (observed under React
      // StrictMode's double-invoked effects in dev).
      const t = Math.min(Math.max((now - start) / config.countUpMs, 0), 1);
      setDisplayAmount(Math.round(easeOutCubic(t) * winAmount));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    const dismissTimer = window.setTimeout(() => setDismissing(true), config.countUpMs + config.holdMs);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(dismissTimer);
    };
  }, [winAmount, config.countUpMs, config.holdMs]);

  useEffect(() => {
    if (!dismissing) return;
    const timer = window.setTimeout(onDismiss, 300); // matches the fade-out CSS duration
    return () => window.clearTimeout(timer);
  }, [dismissing, onDismiss]);

  function handleSkip() {
    setDisplayAmount(winAmount);
    setDismissing(true);
  }

  const tierClass = `win-celebration--${tier.toLowerCase().replace(" ", "-")}`;

  return (
    <div
      className={`win-celebration ${tierClass} ${dismissing ? "win-celebration--dismissing" : ""}`}
      onClick={handleSkip}
      role="button"
      tabIndex={0}
    >
      <div className="win-celebration-particles">
        {particles.map((p) => (
          <span
            key={p.id}
            className="win-celebration-particle"
            style={{
              left: `${p.left}%`,
              backgroundColor: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div
        ref={contentRef}
        className="win-celebration-fit"
        style={fitScale < 1 ? { transform: `scale(${fitScale})` } : undefined}
      >
        <div className="win-celebration-content">
          <div className="win-celebration-glow" />
          <img className="win-celebration-title-image" src={TIER_IMAGES[tier]} alt={tier} />
          <div className="win-celebration-amount">${displayAmount.toLocaleString()}</div>
          <div className="win-celebration-hint">tap to skip</div>
        </div>
      </div>
    </div>
  );
}
