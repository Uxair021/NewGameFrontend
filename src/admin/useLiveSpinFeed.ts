import { useEffect, useRef, useState } from "react";
import { adminApi, SpinEntry } from "./adminApi";
import { resolveApiBaseUrl } from "../api/client";

const RECONNECT_DELAY_MS = 1500;

export interface LiveSpinEvent {
  userId: string;
  username: string;
  gameId: string;
  bet: number;
  winAmount: number;
  tier: string | null;
  forced: boolean;
  balanceAfter: number;
  createdAt: string;
}

export interface LiveSpinFilter {
  username?: string;
  gameId?: string;
}

const MAX_ENTRIES = 300;
const SEARCH_DEBOUNCE_MS = 300;

function toLiveEvent(s: SpinEntry): LiveSpinEvent {
  return {
    userId: typeof s.userId === "string" ? s.userId : s.userId._id,
    username: typeof s.userId === "string" ? "" : s.userId.username,
    gameId: s.gameId,
    bet: s.betAmount,
    winAmount: s.winAmount,
    tier: s.tier,
    forced: s.forced,
    balanceAfter: s.balanceAfter,
    createdAt: s.createdAt,
  };
}

function matchesFilter(s: LiveSpinEvent, filter: LiveSpinFilter): boolean {
  if (filter.gameId && filter.gameId !== "all" && s.gameId !== filter.gameId) return false;
  if (filter.username && !s.username.toLowerCase().includes(filter.username.toLowerCase())) return false;
  return true;
}

/**
 * Loads spins matching `filter` from the server (so search/game filters see the full history,
 * not just whatever happens to still be in the live rolling window), then keeps the list live
 * via SSE — new spins are appended only if they match the current filter.
 */
export function useLiveSpinFeed(filter: LiveSpinFilter = {}) {
  const [spins, setSpins] = useState<LiveSpinEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const sourceRef = useRef<EventSource | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Server-side search/filter — debounced so fast typing doesn't spam requests.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      adminApi
        .recentSpins({
          username: filter.username || undefined,
          gameId: filter.gameId && filter.gameId !== "all" ? filter.gameId : undefined,
          limit: MAX_ENTRIES,
        })
        .then((initial) => {
          if (cancelled) return;
          setSpins(initial.map(toLiveEvent));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, filter.username ? SEARCH_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.username, filter.gameId]);

  // Long-lived SSE connection for the page's lifetime, independent of the active filter.
  // SSE auth tickets are short-lived and single-use (see backEnd/src/utils/sseTicket.ts), so
  // if this connection ever drops, the browser's native EventSource retry (same URL, same
  // already-consumed ticket) can never succeed on its own — a fresh ticket + a brand new
  // EventSource is required. `connect()` below is what actually makes this reconnect instead
  // of silently going stale until the admin manually reloads the page.
  useEffect(() => {
    let cancelled = false;
    let reconnectId: number | null = null;

    const connect = () => {
      if (cancelled) return;
      adminApi.getSseTicket().then((ticket) => {
        if (cancelled) return;
        const url = `${resolveApiBaseUrl()}/api/admin/events?ticket=${encodeURIComponent(ticket)}`;
        const source = new EventSource(url);
        sourceRef.current = source;

        source.onopen = () => setConnected(true);
        source.onerror = () => {
          setConnected(false);
          source.close();
          if (sourceRef.current === source) sourceRef.current = null;
          if (!cancelled) reconnectId = window.setTimeout(connect, RECONNECT_DELAY_MS);
        };
        source.addEventListener("spin", (event) => {
          const payload = JSON.parse((event as MessageEvent).data) as LiveSpinEvent;
          if (!matchesFilter(payload, filterRef.current)) return;
          setSpins((prev) => [payload, ...prev].slice(0, MAX_ENTRIES));
        });
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectId !== null) window.clearTimeout(reconnectId);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  return { spins, connected, loading };
}
