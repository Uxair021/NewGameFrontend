import { useEffect, useMemo, useState } from "react";
import { apiClient, resolveApiBaseUrl } from "./client";
import { gameRegistry, type GameRegistryEntry, type GameTag } from "../games/registry";

/** Admin override for one lobby card. Games without one keep their registry defaults. */
export interface LobbyGameOverride {
  slug: string;
  visible: boolean;
  /** null = no badge. */
  tag: GameTag | null;
}

export interface LobbyGameState {
  game: GameRegistryEntry;
  visible: boolean;
  tag: GameTag | null;
}

export async function fetchLobbyOverrides(): Promise<LobbyGameOverride[]> {
  const { data } = await apiClient.get<{ games: LobbyGameOverride[] }>("/api/lobby/games");
  return data.games;
}

export async function updateLobbyGameRequest(slug: string, visible: boolean, tag: GameTag | null): Promise<void> {
  await apiClient.put(`/api/admin/lobby/${slug}`, { visible, tag });
}

/** Every registry game with its admin overrides applied. */
export function mergeLobbyOverrides(overrides: LobbyGameOverride[]): LobbyGameState[] {
  const bySlug = new Map(overrides.map((o) => [o.slug, o]));
  return gameRegistry.map((game) => {
    const o = bySlug.get(game.slug);
    return { game, visible: o?.visible ?? true, tag: o ? o.tag : game.tag ?? null };
  });
}

/**
 * Lobby games as the admin has configured them, kept live over SSE — the server sends the full
 * override list on connect and after every admin change. Until it arrives (or if the backend is
 * unreachable) the registry defaults are shown, so the lobby never renders empty.
 */
export function useLobbyGames(): LobbyGameState[] {
  const [overrides, setOverrides] = useState<LobbyGameOverride[]>([]);

  useEffect(() => {
    // No ticket in the URL, so the browser's built-in EventSource retry can reconnect on its own;
    // each reconnect gets a fresh snapshot.
    const source = new EventSource(`${resolveApiBaseUrl()}/api/lobby/stream`);
    source.addEventListener("lobby", (e) => {
      try {
        setOverrides((JSON.parse((e as MessageEvent).data) as { games: LobbyGameOverride[] }).games);
      } catch {
        /* malformed frame — keep the last good state */
      }
    });
    return () => source.close();
  }, []);

  return useMemo(() => mergeLobbyOverrides(overrides), [overrides]);
}

/** Only the games the admin has left switched on, in registry order — what every lobby page shows. */
export function useVisibleLobbyGames(): LobbyGameState[] {
  const games = useLobbyGames();
  return useMemo(() => games.filter((g) => g.visible), [games]);
}
