import { useEffect, useRef, useState, useCallback, ReactNode, CSSProperties } from "react";
import { GameInfoPopup, InfoTheme } from "../shared/GameInfoPopup";
import { Application } from "pixi.js";
import { gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { VegasHitsScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/VegasHitsScene";
import { getVegasHitsConfig, spinRequest, logSpinResult, VegasHitsConfigResponse } from "./api";
import { BigWinBanner, FreeSpinsBanner } from "./BigWinBanner";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const BG_FRAMES = ["/symbols/vegasHit/bg/bg_000.webp", "/symbols/vegasHit/bg/bg_001.webp"];
const BG_FRAME_MS = 1000;
const BG_MUSIC_URL = "/Sound/kulakovka-casino-291450.mp3";
const WIN_HIGHLIGHT_MIN_DISPLAY_MS = 2000;
const AUTOPLAY_GAP_MS = 700;
const FREE_SPIN_GAP_MS = 700;
/** "trigger 7 Free Games ... up to a maximum of 700 Free Games" — enforced client-side since
 * the server is stateless per spin and doesn't track how many free spins a chain has already
 * awarded (mirrors the backend's own MAX_TOTAL_FREE_SPINS — see games/VegasHits/config.ts). */
const MAX_TOTAL_FREE_SPINS = 700;
/** Testing aid — true lands a BONUS on every reel of every paid spin (3 scatters), so Free Games
 * trigger every time. Never applied to the free spins themselves, so a round still ends.
 * false = normal play. */
const FORCE_FREE_GAMES = false;

/** Full-screen banners, shown one at a time in order (see `banners` state). "bigWin" is only the
 * Free Games round-total summary — there's no Big/Mega/Jackpot celebration on regular wins. */
type Banner = { kind: "bigWin"; winAmount: number } | { kind: "freeSpins"; freeSpins: number };

export function VegasHitsGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<VegasHitsScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<VegasHitsConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>([0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30]);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [turbo, setTurbo] = useState(false);
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
  /** Running total of the current free-games round — shown in the WIN box during the round and
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
  const winHighlightActiveRef = useRef(false);
  const winHighlightStartRef = useRef(0);

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

  const [bgFrame, setBgFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setBgFrame((f) => (f + 1) % BG_FRAMES.length), BG_FRAME_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    getVegasHitsConfig()
      .then((c) => {
        setConfig(c);
        setBetLevels(c.betLevels);
      })
      .catch(() => {
        /* fall back to defaults already set */
      });
  }, []);

  // Waits for config (the reel needs its symbolWeights before it can build its cosmetic filler
  // — see pixi/Reel.ts) before creating the Pixi app/scene.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        ...gameRendererOptions(),
        autoDensity: true,
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

  /** Classic auto-stop spin: the server decides the whole grid + result in one call, the reels
   * play a fixed-duration landing animation on it (see pixi/VegasHitsScene.spin), same shape as
   * 7 Crystal Clover's runSpin. `isFreeSpin` plays one spin of an already-active Free Games
   * round (no balance staked, at the round's locked bet) instead of a normal paid spin. */
  const runSpin = useCallback(
    async (isFreeSpin: boolean, guaranteeShortfall = 0) => {
      sound.resumeAudio();
      if (!sceneRef.current || spinning || spinLockRef.current) return;
      if (!isFreeSpin && (!user || user.balance < totalBet)) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }

      setError(null);
      setSpinning(true);
      // The bet leaves the balance the moment SPIN is pressed (free spins cost nothing); a win is
      // added back once the reels land (result.balance = balanceBefore - bet + win).
      spinLockRef.current = true;
      const spinBetLevel = isFreeSpin ? betLevels[freeGames?.lockedBetIndex ?? betIndex] : betLevel;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!isFreeSpin) setBalance(Math.round((balanceBefore - spinBetLevel) * 100) / 100);
      setWinAmount(isFreeSpin ? roundWinRef.current : 0);

      // A previous spin's win highlight must stay visible for at least
      // WIN_HIGHLIGHT_MIN_DISPLAY_MS before this new spin clears it, even if the player hits
      // SPIN again immediately.
      if (winHighlightActiveRef.current) {
        const remaining = WIN_HIGHLIGHT_MIN_DISPLAY_MS - (Date.now() - winHighlightStartRef.current);
        if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
        winHighlightActiveRef.current = false;
      }
      if (!sceneRef.current) {
        spinLockRef.current = false;
        if (!isFreeSpin) setBalance(balanceBefore);
        return;
      }

      try {
        const result = await spinRequest(spinBetLevel, isFreeSpin, balanceBefore, FORCE_FREE_GAMES && !isFreeSpin, guaranteeShortfall);
        spinResolved = true;
        sound.startReelSpinLoop();
        await sceneRef.current.spin(result.grid, () => sound.playReelStop(), turbo);
        sound.stopReelSpinLoop();

        let balanceAfter = result.balance;
        if (isFreeSpin) {
          // Free-game wins pile up in the WIN box; the balance is only credited when the round's
          // Big Win banner is tapped away (see collectRoundWin).
          roundWinRef.current = Math.round((roundWinRef.current + result.winAmount) * 100) / 100;
          setWinAmount(roundWinRef.current);
          balanceAfter = Math.round((balanceRef.current + roundWinRef.current) * 100) / 100;
        } else {
          setWinAmount(result.winAmount);
          // A spin that starts a free-spin round holds its own win too — it's credited with the
          // round's total when the round's result is tapped away.
          if (!(result.freeGamesAward)) setBalance(result.balance);
        }

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding.
        logSpinResult({
          betAmount: isFreeSpin ? 0 : spinBetLevel,
          winAmount: result.winAmount,
          reelSymbols: result.grid,
          balanceAfter,
        }).catch(() => {});

        if (result.evaluation.winningPositions.length > 0) {
          sceneRef.current.showWinHighlights(result.evaluation.winningPositions);
          winHighlightActiveRef.current = true;
          winHighlightStartRef.current = Date.now();
        }

        if (result.winAmount > 0) sound.playWinChime();

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
          // The round's total starts from the triggering spin's own (held) win.
          roundWinRef.current = result.winAmount;
          triggerWinRef.current = result.winAmount;
          setFreeGames({
            remaining: result.freeGamesAward.freeSpins,
            total: result.freeGamesAward.freeSpins,
            lastChiliMultiplier: null,
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
        setAutoplay(false);
        if (isFreeSpin) {
          // The round can't continue — still show (and credit) what it had won so far.
          setFreeGames(null);
          setBanners((q) => [...q, { kind: "bigWin", winAmount: roundWinRef.current }]);
        }
      } finally {
        spinLockRef.current = false;
        setSpinning(false);
      }
    },
    [betIndex, betLevel, betLevels, freeGames, spinning, totalBet, turbo, user, setBalance]
  );

  // Autoplay — repeats a normal paid spin on a short delay, same pattern as 7 Crystal Clover.
  // Never fires while a Free Games round is active (that round drives its own spins below).
  useEffect(() => {
    if (!autoplay || spinning || !ready || inFreeGames || banners.length > 0) return;
    const id = window.setTimeout(() => runSpin(false), AUTOPLAY_GAP_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, inFreeGames, banners.length, runSpin]);

  // Auto-continues the Free Games round until it runs out.
  useEffect(() => {
    if (!freeGames || spinning || !ready || banners.length > 0 || showPaytable) return;
    if (freeGames.remaining <= 0) {
      // Round over — show its total in the Big Win banner; tapping it away credits the balance.
      setBanners((q) => [...q, { kind: "bigWin", winAmount: roundWinRef.current }]);
      setFreeGames(null);
      // Autoplay stops once a bonus round ends — the player resumes with SPIN or AUTO.
      setAutoplay(false);
      return;
    }
    // Last spin of the round and it's still under the 1x minimum → this spin lands a real line that covers it.
    const lockedBet = betLevels[freeGames.lockedBetIndex] ?? betLevel;
    const shortfall = freeGames.remaining === 1 ? Math.max(0, Math.round((lockedBet - (roundWinRef.current - triggerWinRef.current)) * 100) / 100) : 0;
    const id = window.setTimeout(() => runSpin(true, shortfall), FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeGames, spinning, ready, banners.length, showPaytable, runSpin, betLevels, betLevel]);

  /** The round's Big Win banner was tapped away — only now is its total added to the balance. */
  const collectRoundWin = useCallback(() => {
    const total = roundWinRef.current;
    roundWinRef.current = 0;
    if (total > 0) setBalance(Math.round((balanceRef.current + total) * 100) / 100);
    dismissBanner();
  }, [dismissBanner, setBalance]);

  const freeSpinsBannerUp = banners[0]?.kind === "freeSpins";

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

          {BG_FRAMES.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, visibility: i === bgFrame ? "visible" : "hidden" }}
            />
          ))}

          <div className="absolute top-0 z-10 w-full flex items-center justify-between px-14 py-8">
            <GameHomeButton size={88} />
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
            <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-red-300/70">Loading reels...</div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
              {error}
            </div>
          )}

          {/* `key` gives each queued banner a fresh mount, so its zoom-in and count-up replay. */}
          {banners[0]?.kind === "bigWin" && (
            <BigWinBanner key={banners.length} winAmount={banners[0].winAmount} onDismiss={collectRoundWin} contained />
          )}
          {banners[0]?.kind === "freeSpins" && (
            <FreeSpinsBanner
              key={banners.length}
              freeSpins={banners[0].freeSpins}
              onDismiss={dismissBanner}
              startRequested={bannerStartRequested}
              contained
            />
          )}

          {/* Raised above a Free Spins banner while it's up so SPIN can start the round. */}
          <div
            className={`absolute bottom-0 ${freeSpinsBannerUp ? "z-40" : "z-10"} flex w-full items-center justify-between gap-3 border-t border-white/10 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black px-4 py-5`}
          >
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-3">
                <CtrlButton onClick={() => setShowPaytable((v) => !v)} ariaLabel="Paytable" className="h-[60px] w-[60px]">
                  <InfoIcon />
                </CtrlButton>
                <CtrlButton
                  onClick={() => {
                    sound.resumeAudio();
                    setMuted(sound.toggleMuted());
                  }}
                  active={muted}
                  ariaLabel={muted ? "Unmute" : "Mute"}
                  className="h-[60px] w-[60px]"
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
              <CtrlButton onClick={() => changeBet(-1)} disabled={betIndex === 0 || inFreeGames} ariaLabel="Decrease bet" className="h-[60px] w-[65px]">
                <TriangleIcon direction="left" />
              </CtrlButton>
              <div className="flex flex-col items-center leading-tight">
                <span className="text-md font-bold uppercase tracking-wide text-red-400">Bet</span>
                <span className="text-3xl font-bold text-white">{totalBet.toFixed(2)}</span>
              </div>
              <CtrlButton
                onClick={() => changeBet(1)}
                disabled={betIndex === betLevels.length - 1 || inFreeGames}
                ariaLabel="Increase bet"
                className="h-[60px] w-[65px]"
              >
                <TriangleIcon direction="right" />
              </CtrlButton>
            </div>

            <div className="flex min-w-[220px] flex-1 max-w-sm items-center justify-center gap-2 rounded-lg border border-black bg-black/70 py-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.8)]">
              <span className="text-lg font-bold uppercase tracking-wide text-white">Win</span>
              <span className="text-5xl font-black text-red-400">{winAmount.toFixed(2)}</span>
            </div>

            <div className="flex items-center gap-3">
              <CtrlButton onClick={() => setTurbo((v) => !v)} active={turbo} ariaLabel="Turbo spin" className="h-[80px] w-[85px]">
                <TurboIcon size={46} />
              </CtrlButton>

              <button
                onClick={() => {
                  sound.resumeAudio();
                  setAutoplay((v) => !v);
                }}
                disabled={inFreeGames}
                aria-label="Autoplay"
                className={`relative flex h-[120px] w-[140px] items-center justify-center rounded-2xl text-xl border font-black tracking-wide transition-all duration-150 ease-out active:translate-y-[2px] disabled:opacity-40 disabled:active:translate-y-0 ${
                  autoplay
                    ? "border-red-400 bg-red-500/25 text-red-200 shadow-[0_0_16px_rgba(239,68,68,0.55)]"
                    : "border-white/20 bg-white/[0.06] text-white/80 hover:border-red-300/50 hover:bg-white/[0.1]"
                }`}
              >
                AUTO
              </button>

              <button
                onClick={() => {
                  // A Free Spins banner is up — SPIN starts the round, same as tapping the banner.
                  if (freeSpinsBannerUp) setBannerStartRequested(true);
                  else runSpin(false);
                }}
                disabled={
                  !ready ||
                  spinning ||
                  bannerStartRequested ||
                  (freeSpinsBannerUp ? false : inFreeGames || banners.length > 0)
                }
                className="relative flex h-[145px] w-[200px] items-center justify-center rounded-3xl border-2 border-red-950 bg-gradient-to-b from-orange-400 via-red-500 to-red-700 text-6xl font-black italic tracking-wide text-white transition-transform duration-100 ease-out active:translate-y-[3px] disabled:opacity-50 disabled:active:translate-y-0"
                style={{
                  boxShadow: "0 5px 0 #7f1d1d, 0 9px 14px rgba(0,0,0,0.55), inset 0 2px 2px rgba(255,255,255,0.6), inset 0 -5px 8px rgba(0,0,0,0.3)",
                }}
              >
                <span className="pointer-events-none absolute inset-x-[0] top-0 h-[50%] rounded-full bg-white/40" style={{ filter: "blur(3px)" }} />
                {spinning ? "..." : "SPIN"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showLoadingScreen && (
        <LoadingScreen
          title="Vegas Hits"
          ready={ready}
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

/** Colours for the shared rules popup (see shared/GameInfoPopup). */
const INFO_THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #8a1c1c 0%, #4a0b0b 55%, #1f0505 100%)",
  accent: "#fcd34d",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #fde047 0%, #f59e0b 50%, #ea580c 100%)",
  buttonEdge: "#7c2d12",
};

function InfoScreen({ config, onClose }: { config: VegasHitsConfigResponse; onClose: () => void }) {
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
          <img key={i} src={SYMBOL_IMAGES[img]} alt={i === 0 ? label : ""} className="-mx-1 h-[53px] sm:h-[72px] w-[53px] sm:w-[72px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
        ))}
      </div>
      <div className="mt-2 text-[15px] sm:text-[18px] font-bold text-white">{label}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-[19px] sm:text-[22px] font-black" style={GOLD_TEXT}>
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
          <p className="mb-3 sm:mb-6 text-center text-[14px] sm:text-[16px] text-white/80">
            Land <b className="text-amber-300">3 matching symbols</b> on a payline to win. Each pays the multiplier shown
            <b className="text-amber-300"> × your bet</b>, per winning line.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-5">
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
        <div className="flex flex-col gap-3 sm:gap-6">
          <div className="flex items-center gap-3 sm:gap-8 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-red-500/10 px-3 sm:px-8 py-3 sm:py-6 flex-col sm:flex-row">
            <img src={SYMBOL_IMAGES.WILD} alt="Red Hot 3X Wild" className="h-[82px] sm:h-[112px] w-[82px] sm:w-[112px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="text-[14px] sm:text-[16px] leading-[20px] sm:leading-[24px] text-white/85">
              <div className="mb-1 text-[20px] sm:text-[24px] font-black" style={GOLD_TEXT}>
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
        <div className="flex items-start gap-3 sm:gap-10 flex-col sm:flex-row">
          <div className="grid flex-none grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
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
              = {config.freeGames.spinsPerTrigger} FREE GAMES
            </span>
          </div>
          <div className="mb-3 sm:mb-6 grid w-full max-w-[1100px] grid-cols-3 sm:grid-cols-6 gap-4">
            {config.freeGames.chiliMultiplierPool.map((m) => (
              <div key={m} className="rounded-2xl border border-amber-300/25 bg-white/[0.06] px-3 py-4 text-center">
                <div className="text-[21px] sm:text-[26px] font-black" style={GOLD_TEXT}>
                  x{m}
                </div>
                <div className="text-[12px] sm:text-[12px] font-bold tracking-widest text-white/70">CHILI</div>
              </div>
            ))}
          </div>
          <ul className="max-w-[1100px] list-disc space-y-3 pl-6 text-[14px] sm:text-[16px] leading-[19px] sm:leading-[22px] text-white/85">
            <li>
              {config.bonus.triggerCount}+ BONUS anywhere award <b className="text-amber-300">{config.freeGames.spinsPerTrigger} free games</b>.
            </li>
            <li>
              Tap the screen or SPIN to start — free games then play automatically at the <b className="text-amber-300">same bet</b> that triggered them, cost nothing, and always pay at least 1x that bet in total. The total is added to your balance when you tap it away; auto play stops when the round ends.
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

  return <GameInfoPopup label="Vegas Hits rules" theme={INFO_THEME} steps={steps} onClose={onClose} />;
}


