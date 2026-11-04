import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { Application } from "pixi.js";
import { budgetResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { FiveXRewindScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/FiveXRewindScene";
import { getFiveXRewindConfig, spinRequest, logSpinResult, syncFiveXRtpConfigFromServer } from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
// import SlotControlBar from "../shared/SlotControlBar"; // footer swapped for GameController3rd below
import { GameMenu, FIVE_X_MENU_THEME } from "../shared/GameMenu";
import { InfoScreen } from "./InfoScreen";

// Control bar, loaded on demand (code-split into its own chunk) — see the <Suspense> footer below.
const GameController3rd = lazy(() => import("../shared/GameController3rd"));
import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
// import { CelebrationGifOverlay } from "./CelebrationGifOverlay";

const DEFAULT_BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];
const WIN_GLOW_MIN_DISPLAY_MS = 2000;
// Canvas resolution / antialiasing come from the shared gameRendererOptions() (capped, no MSAA) —
// the 1920×1080 canvas at 2x with MSAA kept phones busy and delayed every touch by 1–2s.
/** Pixi redraw cap while the reels are idle; lifted to the display's full rate while a spin runs. */
const IDLE_MAX_FPS = 30;
const BG_MUSIC_URL = "/Sound/mfcc-lottery-casino-pause-intro-background-music-120443.mp3";
// Background loop: an animated WebP assembled from the frames in bg/ (33 frames, each with its
// own delay from its file name, ~1.1s per loop) — ~1 MB, vs the 24.5 MB bg.gif it replaces.
// Built at 960x540 and played inside the Pixi canvas (see pixi/BgAnimation), so only one small
// decoded frame is on the GPU — an animated <img> is re-rastered at screen size every frame. The
// <img> below is just the fallback for browsers without the WebCodecs ImageDecoder.
const BG_ANIM_URL = "/symbols/5xRewind/bg.webp";

/** GPU-memory budget for the canvas's backing buffer, in pixels (~12 bytes of GPU memory each —
 * see budgetResolution). ~0.5 MP keeps the whole game around 10-15 MB of GPU memory; on smaller
 * screens the canvas renders even fewer pixels (just what's visible). Raise for sharper output. */
const MAX_BACKING_PIXELS = 500_000;
// const CELEBRATION_GIF_URL = "/symbols/5xRewind/celebration.gif";

export function FiveXRewindGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<FiveXRewindScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;
  /** Show bg.webp as an <img> behind the canvas — only when the scene couldn't play it in-canvas. */
  const [imgBackground, setImgBackground] = useState(false);

  const [ready, setReady] = useState(false);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(1);
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
  const [turbo, setTurbo] = useState(false);
  // const [celebrationGifActive, setCelebrationGifActive] = useState(false);
  const winGlowActiveRef = useRef(false);
  const winGlowStartRef = useRef(0);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncFiveXRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getFiveXRewindConfig()
      .then((c) => {
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
        backgroundAlpha: 0,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        app.ticker.maxFPS = IDLE_MAX_FPS; // full speed only while spinning — see the effect below
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await FiveXRewindScene.create(app, BG_ANIM_URL);
          if (cancelled) {
            scene.destroy();
            return;
          }
          sceneRef.current = scene;
          setImgBackground(!scene.hasCanvasBackground);
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
        console.error("5x Rewind: failed to initialize", err);
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

  // Full frame rate while a spin is in flight; back to the idle cap once it settles. 0 = uncapped.
  useEffect(() => {
    const app = appRef.current;
    if (app) app.ticker.maxFPS = spinning ? 0 : IDLE_MAX_FPS;
  }, [spinning, ready]);

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
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

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
    // setCelebrationGifActive(false);

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
      await sceneRef.current.spin(result.reels, result.halfStopReels, () => sound.playReelStop(), turbo);
      sound.stopReelSpinLoop();
      setWinAmount(result.winAmount);
      setBalance(result.balance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding.
      logSpinResult({
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: result.reels.map((s) => [s]),
        balanceAfter: result.balance,
      }).catch(() => {});

      if (result.winAmount > 0) {
        sceneRef.current.setWinGlow(true);
        winGlowActiveRef.current = true;
        winGlowStartRef.current = Date.now();
        // setCelebrationGifActive(true);
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
  }, [betAmount, spinning, user, setBalance, turbo]);

  // First autoplay spin fires the instant AUTO is switched on; later ones pause 700ms and
  // also let a win glow show for its full WIN_GLOW_MIN_DISPLAY_MS.
  const autoFirstSpinRef = useRef(true);
  useEffect(() => {
    if (!autoplay) autoFirstSpinRef.current = true;
  }, [autoplay]);
  useEffect(() => {
    if (!autoplay || spinning || !ready) return;
    const glowRemaining = winGlowActiveRef.current ? WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winGlowStartRef.current) : 0;
    const delay = autoFirstSpinRef.current ? 0 : Math.max(700, glowRemaining);
    const id = window.setTimeout(() => {
      autoFirstSpinRef.current = false;
      runSpin();
    }, delay);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, runSpin]);

  const changeBet = (direction: 1 | -1) => {
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;

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
      <GameJackpotBar gameId="5x-rewind" />

      {imgBackground && (
        <img
          src={BG_ANIM_URL}
          alt=""
          aria-hidden
          decoding="async"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, willChange: "transform" }}
        />
      )}

      {/* <CelebrationGifOverlay
        active={celebrationGifActive}
        src={CELEBRATION_GIF_URL}
        onDone={() => setCelebrationGifActive(false)}
      /> */}

      <div className="relative mt-1 overflow-hidden rounded-lg">
        <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-amber-300/70">Loading reels...</div>
        )}
      </div>

      {error && (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">
          {error}
        </div>
      )}

      <div className="absolute bottom-0 z-10 w-full">
        {/* SlotControlBar — commented out; GameController3rd below is the active footer for
            FiveXRewind. To switch back: restore this block and its import.
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
          turbo={turbo}
          onToggleTurbo={() => setTurbo((v) => !v)}
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
            turbo={turbo}
            onToggleTurbo={() => setTurbo((v) => !v)}
            win={winAmount}
            spinning={spinning}
            spinDisabled={!ready || spinning}
            onSpin={() => runSpin()}
            auto={autoplay}
            onToggleAuto={() => {
              sound.resumeAudio();
              setAutoplay((v) => !v);
            }}
            onInfo={() => {
              sound.resumeAudio();
              setShowMenu((v) => !v);
            }}
            helpIcon="menu"
            muted={muted}
            onToggleMute={() => {
              sound.resumeAudio();
              setMuted(sound.toggleMuted());
            }}
          />
        </Suspense>
      </div>

      {showMenu && (
        <GameMenu
          theme={FIVE_X_MENU_THEME}
          muted={muted}
          onToggleSound={() => {}}
          onInfo={() => setShowInfo(true)}
          onClose={() => setShowMenu(false)}
          // Just above the Menu key at the bar's left end, in design pixels.
          style={{ left: 14, bottom: 158 }}
        />
      )}
    </div>
    </div>

    {showInfo && <InfoScreen bet={betAmount} onClose={() => setShowInfo(false)} />}


    {showLoadingScreen && (
      <LoadingScreen
        title="5x Rewind"
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
