import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { RubberDuckScene, CANVAS_WIDTH, CANVAS_HEIGHT, VIEW_LEFT, VIEW_TOP, VIEW_WIDTH, VIEW_HEIGHT } from "./pixi/RubberDuckScene";
import { BG_URL } from "./pixi/symbols";
import { getRubberDuckConfig, spinRequest, logSpinResult, RubberDuckConfigResponse, syncRubberDuckRtpConfigFromServer } from "./api";
import { FreeSpinCelebration, type CelebrationPalette } from "../ShamrockSpin/FreeSpinCelebration";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
// import { GameHomeButton } from "../shared/GameHomeButton";
import { SlotConsole } from "../shared/SlotConsole";
import { GameMenu, FRUITY_MENU_THEME } from "../shared/GameMenu";
import { InfoScreen } from "./InfoScreen";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
const WIN_GLOW_MIN_DISPLAY_MS = 3500;
const FREE_SPIN_GAP_MS = 900;
const AUTOPLAY_GAP_MS = 700;
const RETRIGGER_TOAST_MS = 2600;

/** The free-spins banner in Rubber Duck's sky-blue theme (it's shared with Shamrock Spin, whose
 * default is green). */
const RUBBER_DUCK_BANNER_PALETTE: CelebrationPalette = {
  stroke: "#0ea5e9",
  shadow: "#061a33",
  deepShadow: "#030f1f",
  glow: "#38bdf8",
  blinkGlow: "rgba(56, 189, 248, 0.9)",
  blinkGlowFaint: "rgba(56, 189, 248, 0.2)",
};

