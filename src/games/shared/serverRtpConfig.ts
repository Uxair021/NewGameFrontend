import { apiClient } from "../../api/client";

/**
 * Server copy of each game's admin RTP config.
 *
 * The admin RTP page saves a game's config to the database as well as to the admin's browser, and
 * the game fetches it every time it loads (before its loading screen finishes) and writes it into
 * localStorage under the game's usual key — so every player, on any device, plays on what the
 * admin saved. From there on the game reads localStorage exactly as before; its own loader still
 * validates the config and applies the house rules (falling back to its default if it doesn't fit).
 *
 * `gameId` is the game's backend id (the same as in its /api/games/<id>/spin-log route), or "keno"
 * for the one config HexaKeno and Super Keno Balls share.
 */

/** Fetches the admin-saved config and stores it under `storageKey`. Resolves either way: when the
 * server has none yet or can't be reached, the game keeps its current local config (or default).
 * Returns whether a server config was stored. */
export async function syncRtpConfigFromServer(gameId: string, storageKey: string): Promise<boolean> {
  try {
    // Short timeout: this holds the loading screen, and on failure the local config is fine.
    const { data } = await apiClient.get<{ config: unknown }>(`/api/games/${gameId}/rtp-config`, { timeout: 5000 });
    const config = data?.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) return false;
    localStorage.setItem(storageKey, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** Admin page: saves a game's config to the server (every player's game loads it from there).
 * Throws if the server rejects it, so the page can say so instead of claiming it saved. */
export async function saveRtpConfigToServer(gameId: string, config: unknown): Promise<void> {
  await apiClient.put(`/api/admin/rtp-config/${gameId}`, { config });
}
