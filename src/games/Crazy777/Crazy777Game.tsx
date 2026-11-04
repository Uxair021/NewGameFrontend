import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { Crazy777Scene, CANVAS_WIDTH, CANVAS_HEIGHT, RENDER_QUALITY } from "./pixi/Crazy777Scene";
import { getCrazy777Config, getRespinShortfallX, spinRequest, logSpinResult, Crazy777ConfigResponse, syncCrazy777RtpConfigFromServer } from "./api";
import { RespinIntro, RespinOutro } from "./RespinIntro";
import { InfoScreen } from "./InfoScreen";
import { LoadingScreen } from "../shared/LoadingScreen";
import { SimpleWinPopup } from "./SimpleWinPopup";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
// import SlotControlBar from "../shared/SlotControlBar"; // footer swapped for GameController below
import GameController from "../shared/GameController"; // ported from E:\Office Games\game-controller
import { GameHomeButton } from "../shared/GameHomeButton";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];

const WIN_GLOW_MIN_DISPLAY_MS = 1000;
/** Pixi redraw cap while the reels are idle. Every animation here (reel motion, win-glow
 * pulses, the reel-4 reveal) runs on its own requestAnimationFrame and only *changes* sprites;
 * the ticker does the drawing — so capping it only lowers how often the GPU redraws, never an
 * animation's timing. Lifted to the display's full rate while a spin is in flight. */
const IDLE_MAX_FPS = 30;
const BG_MUSIC_URL = "/Sound/vibehorn-disco-funk-507218.mp3";
// Safety cap for the special-reel bonus reveal (shake ~2s + drop ~0.4s ≈ 2.4s) — if the
// animation ever gets stuck (backgrounded tab throttling rAF, etc.) this guarantees the spin
// flow still continues instead of hanging forever and freezing the SPIN button.
const SPECIAL_REVEAL_TIMEOUT_MS = 3500;
/** Pause between the WIN box finishing its count-up and the win being added to the balance. */
const BALANCE_CREDIT_DELAY_MS = 1200;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => window.setTimeout(resolve, ms))]);
}

