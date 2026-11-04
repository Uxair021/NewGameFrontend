import { useEffect, useState, type CSSProperties } from "react";
import "./FreeSpinCelebration.css";

interface FreeSpinCelebrationProps {
  count: number;
  onDismiss: () => void;
  /** Set true when the player presses the control bar's SPIN button — plays the same exit as a tap on the banner. */
  startRequested?: boolean;
  /** Called the moment the player starts the round by tapping the banner (before its exit animation). */
  onStart?: () => void;
  /** What's being awarded, singular / plural (default "FREE SPIN" / "FREE SPINS"). */
  unit?: { one: string; many: string };
  /** The banner's theme colours (default: Shamrock Spin's greens). The gold lettering stays. */
  palette?: CelebrationPalette;
}

/** Colours behind the gold lettering — outline, 3D shadow layers and glows. */
export interface CelebrationPalette {
  /** Bright outline around every letter. */
  stroke: string;
  /** Dark 3D extrusion under the letters, and its deeper second layer. */
  shadow: string;
  deepShadow: string;
  /** Soft outer glow around the whole text. */
  glow: string;
  /** The blinking "PLAY TO START" glow, at full and faint strength (CSS colours). */
  blinkGlow: string;
  blinkGlowFaint: string;
}

export const SHAMROCK_PALETTE: CelebrationPalette = {
  stroke: "#0db836",
  shadow: "#01240a",
  deepShadow: "#001806",
  glow: "#00e640",
  blinkGlow: "rgba(0, 230, 64, 0.9)",
  blinkGlowFaint: "rgba(0, 230, 64, 0.2)",
};

const DEFAULT_UNIT = { one: "FREE SPIN", many: "FREE SPINS" };

/**
 * Free spin trigger banner matching the authentic Shamrock Spin cabinet art:
 * - Large Western slab number "{count}" beside "FREE SPINS"
 * - Authentic 3D layered gold metallic gradient with dark amber edge and neon emerald stroke
 * - "PLAY TO START" casino flashing prompt below the payline
 * - Punchy slot-machine slam-in animation + gentle breathing pulse + blink effect
 * - Stays visible until the player clicks to start
 */
