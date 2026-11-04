import { useEffect, useRef, useState, useCallback, ReactNode, CSSProperties, lazy, Suspense, memo } from "react";
import { Link } from "react-router-dom";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { VegasHitsScene, CANVAS_WIDTH, CANVAS_HEIGHT, VIEW_LEFT, VIEW_TOP, VIEW_WIDTH, VIEW_HEIGHT } from "./pixi/VegasHitsScene";
import { getVegasHitsConfig, spinRequest, logSpinResult, VegasHitsConfigResponse, syncVegasHitsRtpConfigFromServer } from "./api";
import { BigWinBanner, FreeSpinsBanner } from "./BigWinBanner";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GAME_EXIT_PATH } from "../shared/gameExit";

// Control bar, loaded on demand (code-split into its own chunk) — see the <Suspense> footer below.
const GameController3rd = lazy(() => import("../shared/GameController3rd"));
import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const IDLE_MAX_FPS = 30;
const BG_FRAME_0_URL = "/symbols/vegasHit/bg_000.webp";
const BG_FRAME_1_URL = "/symbols/vegasHit/bg_001.webp";
const BG_MUSIC_URL = "/Sound/kulakovka-casino-291450.mp3";
const WIN_HIGHLIGHT_MIN_DISPLAY_MS = 2000;
const AUTOPLAY_GAP_MS = 700;
const FREE_SPIN_GAP_MS = 700;
/** "trigger 7 Free Games ... up to a maximum of 700 Free Games" — enforced client-side since
 * the server is stateless per spin and doesn't track how many free spins a chain has already
 * awarded (mirrors the backend's own MAX_TOTAL_FREE_SPINS — see games/VegasHits/config.ts). */
const MAX_TOTAL_FREE_SPINS = 700;
/** Testing aid — true shows the Big Win banner on EVERY winning spin (any amount > 0), so the
 * banner can be checked without waiting for a real big win. false = only real big wins. */
const SHOW_EVERY_WIN_AS_BIG_WIN = false;
/** Testing aid — true lands a BONUS on every reel of every paid spin (3 scatters), so Free Games
 * trigger every time. Never applied to the free spins themselves, so a round still ends.
 * false = normal play. */
const FORCE_FREE_GAMES = false;

/** Full-screen banners, shown one at a time in order (see `banners` state). */
type Banner = { kind: "bigWin"; winAmount: number } | { kind: "freeSpins"; freeSpins: number };

