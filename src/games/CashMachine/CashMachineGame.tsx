import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { Application } from "pixi.js";
import { budgetResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { CashMachineScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/CashMachineScene";
import { getCashMachineConfig, spinRequest, logSpinResult, CashMachineConfigResponse, syncCashRtpConfigFromServer } from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
// import SlotControlBar from "../shared/SlotControlBar"; // footer swapped for GameController below
// import GameController from "../shared/GameController"; // footer swapped for GameController3rd below
import { InfoScreen } from "./InfoScreen";
import { GameMenu, CASH_MACHINE_MENU_THEME } from "../shared/GameMenu";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";

// Control bar, loaded on demand (code-split into its own chunk) — see the <Suspense> footer below.
const GameController3rd = lazy(() => import("../shared/GameController3rd"));

const DEFAULT_BET_LEVELS = [0.1, 0.5, 0.9, 1, 5, 10];
const WIN_GLOW_MIN_DISPLAY_MS = 2000;
const BG_MUSIC_URL = "/Sound/mondamusic-retro-arcade-game-music-512837.mp3";

/** GPU-memory budget for the canvas's backing buffer, in pixels (~12 bytes of GPU memory each —
 * see budgetResolution). ~0.8 MP keeps the whole game around 10-15 MB of GPU memory; on smaller
 * screens the canvas renders even fewer pixels (just what's visible). Raise for sharper output. */
const MAX_BACKING_PIXELS = 800_000;

/** Mirrors the backend's BET_TIERS mapping (bet -> reels in play) — used purely to dim
 * the not-in-play reels immediately when the bet changes, before the next spin. */
function getActiveReelsForBet(bet: number): number {
  if (bet === 0.1 || bet === 1) return 1;
  if (bet === 0.5 || bet === 5) return 2;
  return 3;
}

export function CashMachineGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CashMachineScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<CashMachineConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);
  const winGlowActiveRef = useRef(false);
  const winGlowStartRef = useRef(0);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncCashRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getCashMachineConfig()
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
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        ...gameRendererOptions(),
        resolution: budgetResolution(fitScaleRef.current, CANVAS_WIDTH, CANVAS_HEIGHT, MAX_BACKING_PIXELS),
        autoDensity: true,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await CashMachineScene.create(app);
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
        console.error("Cash Machine: failed to initialize", err);
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

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  const runSpin = useCallback(async () => {
    sound.resumeAudio();
    if (!sceneRef.current || spinning || spinLockRef.current) return;
    if (!user || user.balance < betAmount) {
      setError("Insufficient balance");
      setAutoplay(false);
      return;
    }

    setError(null);
    setSpinning(true);
    setWinAmount(0);

    // A new spin clears the previous win glow right away, so a SPIN press never waits.
    // (Autoplay still holds the glow for WIN_GLOW_MIN_DISPLAY_MS — see its effect below.)
    if (winGlowActiveRef.current) {
      sceneRef.current?.setWinGlow(false);
      winGlowActiveRef.current = false;
    }
    if (!sceneRef.current) return;

    // The bet leaves the balance the moment the spin starts; a win is added back once the reels
    // land (result.balance = balanceBefore - bet + win, so a loss leaves it as already deducted).
    spinLockRef.current = true;
    const balanceBefore = balanceRef.current;
    /** Set once the spin result is in — after that a failure must not refund the bet. */
    let spinResolved = false;
    setBalance(Math.round((balanceBefore - betAmount) * 100) / 100);

    try {
      const result = await spinRequest(betAmount, balanceBefore);
      spinResolved = true;
      sound.startReelSpinLoop();
      await sceneRef.current.spin(result.symbols, result.activeReels, result.respunIndexes, () => sound.playReelStop());
      sound.stopReelSpinLoop();
      setWinAmount(result.winAmount);
      setBalance(result.balance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding.
      logSpinResult({
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: [result.symbols],
        balanceAfter: result.balance,
      }).catch(() => {});

      if (result.winAmount > 0) {
        sceneRef.current.setWinGlow(true);
        winGlowActiveRef.current = true;
        winGlowStartRef.current = Date.now();
      }

      if (result.winAmount > 0) sound.playWinChime();
    } catch (err) {
      // The spin request itself failed — give the bet back.
      if (!spinResolved) setBalance(balanceBefore);
      sound.stopReelSpinLoop();
      const message = err instanceof Error ? err.message : "Spin failed";
      setError(message);
      setAutoplay(false);
    } finally {
      spinLockRef.current = false;
      setSpinning(false);
    }
  }, [betAmount, spinning, user, setBalance]);

  // First autoplay spin fires the instant AUTO is switched on; later ones pause 700ms and
  // also let a win glow show for its full WIN_GLOW_MIN_DISPLAY_MS.
  const autoFirstSpinRef = useRef(true);
  useEffect(() => {
    if (!autoplay) autoFirstSpinRef.current = true;
  }, [autoplay]);
  useEffect(() => {
    if (!autoplay || spinning || !ready || showInfo) return;
    const glowRemaining = winGlowActiveRef.current ? WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winGlowStartRef.current) : 0;
    const delay = autoFirstSpinRef.current ? 0 : Math.max(700, glowRemaining);
    const id = window.setTimeout(() => {
      autoFirstSpinRef.current = false;
      runSpin();
    }, delay);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, showInfo, runSpin]);

  // Dim the not-in-play reels the instant the bet changes, rather than waiting for the
  // next spin to resolve and only then reflecting the new reel count.
  // Keep the canvas's backing resolution matched to its on-screen size (it's CSS-scaled by
  // fitScale), within the GPU-memory budget. Debounced so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = budgetResolution(fitScale, CANVAS_WIDTH, CANVAS_HEIGHT, MAX_BACKING_PIXELS);
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      app.renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT, resolution);
      // The render loop is paused while idle, so draw the resized canvas once.
      sceneRef.current?.renderNow();
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    sceneRef.current.setActiveReelsPreview(getActiveReelsForBet(betAmount));
  }, [betAmount, ready]);

  const changeBet = (direction: 1 | -1) => {
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  // MAX BET: jump straight to the highest bet level (GameController shows it in the TURBO slot,
  // since CashMachine has no turbo mode; GameController3rd likewise turns its TURBO slot into MAX BET).
  const setMaxBet = () => setBetIndex(betLevels.length - 1);

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;

  return (
    <>
    <div className="relative overflow-hidden" style={{ width: scaledWidth, height: scaledHeight }}>
    <div
      ref={gameCardRef}
      className="relative flex flex-col overflow-hidden bg-black shadow-2xl"
      style={{
        width: CANVAS_WIDTH,
        transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
        transformOrigin: "top left",
      }}
    >
      {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
      <GameJackpotBar gameId="cash-machine" />

      <div className="relative mt-1 overflow-hidden rounded-lg">
        <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black text-emerald-400/70">
            Loading reels...
          </div>
        )}
      </div>

      {error && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">
          {error}
        </div>
      )}

      <div className="absolute bottom-0 w-full">
        {/* SlotControlBar — commented out per request; GameController below is the active footer
            for CashMachine. To switch back: restore this block and its import.
        <SlotControlBar
          credit={user?.balance ?? 0}
          betLabel={betAmount.toFixed(2)}
          onBetDecrease={() => changeBet(-1)}
          onBetIncrease={() => changeBet(1)}
          betDecreaseDisabled={betIndex === 0}
          betIncreaseDisabled={betIndex === betLevels.length - 1}
          win={winAmount}
          spinning={spinning}
          spinDisabled={!ready || spinning}
          onSpin={() => runSpin()}
          auto={autoplay}
          onToggleAuto={() => {
            sound.resumeAudio();
            setAutoplay((v) => !v);
          }}
          onMaxBet={setMaxBet}
          maxBetDisabled={betIndex === betLevels.length - 1}
          muted={muted}
          onToggleMute={() => {
            sound.resumeAudio();
            setMuted(sound.toggleMuted());
          }}
          onInfo={() => setShowInfo(true)}
        />
        */}
        {/* GameController — commented out; GameController3rd below is the active footer for
            CashMachine. To switch back: restore this block and its import.
        <GameController
          betAmount={betAmount}
          credit={user?.balance ?? 0}
          onBetDecrease={() => changeBet(-1)}
          onBetIncrease={() => changeBet(1)}
          betDecreaseDisabled={betIndex === 0}
          betIncreaseDisabled={betIndex === betLevels.length - 1}
          win={winAmount}
          spinning={spinning}
          spinDisabled={!ready || spinning}
          onSpin={() => runSpin()}
          allowQuickStop={false}
          onMaxBet={setMaxBet}
          maxBetDisabled={betIndex === betLevels.length - 1}
          auto={autoplay}
          onToggleAuto={() => {
            sound.resumeAudio();
            setAutoplay((v) => !v);
          }}
          muted={muted}
          onToggleMute={() => {
            sound.resumeAudio();
            setMuted(sound.toggleMuted());
          }}
          onInfo={() => setShowInfo(true)}
        />
        */}
        {/* placeholder of the bar's exact size while its chunk loads, so the layout doesn't jump */}
        <Suspense fallback={<div className="aspect-[1878/147] w-full bg-[#410117]" />}>
          <GameController3rd
            betAmount={betAmount}
            credit={user?.balance ?? 0}
            onBetDecrease={() => changeBet(-1)}
            onBetIncrease={() => changeBet(1)}
            betDecreaseDisabled={betIndex === 0}
            betIncreaseDisabled={betIndex === betLevels.length - 1}
            onMaxBet={setMaxBet}
            maxBetDisabled={betIndex === betLevels.length - 1}
            win={winAmount}
            spinning={spinning}
            spinDisabled={!ready || spinning}
            onSpin={() => runSpin()}
            auto={autoplay}
            onToggleAuto={() => {
              sound.resumeAudio();
              setAutoplay((v) => !v);
            }}
            muted={muted}
            onToggleMute={() => {
              sound.resumeAudio();
              setMuted(sound.toggleMuted());
            }}
            onInfo={() => {
              sound.resumeAudio();
              setShowMenu((v) => !v);
            }}
            helpIcon="menu"
          />
        </Suspense>
      </div>

      {showMenu && (
        <GameMenu
          theme={CASH_MACHINE_MENU_THEME}
          muted={muted}
          onToggleSound={() => {}}
          onInfo={() => setShowInfo(true)}
          onClose={() => setShowMenu(false)}
          // Just above the Menu key at the bar's left end, in design pixels.
          style={{ left: 10, bottom: 122 }}
        />
      )}
    </div>
    </div>

    {showInfo && config && <InfoScreen bet={betAmount} onClose={() => setShowInfo(false)} />}


    {showLoadingScreen && (
      <LoadingScreen
        title="Cash Machine"
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

