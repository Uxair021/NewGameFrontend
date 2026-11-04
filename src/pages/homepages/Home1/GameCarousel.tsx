import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { GAME_TAGS } from "../../../games/registry";
import { GAME_THUMBNAILS } from "../../../games/thumbnails";
import { useVisibleLobbyGames, type LobbyGameState } from "../../../api/lobbyApi";

interface CardProps {
  item: LobbyGameState;
  className?: string;
  onClick: (slug: string) => void;
}

function Card({ item: { game, tag }, className = "", onClick }: CardProps) {
  const comingSoon = game.status === "coming-soon";
  const image = GAME_THUMBNAILS[game.slug];
  const tagStyle = GAME_TAGS.find((t) => t.id === tag);
  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none absolute -inset-2 rounded-xl bg-gradient-to-br from-indigo-600 via-fuchsia-600 to-amber-400 opacity-70 blur-md" />
      <button
        type="button"
        onClick={() => onClick(game.slug)}
        disabled={comingSoon}
        className="relative z-10 h-full w-full cursor-pointer overflow-hidden rounded-lg border-2 border-amber-400/20 shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-3px_6px_rgba(0,0,0,0.35)] transition-transform duration-200 hover:scale-105 active:scale-90 disabled:cursor-not-allowed disabled:hover:scale-100"
      >
        {image ? (
          <img src={image} alt={game.name} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span
            className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br text-5xl drop-shadow-lg ${
              game.thumbnailGradient ?? "from-slate-800 to-slate-900"
            }`}
          >
            {game.icon}
          </span>
        )}
        {tagStyle && !comingSoon && (
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-md ${tagStyle.className}`}
          >
            {tagStyle.label}
          </span>
        )}
        {comingSoon && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/55 text-[10px] font-bold uppercase tracking-wider text-slate-100">
            <span className="text-lg">🔒</span>
            Coming Soon
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-center text-xs font-bold text-white drop-shadow">
          {game.name}
        </span>
      </button>
    </div>
  );
}

// 6 slots visible per screen: (100% / 6) - (5rem gap-total / 6), pre-divided to avoid a bare "/" in the arbitrary value
const SLOT_WIDTH = "w-[calc(17.6%)]";

export function GameCarousel() {
  const navigate = useNavigate();
  // The live lobby list (admin's Lobby Games page): the first third as tall cards, the rest
  // stacked two per slot, same layout as the original demo row.
  const games = useVisibleLobbyGames();
  const singleCount = Math.ceil(games.length / 3);
  const singleCards = games.slice(0, singleCount);
  const doubleSlots: LobbyGameState[][] = [];
  for (let i = singleCount; i < games.length; i += 2) doubleSlots.push(games.slice(i, i + 2));

  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScrollLeft: 0, distance: 0 });

  useEffect(() => {
    const handleWindowWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (scrollerRef.current) scrollerRef.current.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
    };
    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWindowWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    drag.current = {
      active: true,
      startX: e.pageX,
      startScrollLeft: scrollerRef.current?.scrollLeft ?? 0,
      distance: 0,
    };
  };

  const stopDrag = () => {
    drag.current.active = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.active || !scrollerRef.current) return;
    e.preventDefault();
    const delta = e.pageX - drag.current.startX;
    drag.current.distance = Math.abs(delta);
    scrollerRef.current.scrollLeft = drag.current.startScrollLeft - delta;
  };

  // ProtectedRoute on /games/* sends signed-out visitors to /login. A real click is told apart
  // from the end of a drag by distance, same as the original.
  const onCardClick = (slug: string) => {
    if (drag.current.distance > 5) return;
    navigate(`/games/${slug}`);
  };

  return (
    <div
      ref={scrollerRef}
      className="homepages-scrollbar-hide w-full cursor-grab overflow-x-auto px-22 pt-15 py-6 active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div className="flex snap-x snap-mandatory items-stretch gap-15 px-6">
        {singleCards.map((item) => (
          <Card key={item.game.slug} item={item} className={`${SLOT_WIDTH} h-105 shrink-0 snap-start`} onClick={onCardClick} />
        ))}

        {doubleSlots.map((pair) => (
          <div key={pair[0].game.slug} className={`${SLOT_WIDTH} flex h-105 shrink-0 snap-start flex-col gap-15`}>
            {pair.map((item) => (
              <Card key={item.game.slug} item={item} className="flex-1" onClick={onCardClick} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
