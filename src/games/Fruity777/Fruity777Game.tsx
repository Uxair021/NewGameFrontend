import { useEffect, useRef, useState, useCallback, ReactNode, CSSProperties } from "react";
import { GameInfoPopup, InfoTheme } from "../shared/GameInfoPopup";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { FruityScene, CANVAS_WIDTH, CANVAS_HEIGHT, VIEW_LEFT, VIEW_TOP, VIEW_WIDTH, VIEW_HEIGHT } from "./pixi/FruityScene";
import { BG_URL, FREE_GAME_BG_URL } from "./pixi/symbols";
import { symbolUrl } from "./pixi/symbols";
import { STAR_SWEEP_SECONDS, WIN_GLOW_START_OVERLAP_SECONDS } from "./pixi/Reel";
import {
  getFruity777Config,
  spinRequest,
  logSpinResult,
  Fruity777ConfigResponse,
  FruitySymbol,
  PayoutRow,
  getFreeSpinShortfallX,
  syncFruityRtpConfigFromServer,
} from "./api";
import { FreeGamesIntro, FreeGamesBigWin } from "./FreeGamesOverlays";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameMenu, FRUITY_MENU_THEME } from "../shared/GameMenu";
import { SlotConsole } from "../shared/SlotConsole";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
// How long a win's slash/glow + sidebar pulse stays visible before the next spin can clear
// it — matches FruityScene.ts's PULSE_TOTAL_SECONDS (3.5s, per user request: "keep it for
// 3-4 sec").
// The fruit's glow/pulse only starts once the star sweep finishes (see Reel.startWinEffect), so
// the sweep's length is added on top — otherwise the next spin would cut the glow short.
const STAR_INTRO_MS = (STAR_SWEEP_SECONDS - WIN_GLOW_START_OVERLAP_SECONDS) * 1000;
const WIN_GLOW_MIN_DISPLAY_MS = 3500 + STAR_INTRO_MS;
const FREE_SPIN_GAP_MS = 900;
/** A normal (non-free) spin paying at least this x of the bet shows the Big Win screen. */
const BIG_WIN_MIN_X = 10;
/** How long the payline win effect shows before the Big Win screen covers it. */
const BIG_WIN_SCREEN_DELAY_MS = 900;
const AUTOPLAY_GAP_MS = 700;
// FAST spin mode: the reels themselves spin quicker (see FruityScene.spin) and every pause
// between spins is shortened to match, so autoplay/free spins actually feel faster too.
// On a free-spins trigger, how long the payline bells swing before the FREE SPINS popup
// appears (and the free spins start) — long enough for ~2 swings.
const BONUS_BELL_INTRO_MS = 2000;
const FAST_WIN_GLOW_MIN_DISPLAY_MS = 1200 + STAR_INTRO_MS;
const FAST_FREE_SPIN_GAP_MS = 350;
// After the last free spin lands, pause this long (so its result is seen) before the Big Win total.
const FREE_GAMES_END_DELAY_MS = 1500;
const FAST_AUTOPLAY_GAP_MS = 250;

/** GPU-memory knob for the whole game: the canvas renders at this fraction of its on-screen pixel
 * size (see fitResolution below). 1 = pixel-exact; lower = less GPU memory, slightly softer art. */
const RENDER_QUALITY = 0.75;

const BG_MUSIC_URL = "/Sound/mfcc-gambling-lottery-casino-gambling-music-120447.mp3";