export function FreeSpinCelebration({
  count,
  onDismiss,
  startRequested = false,
  onStart,
  unit = DEFAULT_UNIT,
  palette = SHAMROCK_PALETTE,
}: FreeSpinCelebrationProps) {
  const words = ` ${count === 1 ? unit.one : unit.many}`;
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (startRequested) setDismissing(true);
  }, [startRequested]);

  useEffect(() => {
    if (!dismissing) return;
    const timer = window.setTimeout(onDismiss, 220);
    return () => window.clearTimeout(timer);
  }, [dismissing, onDismiss]);

  function handleStart() {
    if (!dismissing) {
      setDismissing(true);
      onStart?.();
    }
  }

  return (
    <div
      className={`free-spin-celebration-overlay ${dismissing ? "free-spin-celebration-overlay--dismissing" : ""}`}
      onClick={handleStart}
      role="button"
      tabIndex={0}
      aria-label="Start Free Spins"
      style={{ "--fs-blink-glow": palette.blinkGlow, "--fs-blink-glow-faint": palette.blinkGlowFaint } as CSSProperties}
    >
      <div className="free-spin-celebration-banner">
        <svg
          viewBox="0 0 820 230"
          className="free-spin-celebration-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="shamrockGoldGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fffde8" />
              <stop offset="22%" stopColor="#ffea78" />
              <stop offset="58%" stopColor="#f3a01a" />
              <stop offset="100%" stopColor="#ca6b02" />
            </linearGradient>

            <filter id="shamrock3DShadow" x="-30%" y="-30%" width="160%" height="170%">
              <feDropShadow dx="0" dy="4" stdDeviation="0" floodColor={palette.shadow} floodOpacity="1" />
              <feDropShadow dx="0" dy="7" stdDeviation="1" floodColor={palette.deepShadow} floodOpacity="1" />
              <feDropShadow dx="0" dy="10" stdDeviation="6" floodColor="#000000" floodOpacity="0.9" />
              <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor={palette.glow} floodOpacity="0.75" />
            </filter>
          </defs>

          {/* Top line: "{count} FREE SPINS" */}
          <g className="free-spin-title-group" filter="url(#shamrock3DShadow)">
            {/* 3D Downward Extrusion Shadow Layer */}
            <text
              x="50%"
              y="105"
              textAnchor="middle"
              className="free-spin-svg-title free-spin-layer-shadow"
              dy="5"
              stroke={palette.shadow}
              strokeWidth="16"
              strokeLinejoin="round"
              fill={palette.shadow}
            >
              <tspan className="free-spin-number-tspan" fontSize="118">
                {count}
              </tspan>
              <tspan className="free-spin-words-tspan" fontSize="80" dx="16">
                {words}
              </tspan>
            </text>

            {/* Bright Emerald Green Stroke Layer */}
            <text
              x="50%"
              y="105"
              textAnchor="middle"
              className="free-spin-svg-title free-spin-layer-stroke"
              stroke={palette.stroke}
              strokeWidth="12"
              strokeLinejoin="round"
              fill={palette.stroke}
            >
              <tspan className="free-spin-number-tspan" fontSize="118">
                {count}
              </tspan>
              <tspan className="free-spin-words-tspan" fontSize="80" dx="16">
                {words}
              </tspan>
            </text>

            {/* Inner Amber Edge Layer */}
            <text
              x="50%"
              y="105"
              textAnchor="middle"
              className="free-spin-svg-title free-spin-layer-inner"
              stroke="#6e3905"
              strokeWidth="4"
              strokeLinejoin="round"
              fill="#6e3905"
            >
              <tspan className="free-spin-number-tspan" fontSize="118">
                {count}
              </tspan>
              <tspan className="free-spin-words-tspan" fontSize="80" dx="16">
                {words}
              </tspan>
            </text>

            {/* Metallic Gold Fill Layer */}
            <text
              x="50%"
              y="105"
              textAnchor="middle"
              className="free-spin-svg-title free-spin-layer-fill"
              fill="url(#shamrockGoldGrad)"
            >
              <tspan className="free-spin-number-tspan" fontSize="118">
                {count}
              </tspan>
              <tspan className="free-spin-words-tspan" fontSize="80" dx="16">
                {words}
              </tspan>
            </text>
          </g>

          {/* Bottom line: "PLAY TO START" */}
          <g className="free-spin-subtitle-group" filter="url(#shamrock3DShadow)">
            {/* 3D Downward Extrusion Shadow Layer */}
            <text
              x="50%"
              y="186"
              textAnchor="middle"
              className="free-spin-svg-subtitle free-spin-layer-shadow"
              dy="4"
              stroke={palette.shadow}
              strokeWidth="11"
              strokeLinejoin="round"
              fill={palette.shadow}
            >
              PLAY TO START
            </text>

            {/* Bright Emerald Green Stroke Layer */}
            <text
              x="50%"
              y="186"
              textAnchor="middle"
              className="free-spin-svg-subtitle free-spin-layer-stroke"
              stroke={palette.stroke}
              strokeWidth="8"
              strokeLinejoin="round"
              fill={palette.stroke}
            >
              PLAY TO START
            </text>

            {/* Inner Amber Edge Layer */}
            <text
              x="50%"
              y="186"
              textAnchor="middle"
              className="free-spin-svg-subtitle free-spin-layer-inner"
              stroke="#6e3905"
              strokeWidth="3"
              strokeLinejoin="round"
              fill="#6e3905"
            >
              PLAY TO START
            </text>

            {/* Metallic Gold Fill Layer */}
            <text
              x="50%"
              y="186"
              textAnchor="middle"
              className="free-spin-svg-subtitle free-spin-layer-fill"
              fill="url(#shamrockGoldGrad)"
            >
              PLAY TO START
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
