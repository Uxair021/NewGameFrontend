import { Link } from "react-router-dom";
import { getGameBySlug } from "../games/registry";

/** Whichever tagged-NEW game should headline the banner's "Play Now" CTA. */
const FEATURED_SLUG = "hexa-keno";

export function HeroBanner() {
  const featured = getGameBySlug(FEATURED_SLUG);

  return (
    <div className="relative flex min-h-[150px] items-center overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-amber-950 via-slate-950 to-black px-5 py-6 sm:min-h-[220px] sm:px-8 sm:py-10">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(251,191,36,0.35), transparent 45%), radial-gradient(circle at 85% 75%, rgba(249,115,22,0.25), transparent 45%)",
        }}
      />
      <div className="relative z-10 max-w-md">
        <span className="mb-2 inline-block rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300 ring-1 ring-amber-400/30 sm:mb-3">
          Featured game
        </span>
        <h2 className="mb-1.5 text-xl font-extrabold text-white sm:mb-2 sm:text-3xl">Welcome to Texas Slots</h2>
        <p className="mb-3 hidden text-sm text-slate-300 sm:mb-5 sm:block">
          Spin the reels for wilds, scatters, and free-spin bonanzas, or pick your numbers on Keno. Big wins are
          waiting.
        </p>
        {featured && (
          <Link
            to={`/games/${featured.slug}`}
            className="inline-block rounded-full bg-gradient-to-br from-amber-400 to-orange-500 px-5 py-2 text-sm font-bold text-slate-900 shadow-lg hover:brightness-105 sm:px-6 sm:py-2.5"
          >
            ▶ Play {featured.name}
          </Link>
        )}
      </div>
    </div>
  );
}