export function VegasHitsGame() {
  const { user, setBalance } = useAuth();
  // Latest balance — runSpin reads it at spin start instead of a possibly stale closure.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<VegasHitsScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<VegasHitsConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>([0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10]);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [turbo, setTurbo] = useState(false);
  /** Queue of full-screen banners — the first one is showing; dismissing it shows the next. A
   * spin can queue both (Big Win first, then the Free Spins award). Every celebration tier
   * (BIG / MEGA / JACKPOT) shows the same Big Win banner. Free spins wait while any banner is up. */
  const [banners, setBanners] = useState<Banner[]>([]);
  const dismissBanner = useCallback(() => setBanners((q) => q.slice(1)), []);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);
  const winHighlightActiveRef = useRef(false);
  const winHighlightStartRef = useRef(0);

  const handleLoadingDone = useCallback(() => {
    setShowLoadingScreen(false);
    sound.startStreamingMusic(BG_MUSIC_URL);
  }, []);

  const [freeGames, setFreeGames] = useState<{
    remaining: number;
    total: number;
    lastChiliMultiplier: number | null;
    totalWin: number;
    lockedBetIndex: number;
  } | null>(null);

  const betLevel = betLevels[betIndex] ?? betLevels[0];
  const totalBet = betLevel;
  const inFreeGames = freeGames !== null;

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncVegasHitsRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getVegasHitsConfig()
      .then((c) => {
        setConfig(c);
        setBetLevels(c.betLevels);
      })
      .catch(() => {
        /* fall back to defaults already set */
      });
  }, [rtpReady]);

  // Waits for config (the reel needs its symbolWeights before it can build its cosmetic filler
  // — see pixi/Reel.ts) before creating the Pixi app/scene.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        // Only the reel area (see VIEW_* in VegasHitsScene) — the rest of the screen is DOM.
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        ...gameRendererOptions(),
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
        app.ticker.maxFPS = IDLE_MAX_FPS;
        // Pin the cropped canvas over the reel area of the full-size host.
        Object.assign(app.canvas.style, { position: "absolute", left: `${VIEW_LEFT}px`, top: `${VIEW_TOP}px` });
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await VegasHitsScene.create(app, config.symbolWeights);
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
        console.error("Vegas Hits: failed to initialize", err);
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
  }, [config, initRetryKey]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  // Keep the canvas's backing resolution matched to its on-screen size: it's 1920x1080 in design
  // space but CSS-scaled by fitScale, so on most screens a full-size backing buffer is mostly
  // pixels the browser throws away. Debounced so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = fitResolution(fitScale);
      if (Math.abs(app.renderer.resolution - resolution) > 0.05) {
        app.renderer.resize(VIEW_WIDTH, VIEW_HEIGHT, resolution);
      }
    }, 150);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  /** Classic auto-stop spin: the server decides the whole grid + result in one call, the reels
   * play a fixed-duration landing animation on it (see pixi/VegasHitsScene.spin), same shape as
   * 7 Crystal Clover's runSpin. `isFreeSpin` plays one spin of an already-active Free Games
   * round (no balance staked, at the round's locked bet) instead of a normal paid spin. */
  const runSpin = useCallback(
    async (isFreeSpin: boolean) => {
      sound.resumeAudio();
      if (!sceneRef.current || spinning) return;
      if (!isFreeSpin && (!user || user.balance < totalBet)) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }

      setError(null);
      setSpinning(true);

      // The bet leaves the balance the moment the spin starts (free spins cost nothing); the win
      // is added back once the reels land (result.balance = balanceBefore - bet + win).
      const spinBetLevel = isFreeSpin ? betLevels[freeGames?.lockedBetIndex ?? betIndex] : betLevel;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!isFreeSpin) setBalance(Math.round((balanceBefore - spinBetLevel) * 100) / 100);

      // A previous spin's win highlight must stay visible for at least
      // WIN_HIGHLIGHT_MIN_DISPLAY_MS before this new spin clears it, even if the player hits
      // SPIN again immediately.
      if (winHighlightActiveRef.current) {
        const remaining = WIN_HIGHLIGHT_MIN_DISPLAY_MS - (Date.now() - winHighlightStartRef.current);
        if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
        winHighlightActiveRef.current = false;
      }
      if (!sceneRef.current) {
        if (!isFreeSpin) setBalance(balanceBefore);
        setSpinning(false);
        return;
      }
      // The last win stays in the WIN box until the new spin's reels actually start.
      setWinAmount(0);
      if (appRef.current) appRef.current.ticker.maxFPS = 60;

      try {
        const result = await spinRequest(spinBetLevel, isFreeSpin, balanceBefore, FORCE_FREE_GAMES && !isFreeSpin);
        spinResolved = true;
        sound.startReelSpinLoop();
        await sceneRef.current.spin(result.grid, sound.reelStopSounds(3), turbo);
        sound.stopReelSpinLoop();

        setWinAmount(result.winAmount);
        setBalance(result.balance);

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding.
        logSpinResult({
          betAmount: isFreeSpin ? 0 : spinBetLevel,
          winAmount: result.winAmount,
          reelSymbols: result.grid,
          balanceAfter: result.balance,
          tier: result.tier,
        }).catch(() => { });

        if (result.evaluation.winningPositions.length > 0) {
          sceneRef.current.showWinHighlights(result.evaluation.winningPositions);
          winHighlightActiveRef.current = true;
          winHighlightStartRef.current = Date.now();
        }

        const celebrationTier = result.tier ?? (SHOW_EVERY_WIN_AS_BIG_WIN && result.winAmount > 0 ? "BIG WIN" : null);
        if (celebrationTier) {
          sound.playCelebration(celebrationTier);
          setBanners((q) => [...q, { kind: "bigWin", winAmount: result.winAmount }]);
        } else if (result.winAmount > 0) {
          sound.playWinChime();
        }

        // Free spins actually granted — a retrigger is capped so the round never exceeds
        // MAX_TOTAL_FREE_SPINS in total (see the setFreeGames updater below).
        const award = result.freeGamesAward;
        const granted = award ? (isFreeSpin ? Math.max(0, Math.min(award.freeSpins, MAX_TOTAL_FREE_SPINS - (freeGames?.total ?? 0))) : award.freeSpins) : 0;
        if (granted > 0) setBanners((q) => [...q, { kind: "freeSpins", freeSpins: granted }]);

        if (isFreeSpin) {
          setFreeGames((prev) => {
            if (!prev) return prev;
            const totalWin = prev.totalWin + result.winAmount;
            if (result.freeGamesAward) {
              const grantable = Math.max(0, Math.min(result.freeGamesAward.freeSpins, MAX_TOTAL_FREE_SPINS - prev.total));
              return {
                ...prev,
                remaining: prev.remaining - 1 + grantable,
                total: prev.total + grantable,
                lastChiliMultiplier: result.evaluation.chiliMultiplier,
                totalWin,
              };
            }
            return { ...prev, remaining: prev.remaining - 1, lastChiliMultiplier: result.evaluation.chiliMultiplier, totalWin };
          });
        } else if (result.freeGamesAward) {
          setFreeGames({
            remaining: result.freeGamesAward.freeSpins,
            total: result.freeGamesAward.freeSpins,
            lastChiliMultiplier: null,
            totalWin: 0,
            lockedBetIndex: betIndex,
          });
        }
      } catch (err) {
        sound.stopReelSpinLoop();
        const message = err instanceof Error ? err.message : "Spin failed";
        setError(message);
        setAutoplay(false);
        // The spin request itself failed — give the bet back.
        if (!spinResolved && !isFreeSpin) setBalance(balanceBefore);
        if (isFreeSpin) setFreeGames(null);
      } finally {
        setSpinning(false);
        if (appRef.current) appRef.current.ticker.maxFPS = IDLE_MAX_FPS;
      }
    },
    [betIndex, betLevel, betLevels, freeGames, spinning, totalBet, turbo, user, setBalance]
  );

  // Autoplay — repeats a normal paid spin on a short delay, same pattern as 7 Crystal Clover.
  // Never fires while a Free Games round is active (that round drives its own spins below).
  useEffect(() => {
    if (!autoplay || spinning || !ready || inFreeGames || banners.length > 0) return;
    // Let a win stay on screen (highlight + WIN box) for its full minimum time before the next
    // autoplay spin clears it.
    const highlightLeft = winHighlightActiveRef.current
      ? WIN_HIGHLIGHT_MIN_DISPLAY_MS - (Date.now() - winHighlightStartRef.current)
      : 0;
    const id = window.setTimeout(() => runSpin(false), Math.max(AUTOPLAY_GAP_MS, highlightLeft));
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, inFreeGames, banners.length, runSpin]);

  // Auto-continues the Free Games round until it runs out.
  useEffect(() => {
    if (!freeGames || spinning || !ready || banners.length > 0 || showPaytable) return;
    if (freeGames.remaining <= 0) {
      // Round over — show its total in the Big Win banner.
      if (freeGames.totalWin > 0) setBanners((q) => [...q, { kind: "bigWin", winAmount: freeGames.totalWin }]);
      setFreeGames(null);
      return;
    }
    const id = window.setTimeout(() => runSpin(true), FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeGames, spinning, ready, banners.length, showPaytable, runSpin]);

  const changeBet = (direction: 1 | -1) => {
    if (inFreeGames) return;
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
          <GameJackpotBar gameId="vegas-hits" />

          {/* Animated cabinet background — isolated in CabinetBackground so frame ticks don't re-render the game */}
          <CabinetBackground />

          <div className="absolute top-0 z-10 w-full flex items-center justify-between px-14 py-1">
            <Link
              to={GAME_EXIT_PATH}
              className="flex bg-white h-[88px] w-[100px] items-center justify-center rounded-xl border-4 border-black text-black font-bold hover:bg-white"
              aria-label="Home"
            >
              <HomeIcon size={46} />
            </Link>
            {inFreeGames && (
              <div className="flex items-center gap-4 rounded-full bg-black/80 border-2 border-red-500 px-6 py-2 text-red-300 font-black text-2xl tracking-wide">
                <span>FREE GAMES</span>
                <span className="text-white">{freeGames!.remaining} left (of {freeGames!.total})</span>
                {freeGames!.lastChiliMultiplier !== null && <span className="text-orange-400">🌶 x{freeGames!.lastChiliMultiplier}</span>}
                <span>Win: {freeGames!.totalWin.toFixed(2)}</span>
              </div>
            )}
          </div>

          {showPaytable && config && <InfoScreen config={config} onClose={() => setShowPaytable(false)} />}

          <div className="relative mt-1 overflow-hidden rounded-lg">
            <div ref={canvasHostRef} className="relative mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-red-300/70">Loading reels...</div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
              {error}
            </div>
          )}

          <div className="absolute bottom-0 z-10 w-full">
            {/* placeholder of the bar's exact size while its chunk loads, so the layout doesn't jump */}
            <Suspense fallback={<div className="aspect-[1878/180] w-full bg-[#410117]" />}>
              <GameController3rd
                betAmount={totalBet}
                credit={user?.balance ?? 0}
                onBetDecrease={() => changeBet(-1)}
                onBetIncrease={() => changeBet(1)}
                betDecreaseDisabled={betIndex === 0 || inFreeGames}
                betIncreaseDisabled={betIndex === betLevels.length - 1 || inFreeGames}
                turbo={turbo}
                onToggleTurbo={() => setTurbo((v) => !v)}
                win={winAmount}
                spinning={spinning}
                spinDisabled={!ready || spinning || inFreeGames}
                onSpin={() => runSpin(false)}
                auto={autoplay}
                autoDisabled={inFreeGames}
                onToggleAuto={() => {
                  if (inFreeGames) return;
                  sound.resumeAudio();
                  setAutoplay((v) => !v);
                }}
                onInfo={() => setShowPaytable((v) => !v)}
                muted={muted}
                onToggleMute={() => {
                  sound.resumeAudio();
                  setMuted(sound.toggleMuted());
                }}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {/* `key` gives each queued banner a fresh mount, so its zoom-in and count-up replay. */}
      {banners[0]?.kind === "bigWin" && <BigWinBanner key={banners.length} winAmount={banners[0].winAmount} onDismiss={dismissBanner} />}
      {banners[0]?.kind === "freeSpins" && <FreeSpinsBanner key={banners.length} freeSpins={banners[0].freeSpins} onDismiss={dismissBanner} />}

      {showLoadingScreen && (
        <LoadingScreen
          title="Vegas Hits"
          ready={ready && rtpReady}
          error={initError}
          onRetry={retryInit}
          onDone={handleLoadingDone}
        />
      )}
    </>
  );
}

