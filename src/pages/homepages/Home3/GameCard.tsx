import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { GAME_TAGS, type GameTag } from "../../../games/registry";
import { PopularGame } from "./data";

const BADGE_STYLES: Record<GameTag, string> = {
  HOT: "bg-gradient-to-r from-rose-500 to-orange-500 text-white",
  NEW: "bg-gradient-to-r from-emerald-400 to-green-500 text-slate-900",
  TOP: "bg-gradient-to-r from-sky-400 to-blue-500 text-white",
  JACKPOT: "bg-gradient-to-r from-[color:var(--color-nx-gold)] to-amber-500 text-slate-900",
  EXCLUSIVE: "bg-gradient-to-r from-violet-600 to-indigo-600 text-white",
};

/** Playable games link to /games/<slug> (ProtectedRoute sends signed-out visitors to /login);
 * "coming soon" ones render locked. */
export function GameCard({ game }: { game: PopularGame }) {
  const reduceMotion = useReducedMotion();
  const { id: slug, title, image, gradient, icon, badge, comingSoon } = game;

  const art = image ? (
    <motion.img
      src={image}
      alt={title}
      draggable={false}
      className="h-full w-full object-cover"
      whileHover={reduceMotion || comingSoon ? undefined : { scale: 1.08 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    />
  ) : (
    <span
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br text-5xl drop-shadow-lg ${
        gradient ?? "from-slate-800 to-slate-900"
      }`}
    >
      {icon}
    </span>
  );

  const thumb = (
    <div className={`relative aspect-[2.8/4] overflow-hidden ${comingSoon ? "cursor-not-allowed" : "cursor-pointer"}`}>
      {art}

      {badge && !comingSoon && (
        <span
          className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-title font-bold uppercase tracking-wide shadow-md ${BADGE_STYLES[badge]}`}
        >
          {GAME_TAGS.find((t) => t.id === badge)?.label ?? badge}
        </span>
      )}

      {comingSoon && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/55">
          <span className="text-lg">🔒</span>
          <span className="text-[10px] font-title font-bold uppercase tracking-wider text-slate-100">Coming Soon</span>
        </div>
      )}

      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-center text-xs font-bold text-white drop-shadow">
        {title}
      </span>
    </div>
  );

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="group relative w-40 shrink-0 overflow-hidden rounded border border-white/20 bg-[color:var(--color-nx-surface)] shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-3px_6px_rgba(0,0,0,0.35)] transition-colors duration-300 hover:border-[color:var(--color-nx-violet)]/60 hover:shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-3px_6px_rgba(0,0,0,0.35),0_0_24px_rgba(147,51,234,0.25)] sm:w-44"
    >
      {comingSoon ? (
        thumb
      ) : (
        <Link to={`/games/${slug}`} aria-label={`Play ${title}`} draggable={false} className="block">
          {thumb}
        </Link>
      )}
    </motion.div>
  );
}
