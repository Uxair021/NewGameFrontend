import { Link } from "react-router-dom";
import { GAME_EXIT_PATH } from "./gameExit";

/**
 * The home (back to lobby) button shared by every game — one look everywhere and readable on any
 * background: a dark glass disc, a gold gradient ring with a soft glow, and a bold white house.
 *
 * `size` is the button's diameter in the game's design pixels (games are CSS-scaled to the
 * screen). Game cards shrink a lot on phones, so on touch devices the button grows 1.6× from the
 * corner it's anchored to (`anchor`), keeping it a comfortable size to see and tap.
 */
export function GameHomeButton({
  size = 48,
  onClick,
  anchor = "top-left",
  className = "",
  ariaLabel = "Home",
}: {
  /** diameter in design px (desktop size) */
  size?: number;
  /** custom exit handler (e.g. ending a session first); without it the button links to the lobby */
  onClick?: () => void;
  /** corner it grows from on phones / tablets, so it never grows off-screen */
  anchor?: "top-left" | "bottom-left";
  className?: string;
  ariaLabel?: string;
}) {
  const ring = Math.max(2, Math.round(size * 0.06));
  const style = {
    width: size,
    height: size,
    padding: ring,
    transformOrigin: anchor === "top-left" ? "top left" : "bottom left",
  };
  const cls =
    `group relative inline-flex shrink-0 items-center justify-center rounded-full ` +
    // gold gradient ring (the padding shows it around the inner disc) + glow + depth shadow
    `bg-[linear-gradient(145deg,#fff1a8_0%,#fbbf24_35%,#d97706_70%,#fde68a_100%)] ` +
    `shadow-[0_0_14px_rgba(251,191,36,0.55),0_4px_10px_rgba(0,0,0,0.6)] ` +
    `transition-transform duration-150 ease-out hover:brightness-110 active:scale-90 ` +
    // phones / tablets: 1.6× from the anchored corner
    `[@media(hover:none)_and_(pointer:coarse)]:scale-[1.6] [@media(hover:none)_and_(pointer:coarse)]:active:scale-[1.45] ` +
    `[-webkit-tap-highlight-color:transparent] ${className}`;

  const face = (
    <span className="flex h-full w-full items-center justify-center rounded-full bg-[radial-gradient(circle_at_50%_30%,#3b2a10_0%,#1a1206_60%,#0b0803_100%)] shadow-[inset_0_2px_3px_rgba(255,255,255,0.18),inset_0_-3px_6px_rgba(0,0,0,0.6)]">
      <svg
        viewBox="0 0 24 24"
        style={{ width: size * 0.5, height: size * 0.5 }}
        className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
        fill="currentColor"
        aria-hidden
      >
        <path d="M11.3 3.3a1 1 0 0 1 1.4 0l8.5 8.2a1 1 0 0 1-.7 1.7H19v6.8a1 1 0 0 1-1 1h-3.7a.8.8 0 0 1-.8-.8v-4.4h-3v4.4a.8.8 0 0 1-.8.8H6a1 1 0 0 1-1-1v-6.8H3.5a1 1 0 0 1-.7-1.7z" />
      </svg>
    </span>
  );

  return onClick ? (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={cls} style={style}>
      {face}
    </button>
  ) : (
    <Link to={GAME_EXIT_PATH} aria-label={ariaLabel} className={cls} style={style}>
      {face}
    </Link>
  );
}
