import { useEffect, useRef, useState, useCallback, ReactNode, CSSProperties, lazy, Suspense } from "react";
import { GameInfoPopup, InfoTheme } from "../shared/GameInfoPopup";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import {
  SizzlingSevensScene,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  REEL_AREA_TOP,
  RENDER_QUALITY,
  VIEW_LEFT,
  VIEW_TOP,
  VIEW_WIDTH,
  VIEW_HEIGHT,
} from "./pixi/SizzlingSevensScene";
import {
  getSizzlingSevensConfig,
  getForcedLossChance,
  getSizzlingRtpConfig,
  isLosingSizzlingGrid,
  spinRequest,
  logSpinResult,
  SizzlingSevensConfigResponse,
  FreeGamesAward,
  drawFreeGamesFloor,
  makeFreeSpinWinOf,
  pickCoveringGrid,
  syncSizzlingRtpConfigFromServer,
} from "./api";
import { pickFreeSpinMultiplier, type Grid } from "./winCalc";
import { BigWinBanner, FreeSpinsBanner } from "./BigWinBanner";
import { FREE_GAMES_MIN_WIN_X } from "./config";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";
import { COUNT_UP_MS } from "../shared/useCountUp";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";

// Control bar, loaded on demand (code-split into its own chunk) — see the <Suspense> footer below.
const GameController3rd = lazy(() => import("../shared/GameController3rd"));
const BG_URL = "/symbols/sizzling7s/bg.webp";
const BG_MUSIC_URL = "/Sound/alex-morgan-chinese-lunar-new-year-music-548625.mp3";
/** How long an auto-played free spin stays continuously "spinning" before it lands on its own
 * — a normal spin instead lands whenever the player clicks Stop. */
const FREE_SPIN_AUTO_STOP_MS = 1400;
const FREE_SPIN_GAP_MS = 900;
/** Longest a win waits for its symbol animation to load before WIN is shown anyway. */
const MAX_HIGHLIGHT_WAIT_MS = 400;
/** The reels just landed (all together): the spin sound stops and the stop "drum" hits — at the
 * landing itself, not after the settle bounce finishes (see reelLanding). */
const onReelsLanded = () => {
  sound.stopReelSpinLoop();
  sound.playDrumBeat();
};
/** Testing aid — true lands a BONUS on every reel of every paid spin (3 scatters), so Free Games
 * trigger every time. Never applied to the free spins themselves, so a round still ends.
 * false = normal play. */
const FORCE_FREE_GAMES = false;


/** Full-screen banners, shown one at a time in order (see `banners` state). "bigWin" is only the
 * Free Games round-total summary — there's no Big/Mega/Jackpot celebration on regular wins. */
type Banner = { kind: "bigWin"; winAmount: number } | { kind: "freeSpins"; freeSpins: number; multiplierPool: number[] };

