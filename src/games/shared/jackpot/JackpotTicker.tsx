import { CSSProperties, useEffect, useRef, useState } from "react";
import { JackpotTierInfo, JackpotTierKey } from "./jackpotApi";

/** Segment background + label gradient per tier. */
export const TIER_STYLE: Record<JackpotTierKey, { bg: string; label: string }> = {
  jackpot: { bg: "linear-gradient(180deg, #ef3b3f 0%, #b3141a 45%, #6e070b 100%)", label: "linear-gradient(180deg, #fffbc2, #ffd23f 55%, #f59e0b)" },
  mega: { bg: "linear-gradient(180deg, #3fcf63 0%, #15913a 45%, #0a5420 100%)", label: "linear-gradient(180deg, #fbffc4, #d4ff5c 55%, #7ee03b)" },
  major: { bg: "linear-gradient(180deg, #4a8cf5 0%, #1f4fc4 45%, #0e2670 100%)", label: "linear-gradient(180deg, #e8fdff, #7fe3ff 55%, #2bb6f5)" },
  mini: { bg: "linear-gradient(180deg, #c04ef0 0%, #8a1fc0 45%, #4a0a70 100%)", label: "linear-gradient(180deg, #fff0ff, #ff9be8 55%, #f052c8)" },
};

export const AMOUNT_GRADIENT = "linear-gradient(180deg, #fffde0 0%, #ffe14d 50%, #f2a20c 100%)";
const GOLD_RIM = "linear-gradient(180deg, #fff6b8 0%, #f5c518 35%, #b8780a 70%, #ffe27a 100%)";
/** Both pills are this wide (design px), so the left and right sides always match. Wide enough
 * for "JACKPOT $x,xxx.xx" + "MEGA $xxx.xx" — raise it if the admin sets bigger amounts. */
const PILL_WIDTH = 440;
export const JACKPOT_FONT = '"Lilita One", "Rajdhani", system-ui, sans-serif';

export const gradientText = (gradient: string): CSSProperties => ({
  backgroundImage: gradient,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  // A dark rim around gradient-clipped text — text-stroke would paint over the gradient.
  filter: "drop-shadow(0 2px 0 rgba(40,15,0,0.95)) drop-shadow(0 0 1px rgba(40,15,0,0.9))",
});

export const formatAmount = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COUNT_UP_MS = 900;

/** Rolls a displayed amount from its previous value to `target` (ease-out) whenever the live
 * jackpot stream pushes a new balance, so the bar counts up instead of jumping. */
export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    // Drops (a tier was just won) snap straight down; rises animate.
    if (target <= from) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const value = from + (target - from) * (1 - (1 - t) ** 3);
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}

function Coin({ size }: { size: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 35% 30%, #fffbe0 0%, #ffd84a 35%, #e09a00 70%, #8a5200 100%)",
        boxShadow: `inset 0 0 0 ${Math.max(2, size / 9)}px rgba(255,230,120,0.85), 0 2px 4px rgba(0,0,0,0.45)`,
      }}
    />
  );
}

function TierSegment({
  tier,
  divider,
  onClick,
}: {
  tier: JackpotTierInfo;
  divider: boolean;
  onClick?: (tier: JackpotTierKey) => void;
}) {
  const s = TIER_STYLE[tier.key];
  const shown = useCountUp(tier.amount);
  // A button when tappable (opens the Jackpot Record screen); pointer-events-auto re-enables taps
  // inside the bar, which is otherwise click-through.
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick ? () => onClick(tier.key) : undefined}
      aria-label={onClick ? `${tier.label} jackpot records` : undefined}
      // Starts at its own text's width and takes an equal share of whatever room is left in the
      // pill, so a long amount gets more space and a short one doesn't look empty.
      className={`flex h-full flex-auto items-center justify-between gap-2.5 whitespace-nowrap px-[14px] ${
        onClick ? "pointer-events-auto cursor-pointer hover:brightness-110 active:brightness-90" : ""
      }`}
      style={{
        background: s.bg,
        borderLeft: divider ? "3px solid #f5c518" : undefined,
        boxShadow: "inset 0 2px 3px rgba(255,255,255,0.35), inset 0 -4px 6px rgba(0,0,0,0.35)",
      }}
    >
      <span className="text-[22px] uppercase leading-none tracking-wide" style={{ fontFamily: JACKPOT_FONT, ...gradientText(s.label) }}>
        {tier.label}
      </span>
      <span className="text-[26px] leading-none" style={{ fontFamily: JACKPOT_FONT, ...gradientText(AMOUNT_GRADIENT) }}>
        {formatAmount(shown)}
      </span>
    </Tag>
  );
}

/** One gold-rimmed pill holding the given tiers, with coins on both sides. With `onTierClick`,
 * each tier can be tapped (used to open the Jackpot Record screen on that tier's tab). */
export function JackpotTierGroup({
  tiers,
  onTierClick,
}: {
  tiers: JackpotTierInfo[];
  onTierClick?: (tier: JackpotTierKey) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Coin size={16} />
      <Coin size={30} />
      <div className="rounded-full p-[3px]" style={{ background: GOLD_RIM, boxShadow: "0 3px 8px rgba(0,0,0,0.5)" }}>
        <div className="flex h-[46px] overflow-hidden rounded-full" style={{ width: PILL_WIDTH }}>
          {tiers.map((t, i) => (
            <TierSegment key={t.key} tier={t} divider={i > 0} onClick={onTierClick} />
          ))}
        </div>
      </div>
      <Coin size={30} />
      <Coin size={16} />
    </div>
  );
}

interface JackpotTickerProps {
  tiers: JackpotTierInfo[];
  onTierClick?: (tier: JackpotTierKey) => void;
  className?: string;
  style?: CSSProperties;
}

/** Full-width jackpot bar for the top of a pool game: the two biggest tiers on the left, the two
 * smallest on the right, and an empty, transparent middle so the game's own logo shows through.
 * Sized in the game's design pixels; each game positions it (and pads it clear of its own corner
 * buttons) via className/style. */
export function JackpotTicker({ tiers, onTierClick, className = "", style }: JackpotTickerProps) {
  if (tiers.length === 0) return null;
  const half = Math.ceil(tiers.length / 2);
  return (
    <div className={`pointer-events-none flex items-center justify-between ${className}`} style={style}>
      <JackpotTierGroup tiers={tiers.slice(0, half)} onTierClick={onTierClick} />
      <JackpotTierGroup tiers={tiers.slice(half)} onTierClick={onTierClick} />
    </div>
  );
}
