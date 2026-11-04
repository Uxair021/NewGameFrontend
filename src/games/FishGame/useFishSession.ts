import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { FishWallet } from "./pixi/FishGameScene";
import {
  endFishSession,
  endFishSessionOnUnload,
  FishHitInput,
  FishSessionSummary,
  sendFishHits,
  startFishSession,
} from "./api";

/** How often queued hits are sent to the server — one request per this interval, not per hit. */
const BATCH_INTERVAL_MS = 1000;
/** With nothing to send, an empty batch still goes out this often so the server knows the tab
 * is open (it closes sessions it hasn't heard from in ~2 minutes). */
const HEARTBEAT_MS = 30 * 1000;
/** No player input for this long shows the "still playing?" countdown. Auto-fire doesn't count
 * as input, so an unattended auto-firing gun gets stopped too. */
const IDLE_AFTER_MS = 10 * 60 * 1000;
const IDLE_COUNTDOWN_SECONDS = 10;
const MAX_HITS_PER_BATCH = 100;

export type FishSessionPhase = "starting" | "playing" | "idle-warning" | "ending" | "ended" | "failed";

interface QueuedHit extends FishHitInput {
  resolve: (result: { killed: boolean; winAmount: number } | null) => void;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One visit to the fish game, from entering to leaving. Hits are queued and sent about once a
 * second in a single request (the server still rolls every kill), instead of one request per
 * hit. Credits shown = server balance − bets on bullets still in flight or waiting to be sent.
 */
export function useFishSession(betRef: MutableRefObject<number>, onBalance: (balance: number) => void) {
  const [phase, setPhaseState] = useState<FishSessionPhase>("starting");
  const [credits, setCredits] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(IDLE_COUNTDOWN_SECONDS);
  const [summary, setSummary] = useState<FishSessionSummary | null>(null);

  const phaseRef = useRef<FishSessionPhase>("starting");
  const sessionIdRef = useRef<string | null>(null);
  const balanceRef = useRef(0);
  const reservedRef = useRef(0);
  const queueRef = useRef<QueuedHit[]>([]);
  const sendingRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const lastInputAtRef = useRef(Date.now());
  const onBalanceRef = useRef(onBalance);
  onBalanceRef.current = onBalance;

  const setPhase = (next: FishSessionPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const syncCredits = () => setCredits(roundCents(balanceRef.current - reservedRef.current));
  const release = (bet: number) => {
    reservedRef.current = roundCents(reservedRef.current - bet);
  };

  /** Ends the session on the server and shows the summary. Waits for queued hits to be sent first
   * so every hit the player already saw lands in this session. */
  const finish = useCallback(async (reason: "exit" | "idle") => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || phaseRef.current === "ending" || phaseRef.current === "ended") return;
    setPhase("ending");

    while (sendingRef.current || queueRef.current.length > 0) {
      if (!sendingRef.current) await flush();
      else await new Promise((r) => setTimeout(r, 100));
    }

    try {
      const result = await endFishSession(sessionId, reason);
      setSummary(result);
      if (result.endBalance !== null) {
        balanceRef.current = result.endBalance;
        onBalanceRef.current(result.endBalance);
      }
    } catch {
      setError("Couldn't reach the server — your balance is saved up to the last shot.");
    }
    sessionIdRef.current = null;
    reservedRef.current = 0;
    syncCredits();
    setPhase("ended");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads only refs and stable setters
  }, []);

