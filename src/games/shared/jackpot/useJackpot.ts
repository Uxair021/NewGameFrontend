import { useCallback, useEffect, useRef, useState } from "react";
import {
  JackpotClaimResult,
  JackpotInfo,
  JackpotPending,
  clearJackpotContribution,
  jackpotClaimRequest,
  jackpotStreamTicketRequest,
  jackpotStreamUrl,
  setJackpotContribution,
} from "./jackpotApi";

const RECONNECT_DELAY_MS = 3_000;
/** Claim tries when the request never reaches the server (network drop). A rejection from the
 * server is never retried here — it lands in the admin's payout report for a manual Retry. */
const CLAIM_TRIES = 4;
const CLAIM_RETRY_MS = 2_000;

/**
 * Connects an open game to the shared jackpot pool over one SSE stream — no polling. While the
 * stream is open the backend counts this player as playing this game; it pushes the four tiers'
 * collected amounts whenever they change (at most once a second), the contribution % the spin
 * logic reads via getJackpotRtpScale, and any hit that's ready for this player.
 *
 * A game that can deliver a jackpot passes `canDeliver: true` and, before each paid spin, calls
 * `takePending()` — if it returns a hit, it forces its free spins / bonus feature, and when that
 * feature ends, `claim(hit.hitId)` and credits the amount. Games that only show the bar use
 * GameJackpotBar, which calls this with canDeliver off.
 */
export function useJackpot(gameId: string, { canDeliver = false }: { canDeliver?: boolean } = {}) {
  const [info, setInfo] = useState<JackpotInfo | null>(null);
  const pendingRef = useRef<JackpotPending | null>(null);
  /** The hit currently being delivered — the server keeps offering it until it's claimed, so
   * repeats are ignored instead of forcing a second feature. */
  const takenHitIdRef = useRef<string | null>(null);

  // Stream tickets are single-use, so the browser's own EventSource retry (same URL) can never
  // succeed — on any error, close it and reconnect with a fresh ticket.
  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectId: number | null = null;

    const connect = () => {
      if (cancelled) return;
      jackpotStreamTicketRequest()
        .then((ticket) => {
          if (cancelled) return;
          source = new EventSource(jackpotStreamUrl(ticket, gameId, canDeliver));
          source.addEventListener("state", (event) => {
            const next = JSON.parse((event as MessageEvent).data) as JackpotInfo;
            setInfo(next);
            setJackpotContribution(gameId, next.inPool ? next.contributionPercent : 0);
          });
          source.addEventListener("pending", (event) => {
            const hit = JSON.parse((event as MessageEvent).data) as JackpotPending;
            if (hit.hitId !== takenHitIdRef.current) pendingRef.current = hit;
          });
          source.onerror = () => {
            source?.close();
            source = null;
            if (!cancelled) reconnectId = window.setTimeout(connect, RECONNECT_DELAY_MS);
          };
        })
        .catch(() => {
          if (!cancelled) reconnectId = window.setTimeout(connect, RECONNECT_DELAY_MS);
        });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectId !== null) window.clearTimeout(reconnectId);
      source?.close();
      clearJackpotContribution(gameId);
      pendingRef.current = null;
    };
  }, [gameId, canDeliver]);

  /** Takes the ready hit (if any) so it's only used for one feature. If the player leaves before
   * claiming, the backend still has it locked to them and offers it again next time. */
  const takePending = useCallback((): JackpotPending | null => {
    const hit = pendingRef.current;
    pendingRef.current = null;
    if (hit) takenHitIdRef.current = hit.hitId;
    return hit;
  }, []);

  const claim = useCallback(
    async (hitId: string): Promise<JackpotClaimResult | null> => {
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            return await jackpotClaimRequest(hitId, gameId);
          } catch (err) {
            const reachedServer = !!(err as { response?: unknown })?.response;
            if (reachedServer || attempt >= CLAIM_TRIES) return null;
            await new Promise((r) => window.setTimeout(r, CLAIM_RETRY_MS * attempt));
          }
        }
      } finally {
        if (takenHitIdRef.current === hitId) takenHitIdRef.current = null;
      }
    },
    [gameId]
  );

  return { info, takePending, claim };
}