export function SizzlingSevensGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (spins read it instead of a possibly stale closure), the balance a manual spin
  // started from (its bet is taken on SPIN, its win added after STOP) and an in-flight lock so a
  // second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinBalanceBeforeRef = useRef(0);
  const spinLockRef = useRef(false);
  /** A base-game win waiting to be added to the balance: it goes in once the WIN readout has
   * finished counting up (COUNT_UP_MS), or straight away if a new spin starts / the game closes first. */
  const pendingCreditRef = useRef<{ amount: number; timer: number } | null>(null);
  const flushPendingCreditRef = useRef(() => {});
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SizzlingSevensScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  // The controller now sits below the game area (not over the reels), so the card is taller than
  // CANVAS_HEIGHT — track its real height so the scaled outer frame doesn't crop it.
  const [cardHeight, setCardHeight] = useState(CANVAS_HEIGHT);
  useEffect(() => {
    const el = gameCardRef.current;
    if (!el) return;
    const update = () => setCardHeight(el.offsetHeight || CANVAS_HEIGHT);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<SizzlingSevensConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>([0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10]);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [awaitingStop, setAwaitingStop] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  /** Queue of full-screen banners — the first one is showing; dismissing it shows the next. A
   * spin can queue both (round total first, then a retriggered Free Spins award). Free spins wait
   * while any banner is up. */
  const [banners, setBanners] = useState<Banner[]>([]);
  /** Player pressed SPIN while a Free Spins banner was up — it leaves, then the round (re)starts. */
  const [bannerStartRequested, setBannerStartRequested] = useState(false);
  const dismissBanner = useCallback(() => {
    setBanners((q) => q.slice(1));
    setBannerStartRequested(false);
  }, []);
  /** Running total of the current Free Games round — shown in the WIN box during the round and
   * only credited to the balance once the player taps the round's Big Win banner away. */
  const roundWinRef = useRef(0);
  /** The triggering spin's own win, held in roundWinRef — the round minimum counts free-spin wins only. */
  const triggerWinRef = useRef(0);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);

  const [freeGames, setFreeGames] = useState<{
    remaining: number;
    total: number;
    pool: number[];
    lastMultiplier: number | null;
    totalWin: number;
    lockedBetIndex: number;
  } | null>(null);

  const betLevel = betLevels[betIndex] ?? betLevels[0];
  const totalBet = betLevel;

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncSizzlingRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getSizzlingSevensConfig()
      .then((c) => {
        setConfig(c);
        setBetLevels(c.betLevels);
      })
      .catch(() => {
        /* fall back to defaults already set */
      });
  }, [rtpReady]);

  // Waits for config (the reel needs its symbolWeights before it can start scrolling with the
  // right distribution — see pixi/Reel.ts) before creating the Pixi app/scene.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        ...gameRendererOptions(),
        resolution: fitResolution(fitScaleRef.current) * RENDER_QUALITY,
        autoDensity: true,
        backgroundAlpha: 0,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        // The canvas only covers the reel area (see VIEW_* in the scene) — pin it there.
        Object.assign(app.canvas.style, { position: "absolute", left: `${VIEW_LEFT}px`, top: `${VIEW_TOP}px` });
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await SizzlingSevensScene.create(app, config.symbolWeights, config.paylines);
          if (cancelled) {
            scene.destroy();
            return;
          }
          sceneRef.current = scene;
          setReady(true);
        } catch (err) {
          // Scene/asset creation failed after the canvas was already mounted — tear it down
          // fully so a retry starts from a clean slate instead of stacking a second canvas.
          app.canvas.remove();
          app.destroy(true, { children: true });
          appRef.current = null;
          throw err;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Previously unhandled — any WebGL context or asset-loading failure here (the most
        // likely cause on memory/WebGL-constrained mobile browsers) just left `ready` false
        // forever with the loading screen spinning and no error, no retry, nothing to act
        // on. Surfacing it is what actually matters here, more than the exact message.
        console.error("Sizzling 7s: failed to initialize", err);
        setInitError("Failed to load the game. Please check your connection and try again.");
      });

    return () => {
      cancelled = true;
      sound.stopBackgroundMusic();
      sound.stopReelSpinLoop();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      releaseTextures();
    };
  }, [config, initRetryKey]);

  // Keep the canvas's backing resolution matched to its on-screen size: the game card is
  // CSS-scaled by fitScale, so rendering at full design size is mostly pixels the browser throws
  // away. Debounced so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = fitResolution(fitScale) * RENDER_QUALITY;
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      app.renderer.resize(VIEW_WIDTH, VIEW_HEIGHT, resolution);
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  /** Applies a resolved spin's result to state — shared by the manual (Stop-clicked) path and
   * the free-spin auto-stop path. */
  const applyResult = useCallback(
    async (
      result: {
        winAmount: number;
        winningPositions: [number, number][];
        freeGamesAward: FreeGamesAward | null;
        balance: number;
      },
      isFreeSpin: boolean
    ) => {
      // Order: the winning symbols animate first, then WIN counts up in the controller, then the
      // win is added to the balance (which counts up too) once WIN has finished.
      // The frames are normally ready (freezeSpin starts decoding them while the reels land);
      // on a slow connection don't hold WIN / SPIN for them — the symbols join in when loaded.
      if (result.winningPositions.length > 0) {
        const highlighted = sceneRef.current?.showWinHighlights(result.winningPositions);
        await Promise.race([highlighted, new Promise((r) => window.setTimeout(r, MAX_HIGHLIGHT_WAIT_MS))]);
      }

      if (isFreeSpin) {
        // Free-game wins pile up in the WIN box; the balance is only credited when the round's
        // Big Win banner is tapped away (see collectRoundWin).
        roundWinRef.current = Math.round((roundWinRef.current + result.winAmount) * 100) / 100;
        setWinAmount(roundWinRef.current);
      } else {
        setWinAmount(result.winAmount);
        // A spin that starts a free-spin round holds its own win too — it's credited with the
        // round's total when the round's result is tapped away. (The bet already left the
        // balance on SPIN, so only the win is still to add.)
        if (!result.freeGamesAward && result.winAmount > 0) {
          flushPendingCreditRef.current();
          pendingCreditRef.current = {
            amount: result.winAmount,
            timer: window.setTimeout(() => flushPendingCreditRef.current(), COUNT_UP_MS),
          };
        }
      }

      if (result.winAmount > 0) sound.playWinChime();

      const award = result.freeGamesAward;
      if (award) {
        setBanners((q) => [...q, { kind: "freeSpins", freeSpins: award.freeSpins, multiplierPool: award.multiplierPool }]);
      }

      if (isFreeSpin) {
        setFreeGames((prev) => {
          if (!prev) return prev;
          const totalWin = prev.totalWin + result.winAmount;
          if (result.freeGamesAward) {
            return {
              ...prev,
              remaining: prev.remaining - 1 + result.freeGamesAward.freeSpins,
              total: prev.total + result.freeGamesAward.freeSpins,
              pool: result.freeGamesAward.multiplierPool,
              totalWin,
            };
          }
          return { ...prev, remaining: prev.remaining - 1, totalWin };
        });
      } else if (result.freeGamesAward) {
        // The round's total starts from the triggering spin's own (held) win.
        roundWinRef.current = result.winAmount;
        triggerWinRef.current = result.winAmount;
        setFreeGames({
          remaining: result.freeGamesAward.freeSpins,
          total: result.freeGamesAward.freeSpins,
          pool: result.freeGamesAward.multiplierPool,
          lastMultiplier: null,
          totalWin: 0,
          lockedBetIndex: betIndex,
        });
      }
    },
    [betIndex]
  );

  /** Adds a waiting base-game win to the balance now (see pendingCreditRef). */
  flushPendingCreditRef.current = () => {
    const pending = pendingCreditRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingCreditRef.current = null;
    // balanceRef is only refreshed on render — update it too, for a spin starting right after.
    balanceRef.current = Math.round((balanceRef.current + pending.amount) * 100) / 100;
    setBalance(balanceRef.current);
  };
  // Closing the game mid-count still credits the win.
  useEffect(() => () => flushPendingCreditRef.current(), []);

  /** Manual spin (SPIN button) — purely local: starts the reels scrolling and arms the button
   * as "Stop". No server call yet, nothing deducted — the round only becomes real once Stop
   * freezes a grid to send off for scoring. */
  const startManualSpin = useCallback(() => {
    sound.resumeAudio();
    if (!sceneRef.current || spinning || spinLockRef.current) return;
    // The last win goes into the balance first, so this spin's bet comes off the right total.
    flushPendingCreditRef.current();
    if (!user || balanceRef.current < totalBet) {
      setError("Insufficient balance");
      return;
    }

    setError(null);
    // The bet leaves the balance the moment SPIN is pressed; the win (if any) is added after STOP.
    spinLockRef.current = true;
    spinBalanceBeforeRef.current = balanceRef.current;
    setBalance(Math.round((balanceRef.current - totalBet) * 100) / 100);
    setSpinning(true);
    setWinAmount(0);
    sceneRef.current.startSpin();
    sound.startReelSpinLoop();
    setAwaitingStop(true);
  }, [spinning, totalBet, user, setBalance]);

  /** Stop button — freezes every reel exactly where it is (no substitution — see
   * Reel.freezeInPlace) and sends that grid to the server to be scored and paid out. */
  const handleStopClick = useCallback(async () => {
    if (!sceneRef.current || !awaitingStop) return;
    setAwaitingStop(false);
    // Admin Loss %: on this share of paid spins a would-be win lands as a loss instead.
    const forceLoss = Math.random() < getForcedLossChance(getSizzlingRtpConfig()) ? { isLosing: isLosingSizzlingGrid } : undefined;
    const grid = await sceneRef.current.freezeSpin(FORCE_FREE_GAMES, forceLoss, undefined, onReelsLanded);

    const balanceBefore = spinBalanceBeforeRef.current;
    let spinResolved = false;
    try {
      // result.balance = balanceBefore - bet + win (the bet already left the balance on SPIN).
      const result = await spinRequest(betLevel, grid, false, null, balanceBefore);
      spinResolved = true;
      await applyResult(
        {
          winAmount: result.winAmount,
          winningPositions: result.evaluation.winningPositions,
          freeGamesAward: result.freeGamesAward,
          balance: result.balance,
        },
        false
      );

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding.
      logSpinResult({
        betAmount: betLevel,
        winAmount: result.winAmount,
        reelSymbols: result.grid,
        balanceAfter: result.balance,
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "Spin failed";
      setError(message);
      // The spin request itself failed — give the bet back.
      if (!spinResolved) setBalance(balanceBefore);
    } finally {
      spinLockRef.current = false;
      setSpinning(false);
    }
  }, [applyResult, awaitingStop, betLevel, setBalance]);

  /** One auto-played free spin — starts scrolling, freezes itself after
   * FREE_SPIN_AUTO_STOP_MS (no player Stop click during Free Games), then sends the frozen
   * grid off for scoring, same as a manual Stop. */
  const runFreeSpin = useCallback(async () => {
    if (!sceneRef.current || !freeGames || spinLockRef.current) return;
    spinLockRef.current = true;
    setSpinning(true);
    setWinAmount(roundWinRef.current);
    sceneRef.current.startSpin();
    sound.startReelSpinLoop();

    try {
      await new Promise((r) => window.setTimeout(r, FREE_SPIN_AUTO_STOP_MS));
      const freeBetLevel = betLevels[freeGames.lockedBetIndex];
      // Last spin of the round: if the round is still under its FREE_GAMES_MIN_WIN_X floor, the
      // reels land a real winning board that covers it (multiplier drawn first, so the pick can
      // account for it).
      const lastSpin = freeGames.remaining === 1;
      const multiplier = lastSpin ? pickFreeSpinMultiplier(freeGames.pool) : undefined;
      const floor = lastSpin ? drawFreeGamesFloor(freeBetLevel) : 0;
      const need = floor - (roundWinRef.current - triggerWinRef.current);
      const forceWin =
        multiplier !== undefined && need > 0
          ? { pick: (natural: Grid, draw: () => Grid) => pickCoveringGrid(natural, draw, makeFreeSpinWinOf(freeBetLevel, multiplier), need) }
          : undefined;
      const grid = await sceneRef.current.freezeSpin(false, undefined, forceWin, onReelsLanded);

      const result = await spinRequest(freeBetLevel, grid, true, freeGames.pool, balanceRef.current, multiplier);

      // Last resort only — no fresh landing covered the floor: top up the small remainder.
      if (lastSpin && !result.freeGamesAward) {
        const shortfall = Math.round((floor - (roundWinRef.current - triggerWinRef.current + result.winAmount)) * 100) / 100;
        if (shortfall > 0) result.winAmount = Math.round((result.winAmount + shortfall) * 100) / 100;
      }
      await applyResult(
        {
          winAmount: result.winAmount,
          winningPositions: result.evaluation.winningPositions,
          freeGamesAward: result.freeGamesAward,
          balance: result.balance,
        },
        true
      );

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding. Bet is logged as 0 since free spins never
      // stake anything; balanceAfter counts the round's (not yet shown) winnings so far.
      logSpinResult({
        betAmount: 0,
        winAmount: result.winAmount,
        reelSymbols: result.grid,
        balanceAfter: Math.round((balanceRef.current + roundWinRef.current) * 100) / 100,
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Free spin failed");
      // The round can't continue — still show (and credit) what it had won so far.
      setFreeGames(null);
      setBanners((q) => [...q, { kind: "bigWin", winAmount: roundWinRef.current }]);
    } finally {
      spinLockRef.current = false;
      setSpinning(false);
    }
  }, [applyResult, betLevels, freeGames]);

  // Auto-continue the Free Games round until it runs out, same "auto-continue while a bonus
  // round is active" pattern Crazy777 uses for respins.
  useEffect(() => {
    if (!freeGames || spinning || !ready || banners.length > 0 || showPaytable) return;
    if (freeGames.remaining <= 0) {
      // Round over — show its total in the Big Win banner; tapping it away credits the balance.
      sound.playCelebration("BIG WIN");
      setBanners((q) => [...q, { kind: "bigWin", winAmount: roundWinRef.current }]);
      setFreeGames(null);
      return;
    }
    const id = window.setTimeout(() => runFreeSpin(), FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeGames, spinning, ready, banners.length, showPaytable, runFreeSpin]);

  /** The round's Big Win banner was tapped away — only now is its total added to the balance. */
  const collectRoundWin = useCallback(() => {
    flushPendingCreditRef.current();
    const total = roundWinRef.current;
    roundWinRef.current = 0;
    if (total > 0) setBalance(Math.round((balanceRef.current + total) * 100) / 100);
    dismissBanner();
  }, [dismissBanner, setBalance]);

  const freeSpinsBannerUp = banners[0]?.kind === "freeSpins";

  const changeBet = (direction: 1 | -1) => {
    if (freeGames) return;
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = cardHeight * fitScale;
  const inFreeGames = freeGames !== null;
  // (old footer only)
  // const spinButtonLabel = awaitingStop ? "STOP" : spinning ? "..." : "SPIN";
  // const spinButtonDisabled = !ready || inFreeGames || (spinning && !awaitingStop);

  return (
    <>
      <div className="relative overflow-hidden" style={{ width: scaledWidth, height: scaledHeight }}>
        <div
          ref={gameCardRef}
          className="relative flex flex-col overflow-hidden rounded-2xl bg-black shadow-2xl"
          style={{
            width: CANVAS_WIDTH,
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="sizzling-7s" />

          <img src={BG_URL} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />

          <div className="absolute top-0 z-10 w-full flex items-center justify-between px-3 py-2">
            <GameHomeButton size={81} />
          </div>

          {/* Free Games status — centered in the strip just above the reels. */}
          {inFreeGames && (
            <div
              className="absolute left-1/2 z-10 flex -translate-x-1/2 -translate-y-full items-center gap-6 whitespace-nowrap rounded-full px-8 py-2 text-4xl font-black tracking-wide text-amber-300"
              style={{ top: CANVAS_HEIGHT * REEL_AREA_TOP - 24 }}
            >
              <span>FREE GAMES</span>
              <span className="text-white">
                {freeGames!.remaining} left (of {freeGames!.total})
              </span>
              {freeGames!.lastMultiplier !== null && <span className="text-lime-300">x{freeGames!.lastMultiplier}</span>}
            </div>
          )}

          {showPaytable && config && <InfoScreen config={config} bet={totalBet} onClose={() => setShowPaytable(false)} />}

          <div className="relative mt-1 overflow-hidden rounded-lg">
            <div ref={canvasHostRef} className="relative mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-amber-300/70">Loading reels...</div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
              {error}
            </div>
          )}

          {/* Old built-in footer — commented out; GameController3rd below is the active footer for
              Sizzling 7s. To switch back: restore this block, spinButtonLabel / spinButtonDisabled
              and the footer helpers (CtrlButton, InfoIcon, SoundIcon, TriangleIcon) at the bottom.
          <div className="absolute bottom-0 z-10 flex w-full items-center justify-between gap-3 border-t border-white/10 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1.5">
                <CtrlButton onClick={() => setShowPaytable((v) => !v)} ariaLabel="Paytable" className="h-10 w-10">
                  <InfoIcon />
                </CtrlButton>
                <CtrlButton
                  onClick={() => {
                    sound.resumeAudio();
                    setMuted(sound.toggleMuted());
                  }}
                  active={muted}
                  ariaLabel={muted ? "Unmute" : "Mute"}
                  className="h-10 w-10"
                >
                  <SoundIcon muted={muted} />
                </CtrlButton>
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-md font-bold uppercase tracking-wide text-white/80">Credit</span>
                <span className="text-3xl font-bold text-white">{(user?.balance ?? 0).toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CtrlButton onClick={() => changeBet(-1)} disabled={betIndex === 0 || inFreeGames} ariaLabel="Decrease bet" className="h-10 w-10">
                <TriangleIcon direction="left" />
              </CtrlButton>
              <div className="flex flex-col items-center leading-tight">
                <span className="text-md font-bold uppercase tracking-wide text-amber-400">Bet</span>
                <span className="text-3xl font-bold text-white">{totalBet.toFixed(2)}</span>
              </div>
              <CtrlButton
                onClick={() => changeBet(1)}
                disabled={betIndex === betLevels.length - 1 || inFreeGames}
                ariaLabel="Increase bet"
                className="h-10 w-10"
              >
                <TriangleIcon direction="right" />
              </CtrlButton>
            </div>

            <div className="flex min-w-[220px] flex-1 max-w-sm items-center justify-center gap-2 rounded-lg border border-black bg-black/70 py-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.8)]">
              <span className="text-md font-bold uppercase tracking-wide text-white">Win</span>
              <span className="text-3xl font-black text-amber-300">{winAmount.toFixed(2)}</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={awaitingStop ? handleStopClick : startManualSpin}
                disabled={spinButtonDisabled}
                className="relative flex h-[70px] w-[200px] items-center justify-center rounded-3xl border-2 border-orange-950 bg-gradient-to-b from-yellow-300 via-amber-500 to-orange-600 text-4xl font-black italic tracking-wide text-white transition-transform duration-100 ease-out active:translate-y-[3px] disabled:opacity-50 disabled:active:translate-y-0"
                style={{
                  boxShadow: "0 5px 0 #7c2d12, 0 9px 14px rgba(0,0,0,0.55), inset 0 2px 2px rgba(255,255,255,0.6), inset 0 -5px 8px rgba(0,0,0,0.3)",
                }}
              >
                <span className="pointer-events-none absolute inset-x-[12%] top-[10%] h-[30%] rounded-full bg-white/40" style={{ filter: "blur(3px)" }} />
                {spinButtonLabel}
              </button>
            </div>
          </div>
          */}
          {/* below the game area (in the card's flow), so it no longer covers the bottom of the reels */}
          {/* Free Games banners — inside the card so the control bar can sit above a Free Spins
              award (SPIN starts the round, same as tapping the banner). `key` gives each queued
              banner a fresh mount, so its zoom-in and count-up replay. */}
          {banners[0]?.kind === "bigWin" && (
            <BigWinBanner key={banners.length} winAmount={banners[0].winAmount} onDismiss={collectRoundWin} contained />
          )}
          {banners[0]?.kind === "freeSpins" && (
            <FreeSpinsBanner
              key={banners.length}
              freeSpins={banners[0].freeSpins}
              multiplierPool={banners[0].multiplierPool}
              onDismiss={dismissBanner}
              startRequested={bannerStartRequested}
              contained
            />
          )}

          <div className={`relative ${freeSpinsBannerUp ? "z-40" : "z-10"} w-full`}>
            {/* placeholder of the bar's exact size while its chunk loads, so the layout doesn't jump */}
            <Suspense fallback={<div className="aspect-[1878/147] w-full bg-[#410117]" />}>
              <GameController3rd
                betAmount={totalBet}
                credit={user?.balance ?? 0}
                onBetDecrease={() => changeBet(-1)}
                onBetIncrease={() => changeBet(1)}
                betDecreaseDisabled={betIndex === 0 || inFreeGames}
                betIncreaseDisabled={betIndex === betLevels.length - 1 || inFreeGames}
                // no turbo here, so the TURBO slot shows MAX BET (locked during free games)
                onMaxBet={() => {
                  if (!inFreeGames) setBetIndex(betLevels.length - 1);
                }}
                maxBetDisabled={betIndex === betLevels.length - 1 || inFreeGames}
                win={winAmount}
                spinning={spinning}
                // While a Free Spins banner is up SPIN is live again — pressing it starts the round.
                spinDisabled={!ready || bannerStartRequested || (freeSpinsBannerUp ? false : inFreeGames || banners.length > 0)}
                onSpin={freeSpinsBannerUp ? () => setBannerStartRequested(true) : startManualSpin}
                // tapping SPIN while the reels can be stopped stops them (the old STOP button)
                onQuickStop={awaitingStop ? handleStopClick : undefined}
                // Sizzling 7s has no autoplay — AUTO hidden, SPIN reads STOP while the reels spin
                auto={false}
                onToggleAuto={() => {}}
                noAuto
                muted={muted}
                onToggleMute={() => {
                  sound.resumeAudio();
                  setMuted(sound.toggleMuted());
                }}
                onInfo={() => setShowPaytable((v) => !v)}
              />
            </Suspense>
          </div>
        </div>
      </div>


      {showLoadingScreen && (
        <LoadingScreen
          title="Sizzling 7s"
          ready={ready && rtpReady}
          error={initError}
          onRetry={retryInit}
          onDone={() => {
            setShowLoadingScreen(false);
            sound.startStreamingMusic(BG_MUSIC_URL);
          }}
        />
      )}
    </>
  );
}

const SYMBOL_IMAGES: Record<string, string> = {
  RED_7: "/symbols/sizzling7s/red-7.webp",
  BLUE_7: "/symbols/sizzling7s/blue-7.webp",
  BAR: "/symbols/sizzling7s/bar.webp",
  DOUBLE_BAR: "/symbols/sizzling7s/bar2.webp",
  TRIPLE_BAR: "/symbols/sizzling7s/bar3.webp",
  WILD_2X: "/symbols/sizzling7s/2xWild.webp",
  BONUS: "/symbols/sizzling7s/bonus.webp",
};

// ------------------------------------------------------------------------------------------
// Rules / info screen — same stepped layout as Fruity 777's InfoScreen, in Sizzling's red/gold
// ------------------------------------------------------------------------------------------

const SYMBOL_NAMES: Record<string, string> = {
  RED_7: "Red 7",
  BLUE_7: "Blue 7",
  TRIPLE_BAR: "Triple BAR",
  DOUBLE_BAR: "Double BAR",
  BAR: "BAR",
  WILD_2X: "2X Wild",
  BONUS: "Bonus",
};

const LINE_SYMBOLS = ["RED_7", "BLUE_7", "TRIPLE_BAR", "DOUBLE_BAR", "BAR"] as const;

const GOLD_TEXT: CSSProperties = {
  background: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/** A bet multiple for display — trims to at most 2 decimals ("0.47", "14.19", "5"). */
function fmtX(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** One payline drawn as a tiny 3x3 grid with the line's cells lit and joined. */
function PaylineDiagram({ line, number }: { line: [number, number, number]; number: number }) {
  const cell = 26;
  const gap = 4;
  const size = cell * 3 + gap * 2;
  const center = (i: number) => i * (cell + gap) + cell / 2;
  return (
    <div className="flex flex-col items-center">
      <div className="relative rounded-lg border border-amber-300/30 bg-black/40 p-1.5">
        <div className="grid grid-cols-3" style={{ gap }}>
          {Array.from({ length: 9 }, (_, k) => {
            const row = Math.floor(k / 3);
            const reel = k % 3;
            const on = line[reel] === row;
            return <div key={k} className={`rounded ${on ? "bg-amber-400/80" : "bg-white/[0.07]"}`} style={{ width: cell, height: cell }} />;
          })}
        </div>
        <svg className="pointer-events-none absolute left-1.5 top-1.5" width={size} height={size}>
          <polyline
            points={line.map((row, reel) => `${center(reel)},${center(row)}`).join(" ")}
            fill="none"
            stroke="#ef4444"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="mt-1 text-[15px] font-bold text-amber-200/80">{number}</div>
    </div>
  );
}

/** Colours for the shared rules popup (see shared/GameInfoPopup). */
const INFO_THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #8a1c1c 0%, #4a0b0b 55%, #1f0505 100%)",
  accent: "#fcd34d",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #fde047 0%, #f59e0b 50%, #ea580c 100%)",
  buttonEdge: "#7c2d12",
};

function InfoScreen({ config, bet, onClose }: { config: SizzlingSevensConfigResponse; bet: number; onClose: () => void }) {
  /** Paytable figures are calibrated relative to LINE_COST, not the player's bet:
   * finalWin = payout x (bet / lineCost). This turns one into "times your total bet". */
  const asX = (payout: number) => payout / config.lineCost;
  const payoutOf = (symbol: string) => config.paytable.find((r) => r.symbol === symbol)?.payout ?? 0;
  const [minX, maxX] = FREE_GAMES_MIN_WIN_X;

  const symbolCard = (symbol: string, x: number, label = SYMBOL_NAMES[symbol], images: string[] = [symbol, symbol, symbol]) => (
    <div
      key={label}
      className="relative flex flex-col items-center rounded-2xl border border-amber-300/25 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-4 pb-4 pt-3"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 8px 18px rgba(0,0,0,.35)" }}
    >
      <div className="flex items-center">
        {images.map((img, i) => (
          <img key={i} src={SYMBOL_IMAGES[img]} alt={i === 0 ? label : ""} className="-mx-1 h-[53px] sm:h-[72px] w-[53px] sm:w-[72px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
        ))}
      </div>
      <div className="mt-2 text-[15px] sm:text-[18px] font-bold text-white">{label}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-[19px] sm:text-[22px] font-black" style={GOLD_TEXT}>
          {fmtX(x)}x
        </span>
        <span className="text-[12px] sm:text-[15px] text-white/60">=</span>
        <span className="text-[16px] sm:text-[20px] font-bold tabular-nums text-lime-300">{(x * bet).toFixed(2)}</span>
      </div>
    </div>
  );

  const steps: { tab: string; title: string; body: ReactNode }[] = [
    {
      tab: "Symbols",
      title: "SYMBOL PAYOUTS",
      body: (
        <>
          <p className="mb-3 sm:mb-6 text-center text-[14px] sm:text-[16px] text-white/80">
            Land <b className="text-amber-300">3 matching symbols</b> on a payline to win. Each pays the multiplier shown
            <b className="text-amber-300"> × your bet</b>, per winning line. Amounts below are for your current bet of{" "}
            <b className="text-lime-300">{bet.toFixed(2)}</b>.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
            {LINE_SYMBOLS.map((symbol) => symbolCard(symbol, asX(payoutOf(symbol))))}
            {config.anyBarPayout > 0 && symbolCard("BAR", asX(config.anyBarPayout), "Any BAR mix", ["BAR", "DOUBLE_BAR", "TRIPLE_BAR"])}
            {config.anySevenPayout > 0 && symbolCard("RED_7", asX(config.anySevenPayout), "Any 7 mix", ["RED_7", "BLUE_7", "RED_7"])}
          </div>
        </>
      ),
    },
    {
      tab: "Wild & Bonus",
      title: "WILD & BONUS SYMBOLS",
      body: (
        <div className="flex flex-col gap-3 sm:gap-6">
          <div className="flex items-center gap-3 sm:gap-8 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-red-500/10 px-3 sm:px-8 py-3 sm:py-6 flex-col sm:flex-row">
            <img src={SYMBOL_IMAGES.WILD_2X} alt="2X Wild" className="h-[82px] sm:h-[112px] w-[82px] sm:w-[112px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="text-[14px] sm:text-[16px] leading-[20px] sm:leading-[24px] text-white/85">
              <div className="mb-1 text-[20px] sm:text-[24px] font-black" style={GOLD_TEXT}>
                2X WILD
              </div>
              Substitutes for every symbol except BONUS, and <b className="text-amber-300">doubles</b> the win for each Wild used:{" "}
              <b className="text-lime-300">1 Wild x2 · 2 Wilds x4 · 3 Wilds x8</b>.
              <br />
              Wilds alone from reel 1 also pay: 1 Wild <b className="text-lime-300">{fmtX(asX(config.wild.purePayout[1]))}x</b> · 2 Wilds{" "}
              <b className="text-lime-300">{fmtX(asX(config.wild.purePayout[2]))}x</b> · 3 Wilds{" "}
              <b className="text-lime-300">{fmtX(asX(config.wild.purePayout[3]))}x</b> (not multiplied again).
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-8 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-red-500/10 px-3 sm:px-8 py-3 sm:py-6 flex-col sm:flex-row">
            <img src={SYMBOL_IMAGES.BONUS} alt="Bonus" className="h-[82px] sm:h-[112px] w-[82px] sm:w-[112px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="text-[14px] sm:text-[16px] leading-[20px] sm:leading-[24px] text-white/85">
              <div className="mb-1 text-[20px] sm:text-[24px] font-black" style={GOLD_TEXT}>
                BONUS
              </div>
              A scatter — it pays <b className="text-amber-300">anywhere</b> on the reels, no payline needed. Wild never replaces it.
              <br />
              <b className="text-amber-300">{config.bonus.triggerCount} or more BONUS</b> pay{" "}
              <b className="text-lime-300">
                {fmtX(asX(payoutOf("BONUS")))}x = {(asX(payoutOf("BONUS")) * bet).toFixed(2)}
              </b>{" "}
              and trigger <b className="text-lime-300">FREE GAMES</b>. See the Free Games page for details.
            </div>
          </div>
        </div>
      ),
    },
    {
      tab: "Paylines",
      title: `${config.paylineCount} PAYLINES`,
      body: (
        <div className="flex items-start gap-3 sm:gap-10 flex-col sm:flex-row">
          <div className="grid flex-none grid-cols-3 sm:grid-cols-7 gap-x-3 gap-y-2">
            {config.paylines.map((line, i) => (
              <PaylineDiagram key={i} line={line} number={i + 1} />
            ))}
          </div>
          <ul className="list-disc space-y-3 pl-6 text-[14px] sm:text-[16px] leading-[19px] sm:leading-[22px] text-white/85">
            <li>
              All <b className="text-amber-300">{config.paylineCount} paylines</b> are always active.
            </li>
            <li>
              Each reel stops on either <b className="text-amber-300">1 symbol</b> in the middle or <b className="text-amber-300">2 symbols</b> at
              the top and bottom — the other rows are blank. A line crossing a blank can't win.
            </li>
            <li>A win needs 3 matching symbols on a line, one on each reel. Wild can stand in.</li>
            <li>Only the highest win on each line is paid; wins on different lines are added together.</li>
          </ul>
        </div>
      ),
    },
    {
      tab: "Free Games",
      title: "BONUS FREE GAMES",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-3 sm:mb-6 flex items-center gap-2 rounded-2xl border-2 border-amber-300/60 bg-amber-400/15 px-3 sm:px-6 py-3 shadow-[0_0_24px_rgba(251,191,36,.35)]">
            {[0, 1, 2].map((i) => (
              <img key={i} src={SYMBOL_IMAGES.BONUS} alt={i === 0 ? "Bonus" : ""} className="h-[55px] sm:h-[75px] w-[55px] sm:w-[75px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            ))}
            <span className="ml-4 text-[25px] sm:text-[30px] font-black" style={GOLD_TEXT}>
              = FREE GAMES
            </span>
          </div>
          <div className="mb-3 sm:mb-6 grid w-full max-w-[1100px] grid-cols-3 sm:grid-cols-5 gap-4">
            {config.freeGames.awards.map((a) => (
              <div key={a.freeSpins} className="rounded-2xl border border-amber-300/25 bg-white/[0.06] px-3 py-4 text-center">
                <div className="text-[21px] sm:text-[26px] font-black" style={GOLD_TEXT}>
                  {a.freeSpins}
                </div>
                <div className="text-[12px] sm:text-[12px] font-bold tracking-widest text-white/70">FREE GAMES</div>
                <div className="mt-2 text-[12px] sm:text-[15px] font-bold text-lime-300">{a.multiplierPool.map((m) => `x${m}`).join(" / ")}</div>
              </div>
            ))}
            <div className="rounded-2xl border border-fuchsia-300/40 bg-fuchsia-500/10 px-3 py-4 text-center">
              <div className="text-[19px] sm:text-[22px] font-black text-fuchsia-200">MYSTERY</div>
              <div className="text-[12px] sm:text-[12px] font-bold tracking-widest text-white/70">{config.freeGames.mystery.spinCounts.join(" / ")} GAMES</div>
              <div className="mt-2 text-[12px] sm:text-[13px] font-bold text-lime-300">{config.freeGames.mystery.multiplierPool.map((m) => `x${m}`).join(" ")}</div>
            </div>
          </div>
          <ul className="max-w-[1100px] list-disc space-y-3 pl-6 text-[14px] sm:text-[16px] leading-[19px] sm:leading-[22px] text-white/85">
            <li>
              {config.bonus.triggerCount}+ BONUS anywhere award one of the prizes above, picked at random. Mystery picks a random number of
              games with the widest range of multipliers.
            </li>
            <li>
              Tap the screen or SPIN to start — free games then play automatically at the <b className="text-amber-300">same bet</b> that triggered them and cost nothing. The total is added to your balance when you tap it away.
            </li>
            <li>
              Every free game draws a <b className="text-amber-300">fresh multiplier</b> from the round's list and multiplies that game's whole
              win.
            </li>
            <li>{config.bonus.triggerCount}+ BONUS during free games add more games.</li>
            <li>
              Every round is guaranteed to pay at least{" "}
              <b className="text-lime-300">
                {minX === maxX ? minX : `${minX}–${maxX}`}x your bet
              </b>{" "}
              in total.
            </li>
          </ul>
        </div>
      ),
    },
  ];

  return <GameInfoPopup label="Sizzling 7s rules" theme={INFO_THEME} steps={steps} onClose={onClose} />;
}


// Old footer helpers (CtrlButton, TriangleIcon, InfoIcon, SoundIcon) — only the commented-out
// built-in footer used them; GameController3rd is the active footer now.
// function CtrlButton({
//   onClick,
//   active = false,
//   disabled = false,
//   ariaLabel,
//   className = "",
//   children,
// }: {
//   onClick: () => void;
//   active?: boolean;
//   disabled?: boolean;
//   ariaLabel: string;
//   className?: string;
//   children: ReactNode;
// }) {
//   const ledge = active ? "#92400e" : "#0a0a0a";
//   return (
//     <button
//       onClick={onClick}
//       disabled={disabled}
//       aria-label={ariaLabel}
//       className={`relative flex items-center justify-center rounded-full border-2 bg-gradient-to-b transition-transform duration-100 ease-out hover:brightness-105 active:translate-y-[3px] disabled:opacity-40 disabled:active:translate-y-0 disabled:pointer-events-none ${
//         active
//           ? "border-amber-800 from-amber-200 via-amber-400 to-amber-600"
//           : "border-black/70 from-white via-neutral-100 to-neutral-300"
//       } ${className}`}
//       style={{
//         boxShadow: `0 4px 0 ${ledge}, 0 7px 10px rgba(255, 255, 255, 0.9), inset 0 2px 1px rgba(255,255,255,0.95), inset 0 -4px 5px rgba(0,0,0,0.22)`,
//       }}
//     >
//       <span className="pointer-events-none absolute inset-x-[16%] top-[9%] h-[36%] rounded-full bg-white/55" style={{ filter: "blur(2px)" }} />
//       {children}
//     </button>
//   );
// }
//
// function TriangleIcon({ direction }: { direction: "left" | "right" }) {
//   const points = direction === "left" ? "15,4 6,12 15,20" : "9,4 18,12 9,20";
//   return (
//     <svg width="16" height="16" viewBox="0 0 24 24">
//       <polygon points={points} fill="black" />
//     </svg>
//   );
// }
//
// function InfoIcon() {
//   return (
//     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.4">
//       <circle cx="12" cy="12" r="9.5" />
//       <line x1="12" y1="11" x2="12" y2="16.5" strokeLinecap="round" />
//       <circle cx="12" cy="7.3" r="1.1" fill="black" stroke="none" />
//     </svg>
//   );
// }
//
// function SoundIcon({ muted }: { muted: boolean }) {
//   return (
//     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
//       <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinecap="round" strokeLinejoin="round" fill="black" />
//       {muted ? (
//         <path d="M17 9 22 15M22 9l-5 6" strokeLinecap="round" />
//       ) : (
//         <>
//           <path d="M16 8a5 5 0 0 1 0 8" strokeLinecap="round" />
//           <path d="M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
//         </>
//       )}
//     </svg>
//   );
// }