  /** Sends whatever hits are queued (or an empty heartbeat). Only one batch is ever in flight, so
   * each response's balance is authoritative. */
  const flush = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || sendingRef.current) return;
    const batch = queueRef.current.splice(0, MAX_HITS_PER_BATCH);
    sendingRef.current = true;
    lastSentAtRef.current = Date.now();

    try {
      const response = await sendFishHits(
        sessionId,
        batch.map(({ speciesId, betAmount }) => ({ speciesId, betAmount }))
      );
      balanceRef.current = response.balance;
      batch.forEach((hit, i) => {
        release(hit.betAmount);
        const result = response.results[i];
        hit.resolve(result && !("rejected" in result) ? result : null);
      });
      setError(null);
      onBalanceRef.current(response.balance);
    } catch (err: any) {
      // Not retried: if the request did reach the server, resending would charge those hits twice.
      // The next successful batch's balance corrects the display either way.
      batch.forEach((hit) => {
        release(hit.betAmount);
        hit.resolve(null);
      });
      if (err?.response?.status === 409) {
        // The server already closed this session (another tab took over, or it timed out).
        sendingRef.current = false;
        syncCredits();
        const sessionIdToSummarize = sessionId;
        setPhase("ending");
        try {
          setSummary(await endFishSession(sessionIdToSummarize, "exit"));
        } catch {
          /* summary is optional here */
        }
        sessionIdRef.current = null;
        setError("This game session has ended.");
        setPhase("ended");
        return;
      }
      setError(err?.response?.data?.error ?? "Connection problem — some shots weren't counted");
    } finally {
      sendingRef.current = false;
      syncCredits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads only refs and stable setters
  }, []);

  // useMemo rather than useRef: React Fast Refresh keeps useRef values across code edits (so the
  // scene would keep calling a stale wallet) but re-runs useMemo, together with the scene effect.
  const wallet = useMemo<FishWallet>(
    () => ({
      reserveShot() {
        if (phaseRef.current !== "playing") return null;
        const bet = betRef.current;
        if (balanceRef.current - reservedRef.current < bet - 1e-9) return null;
        reservedRef.current = roundCents(reservedRef.current + bet);
        syncCredits();
        return bet;
      },
      releaseShot(bet) {
        release(bet);
        syncCredits();
      },
      resolveHit(speciesId, bet) {
        if (!sessionIdRef.current || phaseRef.current === "ended") {
          release(bet);
          syncCredits();
          return Promise.resolve(null);
        }
        return new Promise((resolve) => queueRef.current.push({ speciesId, betAmount: bet, resolve }));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads only refs and stable setters
    []
  );

  /** Opens a session on the server (records the starting balance). */
  const begin = useCallback((isCancelled: () => boolean = () => false) => {
    setPhase("starting");
    setSummary(null);
    setError(null);
    startFishSession()
      .then((session) => {
        if (isCancelled()) return;
        sessionIdRef.current = session.sessionId;
        balanceRef.current = session.balance;
        reservedRef.current = 0;
        lastInputAtRef.current = Date.now();
        syncCredits();
        setPhase("playing");
      })
      .catch((err) => {
        if (isCancelled()) return;
        setError(err?.response?.data?.error ?? "Couldn't start the game — please try again");
        setPhase("failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads only refs and stable setters
  }, []);

  // Entering the game.
  useEffect(() => {
    let cancelled = false;
    begin(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [begin]);

  // Batch sender + heartbeat + idle check, on one timer.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const current = phaseRef.current;
      if (current !== "playing" && current !== "idle-warning") return;

      if (queueRef.current.length > 0 || now - lastSentAtRef.current >= HEARTBEAT_MS) flush();

      if (current === "playing" && now - lastInputAtRef.current >= IDLE_AFTER_MS) {
        setCountdown(IDLE_COUNTDOWN_SECONDS);
        setPhase("idle-warning");
      }
    }, BATCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  // Any real player input resets the idle clock (pointermove too — someone moving the aim is present).
  useEffect(() => {
    const markActive = () => {
      lastInputAtRef.current = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, markActive));
  }, []);

  // The "still playing?" countdown.
  useEffect(() => {
    if (phase !== "idle-warning") return;
    if (countdown <= 0) {
      finish("idle");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, countdown, finish]);

  // Leaving without the in-game exit (tab closed, reload, browser back): close the session with a
  // request that survives the page unloading. If even that fails, the server times it out.
  useEffect(() => {
    const onPageHide = () => {
      if (sessionIdRef.current && phaseRef.current !== "ended") endFishSessionOnUnload(sessionIdRef.current);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      onPageHide();
    };
  }, []);

  const continuePlaying = useCallback(() => {
    lastInputAtRef.current = Date.now();
    setPhase("playing");
  }, []);

  return {
    wallet,
    phase,
    credits,
    error,
    countdown,
    summary,
    continuePlaying,
    exit: useCallback(() => finish("exit"), [finish]),
    playAgain: useCallback(() => begin(), [begin]),
  };
}