export function RubberDuckGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<RubberDuckScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<RubberDuckConfigResponse | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const winEffectActiveRef = useRef(false);
  const winEffectStartRef = useRef(0);

  const [freeSpins, setFreeSpins] = useState<{
    remaining: number;
    total: number;
    totalWin: number;
    lockedBetIndex: number;
  } | null>(null);
  const [freeSpinAward, setFreeSpinAward] = useState<number | null>(null);
  /** Player pressed SPIN while the free-spins banner was up — plays the banner's exit, then the round starts. */
  const [freeSpinStartRequested, setFreeSpinStartRequested] = useState(false);
  /** Running total of the current free-spins round — shown in the WIN box during the round and
   * only credited to the balance once the player taps the "Free Spins Complete" card away. */
  const roundWinRef = useRef(0);
  /** The triggering spin's own win, held in roundWinRef — the round minimum counts free-spin wins only. */
  const triggerWinRef = useRef(0);
  const [freeSpinsSummary, setFreeSpinsSummary] = useState<{ totalWin: number; totalSpins: number } | null>(null);
  const [retriggerToast, setRetriggerToast] = useState(false);

  const betAmount = betLevels[betIndex] ?? betLevels[0];
  const inFreeSpins = freeSpins !== null;

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncRubberDuckRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getRubberDuckConfig()
      .then((c) => {
        setConfig(c);
        setBetLevels(c.betLevels);
      })
      .catch(() => {
        /* fall back to default bet levels already set */
      });
  }, [rtpReady]);

  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        // Only the reel strip (see VIEW_* in RubberDuckScene) — the background is a plain <img>.
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        ...gameRendererOptions(),
        // Matched to the canvas's on-screen size (see the resize effect below), not always 1.25x.
        resolution: fitResolution(fitScaleRef.current),
        autoDensity: true,
        backgroundAlpha: 0,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        // Pin the cropped canvas over the reel strip of the full-size host.
        Object.assign(app.canvas.style, { position: "absolute", left: `${VIEW_LEFT}px`, top: `${VIEW_TOP}px` });
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await RubberDuckScene.create(app);
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
        console.error("Rubber Duck: failed to initialize", err);
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

  // Keep the canvas's backing resolution matched to its on-screen
  // size: it's 1920x1080 in design space but CSS-scaled by fitScale, so a full-size backing buffer
  // is mostly pixels the browser throws away. Debounced so a window drag doesn't reallocate every
  // frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = fitResolution(fitScale);
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

  const runSpin = useCallback(
    async (isFreeSpin: boolean) => {
      if (!sceneRef.current || spinLockRef.current) return;
      setSpinning(true);
      // The bet leaves the balance the moment SPIN is pressed (free spins cost nothing); a win is
      // added back once the reels land (result.balance = balanceBefore - bet + win).
      spinLockRef.current = true;
      const stakeBet = isFreeSpin ? betLevels[freeSpins?.lockedBetIndex ?? betIndex] : betAmount;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!isFreeSpin) setBalance(Math.round((balanceBefore - stakeBet) * 100) / 100);

      if (winEffectActiveRef.current) {
        const remaining = WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winEffectStartRef.current);
        if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
        sceneRef.current?.setWinPositions([]);
        winEffectActiveRef.current = false;
      }
      if (!sceneRef.current) {
        spinLockRef.current = false;
        if (!isFreeSpin) setBalance(balanceBefore);
        return;
      }
      // The last win stays in the WIN box until the new spin's reels actually start.
      setWinAmount(isFreeSpin ? roundWinRef.current : 0);

      try {
        sceneRef.current.setWinPositions([]);
        sound.startReelSpinLoop();
        const result = await spinRequest(stakeBet, isFreeSpin, balanceBefore);
        spinResolved = true;
        // A "ding" as each reel stops on a paytable symbol (each pays on its own reel), climbing
        // in pitch with every paying reel this spin.
        const payingReels = new Set(result.evaluation.positionWins.map((w) => w.reelIndex));
        let hits = 0;
        const reelStop = sound.reelStopSounds(5);
        // 2 BONUS showing → the remaining reels build suspense one by one, with drums + an 8-bit riser.
        await sceneRef.current.spin(
          result.reels,
          (reelIndex) => {
            reelStop();
            if (payingReels.has(reelIndex)) sound.playSymbolHit(hits++);
          },
          (ms) => {
            // Drum roll + a '90s 8-bit arcade riser on top, both cut off when the reel lands.
            const stopDrums = sound.startDrumRoll(ms);
            const stopRiser = sound.startChiptuneRiser(ms);
            return () => {
              stopDrums();
              stopRiser();
            };
          }
        );
        sound.stopReelSpinLoop();

        let balanceAfter = result.balance;
        if (isFreeSpin) {
          // Free-spin wins pile up in the WIN box; the balance is only credited when the round's
          // completion card is closed (see collectRoundWin).
          roundWinRef.current = Math.round((roundWinRef.current + result.winAmount) * 100) / 100;
          setWinAmount(roundWinRef.current);
          balanceAfter = Math.round((balanceRef.current + roundWinRef.current) * 100) / 100;
        } else {
          setWinAmount(result.winAmount);
          // A spin that starts a free-spin round holds its own win too — it's credited with the
          // round's total when the round's result is tapped away.
          if (!(result.freeSpinsAwarded)) setBalance(result.balance);
        }

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding.
        logSpinResult({
          betAmount: isFreeSpin ? 0 : stakeBet,
          winAmount: result.winAmount,
          reelSymbols: result.reels.map((symbol) => [symbol]),
          balanceAfter,
        }).catch(() => {});

        if (result.evaluation.positionWins.length > 0) {
          sceneRef.current.setWinPositions(result.evaluation.positionWins);
          winEffectActiveRef.current = true;
          winEffectStartRef.current = Date.now();
        }

        if (result.winAmount > 0) sound.playWinChime();

        if (isFreeSpin) {
          setFreeSpins((prev) => (prev ? { ...prev, remaining: prev.remaining - 1, totalWin: prev.totalWin + result.winAmount } : prev));
          if (result.retriggered) {
            sound.playFreeSpinsJingle();
            setFreeSpins((prev) => (prev ? { ...prev, remaining: prev.remaining + 10, total: prev.total + 10 } : prev));
            setRetriggerToast(true);
            window.setTimeout(() => setRetriggerToast(false), RETRIGGER_TOAST_MS);
          }
          if (result.freeSpinRoundResult) {
            setFreeSpinsSummary({ totalWin: roundWinRef.current, totalSpins: result.freeSpinRoundResult.totalSpins });
            setFreeSpins(null);
            // Autoplay stops once a bonus round ends — the player resumes with SPIN or AUTO.
            setAutoplay(false);
          }
        } else if (result.freeSpinsAwarded) {
          sound.playFreeSpinsJingle();
          // The round's total starts from the triggering spin's own (held) win.
          roundWinRef.current = result.winAmount;
          triggerWinRef.current = result.winAmount;
          setFreeSpinAward(result.freeSpinsAwarded);
          setFreeSpins({
            remaining: result.freeSpinsAwarded,
            total: result.freeSpinsAwarded,
            totalWin: 0,
            lockedBetIndex: betIndex,
          });
        }
      } catch (err) {
        // The spin request itself failed — give the bet back.
        if (!spinResolved && !isFreeSpin) setBalance(balanceBefore);
        sound.stopReelSpinLoop();
        const message = err instanceof Error ? err.message : "Spin failed";
        setError(message);
        if (isFreeSpin) {
          // The round can't continue — still show (and credit) what it had won so far.
          setFreeSpins(null);
          setFreeSpinsSummary((prev) => prev ?? { totalWin: roundWinRef.current, totalSpins: 0 });
        }
        setAutoplay(false);
      } finally {
        spinLockRef.current = false;
        setSpinning(false);
      }
    },
    [betAmount, betIndex, betLevels, freeSpins, setBalance]
  );

  /** Closes the "Free Spins Complete" card and only now adds the round's total to the balance. */
  const collectRoundWin = useCallback(() => {
    const total = roundWinRef.current;
    roundWinRef.current = 0;
    setFreeSpinsSummary(null);
    if (total > 0) {
      sound.playWinChime();
      setBalance(Math.round((balanceRef.current + total) * 100) / 100);
    }
  }, [setBalance]);

  const startManualSpin = useCallback(() => {
    sound.resumeAudio();
    // The free-spins banner is up — SPIN starts the round, same as tapping the banner.
    if (freeSpinAward !== null) {
      setFreeSpinStartRequested(true);
      return;
    }
    if (!sceneRef.current || spinning || freeSpins || freeSpinsSummary) return;
    if (!user || user.balance < betAmount) {
      setError("Insufficient balance");
      setAutoplay(false);
      return;
    }
    setError(null);
    runSpin(false);
  }, [betAmount, freeSpins, freeSpinAward, freeSpinsSummary, runSpin, spinning, user]);

  useEffect(() => {
    if (!autoplay || spinning || !ready || freeSpins || freeSpinsSummary || showInfo) return;
    // After a win, let it stay on screen (highlight + WIN box) for its full minimum time before
    // the next autoplay spin starts and clears it.
    const winShowingLeft = winEffectActiveRef.current
      ? WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winEffectStartRef.current)
      : 0;
    const id = window.setTimeout(() => {
      if (!user || user.balance < betAmount) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }
      setError(null);
      runSpin(false);
    }, Math.max(AUTOPLAY_GAP_MS, winShowingLeft));
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, freeSpins, freeSpinsSummary, showInfo, user, betAmount, runSpin]);

  useEffect(() => {
    if (!freeSpins || spinning || !ready || freeSpinAward !== null || showInfo) return;
    if (freeSpins.remaining <= 0) return; // waiting on runSpin's own freeSpinRoundResult handling
    const id = window.setTimeout(() => runSpin(true), FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeSpins, spinning, ready, freeSpinAward, showInfo, runSpin]);

  const changeBet = (direction: 1 | -1) => {
    if (freeSpins || autoplay) return;
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;
  // While the free-spins banner is up SPIN is live again — pressing it starts the round.
  const spinDisabled =
    !ready || spinning || freeSpinsSummary !== null || freeSpinStartRequested || (inFreeSpins && freeSpinAward === null);

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
          <GameJackpotBar gameId="rubber-duck" />

          <div className="absolute top-0 z-10 flex w-full items-center justify-between px-3 py-2">
            {/* <GameHomeButton size={81} /> */}
            {inFreeSpins && (
              <div className="flex items-center gap-4 rounded-full bg-black/80 border-2 border-sky-400 px-6 py-2 text-sky-300 font-black text-2xl tracking-wide">
                <span>FREE SPINS</span>
                <span className="text-white">
                  {freeSpins!.remaining} left (of {freeSpins!.total})
                </span>
                <span className="text-lime-300">Win: {freeSpins!.totalWin.toFixed(2)}</span>
                {retriggerToast && <span className="text-amber-300 animate-pulse">+10 MORE!</span>}
              </div>
            )}
          </div>

          <div className="relative overflow-hidden">
            <div ref={canvasHostRef} className="relative mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
              {/* Background art as a plain image — the Pixi canvas on top only covers the reels. */}
              <img src={BG_URL} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
            </div>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-sky-950 text-sky-300/70">
                Loading reels...
              </div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 mx-3 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
              {error}
            </div>
          )}

          {/* Free-spins completion card — tap anywhere to continue; only then is the total credited. */}
          {freeSpinsSummary && (
            <div
              className="absolute inset-0 z-40 cursor-pointer select-none bg-black/50"
              onClick={collectRoundWin}
              role="button"
              tabIndex={0}
              aria-label="Free Spins Complete - tap to continue"
            >
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 border-sky-400 bg-black/90 px-12 py-8 text-center">
                <div className="text-5xl font-black text-sky-300 uppercase tracking-wide">Congratulations</div>
                {freeSpinsSummary.totalSpins > 0 && (
                  <div className="mt-2 text-xl text-white/80">{freeSpinsSummary.totalSpins} spins played</div>
                )}
                <div className="mt-4 text-5xl font-black text-lime-300">{freeSpinsSummary.totalWin.toFixed(2)}</div>
                <div className="mt-6 rounded-full bg-sky-500 px-8 py-2 font-bold text-2xl text-black">COLLECT TO CONTINUE</div>
              </div>
            </div>
          )}

          {freeSpinAward !== null && (
            <FreeSpinCelebration
              count={freeSpinAward}
              palette={RUBBER_DUCK_BANNER_PALETTE}
              startRequested={freeSpinStartRequested}
              onDismiss={() => {
                setFreeSpinAward(null);
                setFreeSpinStartRequested(false);
              }}
            />
          )}

          {/* Same 3D control console as 777 Fruity (shared/SlotConsole) — raised above the free-spins
              banner while it's up so SPIN can start the round. Rubber Duck has no fast-spin mode. */}
          <SlotConsole
            className={`absolute bottom-0 ${freeSpinAward !== null ? "z-40" : "z-10"}`}
            credit={user?.balance ?? 0}
            bet={betAmount}
            win={winAmount}
            onBetDecrease={() => changeBet(-1)}
            onBetIncrease={() => changeBet(1)}
            betDecreaseDisabled={betIndex === 0 || inFreeSpins || autoplay}
            betIncreaseDisabled={betIndex === betLevels.length - 1 || inFreeSpins || autoplay}
            auto={{
              on: autoplay,
              disabled: inFreeSpins,
              onToggle: () => {
                sound.resumeAudio();
                setAutoplay((v) => !v);
              },
            }}
            spinning={spinning}
            spinDisabled={spinDisabled}
            spinLabel={inFreeSpins && freeSpinAward === null ? "FREE" : "SPIN"}
            onSpin={startManualSpin}
            menuOpen={showMenu}
            onToggleMenu={() => setShowMenu((v) => !v)}
          />

          {/* Menu from the console's Menu key: Home, sound on/off, game info. */}
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
        </div>
      </div>


      {showInfo && config && <InfoScreen config={config} bet={betAmount} onClose={() => setShowInfo(false)} />}

      {showLoadingScreen && (
        <LoadingScreen
          title="Rubber Duck"
          ready={ready && rtpReady}
          error={initError}
          onRetry={retryInit}
          onDone={() => {
            setShowLoadingScreen(false);
            sound.startBackgroundMusic("/Sound/mfcc-gambling-lottery-casino-gambling-music-120447.mp3");
          }}
        />
      )}
    </>
  );
}
