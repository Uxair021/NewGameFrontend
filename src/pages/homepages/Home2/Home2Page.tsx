import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuCrown,
  LuGift,
  LuLayoutGrid,
  LuLock,
  LuPlay,
  LuPlus,
  LuShoppingCart,
} from "react-icons/lu";
import { useHomeAuthActions } from "../shared/useHomeAuthActions";
import { ClickGlow } from "../shared/ClickGlow";
import { SplashScreen } from "../Home1/SplashScreen";
import { USES_ROTATE_SCREEN } from "../../../platform";
import { HOME_IMAGES } from "../shared/images";
import { CATEGORIES, GAME_TAGS, type GameCategory } from "../../../games/registry";
import { useVisibleLobbyGames, type LobbyGameState } from "../../../api/lobbyApi";
import { GAME_THUMBNAILS as THUMBNAILS } from "../../../games/thumbnails";

/* /home2 — "Featured Games" casino lobby: neon header (balance, BUY/DEAL, icon tiles), a
 * "FEATURED GAMES" title with a category dropdown, a single scrolling row of neon game cards
 * with PLAY buttons, and a footer nav panel. Sizing is mobile-first compact (phones + tablets,
 * including the CSS-rotated portrait view, which still reports the narrow portrait width) with
 * the full desktop sizes from the `xl:` breakpoint up. */

/** Neon card frames, cycled across the row (green, teal, orange, blue, pink). */
const CARD_NEON = [
  "border-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.55)]",
  "border-teal-300 shadow-[0_0_18px_rgba(94,234,212,0.5)]",
  "border-orange-400 shadow-[0_0_18px_rgba(251,146,60,0.55)]",
  "border-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.55)]",
  "border-fuchsia-400 shadow-[0_0_18px_rgba(232,121,249,0.55)]",
];

/** The games the admin has switched on (same live list as the "/" lobby). Playable ones link to
 * /games/<slug> — ProtectedRoute sends signed-out players to /login; "coming soon" ones have no
 * game yet and render as locked cards. */
function toHomeGames(lobbyGames: LobbyGameState[]) {
  return lobbyGames.map(({ game: g, tag }, i) => ({
    slug: g.slug,
    title: g.name,
    category: g.category,
    tag,
    image: THUMBNAILS[g.slug] as string | undefined,
    icon: g.icon,
    gradient: g.thumbnailGradient,
    comingSoon: g.status === "coming-soon",
    neon: CARD_NEON[i % CARD_NEON.length],
  }));
}
type HomeGame = ReturnType<typeof toHomeGames>[number];

/** Dropdown options: the registry's categories, with "Lobby" shown as "All games". */
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ id: c.id, label: c.id === "all" ? "All games" : c.label }));

const HEADER_ICONS = [
  { src: HOME_IMAGES.bonusReward, alt: "Reward", dot: true },
  { src: HOME_IMAGES.cashPrize, alt: "Cash prize" },
  { src: HOME_IMAGES.settings, alt: "Settings" },
  { src: HOME_IMAGES.trophy, alt: "Trophy" },
  { src: HOME_IMAGES.notification, alt: "Announcements", dot: true },
];

const FOOTER_ITEMS = [
  { label: "Favorites", icon: HOME_IMAGES.fav },
  { label: "All Games", icon: HOME_IMAGES.all, active: true },
  { label: "Reels", icon: HOME_IMAGES.reels },
  { label: "Share", icon: HOME_IMAGES.share },
  { label: "Fish", icon: HOME_IMAGES.fish },
  { label: "Other", icon: HOME_IMAGES.others },
  { label: "Daily Bonus", icon: HOME_IMAGES.dailyBonus, gold: true },
];

/** Card frame: fills the row's height (whatever is left between header, title and footer — so
 * it's never cut off on a short phone screen), width following a 2:3 shape, capped on desktop. */
const CARD_FRAME =
  "relative flex aspect-[2/3] h-full max-h-[470px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border-2 bg-[#0a1230]";

