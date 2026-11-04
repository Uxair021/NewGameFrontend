import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { budgetResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { CrystalCloverScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/CrystalCloverScene";
import { getCrystalCloverConfig, spinRequest, logSpinResult, CrystalCloverConfigResponse, syncCrystalCloverRtpConfigFromServer } from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import { InfoScreen } from "./InfoScreen";
import * as sound from "../shared/sound/soundEngine";
import { GameMenu, CRYSTAL_CLOVER_MENU_THEME } from "../shared/GameMenu";
import { SlotConsole, SlotConsoleTheme } from "../shared/SlotConsole";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const DEFAULT_BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];
const WIN_HIGHLIGHT_MIN_DISPLAY_MS = 2000;
const BG_MUSIC_URL = "/Sound/kulakovka-casino-291450.mp3";
const REEL_SPIN_SOUND_URL = "/Sound/freesound_community-spinning-reel-27903.mp3";
const REEL_SPIN_SOUND_TRIM_SECONDS = 0.4;

/** GPU-memory budget for the canvas's backing buffer, in pixels (~12 bytes of GPU memory each —
 * see budgetResolution). ~0.4 MP keeps the whole game around 10-15 MB of GPU memory; on smaller
 * screens the canvas renders even fewer pixels (just what's visible). Raise for sharper output. */
const MAX_BACKING_PIXELS = 400_000;

/** The soft green backdrop behind the whole game (960x540, scaled to cover the screen). */
const BACKDROP_URL = "/symbols/crystalClover/bg.webp";

/** The console in Crystal Clover's own colours: an emerald-glass deck with the frame's gold trim,
 * emerald / teal / gold keys and a green SPIN (the cabinet's clover green). */
const CONSOLE_THEME: SlotConsoleTheme = {
  deck: ["#13573a", "#0a3a26", "#03180f"],
  deckEdge: "#010a06",
  trim: "rgba(252,211,77,.75)",
  deckFront: ["#06291a", "#010a06"],
  lcdRing: "#0b2a1c",
  lcd: { credit: "#6ee7b7", bet: "#fcd34d", win: "#bef264" },
  keys: {
    menu: { hi: "#d1fae5", mid: "#10b981", lo: "#065f46", ledge: "#022c22", glow: "rgba(52,211,153,.75)", led: "#6ee7b7" },
    fast: { hi: "#ccfbf1", mid: "#14b8a6", lo: "#0f766e", ledge: "#134e4a", glow: "rgba(45,212,191,.8)", led: "#5eead4" },
    auto: { hi: "#fef3c7", mid: "#f59e0b", lo: "#b45309", ledge: "#5b2c06", glow: "rgba(251,191,36,.8)", led: "#fde68a" },
    spin: { hi: "#ecfccb", mid: "#22c55e", lo: "#15803d", ledge: "#0b3d1d", glow: "rgba(74,222,128,.8)", led: "#bbf7d0" },
  },
  spinLabelShadow: "#14532d",
  // A softer gloss and a dark outline, so FAST's bolt / AUTO's arrows / SPIN stay crisp on the
  // bright teal, gold and green keys instead of fading into the white shine.
  gloss: 0.28,
  iconOutline: true,
};

export function CrystalCloverGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CrystalCloverScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<CrystalCloverConfigResponse | null>(null);
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
  const [turbo, setTurbo] = useState(false);
  const winHighlightActiveRef = useRef(false);
  const winHighlightStartRef = useRef(0);
  // The home button and control bar are now genuine stacked rows (not absolute overlays on
  // top of the canvas — frame.png's reel windows fill almost the entire 781px canvas height,
  // leaving no safe margin for an overlay bar to sit in without covering the bottom row of
  // symbols). Since the card's total natural height is no longer just CANVAS_HEIGHT, this
  // measures the real (untransformed) size of `gameCardRef` directly, independent of
  // useFitScale's own internal measurement, so the outer wrapper below can reserve exactly
  // the right amount of post-scale space for all 3 rows together.
  const [naturalSize, setNaturalSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

  useEffect(() => {
    const el = gameCardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setNaturalSize({ width: el.offsetWidth, height: el.offsetHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncCrystalCloverRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getCrystalCloverConfig()
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
        // frame.png's own margins (outside the gold-bordered reel windows) are transparent —
        // without this, Pixi's default opaque black clear color fills them instead of letting
        // the page-level backdrop (see BACKDROP_URL below) show through.
        backgroundAlpha: 0,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await CrystalCloverScene.create(app);
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
        console.error("7 Crystal Clover: failed to initialize", err);
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

    // A previous spin's win highlight must stay visible for at least
    // WIN_HIGHLIGHT_MIN_DISPLAY_MS before this new spin clears it, even if the player hits
    // SPIN again immediately.
    if (winHighlightActiveRef.current) {
      const remaining = WIN_HIGHLIGHT_MIN_DISPLAY_MS - (Date.now() - winHighlightStartRef.current);
      if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
      winHighlightActiveRef.current = false;
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
      sound.startReelSpinLoop(REEL_SPIN_SOUND_URL, REEL_SPIN_SOUND_TRIM_SECONDS);
      await sceneRef.current.spin(result.grid, () => sound.playReelStop(), turbo);
      sound.stopReelSpinLoop();
      setWinAmount(result.winAmount);
      setBalance(result.balance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding.
      logSpinResult({
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: result.grid,
        balanceAfter: result.balance,
      }).catch(() => {});

      if (result.evaluation.lineWins.length > 0) {
        sceneRef.current.showWinHighlights(result.evaluation.lineWins);
        winHighlightActiveRef.current = true;
        winHighlightStartRef.current = Date.now();
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

  useEffect(() => {
    if (!autoplay || spinning || !ready || showInfo) return;
    const id = window.setTimeout(() => {
      runSpin();
    }, 700);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, showInfo, runSpin]);

  const changeBet = (direction: 1 | -1) => {
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  // Full-viewport backdrop, painted as the background of GamePage's full-screen wrapper (the
  // card's ancestor) rather than as a position:fixed <img>: a fixed full-screen element gets its
  // own screen-sized GPU layer (~8 MB+), while the wrapper is part of the page's base layer that
  // exists anyway, so this costs only the small decoded image. It shows through the canvas's
  // transparent margins (backgroundAlpha: 0) and frame.webp's own transparent areas.
  useEffect(() => {
    const wrapper = gameCardRef.current?.closest<HTMLElement>(".force-landscape-wrapper");
    if (!wrapper) return;
    const previous = wrapper.style.cssText;
    wrapper.style.backgroundImage = `url(${BACKDROP_URL})`;
    wrapper.style.backgroundSize = "cover";
    wrapper.style.backgroundPosition = "center";
    return () => {
      wrapper.style.cssText = previous;
    };
  }, []);

  const scaledWidth = naturalSize.width * fitScale;
  const scaledHeight = naturalSize.height * fitScale;

  return (
    <>
      <div className="relative overflow-hidden" style={{ width: scaledWidth, height: scaledHeight }}>
        <div
          ref={gameCardRef}
          className="relative flex flex-col overflow-hidden"
          style={{
            width: CANVAS_WIDTH,
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
          }}
        >

          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="crystal-clover" />

          {/* Row 1: canvas (reels) */}
          <div className="relative overflow-hidden rounded-lg">
            <div ref={canvasHostRef} className="mx-auto bg-transparent" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-emerald-300/70">
                Loading reels...
              </div>
            )}
            {error && (
              <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
                {error}
              </div>
            )}
          </div>

          {/* Row 2: 3D control console — the same shared one 777 Fruity uses (see shared/SlotConsole). */}
          <SlotConsole
            className="relative z-10 py-3"
            theme={CONSOLE_THEME}
            // Flat (no 3D tilt) so the console doesn't need a GPU layer of its own — see SlotConsole.
            flat
            credit={user?.balance ?? 0}
            bet={betAmount}
            win={winAmount}
            onBetDecrease={() => changeBet(-1)}
            onBetIncrease={() => changeBet(1)}
            betDecreaseDisabled={betIndex === 0}
            betIncreaseDisabled={betIndex === betLevels.length - 1}
            fast={{ on: turbo, onToggle: () => setTurbo((v) => !v) }}
            auto={{
              on: autoplay,
              onToggle: () => {
                sound.resumeAudio();
                setAutoplay((v) => !v);
              },
            }}
            spinning={spinning}
            spinDisabled={!ready || spinning}
            onSpin={() => runSpin()}
            menuOpen={showMenu}
            onToggleMenu={() => {
              sound.resumeAudio();
              setShowMenu((v) => !v);
            }}
          />

          {showMenu && (
            <GameMenu
              theme={CRYSTAL_CLOVER_MENU_THEME}
              muted={muted}
              onToggleSound={() => {
                sound.resumeAudio();
                setMuted(sound.toggleMuted());
              }}
              onInfo={() => setShowInfo(true)}
              onClose={() => setShowMenu(false)}
              // Just above the console's Menu key, in design pixels.
              style={{ left: 38, bottom: 178 }}
            />
          )}
        </div>
      </div>

      {showInfo && config && <InfoScreen config={config} bet={betAmount} onClose={() => setShowInfo(false)} />}


      {showLoadingScreen && (
        <LoadingScreen
          title="7 Crystal Clover"
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