function CtrlButton({
  onClick,
  active = false,
  disabled = false,
  ariaLabel,
  className = "",
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const ledge = active ? "#92400e" : "#0a0a0a";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative flex items-center justify-center rounded-full border-2 bg-gradient-to-b transition-transform duration-100 ease-out hover:brightness-105 active:translate-y-[3px] disabled:opacity-40 disabled:active:translate-y-0 disabled:pointer-events-none ${
        active
          ? "border-amber-800 from-amber-200 via-amber-400 to-amber-600"
          : "border-black/70 from-white via-neutral-100 to-neutral-300"
      } ${className}`}
      style={{
        boxShadow: `0 4px 0 ${ledge}, 0 7px 10px rgba(255, 255, 255, 0.9), inset 0 2px 1px rgba(255,255,255,0.95), inset 0 -4px 5px rgba(0,0,0,0.22)`,
      }}
    >
      <span className="pointer-events-none absolute inset-x-[16%] top-[9%] h-[36%] rounded-full bg-white/55" style={{ filter: "blur(2px)" }} />
      {children}
    </button>
  );
}

function TriangleIcon({ direction }: { direction: "left" | "right" }) {
  const points = direction === "left" ? "15,4 6,12 15,20" : "9,4 18,12 9,20";
  return (
    <svg width="36" height="36" viewBox="0 0 24 24">
      <polygon points={points} fill="black" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.4">
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="11" x2="12" y2="16.5" strokeLinecap="round" />
      <circle cx="12" cy="7.3" r="1.1" fill="black" stroke="none" />
    </svg>
  );
}

function TurboIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="black" stroke="none">
      <polygon points="13,2 3,14 11,14 9,22 21,9 13,9" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinecap="round" strokeLinejoin="round" fill="black" />
      {muted ? (
        <path d="M17 9 22 15M22 9l-5 6" strokeLinecap="round" />
      ) : (
        <>
          <path d="M16 8a5 5 0 0 1 0 8" strokeLinecap="round" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