/** The cabinet's 2-frame flicker: ONE <img> whose src swaps between the frames, instead of two
 * stacked full-size layers (the hidden one still held its decoded pixels on the GPU). Both frames
 * are decoded up front so a swap never flashes. */
const CabinetBackground = memo(function CabinetBackground() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const preload = [BG_FRAME_0_URL, BG_FRAME_1_URL].map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => {});
    });
    // `cancelled` matters: the preload finishes after an unmount (React Strict Mode mounts twice in
    // dev), and a timer started then would never be cleared — two timers flipping the frame
    // every 500ms cancel each other out and the background looks frozen.
    let cancelled = false;
    let timer = 0;
    void Promise.all(preload).then(() => {
      if (cancelled) return;
      timer = window.setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 500);
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <img
      src={frame === 0 ? BG_FRAME_0_URL : BG_FRAME_1_URL}
      alt=""
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
    />
  );
});

const SYMBOL_IMAGES: Record<string, string> = {
  GREEN_7: "/symbols/vegasHit/Green7.webp",
  DOUBLE_GREEN_7: "/symbols/vegasHit/DoubleGreen7.webp",
  TRIPLE_GREEN_7: "/symbols/vegasHit/TripleGreen7.webp",
  RED_7: "/symbols/vegasHit/Red7.webp",
  BLUE_7: "/symbols/vegasHit/Blue7.webp",
  WILD: "/symbols/vegasHit/redHot.webp",
  BONUS: "/symbols/vegasHit/Bonus.webp",
};

