import { useState } from "react";
import { CATEGORIES, type GameCategory } from "../games/registry";
import { useLobbyGames } from "../api/lobbyApi";
import { Sidebar } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { HeroBanner } from "../components/HeroBanner";
import { FilterChips } from "../components/FilterChips";
import { GameCard } from "../components/GameCard";

export function HomePage() {
  const [category, setCategory] = useState<"all" | GameCategory>("all");
  const [tagFilter, setTagFilter] = useState<"all" | "HOT" | "NEW">("all");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const lobbyGames = useLobbyGames();

  const games = lobbyGames.filter(({ game, visible, tag }) => {
    if (!visible) return false;
    if (category !== "all" && game.category !== category) return false;
    if (tagFilter !== "all" && tag !== tagFilter) return false;
    if (search.trim() && !game.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar active={category} onSelect={setCategory} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar search={search} onSearchChange={setSearch} onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <HeroBanner />

          <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3 sm:mb-5 sm:mt-8">
            <h2 className="m-0 text-lg font-bold sm:text-xl">{CATEGORIES.find((c) => c.id === category)?.label}</h2>
            <FilterChips active={tagFilter} onSelect={setTagFilter} />
          </div>

          {games.length > 0 ? (
            <section className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-5">
              {games.map(({ game, tag }) => (
                <GameCard
                  key={game.slug}
                  slug={game.slug}
                  name={game.name}
                  description={game.description}
                  tag={tag ?? undefined}
                  status={game.status}
                  thumbnailGradient={game.thumbnailGradient}
                  icon={game.icon}
                />
              ))}
            </section>
          ) : (
            <p className="text-slate-400">No games match your filters.</p>
          )}
        </main>
      </div>
    </div>
  );
}