export function Fruity777Game() {
  const { user, setBalance } = useAuth();
  // Latest balance — runSpin reads this rather than a possibly stale `user` from its closure.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  /** True while a spin is in flight — a second spin can never start on top of it. */
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<FruityScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Fruity777ConfigResponse | null>(null);
  /** FreeGameBg from the free games intro until the Big Win total is collected. */
  const [freeGameBg, setFreeGameBg] = useState(false);
  /** Total won over the free spins round just finished — shows the Big Win screen while set. */
  const [freeGamesTotal, setFreeGamesTotal] = useState<number | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  /** True while a win's reel animation is still playing (its full minimum display time) — SPIN
   * and autoplay stay off until it has played completely. */
  const [winAnimating, setWinAnimating] = useState(false);
  const winAnimTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (winAnimTimerRef.current !== null) window.clearTimeout(winAnimTimerRef.current);
  }, []);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [fastSpin, setFastSpin] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const winEffectActiveRef = useRef(false);
  const winEffectStartRef = useRef(0);

  const [freeGames, setFreeGames] = useState<{
    remaining: number;
    total: number;
    totalWin: number;
    lockedBetIndex: number;
  } | null>(null);
  // Free spins count while the full-screen FREE GAMES intro is showing (null = not showing).
  const [freeIntro, setFreeIntro] = useState<number | null>(null);
  /** Player pressed SPIN while the FREE GAMES intro was up — closes it, same as tapping it. */
  const [freeIntroStartRequested, setFreeIntroStartRequested] = useState(false);
  /** A normal spin's 10x+ win while its Big Win screen is up (null = not showing). */
  const [baseBigWin, setBaseBigWin] = useState<number | null>(null);
  /** The balance that win brings, applied when the screen is collected. */
  const pendingBigWinRef = useRef<number | null>(null);
  /** Running total of the current free-spins round — shown in the WIN box during the round and
   * only credited to the balance once the player collects the Big Win screen. */
  const roundWinRef = useRef(0);
  /** The triggering spin's own win, held in roundWinRef — the round minimum counts free-spin wins only. */
  const triggerWinRef = useRef(0);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server and stored locally —
   * the loading screen stays up until then, so the very first spin already uses it. */
  const [rtpReady, setRtpReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Server config first (if it can't be fetched the game keeps its local/default config), then
    // the paytable/bet levels read from what's now stored.
    void syncFruityRtpConfigFromServer().then(() => {
      if (cancelled) return;
      setRtpReady(true);
      getFruity777Config()
        .then((c) => {
          if (cancelled) return;
          setConfig(c);
          setBetLevels(c.betLevels);
        })
        .catch(() => {
          /* fall back to default bet levels already set */
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Warm the free games background and Big Win art so they don't flash in.
  useEffect(() => {
    for (const url of [FREE_GAME_BG_URL, "/symbols/fruity777/colorBg.webp", "/symbols/fruity777/bigWin.webp"]) {
      new Image().src = url;
    }
  }, []);

  useEffect(() => {
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
        // Transparent — the background is the <img> under the canvas.
        backgroundAlpha: 0,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        // The canvas only covers part of the design (see VIEW_* in FruityScene) — pin it there.
        Object.assign(app.canvas.style, { position: "absolute", left: `${VIEW_LEFT}px`, top: `${VIEW_TOP}px` });
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await FruityScene.create(app);
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
        console.error("777 Fruity: failed to initialize", err);
        setInitError("Failed to load the game. Please check your connection and try again.");
      });

    return () => {
      cancelled = true;
      sound.stopReelSpinLoop();
      sound.stopBackgroundMusic();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      releaseTextures();
    };
  }, [initRetryKey]);

  // Keep the canvas's backing resolution matched to its on-screen size: it's 1920x1080 in design
  // space but CSS-scaled by fitScale, so on most screens a full-size backing buffer is mostly
  // pixels the browser throws away. Debounced so a window drag doesn't reallocate every frame.
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

  // Keep the sidebar paytable in sync once config loads, and live as the bet changes — each
  // row shows the actual amount that combo pays at the *current* bet, not a bare multiplier.
  useEffect(() => {
    if (!ready || !config || !sceneRef.current) return;
    sceneRef.current.updatePaytable(config.paytable, betAmount);
  }, [ready, config, betAmount]);

  /** Runs one spin — manual (real bet) or auto-played free spin — and applies the result.
   * Shared by both paths since the server/animation flow is identical; only whether a bet is
   * actually staked (and whether a Bonus trigger starts a new round vs adds to one already
   * running) differs. */
  const runSpin = useCallback(
    async (isFreeSpin: boolean, guaranteeShortfallX = 0) => {
      if (!sceneRef.current || spinLockRef.current) return;
      spinLockRef.current = true;
      setSpinning(true);
      setWinAmount(isFreeSpin ? roundWinRef.current : 0);

      // The bet leaves the balance the moment SPIN is pressed (free spins cost nothing); a win is
      // added back once the reels land, a loss leaves it as is.
      const stakeBet = isFreeSpin ? betLevels[freeGames?.lockedBetIndex ?? betIndex] : betAmount;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!isFreeSpin) setBalance(Math.round((balanceBefore - stakeBet) * 100) / 100);

      if (winEffectActiveRef.current) {
        const minDisplay = fastSpin ? FAST_WIN_GLOW_MIN_DISPLAY_MS : WIN_GLOW_MIN_DISPLAY_MS;
        const remaining = minDisplay - (Date.now() - winEffectStartRef.current);
        if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
        sceneRef.current?.setWinEffect(false);
        winEffectActiveRef.current = false;
      }
      if (!sceneRef.current) {
        spinLockRef.current = false;
        return;
      }

      try {
        sceneRef.current.setWinEffect(false);
        sound.startReelSpinLoop();
        const result = await spinRequest(stakeBet, isFreeSpin, balanceBefore, guaranteeShortfallX);
        spinResolved = true;
        // Reels 1 and 2 matching on the payline → reel 3 spins on with a drum roll (see FruityScene.spin).
        await sceneRef.current.spin(result.reels, sound.reelStopSounds(3), fastSpin, (ms) => sound.startDrumRoll(ms));
        sound.stopReelSpinLoop();

        let balanceAfter = result.balance;
        let isBigWin = false;
        if (isFreeSpin) {
          // Free-spin wins pile up in the WIN box; the balance is only credited when the round's
          // Big Win screen is collected (see collectFreeGamesTotal).
          roundWinRef.current = Math.round((roundWinRef.current + result.winAmount) * 100) / 100;
          setWinAmount(roundWinRef.current);
          balanceAfter = Math.round((balanceRef.current + roundWinRef.current) * 100) / 100;
        } else {
          setWinAmount(result.winAmount);
          // A 10x+ win is held for the Big Win screen (credited when it's collected — see
          // collectBaseBigWin), like a spin that starts free spins.
          isBigWin = result.multiplier >= BIG_WIN_MIN_X && result.winAmount > 0;
          // result.balance = balanceBefore - stake + win, i.e. the already-deducted balance plus the win.
          if (result.winAmount > 0 && !(result.freeSpinsAwarded > 0) && !isBigWin) setBalance(result.balance);
        }

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding.
        logSpinResult({
          betAmount: isFreeSpin ? 0 : stakeBet,
          winAmount: result.winAmount,
          reelSymbols: result.reels,
          balanceAfter,
        }).catch(() => {});

        if (result.winAmount > 0) {
          const winningSymbol = result.lineSymbols[1];
          sceneRef.current.setWinEffect(true, winningSymbol);
          winEffectActiveRef.current = true;
          winEffectStartRef.current = Date.now();
          // Hold SPIN until the win animation has played for its full display time.
          setWinAnimating(true);
          if (winAnimTimerRef.current !== null) window.clearTimeout(winAnimTimerRef.current);
          winAnimTimerRef.current = window.setTimeout(
            () => {
              winAnimTimerRef.current = null;
              setWinAnimating(false);
            },
            fastSpin ? FAST_WIN_GLOW_MIN_DISPLAY_MS : WIN_GLOW_MIN_DISPLAY_MS
          );
        }

        if (result.winAmount > 0) sound.playWinChime();

        if (isBigWin) {
          // Let the payline win effect show for a moment, then the Big Win screen (waits for a tap,
          // autoplay included — and autoplay switches off).
          await new Promise((r) => window.setTimeout(r, BIG_WIN_SCREEN_DELAY_MS));
          if (!sceneRef.current) return;
          pendingBigWinRef.current = result.balance;
          setAutoplay(false);
          sound.playCelebration("BIG WIN");
          setBaseBigWin(result.winAmount);
        }

        if (isFreeSpin) {
          setFreeGames((prev) => (prev ? { ...prev, remaining: prev.remaining - 1, totalWin: prev.totalWin + result.winAmount } : prev));
        } else if (result.freeSpinsAwarded > 0) {
          sceneRef.current.playBonusTrigger();
          sound.playFreeSpinsJingle();
          await new Promise((r) => window.setTimeout(r, fastSpin ? BONUS_BELL_INTRO_MS / 2 : BONUS_BELL_INTRO_MS));
          if (!sceneRef.current) return;
          // The round's total starts from the triggering spin's own (held) win.
          roundWinRef.current = result.winAmount;
          triggerWinRef.current = result.winAmount;
          setFreeIntro(result.freeSpinsAwarded);
          setFreeGames({
            remaining: result.freeSpinsAwarded,
            total: result.freeSpinsAwarded,
            totalWin: 0,
            lockedBetIndex: betIndex,
          });
        }
      } catch (err) {
        sound.stopReelSpinLoop();
        const message = err instanceof Error ? err.message : "Spin failed";
        setError(message);
        // The spin request itself failed — give the bet back.
        if (!spinResolved && !isFreeSpin) setBalance(balanceBefore);
        if (isFreeSpin) {
          // The round can't continue — still show (and credit) what it had won so far.
          setFreeGames(null);
          setFreeGamesTotal(roundWinRef.current);
        }
        setAutoplay(false);
      } finally {
        spinLockRef.current = false;
        setSpinning(false);
      }
    },
    [betAmount, betIndex, betLevels, freeGames, setBalance, fastSpin]
  );

  /** Big Win screen collected → only now does the win reach the balance. */
  const collectBaseBigWin = useCallback(() => {
    if (pendingBigWinRef.current !== null) setBalance(pendingBigWinRef.current);
    pendingBigWinRef.current = null;
    setBaseBigWin(null);
  }, [setBalance]);

  // Never lose a held Big Win if the player leaves before collecting it.
  useEffect(
    () => () => {
      if (pendingBigWinRef.current !== null) setBalance(pendingBigWinRef.current);
    },
    [setBalance]
  );

  const startManualSpin = useCallback(() => {
    sound.resumeAudio();
    // The FREE GAMES intro is up — SPIN starts the round, same as tapping the intro.
    if (freeIntro !== null) {
      setFreeIntroStartRequested(true);
      return;
    }
    if (!sceneRef.current || spinning || winAnimating || freeGames || freeGamesTotal !== null || baseBigWin !== null) return;
    if (!user || user.balance < betAmount) {
      setError("Insufficient balance");
      setAutoplay(false);
      return;
    }
    setError(null);
    runSpin(false);
  }, [betAmount, freeGames, freeGamesTotal, freeIntro, baseBigWin, runSpin, spinning, winAnimating, user]);

  // Autoplay — repeats a normal paid spin on a short delay until toggled off, balance runs
  // out, or a spin errors (see runSpin's catch block). Never fires during a Bonus round (that
  // has its own auto-continue below), or while the rules screen is open.
  useEffect(() => {
    if (!autoplay || spinning || winAnimating || !ready || freeGames || showInfo || freeIntro !== null || freeGamesTotal !== null) return;
    const id = window.setTimeout(() => {
      if (!user || user.balance < betAmount) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }
      setError(null);
      runSpin(false);
    }, fastSpin ? FAST_AUTOPLAY_GAP_MS : AUTOPLAY_GAP_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, winAnimating, ready, freeGames, showInfo, freeIntro, freeGamesTotal, user, betAmount, runSpin, fastSpin]);

  // Auto-continue the Bonus round until it runs out (no retrigger — see backend engine.ts).
  useEffect(() => {
    if (!freeGames || spinning || !ready || freeIntro !== null || showInfo) return;
    if (freeGames.remaining <= 0) {
      // Round over → Big Win screen with the round's total (COLLECT returns to the base game).
      const id = window.setTimeout(() => {
        sound.playCelebration("BIG WIN");
        setFreeGamesTotal(roundWinRef.current);
        setFreeGames(null);
        // Autoplay stops once a bonus round ends — the player resumes with SPIN or AUTO.
        setAutoplay(false);
      }, FREE_GAMES_END_DELAY_MS);
      return () => window.clearTimeout(id);
    }
    // Last spin of the round and it's still under the 1x minimum → this spin lands a real line that covers it.
    const lockedBet = betLevels[freeGames.lockedBetIndex] ?? betAmount;
    const shortfallX = freeGames.remaining === 1 ? getFreeSpinShortfallX(lockedBet, roundWinRef.current - triggerWinRef.current) : 0;
    const id = window.setTimeout(() => runSpin(true, shortfallX), fastSpin ? FAST_FREE_SPIN_GAP_MS : FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeGames, spinning, ready, freeIntro, showInfo, runSpin, fastSpin, betLevels, betAmount]);

  /** FREE GAMES intro finished → switch to the free games background; the auto-continue effect
   * above then starts the spins. */
  const closeFreeIntro = useCallback(() => {
    setFreeIntro(null);
    setFreeIntroStartRequested(false);
    setFreeGameBg(true);
  }, []);

  /** Big Win total collected → only now is the round's total added to the balance; back to the
   * normal background and base game. */
  const collectFreeGamesTotal = useCallback(() => {
    const total = roundWinRef.current;
    roundWinRef.current = 0;
    if (total > 0) setBalance(Math.round((balanceRef.current + total) * 100) / 100);
    setFreeGamesTotal(null);
    sceneRef.current?.setWinEffect(false);
    winEffectActiveRef.current = false;
    // The win animation was just cleared, so SPIN shouldn't wait for it any longer.
    if (winAnimTimerRef.current !== null) window.clearTimeout(winAnimTimerRef.current);
    winAnimTimerRef.current = null;
    setWinAnimating(false);
    setFreeGameBg(false);
  }, [setBalance]);

  const changeBet = (direction: 1 | -1) => {
    if (freeGames || autoplay) return;
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;
  const inFreeGames = freeGames !== null;
  // While the FREE GAMES intro is up SPIN is live again — pressing it starts the round.
  const introUp = freeIntro !== null;
  const spinDisabled =
    !ready || spinning || freeIntroStartRequested || (introUp ? false : winAnimating || inFreeGames || baseBigWin !== null);

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
          <GameJackpotBar gameId="fruity-777" />

          <div className="absolute top-0 z-10 flex w-full items-center justify-center px-3 py-2">
            {inFreeGames && (
              <div className="flex items-center gap-4 rounded-full bg-black/80 border-2 border-amber-400 px-6 py-2 text-amber-300 font-black text-2xl tracking-wide">
                <span>FREE SPINS</span>
                <span className="text-white">
                  {freeGames!.remaining} left (of {freeGames!.total})
                </span>
              </div>
            )}
          </div>

          <div className="relative overflow-hidden">
            <div ref={canvasHostRef} className="relative mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
              <img src={freeGameBg ? FREE_GAME_BG_URL : BG_URL} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
            </div>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-indigo-950 text-amber-300/70">
                Loading reels...
              </div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 mx-3 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
              {error}
            </div>
          )}

          {freeIntro !== null && <FreeGamesIntro spins={freeIntro} onDone={closeFreeIntro} startRequested={freeIntroStartRequested} />}

          {freeGamesTotal !== null && <FreeGamesBigWin totalWin={freeGamesTotal} onClose={collectFreeGamesTotal} />}

          {baseBigWin !== null && <FreeGamesBigWin totalWin={baseBigWin} caption="YOU WIN" onClose={collectBaseBigWin} />}

          {/* 3D control console (shared — see shared/SlotConsole). Raised above the FREE GAMES intro
              while it's up so SPIN can start the round. */}
          <SlotConsole
            className={`absolute bottom-0 ${introUp ? "z-40" : "z-10"}`}
            credit={user?.balance ?? 0}
            bet={betAmount}
            win={winAmount}
            onBetDecrease={() => changeBet(-1)}
            onBetIncrease={() => changeBet(1)}
            betDecreaseDisabled={betIndex === 0 || inFreeGames || autoplay}
            betIncreaseDisabled={betIndex === betLevels.length - 1 || inFreeGames || autoplay}
            fast={{
              on: fastSpin,
              onToggle: () => {
                sound.resumeAudio();
                setFastSpin((v) => !v);
              },
            }}
            auto={{
              on: autoplay,
              disabled: inFreeGames,
              onToggle: () => {
                sound.resumeAudio();
                setAutoplay((v) => !v);
              },
            }}
            spinning={spinning}
            spinDisabled={spinDisabled}
            spinLabel={inFreeGames && !introUp ? "FREE" : "SPIN"}
            onSpin={startManualSpin}
            menuOpen={showMenu}
            onToggleMenu={() => setShowMenu((v) => !v)}
          />

          {showMenu && (
            <GameMenu
              theme={FRUITY_MENU_THEME}
              muted={muted}
              onToggleSound={() => {
                sound.resumeAudio();
                setMuted(sound.toggleMuted());
              }}
              onInfo={() => setShowInfo(true)}
              onClose={() => setShowMenu(false)}
              style={{ left: 38, bottom: 166 }}
            />
          )}

          {showInfo && (
            <InfoScreen
              paytable={config?.paytable ?? []}
              bet={betAmount}
              freeSpins={config?.freeSpins ?? { min: 3, max: 10 }}
              onClose={() => setShowInfo(false)}
            />
          )}
        </div>
      </div>



      {showLoadingScreen && (
        <LoadingScreen
          title="777 Fruity"
          ready={ready && rtpReady}
          error={initError}
          onRetry={retryInit}
          onDone={() => {
            setShowLoadingScreen(false);
            sound.startBackgroundMusic(BG_MUSIC_URL);
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------
// Rules / info screen — stepped like Zeus vs Hades' paged info box
// ------------------------------------------------------------------------------------------

const SYMBOL_NAMES: Record<FruitySymbol, string> = {
  APPLE: "Apple",
  LEMON: "Lemon",
  ORANGE: "Orange",
  PEACH: "Peach",
  PINEAPPLE: "Pineapple",
  GRAPE: "Grapes",
  WATERMELON: "Watermelon",
  DRAGON_FRUIT: "Dragon Fruit",
  SEVEN: "Lucky 7",
  BAR: "BAR",
  STAR: "Lucky Star",
  BONUS: "Bonus",
};

const FRUITS: FruitySymbol[] = ["APPLE", "LEMON", "ORANGE", "PEACH", "PINEAPPLE", "GRAPE", "WATERMELON", "DRAGON_FRUIT"];
const PREMIUMS: FruitySymbol[] = ["SEVEN", "BAR", "STAR"];

const GOLD_TEXT: CSSProperties = {
  background: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/** Colours for the shared rules popup (see shared/GameInfoPopup). */
const INFO_THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #4c2a7a 0%, #24133d 55%, #120a20 100%)",
  accent: "#fcd34d",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #fde047 0%, #f59e0b 50%, #ea580c 100%)",
  buttonEdge: "#7c2d12",
};

function InfoScreen({
  paytable,
  bet,
  freeSpins,
  onClose,
}: {
  paytable: PayoutRow[];
  bet: number;
  freeSpins: { min: number; max: number };
  onClose: () => void;
}) {
  const spinsLabel = freeSpins.min === freeSpins.max ? `${freeSpins.min}` : `${freeSpins.min}–${freeSpins.max}`;
  const payout = (s: FruitySymbol) => paytable.find((r) => r.symbol === s)?.payout ?? 0;
  const symbolCard = (s: FruitySymbol, large = false) => {
    return (
      <div
        key={s}
        className="relative flex flex-col items-center rounded-2xl border border-amber-300/25 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-4 pb-4 pt-3"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 8px 18px rgba(0,0,0,.35)" }}
      >
        <div className="flex items-center">
          {[0, 1, 2].map((i) => (
            <img key={i} src={symbolUrl(s)} alt={i === 0 ? SYMBOL_NAMES[s] : ""} className={`${large ? "h-[61px] sm:h-[82px] w-[61px] sm:w-[82px]" : "h-[43px] sm:h-[58px] w-[43px] sm:w-[58px]"} -mx-1 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]`} />
          ))}
        </div>
        <div className="mt-2 text-[15px] sm:text-[18px] font-bold text-white">{SYMBOL_NAMES[s]}</div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-[19px] sm:text-[22px] font-black" style={GOLD_TEXT}>
            {payout(s)}x
          </span>
          <span className="text-[12px] sm:text-[15px] text-white/60">=</span>
          <span className="text-[16px] sm:text-[20px] font-bold text-lime-300 tabular-nums">{(payout(s) * bet).toFixed(2)}</span>
        </div>
      </div>
    );
  };

  const steps: { tab: string; title: string; body: ReactNode }[] = [
    {
      tab: "Fruits",
      title: "FRUIT SYMBOLS",
      body: (
        <>
          <p className="mb-3 sm:mb-6 text-center text-[14px] sm:text-[16px] text-white/80">
            Land <b className="text-amber-300">3 matching fruits</b> on the payline to win. Each symbol pays the multiplier shown
            <b className="text-amber-300"> × your bet</b>. Amounts below are shown for your current bet of{" "}
            <b className="text-lime-300">{bet.toFixed(2)}</b>.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">{FRUITS.map((s) => symbolCard(s))}</div>
        </>
      ),
    },
    {
      tab: "Premium",
      title: "PREMIUM & SPECIAL SYMBOLS",
      body: (
        <>
          <p className="mb-3 sm:mb-6 text-center text-[14px] sm:text-[16px] text-white/80">
            The highest paying symbols.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6">{PREMIUMS.map((s) => symbolCard(s, true))}</div>
          <div className="mt-3 sm:mt-6 flex items-center gap-3 sm:gap-6 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-fuchsia-500/10 px-3 sm:px-6 py-4 flex-col sm:flex-row">
            <img src={symbolUrl("BONUS")} alt="Bonus" className="h-[53px] sm:h-[72px] w-[53px] sm:w-[72px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="text-[14px] sm:text-[16px] text-white/85">
              <div className="text-[17px] sm:text-[21px] font-black" style={GOLD_TEXT}>
                BONUS
              </div>
              3 BONUS symbols on the payline award{" "}
              <b className="text-lime-300">
                {spinsLabel} FREE SPINS
              </b>
              . See the Free Spins page for full details.
            </div>
          </div>
        </>
      ),
    },
    {
      tab: "Payline",
      title: "PAYLINE",
      body: (
        <div className="flex items-start gap-3 sm:gap-12 flex-col sm:flex-row">
          <div className="flex-none">
            <div className="relative grid grid-cols-3 gap-2 rounded-2xl border-2 border-amber-300/50 bg-black/40 p-3">
              {Array.from({ length: 9 }, (_, k) => {
                const row = Math.floor(k / 3);
                const onLine = row === 1;
                return (
                  <div
                    key={k}
                    className={`flex h-[61px] sm:h-[82px] w-[61px] sm:w-[82px] items-center justify-center rounded-xl ${onLine ? "bg-amber-400/25 ring-2 ring-amber-300" : "bg-white/[0.06]"}`}
                  >
                    <img
                      src={symbolUrl(onLine ? "SEVEN" : (["LEMON", "GRAPE", "APPLE", "PEACH", "ORANGE", "BAR"] as FruitySymbol[])[k % 6])}
                      alt=""
                      className={`h-[46px] sm:h-[63px] w-[46px] sm:w-[63px] object-contain ${onLine ? "" : "opacity-35"}`}
                    />
                  </div>
                );
              })}
              <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-200 via-red-500 to-amber-200 shadow-[0_0_14px_rgba(251,191,36,.9)]" />
            </div>
            <div className="mt-3 text-center text-[12px] sm:text-[14px] font-bold tracking-widest text-amber-300">1 PAYLINE — MIDDLE ROW</div>
          </div>
          <ul className="list-disc space-y-3 pl-6 text-[14px] sm:text-[16px] leading-[19px] sm:leading-[22px] text-white/85">
            <li>This is a classic 3-reel game with a <b className="text-amber-300">single payline</b> across the middle row.</li>
            <li>A win needs <b className="text-amber-300">3 identical symbols</b> on the payline, one on each reel. Symbols above and below the line do not pay.</li>
            <li>Win = symbol multiplier × total bet. Only one win can be paid per spin.</li>
            <li>The paytable on the left of the reels always shows what each combination pays at your current bet.</li>
            <li>
              <b className="text-cyan-300">FAST</b> spins the reels quicker — it does not change the odds or payouts.
            </li>
            <li>
              <b className="text-violet-300">AUTO</b> keeps spinning at the current bet until you press it again, your balance runs out, or a
              Bonus is triggered.
            </li>
          </ul>
        </div>
      ),
    },
    {
      tab: "Free Spins",
      title: "BONUS FREE SPINS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-3 sm:mb-6 flex items-center gap-2 rounded-2xl border-2 border-amber-300/60 bg-amber-400/15 px-3 sm:px-6 py-3 shadow-[0_0_24px_rgba(251,191,36,.35)]">
            {[0, 1, 2].map((i) => (
              <img key={i} src={symbolUrl("BONUS")} alt={i === 0 ? "Bonus" : ""} className="h-[61px] sm:h-[82px] w-[61px] sm:w-[82px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            ))}
            <span className="ml-4 text-[26px] sm:text-[32px] font-black" style={GOLD_TEXT}>
              = {spinsLabel} FREE SPINS
            </span>
          </div>
          <ul className="max-w-[1050px] list-disc space-y-3 pl-6 text-[14px] sm:text-[16px] leading-[19px] sm:leading-[22px] text-white/85">
            <li>Land <b className="text-amber-300">3 BONUS symbols</b> on the payline to trigger the feature and win {spinsLabel} free spins.</li>
            <li>Tap the screen or SPIN to start — free spins then play automatically at the <b className="text-amber-300">same bet</b> that triggered them, cost nothing, and always pay at least 1x that bet in total. The total is added to your balance when you collect it; auto play stops when the round ends.</li>
            <li>Free spins use the same paytable as the base game. Every win is credited to your balance straight away.</li>
            <li>The feature cannot be retriggered during free spins.</li>
            <li>Bet changes and AUTO are locked until the round ends; your total free spins win is shown at the end.</li>
          </ul>
        </div>
      ),
    },
  ];

  return <GameInfoPopup label="777 Fruity rules" theme={INFO_THEME} steps={steps} onClose={onClose} />;
}