// ------------------------------------------------------------------------------------------
// Rules / info screen — same stepped layout as Sizzling 7s' InfoScreen
// ------------------------------------------------------------------------------------------

const SYMBOL_NAMES: Record<string, string> = {
  TRIPLE_GREEN_7: "Triple Green 7",
  DOUBLE_GREEN_7: "Double Green 7",
  GREEN_7: "Green 7",
  BLUE_7: "Blue 7",
  RED_7: "Red 7",
  WILD: "Red Hot 3X Wild",
  BONUS: "Bonus",
};

const LINE_SYMBOLS = ["TRIPLE_GREEN_7", "DOUBLE_GREEN_7", "GREEN_7", "BLUE_7", "RED_7"] as const;

const GOLD_TEXT: CSSProperties = {
  background: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/** A bet multiple for display as "x4" — rounded to a whole number, except values under 1 keep
 * up to 2 decimals ("x0.47") so they never show as x0. */
function fmtX(n: number): string {
  return `x${n >= 1 ? Math.round(n) : Math.round(n * 100) / 100}`;
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

function InfoScreen({ config, onClose }: { config: VegasHitsConfigResponse; onClose: () => void }) {
  const [step, setStep] = useState(0);
  /** Paytable figures are calibrated relative to LINE_COST, not the player's bet:
   * finalWin = payout x (bet / lineCost). This turns one into "times your total bet". */
  const asX = (payout: number) => payout / config.lineCost;
  const payoutOf = (symbol: string) => config.paytable.find((r) => r.symbol === symbol)?.payout ?? 0;
  const rules = config.wild.rules;
  const scatterX = config.bonus.scatterPayoutMultipleOfBet;

  const symbolCard = (symbol: string, x: number, label = SYMBOL_NAMES[symbol], images: string[] = [symbol, symbol, symbol]) => (
    <div
      key={label}
      className="relative flex flex-col items-center rounded-2xl border border-amber-300/25 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-4 pb-4 pt-3"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 8px 18px rgba(0,0,0,.35)" }}
    >
      <div className="flex items-center">
        {images.map((img, i) => (
          <img key={i} src={SYMBOL_IMAGES[img]} alt={i === 0 ? label : ""} className="-mx-1 h-[96px] w-[96px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
        ))}
      </div>
      <div className="mt-2 text-[24px] font-bold text-white">{label}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-[30px] font-black" style={GOLD_TEXT}>
          {fmtX(x)}
        </span>
      </div>
    </div>
  );

  const steps: { tab: string; title: string; body: ReactNode }[] = [
    {
      tab: "Symbols",
      title: "SYMBOL PAYOUTS",
      body: (
        <>
          <p className="mb-6 text-center text-[22px] text-white/80">
            Land <b className="text-amber-300">3 matching symbols</b> on a payline to win. Each pays the multiplier shown
            <b className="text-amber-300"> × your bet</b>, per winning line.
          </p>
          <div className="grid grid-cols-3 gap-5">
            {LINE_SYMBOLS.map((symbol) => symbolCard(symbol, asX(payoutOf(symbol))))}
            {symbolCard("RED_7", asX(rules.anyMixBet), "Any 7 mix", ["RED_7", "BLUE_7", "GREEN_7"])}
          </div>
        </>
      ),
    },
    {
      tab: "Wild & Bonus",
      title: "WILD & BONUS SYMBOLS",
      body: (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-8 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-red-500/10 px-8 py-6">
            <img src={SYMBOL_IMAGES.WILD} alt="Red Hot 3X Wild" className="h-[150px] w-[150px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="text-[22px] leading-[32px] text-white/85">
              <div className="mb-1 text-[32px] font-black" style={GOLD_TEXT}>
                RED HOT 3X WILD
              </div>
              Substitutes for every symbol except BONUS, and multiplies the win it completes:{" "}
              <b className="text-lime-300">
                1 Wild x{rules.oneCompleteMultiplier} · 2 Wilds x{rules.twoCompleteMultiplier}
              </b>
              .
              <br />
              Wilds also pay <b className="text-amber-300">anywhere on screen</b>: 1 Wild{" "}
              <b className="text-lime-300">{fmtX(asX(rules.onePureBet))}</b> · 2 Wilds <b className="text-lime-300">{fmtX(asX(rules.twoPureBet))}</b> · 3+
              Wilds <b className="text-lime-300">{fmtX(asX(rules.threePureBet))}</b> — on top of any line win they complete.
            </div>
          </div>
          <div className="flex items-center gap-8 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-red-500/10 px-8 py-6">
            <img src={SYMBOL_IMAGES.BONUS} alt="Bonus" className="h-[150px] w-[150px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="text-[22px] leading-[32px] text-white/85">
              <div className="mb-1 text-[32px] font-black" style={GOLD_TEXT}>
                BONUS
              </div>
              A scatter — it pays <b className="text-amber-300">anywhere</b> on the reels, no payline needed. Wild never replaces it.
              <br />
              <b className="text-amber-300">{config.bonus.triggerCount} or more BONUS</b> pay{" "}
              <b className="text-lime-300">
                {fmtX(scatterX)}
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
        <div className="flex items-start gap-10">
          <div className="grid flex-none grid-cols-3 gap-x-3 gap-y-2">
            {config.paylines.map((line, i) => (
              <PaylineDiagram key={i} line={line} number={i + 1} />
            ))}
          </div>
          <ul className="list-disc space-y-3 pl-6 text-[22px] leading-[30px] text-white/85">
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
          <div className="mb-6 flex items-center gap-2 rounded-2xl border-2 border-amber-300/60 bg-amber-400/15 px-6 py-3 shadow-[0_0_24px_rgba(251,191,36,.35)]">
            {[0, 1, 2].map((i) => (
              <img key={i} src={SYMBOL_IMAGES.BONUS} alt={i === 0 ? "Bonus" : ""} className="h-[100px] w-[100px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            ))}
            <span className="ml-4 text-[40px] font-black" style={GOLD_TEXT}>
              = {config.freeGames.spinsPerTrigger} FREE GAMES
            </span>
          </div>
          <div className="mb-6 grid w-full max-w-[1100px] grid-cols-6 gap-4">
            {config.freeGames.chiliMultiplierPool.map((m) => (
              <div key={m} className="rounded-2xl border border-amber-300/25 bg-white/[0.06] px-3 py-4 text-center">
                <div className="text-[34px] font-black" style={GOLD_TEXT}>
                  x{m}
                </div>
                <div className="text-[16px] font-bold tracking-widest text-white/70">CHILI</div>
              </div>
            ))}
          </div>
          <ul className="max-w-[1100px] list-disc space-y-3 pl-6 text-[22px] leading-[30px] text-white/85">
            <li>
              {config.bonus.triggerCount}+ BONUS anywhere award <b className="text-amber-300">{config.freeGames.spinsPerTrigger} free games</b>.
            </li>
            <li>
              Free games play automatically at the <b className="text-amber-300">same bet</b> that triggered them and cost nothing.
            </li>
            <li>
              Every free game draws a <b className="text-amber-300">fresh Chili Multiplier</b> from the list above and multiplies that game's
              win — except a win that used a Red Hot 3X Wild.
            </li>
            <li>
              {config.bonus.triggerCount}+ BONUS during free games add {config.freeGames.spinsPerTrigger} more, up to{" "}
              <b className="text-lime-300">{config.freeGames.maxTotalFreeSpins}</b> in total.
            </li>
          </ul>
        </div>
      ),
    },
  ];

  const go = useCallback((delta: number) => setStep((p) => Math.min(Math.max(p + delta, 0), steps.length - 1)), [steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="absolute inset-0 z-40 bg-black/60" onClick={onClose}>
      <style>{`
        @keyframes vh-pop { from { opacity: 0; transform: translate(-50%, -48%) scale(.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        .vh-info-panel { animation: vh-pop .18s ease-out both; }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Game rules"
        onClick={(e) => e.stopPropagation()}
        className="vh-info-panel absolute left-1/2 top-1/2 flex h-[900px] w-[1400px] flex-col rounded-[28px] border-[3px] border-amber-300/70 px-12 pb-8 pt-7 text-white"
        style={{
          background: "radial-gradient(ellipse at 50% 0%, #8a1c1c 0%, #4a0b0b 55%, #1f0505 100%)",
          boxShadow: "0 0 0 6px rgba(35,8,8,.9), 0 0 60px rgba(251,191,36,.25), 0 30px 80px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.2)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-6 top-6 flex h-[56px] w-[56px] items-center justify-center rounded-full border-2 border-amber-300/60 bg-black/40 text-[36px] leading-none text-amber-200 hover:bg-black/60 hover:text-white"
        >
          ×
        </button>

        {/* Stepper */}
        <div className="mx-auto flex items-center">
          {steps.map((s, i) => (
            <div key={s.tab} className="flex items-center">
              {i > 0 && <div className={`mx-3 h-[3px] w-[70px] rounded-full ${i <= step ? "bg-amber-300" : "bg-white/15"}`} />}
              <button onClick={() => setStep(i)} className="flex items-center gap-3" aria-current={i === step ? "step" : undefined}>
                <span
                  className={`flex h-[44px] w-[44px] items-center justify-center rounded-full text-[20px] font-black transition-colors ${i === step
                      ? "bg-gradient-to-b from-yellow-200 to-amber-500 text-black shadow-[0_0_16px_rgba(251,191,36,.7)]"
                      : i < step
                        ? "bg-amber-500/40 text-amber-100"
                        : "bg-white/10 text-white/60"
                    }`}
                >
                  {i + 1}
                </span>
                <span className={`text-[20px] font-bold uppercase tracking-wider ${i === step ? "text-amber-200" : "text-white/50"}`}>{s.tab}</span>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center text-[40px] font-black tracking-wide" style={GOLD_TEXT}>
          {current.title}
        </div>
        <div className="mx-auto mb-5 mt-2 h-[2px] w-[420px] bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />

        <div className="min-h-0 flex-1 overflow-y-auto pr-2">{current.body}</div>

        {/* Footer nav */}
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => go(-1)}
            disabled={step === 0}
            className="rounded-full border-2 border-amber-300/60 bg-black/30 px-8 py-3 text-[22px] font-bold text-amber-100 hover:bg-black/50 disabled:invisible"
          >
            ‹ Back
          </button>
          <span className="text-[18px] tracking-widest text-white/50">
            STEP {step + 1} / {steps.length}
          </span>
          <button
            onClick={() => (isLast ? onClose() : go(1))}
            className="rounded-full bg-gradient-to-b from-yellow-300 via-amber-500 to-orange-600 px-10 py-3 text-[22px] font-black text-white shadow-[0_4px_0_#7c2d12,0_8px_14px_rgba(0,0,0,.5)] active:translate-y-[3px] active:shadow-[0_1px_0_#7c2d12]"
            style={{ textShadow: "0 2px 0 #9a3412" }}
          >
            {isLast ? "Got it!" : "Next ›"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