/* ------------------------------------------------------------------ */
/*  Game card                                                          */
/* ------------------------------------------------------------------ */

function GameCard({ game }: { game: HomeGame }) {
  const art = game.image ? (
    <img src={game.image} alt={game.title} draggable={false} className="h-full w-full object-cover" />
  ) : (
    <span
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br text-6xl drop-shadow-lg ${
        game.gradient ?? "from-slate-800 to-slate-900"
      }`}
    >
      {game.icon}
    </span>
  );

  const tagStyle = GAME_TAGS.find((t) => t.id === game.tag);
  const badge = tagStyle && !game.comingSoon && (
    <span
      className={`absolute left-1.5 top-1.5 z-10 rounded-full px-1.5 py-0.5 font-title text-[8px] font-extrabold uppercase tracking-wider shadow-md lg:left-2 lg:top-2 lg:px-2 lg:text-[10px] xl:text-xs ${tagStyle.className}`}
    >
      {tagStyle.label}
    </span>
  );

  const panel = (pill: React.ReactNode) => (
    <div className="shrink-0 bg-gradient-to-b from-[#0d1838] to-[#070d24] px-2 pb-2 pt-1.5 lg:px-3 lg:pb-3 lg:pt-2 xl:px-4 xl:pb-4 xl:pt-3">
      <p className="truncate text-center font-title text-[10px] font-bold uppercase tracking-wide text-white lg:text-sm xl:text-base">
        {game.title}
      </p>
      {pill}
    </div>
  );

  if (game.comingSoon) {
    return (
      <div className={`${CARD_FRAME} cursor-not-allowed border-slate-500/60 opacity-90`}>
        <div className="relative min-h-0 flex-1">
          {art}
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-white">
            <LuLock className="h-6 w-6 xl:h-9 xl:w-9" />
          </div>
        </div>
        {panel(
          <span className="mx-auto mt-1 flex w-[85%] items-center justify-center rounded-full  bg-slate-600 py-1 font-title text-[9px] font-extrabold uppercase text-slate-200 lg:py-1.5 lg:text-xs xl:mt-2 xl:py-2 xl:text-sm">
            Coming soon
          </span>
        )}
      </div>
    );
  }

  return (
    <Link
      to={`/games/${game.slug}`}
      aria-label={`Play ${game.title}`}
      draggable={false}
      className={`${CARD_FRAME} ${game.neon} group transition-transform duration-200 hover:-translate-y-1`}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">{art}</div>
        {badge}
      </div>
      {panel(
        <span className="mx-auto mt-1 flex w-[85%] items-center justify-center gap-1.5 rounded-full bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-500 py-1 font-title text-[10px] font-extrabold text-slate-900 shadow-[0_3px_8px_rgba(0,0,0,0.45),inset_0_1px_1px_rgba(255,255,255,0.6)] lg:mt-1.5 lg:py-1.5 lg:text-sm xl:mt-2 xl:gap-2.5 xl:py-2 xl:text-lg">
          <LuPlay className="h-2.5 w-2.5 fill-current lg:h-3 lg:w-3 xl:h-4 xl:w-4" />
          PLAY
        </span>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Carousel                                                           */
/* ------------------------------------------------------------------ */

/** The game cards in a single horizontally scrolling row. Touch: native swipe. Mouse: drag to
 * scroll (a drag never counts as a click on a card), ◀ ▶ buttons that page ~one screen-width,
 * and wheel / touchpad scrolling while the pointer is over the row (see below). */
function GamesCarousel({ games }: { games: HomeGame[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScrollLeft: 0, distance: 0 });

  /* Mouse wheel + touchpad two-finger scrolling, only while the pointer is over the row.
   * - Vertical wheel / two-finger up-down: turned into horizontal scrolling (down = forward).
   *   Safe to take over: this page is exactly one screen tall, so there's no page scroll to block.
   * - Two-finger left-right (mostly-horizontal deltas): left to the browser's native scrolling.
   * - Ctrl+wheel (browser zoom / touchpad pinch) is never touched.
   * Card snapping is paused while wheeling (it would fight a stream of tiny touchpad deltas);
   * ~150ms after the last wheel event the row glides to the nearest card, then snapping resumes. */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let idleTimer: number | undefined;
    let resumeTimer: number | undefined;

    const settleOnNearestCard = () => {
      const padLeft = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
      const rowLeft = el.getBoundingClientRect().left;
      let target = el.scrollLeft;
      let best = Infinity;
      for (const card of Array.from(el.children) as HTMLElement[]) {
        const snapLeft = card.getBoundingClientRect().left - rowLeft + el.scrollLeft - padLeft;
        if (Math.abs(snapLeft - el.scrollLeft) < best) {
          best = Math.abs(snapLeft - el.scrollLeft);
          target = snapLeft;
        }
      }
      el.scrollTo({ left: target, behavior: "smooth" });
      // The row now rests exactly on a snap point, so turning snapping back on can't jump it.
      resumeTimer = window.setTimeout(() => {
        el.style.scrollSnapType = "";
      }, 350);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal swipe: native scrolling
      e.preventDefault();
      // deltaMode: 0 = pixels (Chrome/Edge/Safari, touchpads), 1 = lines (Firefox mouse wheel), 2 = pages
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
      window.clearTimeout(idleTimer);
      window.clearTimeout(resumeTimer);
      el.style.scrollSnapType = "none";
      el.scrollLeft += e.deltaY * unit;
      idleTimer = window.setTimeout(settleOnNearestCard, 150);
    };

    // Non-passive so preventDefault() works (React's onWheel is passive and can't block it).
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(idleTimer);
      window.clearTimeout(resumeTimer);
    };
  }, []);

  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !scrollerRef.current) return;
    drag.current = { active: true, startX: e.clientX, startScrollLeft: scrollerRef.current.scrollLeft, distance: 0 };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!drag.current.active || !el) return;
    const delta = e.clientX - drag.current.startX;
    drag.current.distance = Math.max(drag.current.distance, Math.abs(delta));
    if (drag.current.distance > 5) el.style.scrollSnapType = "none"; // snapping fights a live drag
    el.scrollLeft = drag.current.startScrollLeft - delta;
  };
  const endDrag = () => {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (scrollerRef.current) scrollerRef.current.style.scrollSnapType = ""; // re-snap to the nearest card
  };
  // Swallow the click that ends a drag, so releasing over a card doesn't open the game.
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.distance > 5) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.distance = 0;
    }
  };

  const arrow =
    "absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-sky-300/50 bg-[#0a1230]/85 text-white shadow-[0_0_14px_rgba(56,189,248,0.4)] transition-transform hover:scale-110 active:scale-90 lg:h-10 lg:w-10 xl:h-12 xl:w-12";

  return (
    <div className="relative h-full w-full">
      <button type="button" aria-label="Previous games" onClick={() => page(-1)} className={`${arrow} left-0 xl:left-1`}>
        <LuChevronLeft className="h-4 w-4 xl:h-6 xl:w-6" />
      </button>
      <div
        ref={scrollerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
        className="homepages-scrollbar-hide flex h-full cursor-grab select-none snap-x snap-mandatory flex-nowrap items-center gap-3 overflow-x-auto scroll-px-10 px-10 py-2 active:cursor-grabbing xl:gap-6 xl:scroll-px-16 xl:px-16 xl:py-4"
      >
        {games.map((g) => (
          <GameCard key={g.slug} game={g} />
        ))}
      </div>
      <button type="button" aria-label="Next games" onClick={() => page(1)} className={`${arrow} right-0 xl:right-1`}>
        <LuChevronRight className="h-4 w-4 xl:h-6 xl:w-6" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

/** Header avatar for signed-out visitors — a small slot machine (cabinet, three reels, lever). */
function SlotMachineIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="15" height="17" rx="2.5" />
      <rect x="5.5" y="8" width="10" height="6" rx="1" />
      <path d="M8.83 8v6M12.17 8v6" />
      <path d="M7 17.5h7" />
      <path d="M18 9.5h1.5a1 1 0 0 1 1 1V13" />
      <circle cx="20.5" cy="6.5" r="1.5" />
      <path d="M20.5 8v2" />
    </svg>
  );
}

/** Signed-in avatar: the profile picture if there is one (and it loads), else the name's first
 * letter in capitals. */
function UserAvatar({ name, src }: { name: string; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img src={src} alt="" className="h-full w-full rounded-[inherit] object-cover" onError={() => setBroken(true)} />;
  }
  return <>{name.trim().charAt(0).toUpperCase() || "?"}</>;
}

export function Home2Page() {
  const { user, requireAuth, goToDashboard } = useHomeAuthActions();
  /** balance stays masked (*****) until a signed-in player taps it; signed out, a tap goes to login */
  const [showBalance, setShowBalance] = useState(false);
  useEffect(() => {
    if (!user) setShowBalance(false);
  }, [user]);
  const [category, setCategory] = useState<"all" | GameCategory>("all");
  const lobbyGames = useVisibleLobbyGames();
  const allGames = useMemo(() => toHomeGames(lobbyGames), [lobbyGames]);
  const games = category === "all" ? allGames : allGames.filter((g) => g.category === category);

  /* Same splash screen as /home1 (loading image + gold progress bar, ~3s) before the page shows.
   * Stable callback: SplashScreen restarts its timers whenever onFinish changes identity, so an
   * unrelated re-render (e.g. auth finishing loading) must not hand it a new function. */
  const [showSplash, setShowSplash] = useState(true);
  const finishSplash = useCallback(() => setShowSplash(false), []);
  if (showSplash) {
    // Same 90° landscape rotation as the page itself on phones/tablets held upright — the
    // splash's own fixed full-screen root fills this rotated box (see index.css).
    // iPhone / iPad / Android Chrome: 1.3s instead of 3s, shown above the RotatePhone screen and
    // turned 90° when upright (.rotate-splash in index.css); after it, RotatePhone (upright) or this page.
    if (USES_ROTATE_SCREEN) {
      return (
        <div className="rotate-splash">
          <SplashScreen onFinish={finishSplash} barDelay={300} fillDuration={1000} />
        </div>
      );
    }
    return (
      <div className="force-landscape-page">
        <SplashScreen onFinish={finishSplash} />
      </div>
    );
  }

  return (
    // force-landscape-page: rotates this page 90° into landscape on phones/tablets held upright
    // (same rule as game pages + their loading screen; see index.css). The page is exactly one
    // screen tall: header pinned to the top edge, footer to the bottom edge, the cards in between.
    <>
    {/* Same golden click pulse as /home1 (shared/ClickGlow). Deliberately OUTSIDE the rotated
        .force-landscape-page wrapper: it positions glows at the click's viewport coordinates,
        which would land in the wrong spot inside the CSS-rotated box on phones. */}
    <ClickGlow />
    <div className="force-landscape-page flex h-[100dvh] w-full justify-center overflow-hidden bg-[#050a1e] font-ui">
      <div
        className="relative flex h-full w-full max-w-[1800px] flex-col overflow-hidden bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${HOME_IMAGES.backgroundBody})` }}
      >
        {/* Night-city backdrop: darkened top and bottom, clearer through the middle. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#050a1e]/85 via-[#050a1e]/45 to-[#050a1e]/85" />

        <div className="relative flex h-full min-h-0 flex-col">
          {/* ---------------- Header ---------------- */}
          <header className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-cyan-400/40 bg-[#070d24]/80 px-3 py-1.5 shadow-[0_2px_18px_rgba(34,211,238,0.3)] lg:px-6 lg:py-2 xl:gap-4 xl:px-8 xl:py-3">
            <div className="flex items-center gap-2 xl:gap-5">
              <button
                type="button"
                onClick={requireAuth(goToDashboard)}
                aria-label={user ? "Open dashboard" : "Log in"}
                className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-sky-400/80 bg-gradient-to-b from-[#16244f] to-[#0a1230] font-title text-sm font-bold text-white shadow-[0_0_12px_rgba(56,189,248,0.55)] lg:h-11 lg:w-11 lg:text-base xl:h-14 xl:w-14 xl:rounded-xl xl:text-xl"
              >
                {/* signed out: slot machine icon → login; signed in: picture or first letter → dashboard */}
                {user ? (
                  <UserAvatar name={user.username} src={user.avatarUrl} />
                ) : (
                  <SlotMachineIcon className="h-5 w-5 lg:h-7 lg:w-7 xl:h-9 xl:w-9" />
                )}
              </button>

              <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/70 bg-[#0a1230]/80 px-1.5 py-1 lg:gap-2 lg:px-2.5 lg:py-1.5 xl:gap-3 xl:rounded-xl xl:px-3 xl:py-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 text-[10px] font-bold text-amber-900 lg:h-6 lg:w-6 lg:text-xs xl:h-8 xl:w-8 xl:text-sm">
                  $
                </span>
                {/* masked until tapped: signed out → login, signed in → show / hide the live balance */}
                <button
                  type="button"
                  onClick={requireAuth(() => setShowBalance((v) => !v))}
                  aria-label={user ? (showBalance ? "Hide balance" : "Show balance") : "Log in to see your balance"}
                  className={`font-stats text-xs font-bold text-white lg:text-base xl:text-xl ${user && showBalance ? "" : "tracking-[0.25em]"}`}
                >
                  {user && showBalance ? user.balance.toFixed(2) : "*****"}
                </button>
                <button
                  type="button"
                  onClick={requireAuth()}
                  aria-label="Add funds"
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-amber-400 bg-black/60 text-amber-400 transition-colors hover:bg-amber-400 hover:text-black lg:h-6 lg:w-6 xl:h-8 xl:w-8"
                >
                  <LuPlus className="h-3 w-3 xl:h-4 xl:w-4" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-[#0a1230]/80 px-1.5 py-1 lg:gap-2 lg:px-3 lg:py-1.5 xl:gap-3 xl:rounded-xl xl:px-4 xl:py-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-sky-300 to-blue-500 text-[9px] text-white lg:h-6 lg:w-6 lg:text-xs xl:h-8 xl:w-8 xl:text-sm">
                  ★
                </span>
                <span className="font-stats text-xs font-bold tracking-[0.25em] text-white lg:text-base xl:text-xl">*****</span>
              </div>
            </div>

            <div className="flex items-center gap-2 xl:gap-3">
              <button
                type="button"
                onClick={requireAuth()}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-500 px-3 py-1 font-title text-xs font-extrabold text-slate-900 shadow-[0_4px_10px_rgba(0,0,0,0.4),inset_0_2px_2px_rgba(255,255,255,0.55)] transition-transform active:scale-95 lg:gap-2 lg:px-7 lg:py-1.5 lg:text-lg xl:gap-3 xl:rounded-xl xl:px-12 xl:py-2.5 xl:text-2xl"
              >
                <LuShoppingCart className="h-3.5 w-3.5 lg:h-5 lg:w-5 xl:h-7 xl:w-7" />
                BUY
              </button>
              <button
                type="button"
                onClick={requireAuth()}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-fuchsia-400 via-purple-500 to-violet-600 px-3 py-1 font-title text-xs font-extrabold text-white shadow-[0_4px_10px_rgba(0,0,0,0.4),inset_0_2px_2px_rgba(255,255,255,0.4)] transition-transform active:scale-95 lg:gap-2 lg:px-7 lg:py-1.5 lg:text-lg xl:gap-3 xl:rounded-xl xl:px-12 xl:py-2.5 xl:text-2xl"
              >
                <LuGift className="h-3.5 w-3.5 lg:h-5 lg:w-5 xl:h-7 xl:w-7" />
                DEAL
              </button>
            </div>

            <div className="flex items-center gap-1.5 xl:gap-4">
              {HEADER_ICONS.map((ic) => (
                <button
                  key={ic.alt}
                  type="button"
                  onClick={requireAuth()}
                  aria-label={ic.alt}
                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-[#0d1838]/85 transition-transform hover:scale-110 active:scale-90 lg:h-11 lg:w-11 xl:h-16 xl:w-16 xl:rounded-xl"
                >
                  <img src={ic.src} alt="" className="h-6 w-6 object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.6)] lg:h-8 lg:w-8 xl:h-11 xl:w-11" />
                  {ic.dot && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#070d24] xl:-right-1 xl:-top-1 xl:h-3 xl:w-3" />
                  )}
                </button>
              ))}
            </div>
          </header>

          {/* ---------------- Title row ---------------- */}
          <div className="z-10 flex shrink-0 items-center justify-between px-4 pt-2 lg:px-8 lg:pt-4 xl:px-14 xl:pt-6">
            <div className="flex items-center gap-2 xl:gap-4">
              <LuCrown className="h-5 w-5 fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)] lg:h-8 lg:w-8 xl:h-11 xl:w-11" />
              <h2 className="relative pb-1 font-title text-base font-black uppercase tracking-wide text-white lg:text-3xl xl:pb-2 xl:text-5xl">
                Featured <span className="text-cyan-300">Games</span>
                <span className="absolute bottom-0 left-0 h-0.5 w-12 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] xl:h-1 xl:w-24" />
              </h2>
            </div>

            <label className="relative flex items-center gap-2 rounded-lg border border-sky-400/40 bg-[#0a1230]/85 py-1 pl-2 pr-7 text-xs text-white shadow-[0_0_10px_rgba(56,189,248,0.2)] lg:py-1.5 lg:pl-3 lg:pr-9 lg:text-base xl:gap-3 xl:rounded-xl xl:py-2.5 xl:pl-4 xl:pr-12 xl:text-xl">
              <LuLayoutGrid className="h-3.5 w-3.5 text-cyan-300 lg:h-5 lg:w-5 xl:h-6 xl:w-6" />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as "all" | GameCategory)}
                aria-label="Game category"
                className="cursor-pointer appearance-none bg-transparent font-semibold outline-none"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#0a1230] text-white">
                    {c.label}
                  </option>
                ))}
              </select>
              <LuChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 lg:right-3 lg:h-5 lg:w-5 xl:right-4 xl:h-6 xl:w-6" />
            </label>
          </div>

          {/* ---------------- Cards ---------------- */}
          <main className="flex min-h-0 flex-1 items-center py-1 xl:py-4">
            {/* key: a new category starts the row back at the first card */}
            <GamesCarousel key={category} games={games} />
          </main>

          {/* ---------------- Footer ---------------- */}
          <footer className="z-20 mx-2 mb-1.5 shrink-0 rounded-xl border border-sky-400/30 bg-gradient-to-b from-[#0d1838]/95 to-[#070d24]/95 shadow-[0_0_20px_rgba(56,189,248,0.2)] lg:mx-5 lg:mb-3 xl:mx-8 xl:mb-4 xl:rounded-2xl">
            <nav className="flex items-stretch divide-x divide-sky-400/15">
              {FOOTER_ITEMS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={requireAuth()}
                  className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-transform hover:scale-105 active:scale-95 lg:gap-1 lg:py-2 xl:gap-2 xl:py-3 ${
                    item.gold ? "!border-l-amber-400/60" : ""
                  }`}
                >
                  <img
                    src={item.icon}
                    alt=""
                    className="h-7 w-7 object-contain drop-shadow-[0_3px_5px_rgba(0,0,0,0.6)] lg:h-10 lg:w-10 xl:h-14 xl:w-14"
                  />
                  <span
                    className={`whitespace-nowrap text-[9px] font-semibold lg:text-sm xl:text-lg ${
                      item.active ? "text-cyan-300" : item.gold ? "text-amber-300" : "text-slate-200"
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              ))}
            </nav>
          </footer>
        </div>
      </div>
    </div>
    </>
  );
}
