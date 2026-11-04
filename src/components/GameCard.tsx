import { Link } from "react-router-dom";
import { GAME_TAGS, type GameTag } from "../games/registry";
import { GAME_THUMBNAILS as THUMBNAILS } from "../games/thumbnails";

interface GameCardProps {
  slug: string;
  name: string;
  description: string;
  tag?: GameTag;
  status?: "coming-soon";
  thumbnailGradient?: string;
  icon?: string;
}

export function GameCard({ slug, name, tag, status, thumbnailGradient, icon }: GameCardProps) {
  const isComingSoon = status === "coming-soon";

  const thumb = (
    <div
      className={`relative h-[200px] overflow-hidden ${
        thumbnailGradient ? `bg-gradient-to-br ${thumbnailGradient}` : "bg-gradient-to-b from-slate-800 to-slate-900"
      }`}
    >
      {tag && !isComingSoon && (
        <span
          className={`absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            GAME_TAGS.find((t) => t.id === tag)?.className ?? "bg-slate-600 text-white"
          }`}
        >
          {tag}
        </span>
      )}

      {icon ? (
        <span className="flex h-full w-full items-center justify-center text-6xl drop-shadow-lg">{icon}</span>
      ) : (
        <img src={THUMBNAILS[slug]} alt={name} className="h-full w-full object-cover" />
      )}

      {isComingSoon ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/55">
          <span className="text-lg">🔒</span>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-100">Coming Soon</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/0 transition-colors group-hover:bg-slate-950/35">
          <span className="rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 opacity-0 transition-opacity group-hover:opacity-100">
            ▶ Play
          </span>
        </div>
      )}
    </div>
  );

  const body = (
    <div className="px-4 py-2">
      <h3 className="text-lg font-bold text-white">{name}</h3>
      {/* <p className="mt-1 text-sm text-slate-400">{description}</p> */}
    </div>
  );

  if (isComingSoon) {
    return (
      <div className="flex cursor-not-allowed flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 opacity-90">
        {thumb}
        {body}
      </div>
    );
  }

  return (
    <Link
      to={`/games/${slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 transition hover:-translate-y-1 hover:border-indigo-400/60 hover:shadow-[0_0_24px_rgba(129,140,248,0.25)]"
    >
      {thumb}
      {body}
    </Link>
  );
}
