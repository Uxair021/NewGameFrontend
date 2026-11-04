import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { Mega10XPayScene, CANVAS_WIDTH, CANVAS_HEIGHT, RENDER_QUALITY } from "./pixi/Mega10XPayScene";
import { getMega10xPayConfig, spinRequest, logSpinResult, Mega10xPayConfigResponse, syncMega10xRtpConfigFromServer } from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import { useBalanceCountUp, useCountUp } from "../shared/useCountUp";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";
import { InfoScreen } from "./InfoScreen";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "../shared/SoundSettings";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
const WIN_GLOW_MIN_DISPLAY_MS = 2000;
/** A win at least this many times the bet gets the coin shower. */
const COIN_SHOWER_MIN_X = 20;
const BG_MUSIC_URL = "/Sound/what-s-next-nick-petrov-main-version-48836-02-22.mp3";
/** Redraw cap while idle (fps) — every animation runs on its own requestAnimationFrame and only
 * *changes* sprites; the ticker does the drawing, so capping it only lowers how often the GPU
 * redraws, never an animation's timing. Lifted to the display's full rate while a spin is in flight. */
const IDLE_MAX_FPS = 30;


export function Mega10XPayGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Mega10XPayScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Mega10xPayConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  /** A win celebration (multiplier stamp / coin shower) is still animating. */
  const [celebrating, setCelebrating] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  // The Sound key opens the shared sound settings popup; its icon shows muted when nothing can be heard.
  const [showSound, setShowSound] = useState(false);
  const muted = isSilent(useSoundSettings());
  const [autoplay, setAutoplay] = useState(false);
  const winGlowActiveRef = useRef(false);
  const winGlowStartRef = useRef(0);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncMega10xRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getMega10xPayConfig()
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
        resolution: fitResolution(fitScaleRef.current) * RENDER_QUALITY,
        autoDensity: true,
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
          const scene = await Mega10XPayScene.create(app);
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
        console.error("Mega 10X Pay: failed to initialize", err);
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

  // Full frame rate while a spin is in flight; back to the idle cap once it settles. 0 = uncapped.
  useEffect(() => {
    const app = appRef.current;
    if (app) app.ticker.maxFPS = spinning || celebrating ? 0 : IDLE_MAX_FPS;
  }, [spinning, celebrating, ready]);

  // Keep the canvas's backing resolution matched to its on-screen size: it's CSS-scaled by
  // fitScale, so a full-size backing buffer is mostly pixels the browser throws away.
  // Debounced so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = fitResolution(fitScale) * RENDER_QUALITY;
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      app.renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT, resolution);
      sceneRef.current?.setBackgroundResolution(resolution);
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  // WIN counts up to a new win, and BALANCE counts up alongside it over the same time — same
  // timing as GameController2 (bigger wins count a little longer). The balance pill pulses
  // while it's counting.
  const balance = user?.balance ?? 0;
  const countMs = Math.min(1800, 500 + winAmount * 60);
  const shownWin = useCountUp(winAmount, countMs);
  const shownBalance = useBalanceCountUp(balance, countMs);
  const balanceCounting = shownBalance < balance;

  // Keeps the scene's own BET/WIN readouts (rendered inside bg.webp's baked-in box, not the
  // HTML control bar) in sync with the latest bet selection and the counting-up win.
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    sceneRef.current.updateReadouts(betAmount, shownWin);
  }, [ready, betAmount, shownWin]);

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

    if (winGlowActiveRef.current) {
      const remaining = WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winGlowStartRef.current);
      if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
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
      await sceneRef.current.spin(result.reels, result.halfStopReels, () => sound.playReelStop());
      sound.stopReelSpinLoop();

      const scene = sceneRef.current;
      if (!scene) return;
      const celebrations: Promise<void>[] = [];
      if (result.winAmount > 0) {
        // Only the symbols that make the win glow (a cherry win doesn't light the BAR beside it).
        scene.setWinGlow(true, result.winningReels);
        winGlowActiveRef.current = true;
        winGlowStartRef.current = Date.now();
        // 10X / 3X multiplied this win: slam the multiplier first, WIN counts up as it lands.
        if (result.wildMultiplier > 1) {
          const stamp = scene.playMultiplierStamp(result.wildMultiplier);
          celebrations.push(stamp.done);
          setCelebrating(true);
          await stamp.landed;
        }
        if (result.winAmount >= betAmount * COIN_SHOWER_MIN_X) {
          celebrations.push(scene.playCoinShower(25 + result.winAmount / betAmount / 2));
          setCelebrating(true);
        }
      }
      if (celebrations.length) void Promise.all(celebrations).then(() => setCelebrating(false));

      setWinAmount(result.winAmount);
      setBalance(result.balance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding.
      logSpinResult({
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: result.reels,
        balanceAfter: result.balance,
      }).catch(() => {});

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

  // Auto-continues spinning while autoplay is on — same "wait a beat after each landing, then
  // fire the next spin" pattern Buffalo 777's autoplay uses. Stops itself on insufficient
  // balance or a spin error (see runSpin's setAutoplay(false) calls above).
  useEffect(() => {
    if (!autoplay || spinning || !ready || showInfo) return;
    const id = window.setTimeout(() => runSpin(), 700);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, showInfo, runSpin]);

  const changeBet = (direction: 1 | -1) => {
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;

  return (
    <>
      <div className="relative overflow-hidden" style={{ width: scaledWidth, height: scaledHeight + 20 * fitScale }}>
        <div
          ref={gameCardRef}
          className="relative flex flex-col overflow-hidden rounded-lg bg-black shadow-2xl"
          style={{
            width: CANVAS_WIDTH,
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="mega-10x-pay" />

          {/* Top bar — back pill + coin balance readout, distinct pill/LCD styling from every
              other game's control bar (per user request for a different controller UI). */}
          <div className="absolute top-0 z-10 flex w-full items-center justify-between px-3 py-2">
            <GameHomeButton size={56} />
            <div className="flex items-center gap-2">
              <Bevel3DButton onClick={() => { sound.resumeAudio(); setShowSound(true); }} active={showSound} ariaLabel="Sound settings" size={36}>
                <SoundIcon muted={muted} />
              </Bevel3DButton>
              <div
                className={`flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1.5 transition-shadow duration-200 ${
                  balanceCounting
                    ? "origin-center animate-gc2-winpop shadow-[0_0_14px_rgba(251,191,36,0.75),0_2px_4px_rgba(0,0,0,0.6)]"
                    : "shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_2px_4px_rgba(0,0,0,0.6)]"
                }`}
              >
                <CoinIcon />
                <span className="min-w-[70px] text-right font-mono text-lg font-bold text-amber-300">
                  {shownBalance.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="relative">
            <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black text-amber-300/70">
                Loading reels...
              </div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 mx-3 rounded bg-red-900/70 px-8 py-4 text-2xl text-center text-red-100">
              {error}
            </div>
          )}

          {/* Bottom controller — [i][BET-][BET+], a gold MEGA10XPAY pill, and a glossy green
              SPIN button. BET/WIN themselves render inside the scene's own baked-in readout
              box above (see Mega10XPayScene.buildReadouts), not here. Every button uses the
              same heavy 3D bevel (Bevel3DButton) per user request. */}
          <div className="absolute bottom-0 z-10 flex w-full items-center gap-2.5 bg-gradient-to-b from-neutral-900 via-neutral-800 to-neutral-950 px-4 py-3" style={{ height: 73 }}>
            <Bevel3DButton onClick={() => setShowInfo(true)} active={showInfo} ariaLabel="Game rules and information" size={52}>
              <span className="text-2xl font-black italic text-neutral-900">i</span>
            </Bevel3DButton>
            <Bevel3DButton onClick={() => changeBet(-1)} disabled={betIndex === 0 || spinning} ariaLabel="Decrease bet" size={52}>
              <span className="flex flex-col items-center leading-[0.85] text-neutral-900">
                <span className="text-[11px] font-black tracking-wide">BET</span>
                <span className="text-xl font-black">−</span>
              </span>
            </Bevel3DButton>
            <Bevel3DButton onClick={() => changeBet(1)} disabled={betIndex === betLevels.length - 1 || spinning} ariaLabel="Increase bet" size={52}>
              <span className="flex flex-col items-center leading-[0.85] text-neutral-900">
                <span className="text-[11px] font-black tracking-wide">BET</span>
                <span className="text-xl font-black">+</span>
              </span>
            </Bevel3DButton>

            <button
              onClick={() => setShowInfo(true)}
              className="flex h-14 flex-1 items-center justify-center rounded-md border-2 border-amber-900/70 bg-gradient-to-b from-amber-100 via-amber-400 to-amber-600 px-6 text-xl font-black italic tracking-wide text-red-900"
              style={{ boxShadow: "inset 0 2px 3px rgba(255,255,255,0.85), inset 0 -3px 6px rgba(120,53,15,0.5), 0 3px 4px rgba(0,0,0,0.5)" }}
            >
              MEGA 10X PAY
            </button>

            <Bevel3DButton
              onClick={() => {
                sound.resumeAudio();
                setAutoplay((v) => !v);
              }}
              active={autoplay}
              ariaLabel="Autoplay"
              size={52}
            >
              <span className="flex flex-col items-center leading-[0.8] text-neutral-900">
                <AutoplayIcon />
                <span className="mt-0.5 text-[9px] font-black tracking-wide">AUTO</span>
              </span>
            </Bevel3DButton>

            <button
              onClick={runSpin}
              disabled={!ready || spinning}
              className="relative flex h-16 w-36 flex-col items-center justify-center rounded-2xl border-2 border-emerald-950 bg-gradient-to-b from-lime-300 via-green-500 to-green-700 font-black leading-tight text-white transition-transform duration-100 ease-out active:translate-y-[3px] disabled:opacity-50 disabled:active:translate-y-0"
              style={{
                boxShadow:
                  "0 5px 0 #052e16, 0 9px 14px rgba(0,0,0,0.55), inset 0 3px 3px rgba(255,255,255,0.75), inset 0 -6px 10px rgba(0,0,0,0.35)",
              }}
            >
              <span className="pointer-events-none absolute inset-x-[14%] top-[8%] h-[28%] rounded-full bg-white/50" style={{ filter: "blur(2px)" }} />
              <span className="text-2xl tracking-wide">{spinning ? "..." : "SPIN"}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-90">Hold for auto spin</span>
            </button>
          </div>
        </div>
      </div>

      {showInfo && config && <InfoScreen bet={betAmount} onClose={() => setShowInfo(false)} />}
      {showSound && <SoundSettingsPopup onClose={() => setShowSound(false)} />}

      {showLoadingScreen && (
        <LoadingScreen
          title="Mega 10X Pay"
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


/** Square chrome/silver button with a heavy 3D bevel — a raised glossy top-left highlight, a
 * dark ledge along the bottom-right, and a soft rounded-square shape — matching the reference
 * screenshot's [i]/[BET-]/[BET+] buttons exactly. Presses collapse the ledge and nudge the
 * button down into it, same "real physical button" illusion every other game's CtrlButton
 * uses, just square instead of round per this game's distinct look. */
function Bevel3DButton({
  onClick,
  disabled = false,
  active = false,
  ariaLabel,
  size = 52,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  ariaLabel: string;
  size?: number;
  children: React.ReactNode;
}) {
  const ledge = active ? "#78350f" : "#0a0a0a";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative flex shrink-0 items-center justify-center rounded-[10px] border transition-transform duration-100 ease-out active:translate-y-[3px] disabled:opacity-40 disabled:active:translate-y-0 ${
        active
          ? "border-amber-800 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600"
          : "border-neutral-950 bg-gradient-to-b from-neutral-200 via-neutral-400 to-neutral-600"
      }`}
      style={{
        width: size,
        height: size,
        boxShadow: `0 4px 0 ${ledge}, 0 7px 9px rgba(0,0,0,0.5), inset 0 2px 2px rgba(255,255,255,0.85), inset 0 -5px 7px rgba(0,0,0,0.35)`,
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-[14%] top-[8%] h-[38%] rounded-[6px] bg-white/60"
        style={{ filter: "blur(1.5px)" }}
      />
      {children}
    </button>
  );
}

function CoinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="#fbbf24" stroke="#92400e" strokeWidth="1.5" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="900" fill="#92400e">
        $
      </text>
    </svg>
  );
}

function AutoplayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
      <path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 6.93 4" strokeLinecap="round" />
      <path d="M20 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-6.93-4" strokeLinecap="round" />
      <path d="M4 21v-5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
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
