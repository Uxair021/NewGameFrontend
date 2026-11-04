import { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { GAME_TAGS, CATEGORIES, type GameTag } from "../games/registry";
import { GAME_THUMBNAILS } from "../games/thumbnails";
import {
  fetchLobbyOverrides,
  mergeLobbyOverrides,
  updateLobbyGameRequest,
  type LobbyGameState,
} from "../api/lobbyApi";

/** Shows/hides each game on the player home page and sets its badge. Changes are saved straight
 * away and pushed live to every open home page. */
export function AdminLobbyGamesPage() {
  const [games, setGames] = useState<LobbyGameState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  useEffect(() => {
    fetchLobbyOverrides()
      .then((overrides) => setGames(mergeLobbyOverrides(overrides)))
      .catch(() => setError("Couldn't load lobby games."));
  }, []);

  async function save(slug: string, visible: boolean, tag: GameTag | null) {
    const previous = games;
    setGames((list) => list?.map((g) => (g.game.slug === slug ? { ...g, visible, tag } : g)) ?? null);
    setSavingSlug(slug);
    setError(null);
    try {
      await updateLobbyGameRequest(slug, visible, tag);
    } catch {
      setGames(previous);
      setError("Couldn't save that change — please try again.");
    } finally {
      setSavingSlug(null);
    }
  }

  const shownCount = games?.filter((g) => g.visible).length ?? 0;

  return (
    <div>
      <AdminPageHeader
        title="Lobby Games"
        description="Turn games on or off on the player home page and give them a badge. Changes go live instantly."
      />

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!games ? (
        !error && <div className="p-8 text-center text-slate-500">Loading games...</div>
      ) : (
        <>
          <div className="mb-3 text-sm text-slate-500">
            {shownCount} of {games.length} games shown on the home page
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {games.map(({ game, visible, tag }) => {
              const busy = savingSlug === game.slug;
              return (
                <div
                  key={game.slug}
                  className={`flex items-center gap-3 rounded-xl border bg-white p-3 transition-opacity ${
                    visible ? "border-slate-200" : "border-slate-200 opacity-60"
                  }`}
                >
                  {GAME_THUMBNAILS[game.slug] ? (
                    <img
                      src={GAME_THUMBNAILS[game.slug]}
                      alt=""
                      className="h-14 w-14 flex-shrink-0 rounded-lg bg-slate-800 object-cover"
                    />
                  ) : (
                    <span
                      className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-2xl ${
                        game.thumbnailGradient ?? "from-slate-600 to-slate-800"
                      }`}
                    >
                      {game.icon}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800">{game.name}</div>
                    <div className="text-xs text-slate-500">
                      {CATEGORIES.find((c) => c.id === game.category)?.label ?? game.category}
                      {game.status === "coming-soon" && " · Coming soon"}
                    </div>
                    <select
                      value={tag ?? ""}
                      disabled={busy}
                      onChange={(e) => void save(game.slug, visible, (e.target.value || null) as GameTag | null)}
                      aria-label={`Badge for ${game.name}`}
                      className="mt-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 disabled:opacity-50"
                    >
                      <option value="">No badge</option>
                      {GAME_TAGS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={visible}
                      aria-label={`Show ${game.name} on home page`}
                      onClick={() => void save(game.slug, !visible, tag)}
                      disabled={busy}
                      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                        visible ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                          visible ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                    <span className="text-[10px] font-medium uppercase text-slate-400">{visible ? "Shown" : "Hidden"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