export function Crazy777Game() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Crazy777Scene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Crazy777ConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  /** `amount` is this spin's win (the floating popup); `boxAmount` is what the WIN box then shows —
   * the same, except during a respin round, where it's the round's running total. */
  const [simpleWinPopup, setSimpleWinPopup] = useState<{ id: number; amount: number; boxAmount: number } | null>(null);
  /** Everything won since the last paid spin — the paid spin's own win plus every respin win
   * after it — so the WIN box can keep the whole respin round's total. */
  const roundWinRef = useRef(0);
  /** True while the controller's WIN animation (count-up, plus sparkles on a big win) is still
   * playing — together with the popup, this holds SPIN, autoplay and respins. */
  const [controllerWinPending, setControllerWinPending] = useState(false);
  const winAmountRef = useRef(0);
  winAmountRef.current = winAmount;
  /** A plain win's new balance, waiting for its 3-step animation to finish: popup on screen →
   * into the WIN box → (BALANCE_CREDIT_DELAY_MS later) into the balance. */
  const pendingCreditRef = useRef<number | null>(null);
  const [creditPending, setCreditPending] = useState(false);
  const creditTimerRef = useRef<number | null>(null);
  const winAnimating = simpleWinPopup !== null || controllerWinPending || creditPending;
  const simpleWinIdRef = useRef(0);
  const winBoxRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  // Sound on/off — drives GameController's Sound key (starts from the sound engine's saved state).
  const [muted, setMuted] = useState(() => sound.isMuted());
  const [turbo, setTurbo] = useState(false);
  const winGlowActiveRef = useRef(false);
  const winGlowStartRef = useRef(0);

  const [respinsRemaining, setRespinsRemaining] = useState(0);
  const [respinsTotalAwarded, setRespinsTotalAwarded] = useState(0);
  const lockedBetRef = useRef(0);
  const inRespins = respinsRemaining > 0;
  /** Respins awarded, while the "PLAY TO START" banner is up (null = not showing) — the round
   * waits for a tap or SPIN, autoplay included. */
  const [respinIntro, setRespinIntro] = useState<number | null>(null);
  const [respinStartRequested, setRespinStartRequested] = useState(false);
  /** The respins' own winnings this round (the trigger spin's win excluded) — what the round
   * minimum is measured against. */
  const respinWinRef = useRef(0);
  /** True from a respin award until the round's total card is shown. */
  const respinRoundActiveRef = useRef(false);
  /** The finished round's total while its card is up — credited to the balance on tap. */
  const [respinRoundTotal, setRespinRoundTotal] = useState<number | null>(null);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncCrazy777RtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getCrazy777Config()
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
          const scene = await Crazy777Scene.create(app);
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
        console.error("Crazy 777: failed to initialize", err);
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

  // Full frame rate while a spin is in flight (incl. respins and the reel-4 half-stop reveal,
  // which all happen inside `spinning`); back to the idle cap once it settles. 0 = uncapped.
  useEffect(() => {
    const app = appRef.current;
    if (app) app.ticker.maxFPS = spinning ? 0 : IDLE_MAX_FPS;
  }, [spinning, ready]);

  // Keep the canvas's backing resolution matched to its on-screen size: it's 1672x941 in design
  // space but CSS-scaled by fitScale, so on most screens a full-size backing buffer is mostly
  // pixels the browser throws away. Debounced so a window drag doesn't reallocate every frame.
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

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  const runSpin = useCallback(
    async (isRespin: boolean, guaranteeShortfallX = 0) => {
      sound.resumeAudio();
      if (!sceneRef.current || spinning || spinLockRef.current || winAnimating || respinRoundTotal !== null) return;
      const stake = isRespin ? lockedBetRef.current : betAmount;
      if (!isRespin && (!user || user.balance < stake)) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }

      setError(null);
      setSpinning(true);
      if (!isRespin) setWinAmount(0);

      // A new spin clears the previous win glow right away, so a SPIN press never waits.
      // (Autoplay still holds the glow for WIN_GLOW_MIN_DISPLAY_MS — see its effect below.)
      if (winGlowActiveRef.current) {
        sceneRef.current?.setLineWinGlow(false);
        // Reel 4's RESPIN glow is held for the whole respin round (see setRespinMode).
        if (!isRespin) sceneRef.current?.setSpecialGlow(false);
        sceneRef.current?.setPaylineWon(false);
        winGlowActiveRef.current = false;
      }
      if (!sceneRef.current) return;

      // The bet leaves the balance the moment the spin starts (respins cost nothing); a win is
      // added back once the reels land (result.balance = balanceBefore - stake + win).
      spinLockRef.current = true;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!isRespin) setBalance(Math.round((balanceBefore - stake) * 100) / 100);

      try {
        const result = await spinRequest(stake, isRespin, balanceBefore, guaranteeShortfallX);
        spinResolved = true;
        sound.startReelSpinLoop();
        await sceneRef.current.spin(
          result.reels,
          result.specialReel,
          result.emptyReelIndex,
          result.specialIsHalfStop,
          // 3 line reels, plus the special reel on a paid spin (a respin doesn't spin it).
          sound.reelStopSounds(isRespin ? 3 : 4),
          turbo,
          isRespin,
          // Reels 1-3 won → reel 4 spins on a little longer, glowing, for suspense.
          result.baseWin > 0 && !isRespin
        );
        sound.stopReelSpinLoop();

        // A paid spin starts a fresh total; each respin adds to it, so through a respin round the
        // WIN box keeps everything won since the spin that triggered it.
        roundWinRef.current = Math.round(((isRespin ? roundWinRef.current : 0) + result.winAmount) * 100) / 100;
        if (isRespin) respinWinRef.current = Math.round((respinWinRef.current + result.winAmount) * 100) / 100;

        // A respin round's winnings (the triggering spin's own win included) are only credited
        // when its total card is tapped away — until then the balance just shows the bet taken.
        const holdsCredit = isRespin || result.respinsAwarded > 0;
        if (!holdsCredit) {
          if (result.winAmount > 0) {
            // A win reaches the balance last — after its popup has landed in the WIN box and the
            // box has counted up (see creditAfterWinBox).
            pendingCreditRef.current = result.balance;
            setCreditPending(true);
          } else {
            setBalance(result.balance);
          }
        }
        const balanceAfter = holdsCredit ? Math.round((balanceRef.current + roundWinRef.current) * 100) / 100 : result.balance;

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding.
        logSpinResult({
          betAmount: isRespin ? 0 : stake,
          winAmount: result.winAmount,
          reelSymbols: [...result.reels, result.specialReel],
          balanceAfter,
        }).catch(() => {});

        // Reels 1-3 never get the backdrop/border treatment — pulse only, always. The bg-wash +
        // border ("line") glow is reserved for reel 4 landing 5X, 10X or $$+.
        const withGlowBackdrop = result.specialGlowBackdrop;

        if (result.lineWinTierKey) {
          sceneRef.current.setLineWinGlow(true, false);
          sceneRef.current.setPaylineWon(true);
          winGlowActiveRef.current = true;
          winGlowStartRef.current = Date.now();
        }
        // Special reel: only touched when reels 1-3 actually won and this isn't a respin round
        // (it stays frozen/untouched for the whole 5-spin bonus). If it landed as a half-stop
        // (nothing clean on the payline), shake it and let it settle onto its real revealed
        // bonus first, then glow *only reel 4* for that bonus.
        if (result.baseWin > 0 && !isRespin) {
          if (result.specialIsHalfStop) {
            await withTimeout(sceneRef.current.resolveSpecialHalfStop(), SPECIAL_REVEAL_TIMEOUT_MS);
          }
          sceneRef.current.setSpecialGlow(true, withGlowBackdrop);
        }

        if (result.respinsAwarded > 0) {
          sound.playFreeSpinsJingle();
          if (!isRespin) {
            lockedBetRef.current = betAmount;
            respinWinRef.current = 0;
          }
          respinRoundActiveRef.current = true;
          // Respin-round look until the round's total card is tapped away: freespinBg.webp,
          // reel 4's RESPIN pulsing with its animated background.
          sceneRef.current.setRespinMode(true);
          setRespinsTotalAwarded((t) => t + result.respinsAwarded);
          setRespinsRemaining((r) => r + result.respinsAwarded);
          setRespinIntro(result.respinsAwarded);
        }

        if (result.winAmount > 0) {
          sound.playWinChime();
          // Every win (there's no Big/Mega/Jackpot celebration in this game): the WIN box starts its
          // animation halfway through the floating popup's animation (SimpleWinPopup's onHalfway),
          // and SPIN stays disabled until both are done (see winAnimating).
          simpleWinIdRef.current += 1;
          setSimpleWinPopup({ id: simpleWinIdRef.current, amount: result.winAmount, boxAmount: roundWinRef.current });
        } else if (!isRespin) {
          // A losing respin leaves the round's running total in the WIN box.
          setWinAmount(0);
        }
      } catch (err) {
        sound.stopReelSpinLoop();
        const message = err instanceof Error ? err.message : "Spin failed";
        setError(message);
        setAutoplay(false);
        // The spin request itself failed — give the bet back.
        if (!spinResolved && !isRespin) setBalance(balanceBefore);
      } finally {
        spinLockRef.current = false;
        setSpinning(false);
        if (isRespin) setRespinsRemaining((r) => Math.max(r - 1, 0));
      }
    },
    [betAmount, spinning, winAnimating, respinRoundTotal, user, setBalance, turbo]
  );

  /** Step 3 of a win: once the WIN box has shown it, wait BALANCE_CREDIT_DELAY_MS, then add it to
   * the balance — only then is the win's animation complete (SPIN/autoplay are held until now). */
  const creditAfterWinBox = useCallback(() => {
    if (creditTimerRef.current !== null) return;
    if (pendingCreditRef.current === null) {
      setCreditPending(false);
      return;
    }
    creditTimerRef.current = window.setTimeout(() => {
      creditTimerRef.current = null;
      if (pendingCreditRef.current !== null) setBalance(pendingCreditRef.current);
      pendingCreditRef.current = null;
      setCreditPending(false);
    }, BALANCE_CREDIT_DELAY_MS);
  }, [setBalance]);

  // Never lose a pending win's credit if the player leaves mid-animation.
  useEffect(
    () => () => {
      if (creditTimerRef.current !== null) window.clearTimeout(creditTimerRef.current);
      if (pendingCreditRef.current !== null) setBalance(pendingCreditRef.current);
    },
    [setBalance]
  );

  // Safety net: never leave SPIN locked if the controller's end signal somehow doesn't arrive.
  useEffect(() => {
    if (!controllerWinPending) return;
    const id = window.setTimeout(() => {
      setControllerWinPending(false);
      creditAfterWinBox();
    }, 6000);
    return () => window.clearTimeout(id);
  }, [controllerWinPending, creditAfterWinBox]);

  // Auto-continue while respins remain — after the previous win's animations finish, and only
  // once the player has started the round from its "PLAY TO START" banner.
  useEffect(() => {
    if (!inRespins || spinning || !ready || winAnimating || respinIntro !== null) return;
    // Last respin and the respins are still under the 1x minimum → it lands a real line that covers it.
    const shortfallX = respinsRemaining === 1 ? getRespinShortfallX(lockedBetRef.current, respinWinRef.current) : 0;
    const id = window.setTimeout(() => runSpin(true, shortfallX), 900);
    return () => window.clearTimeout(id);
  }, [inRespins, spinning, ready, winAnimating, respinIntro, respinsRemaining, runSpin]);

  // Round over (last respin landed and its win animation finished) → the total card; autoplay
  // stops so the player resumes with SPIN or AUTO.
  useEffect(() => {
    if (!respinRoundActiveRef.current || inRespins || spinning || winAnimating || respinIntro !== null) return;
    respinRoundActiveRef.current = false;
    setRespinRoundTotal(roundWinRef.current);
    setAutoplay(false);
  }, [inRespins, spinning, winAnimating, respinIntro]);

  /** The round's total card was tapped away — only now is the round's total added to the balance. */
  const collectRespinRound = useCallback(() => {
    sceneRef.current?.setRespinMode(false);
    const total = roundWinRef.current;
    setRespinRoundTotal(null);
    if (total > 0) {
      sound.playWinChime();
      setBalance(Math.round((balanceRef.current + total) * 100) / 100);
    }
  }, [setBalance]);

  // Reset the respin tally once the bonus round ends.
  useEffect(() => {
    if (!inRespins && respinsTotalAwarded > 0 && !spinning) {
      const id = window.setTimeout(() => setRespinsTotalAwarded(0), 3000);
      return () => window.clearTimeout(id);
    }
  }, [inRespins, respinsTotalAwarded, spinning]);

  // First autoplay spin fires the instant AUTO is switched on; later ones pause 700ms and
  // also let a win glow show for its full WIN_GLOW_MIN_DISPLAY_MS.
  const autoFirstSpinRef = useRef(true);
  useEffect(() => {
    if (!autoplay) autoFirstSpinRef.current = true;
  }, [autoplay]);
  useEffect(() => {
    if (!autoplay || spinning || !ready || inRespins || showPaytable || winAnimating || respinRoundTotal !== null) return;
    const glowRemaining = winGlowActiveRef.current ? WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winGlowStartRef.current) : 0;
    const delay = autoFirstSpinRef.current ? 0 : Math.max(700, glowRemaining);
    const id = window.setTimeout(() => {
      autoFirstSpinRef.current = false;
      runSpin(false);
    }, delay);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, inRespins, showPaytable, winAnimating, respinRoundTotal, runSpin]);

  // Keep the ladder's win-value LCD readouts in sync with the current bet.
  useEffect(() => {
    if (!ready || !config || !sceneRef.current) return;
    sceneRef.current.updatePayoutValues(config.paytable, config.specialPaytable, betAmount);
  }, [ready, config, betAmount]);

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
      <GameJackpotBar gameId="crazy-777" />

      <div className="absolute top-0 z-10 w-full flex items-center justify-start px-3 py-2">
        <GameHomeButton size={70} />
      </div>

      <div className="relative mt-1 overflow-hidden rounded-lg">
        <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-950 text-amber-300/70">
            Loading reels...
          </div>
        )}
        {inRespins && (
          <div className="absolute left-1/2 top-10 -translate-x-1/2 rounded-full bg-black/90 px-10 py-5 text-4xl font-bold text-amber-300 shadow z-10">
            RESPIN: {respinsRemaining} left (of {respinsTotalAwarded})
          </div>
        )}
      </div>

      {error && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">
          {error}
        </div>
      )}

      {simpleWinPopup && (
        <SimpleWinPopup
          key={simpleWinPopup.id}
          winAmount={simpleWinPopup.amount}
          targetRef={winBoxRef}
          onComplete={() => {
            // Step 2: the popup has landed in the WIN box — the box counts up to it now. Same
            // amount as the box already shows → the controller won't re-animate, so go straight on.
            setSimpleWinPopup(null);
            if (simpleWinPopup.boxAmount !== winAmountRef.current) {
              setControllerWinPending(true);
              setWinAmount(simpleWinPopup.boxAmount);
            } else {
              creditAfterWinBox();
            }
          }}
        />
      )}

      {/* Waits for the trigger spin's own win popup to drop into the WIN box first — both sit
          centre-screen in the same lettering. */}
      {respinIntro !== null && simpleWinPopup === null && (
        <RespinIntro
          count={respinIntro}
          startRequested={respinStartRequested}
          onDismiss={() => {
            setRespinIntro(null);
            setRespinStartRequested(false);
          }}
        />
      )}

      {/* Respin round total — tap anywhere to continue; only then is it credited. */}
      {respinRoundTotal !== null && <RespinOutro total={respinRoundTotal} onDismiss={collectRespinRound} />}

      {/* Raised above the respins banner while it's up so SPIN can start the round. */}
      <div className={`absolute bottom-0 w-full ${respinIntro !== null ? "z-40" : ""}`}>
        {/* SlotControlBar — commented out per request; GameController below is the active footer
            for Crazy777. To switch back: restore this block, its import, and the `muted` state.
        <SlotControlBar
          credit={user?.balance ?? 0}
          betLabel={(inRespins ? lockedBetRef.current : betAmount).toFixed(2)}
          onBetDecrease={() => changeBet(-1)}
          onBetIncrease={() => changeBet(1)}
          betDecreaseDisabled={betIndex === 0 || inRespins}
          betIncreaseDisabled={betIndex === betLevels.length - 1 || inRespins}
          win={winAmount}
          spinning={spinning}
          spinDisabled={!ready || spinning || inRespins}
          onSpin={() => runSpin(false)}
          turbo={turbo}
          onToggleTurbo={() => setTurbo((v) => !v)}
          auto={autoplay}
          onToggleAuto={() => {
            sound.resumeAudio();
            setAutoplay((v) => !v);
          }}
          autoDisabled={inRespins}
          muted={muted}
          onToggleMute={() => {
            sound.resumeAudio();
            setMuted(sound.toggleMuted());
          }}
          onInfo={() => setShowPaytable((v) => !v)}
        />
        */}
        {/* GameController — ported from E:\Office Games\game-controller. Active footer for Crazy777. */}
        <GameController
          betAmount={inRespins ? lockedBetRef.current : betAmount}
          credit={user?.balance ?? 0}
          onBetDecrease={() => changeBet(-1)}
          onBetIncrease={() => changeBet(1)}
          betDecreaseDisabled={betIndex === 0 || inRespins}
          betIncreaseDisabled={betIndex === betLevels.length - 1 || inRespins}
          win={winAmount}
          spinning={spinning}
          // While the respins banner is up SPIN is live again — pressing it starts the round.
          spinDisabled={
            respinIntro !== null
              ? respinStartRequested
              : !ready || spinning || inRespins || winAnimating || respinRoundTotal !== null
          }
          onWinAnimationEnd={() => {
            setControllerWinPending(false);
            creditAfterWinBox();
          }}
          onSpin={() => (respinIntro !== null ? setRespinStartRequested(true) : runSpin(false))}
          auto={autoplay}
          onToggleAuto={() => {
            sound.resumeAudio();
            setAutoplay((v) => !v);
          }}
          allowQuickStop={false}
          fast={turbo}
          onToggleFast={() => setTurbo((v) => !v)}
          onInfo={() => setShowPaytable((v) => !v)}
          muted={muted}
          onToggleMute={() => {
            sound.resumeAudio();
            setMuted(sound.toggleMuted());
          }}
        />
      </div>
    </div>
    </div>

    {showPaytable && config && <InfoScreen bet={inRespins ? lockedBetRef.current : betAmount} onClose={() => setShowPaytable(false)} />}


    {showLoadingScreen && (
      <LoadingScreen
        title="Crazy 777"
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

