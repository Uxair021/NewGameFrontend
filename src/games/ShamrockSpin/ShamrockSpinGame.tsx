import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { useAuth } from "../../context/AuthContext";
import { SlotMachineScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/SlotMachineScene";
import { winTier } from "./pixi/SceneEffects";
import { BigWinOverlay } from "./BigWinOverlay";
import { getShamrockConfig, getFreeSpinShortfallX, spinRequest, logSpinResult, ShamrockConfigResponse, syncShamrockRtpConfigFromServer } from "./api";
import { FreeSpinCelebration } from "./FreeSpinCelebration";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";
import GameController2 from "../shared/GameController2";
import { InfoScreen } from "./InfoScreen";

const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
const DEFAULT_MAX_TOTAL_FREE_SPINS = 29;
const BG_MUSIC_URL = "/Sound/alex-morgan-video-game-pixel-chiptune-music-583271.mp3";
/** GameController2's height at this game's width (its 136px design height, scaled by width / 1440). */
const CONTROL_BAR_HEIGHT = Math.round((136 * CANVAS_WIDTH) / 1440);

export function ShamrockSpinGame() {
  const { user, setBalance } = useAuth();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SlotMachineScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  // Above 900px viewport width this is always 1 (desktop, unaffected). Below that
  // (phones/tablets) it shrinks the whole fixed-design-size card to fit, same
  // technique used by the celebration overlays.
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<ShamrockConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [freeSpinCelebration, setFreeSpinCelebration] = useState<{ count: number } | null>(null);
  const [bigWin, setBigWin] = useState<{ amount: number; tier: 1 | 2 | 3 } | null>(null);
  // Player pressed SPIN on the control bar while the "PLAY TO START" banner was up.
  const [freeSpinStartRequested, setFreeSpinStartRequested] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);

  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const freeSpinsTotalAwardedRef = useRef(0);
  /** Total free spins awarded this round (incl. retriggers) — the "/ total" in the FREE SPINS badge. */
  const [freeSpinsTotal, setFreeSpinsTotal] = useState(0);
  /** Running total of the current free-spin round — shown in the WIN box during the round and
   * only credited to the balance once the player closes the "Free Spins Complete" card. */
  const roundWinRef = useRef(0);
  /** Round total waiting to be credited (set when the round ends, cleared on credit). */
  const pendingCreditRef = useRef<number | null>(null);
  const [freeSpinsDoneWon, setFreeSpinsDoneWon] = useState<number | null>(null);
  const lockedBetRef = useRef(0);
  const winGlowActiveRef = useRef(false);
  // Latest balance, read when the finished round's total is credited.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const setBalanceRef = useRef(setBalance);
  setBalanceRef.current = setBalance;
  /** True while a spin is in flight — a second spin can never start on top of it. */
  const spinLockRef = useRef(false);

  const betAmount = betLevels[betIndex] ?? betLevels[0];
  const inFreeSpins = freeSpinsRemaining > 0;
  const maxTotalFreeSpins = config?.maxTotalFreeSpins ?? DEFAULT_MAX_TOTAL_FREE_SPINS;

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncShamrockRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getShamrockConfig()
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

    app
      .init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        antialias: false,
        resolution: 1,
        autoDensity: true,
        powerPreference: "low-power",
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        app.ticker.maxFPS = 30;
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await SlotMachineScene.create(app);
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
        console.error("Shamrock Spin: failed to initialize", err);
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
    };
  }, [initRetryKey]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  const runSpin = useCallback(
    async (freeSpin: boolean, guaranteeShortfallX = 0) => {
      sound.resumeAudio();
      if (!sceneRef.current || spinning || spinLockRef.current || freeSpinsDoneWon !== null) return;
      const stake = freeSpin ? lockedBetRef.current : betAmount;
      if (!freeSpin && (!user || user.balance < stake)) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }

      setError(null);
      setBigWin(null);
      setSpinning(true);
      if (!freeSpin) setWinAmount(0);

      // Clear a previous spin's win glow right away — never block the next spin starting.
      if (winGlowActiveRef.current) {
        sceneRef.current?.setWinGlow(false);
        winGlowActiveRef.current = false;
      }
      if (!sceneRef.current) return;

      // The bet leaves the balance the moment the spin starts (free spins cost nothing); a win is
      // added back once the reels land (result.balance = balanceBefore - stake + win).
      spinLockRef.current = true;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!freeSpin) setBalance(Math.round((balanceBefore - stake) * 100) / 100);

      try {
        const result = await spinRequest(stake, freeSpin, balanceBefore, guaranteeShortfallX);
        spinResolved = true;
        sound.startReelSpinLoop();
        await sceneRef.current.spin(result.reels, sound.reelStopSounds(3));
        sound.stopReelSpinLoop();
        // A base spin that triggers free spins starts the round total with its own win — held,
        // like every free-spin win, until the round's card is tapped away.
        const triggersRound = !freeSpin && result.freeSpinsAwarded > 0;
        if (triggersRound) roundWinRef.current = result.winAmount;

        let balanceAfter = result.balance;
        if (freeSpin) {
          // Free-spin wins pile up in the WIN box; the balance is only credited when the round's
          // completion card is closed (see creditRoundWin).
          roundWinRef.current = Math.round((roundWinRef.current + result.winAmount) * 100) / 100;
          setWinAmount(roundWinRef.current);
          balanceAfter = Math.round((balanceRef.current + roundWinRef.current) * 100) / 100;
        } else {
          setWinAmount(result.winAmount);
          if (!triggersRound) setBalance(result.balance);
        }

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding.
        logSpinResult({
          betAmount: freeSpin ? 0 : stake,
          winAmount: result.winAmount,
          reelSymbols: result.reels,
          balanceAfter,
        }).catch(() => {});

        if (result.winAmount > 0) {
          sceneRef.current.setWinGlow(true);
          winGlowActiveRef.current = true;
          const multiple = result.winAmount / stake;
          sceneRef.current.celebrateWin(multiple);
          // A spin that also awards free spins gets the free-spin banner instead, and the bonus
          // round itself keeps moving — it has its own "Free Spins Complete" total at the end.
          const tier = winTier(multiple);
          if (tier > 0 && !freeSpin && result.freeSpinsAwarded === 0) {
            setBigWin({ amount: result.winAmount, tier: tier as 1 | 2 | 3 });
            sound.playFreeSpinsWin();
          }
        }

        if (result.freeSpinsAwarded > 0) {
          sound.playFreeSpinsJingle();
          if (!freeSpin) lockedBetRef.current = betAmount;
          const room = Math.max(maxTotalFreeSpins - freeSpinsTotalAwardedRef.current, 0);
          const addable = Math.min(result.freeSpinsAwarded, room);
          freeSpinsTotalAwardedRef.current += addable;
          setFreeSpinsTotal(freeSpinsTotalAwardedRef.current);
          setFreeSpinsRemaining((r) => r + addable);
          setFreeSpinCelebration({ count: result.freeSpinsAwarded });
        }

        if (result.winAmount > 0) sound.playWinChime();
      } catch (err) {
        sound.stopReelSpinLoop();
        const message = err instanceof Error ? err.message : "Spin failed";
        setError(message);
        setAutoplay(false);
        // The spin request itself failed — give the bet back.
        if (!spinResolved && !freeSpin) setBalance(balanceBefore);
      } finally {
        spinLockRef.current = false;
        setSpinning(false);
        if (freeSpin) setFreeSpinsRemaining((r) => Math.max(r - 1, 0));
      }
    },
    [betAmount, spinning, user, setBalance, maxTotalFreeSpins, freeSpinsDoneWon]
  );

  // Auto-continue while free spins remain. Held off while the free-spin
  // celebration banner is showing so the bonus round doesn't start spinning
  // underneath it.
  useEffect(() => {
    if (!inFreeSpins || spinning || !ready || freeSpinCelebration || showInfo) return;
    // Last spin of the round and it's still under the 1x minimum → this spin lands a real line that covers it.
    const shortfallX = freeSpinsRemaining === 1 ? getFreeSpinShortfallX(lockedBetRef.current, roundWinRef.current) : 0;
    const id = window.setTimeout(() => runSpin(true, shortfallX), 900);
    return () => window.clearTimeout(id);
  }, [inFreeSpins, spinning, ready, freeSpinCelebration, showInfo, runSpin, freeSpinsRemaining]);

  // Free spins just won: an alarm loops (after the award jingle) for as long as the banner waits
  // for the player — it stops the moment they start the round (SPIN, or tapping the banner).
  const alarmWaiting = freeSpinCelebration !== null && !freeSpinStartRequested;
  useEffect(() => {
    if (!alarmWaiting) return;
    return sound.startFreeSpinAlarm(700);
  }, [alarmWaiting]);

  // Green reel-background overlay for the whole free-spin bonus round — on the instant free
  // spins are awarded (freeSpinsRemaining becomes > 0), off when the round ends.
  useEffect(() => {
    sceneRef.current?.setFreeSpinOverlay(inFreeSpins);
  }, [inFreeSpins]);

  // When all free spins are completed, display the card showing total amount won.
  // The card remains visible until the player clicks it, and only then closes.
  const prevInFreeSpins = useRef(inFreeSpins);
  useEffect(() => {
    const ended = prevInFreeSpins.current && !inFreeSpins;
    prevInFreeSpins.current = inFreeSpins;
    if (!ended) return;
    const total = Math.round(roundWinRef.current * 100) / 100;
    pendingCreditRef.current = total;
    setWinAmount(total);
    setFreeSpinsDoneWon(total);
    // The "Free Spins Complete" card's own fanfare, as it appears.
    sound.playFreeSpinsWin();
    // Autoplay stops once a bonus round ends — the player resumes with SPIN or AUTO.
    setAutoplay(false);
    freeSpinsTotalAwardedRef.current = 0;
    roundWinRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on round ending only
  }, [inFreeSpins]);

  /** Adds the finished round's total to the balance — called when the completion card closes. */
  const creditRoundWin = useCallback(() => {
    const pending = pendingCreditRef.current;
    if (pending === null) return;
    pendingCreditRef.current = null;
    setBalanceRef.current(Math.round((balanceRef.current + pending) * 100) / 100);
  }, []);

  // Never lose a finished round's winnings if the player leaves before closing the card.
  useEffect(() => creditRoundWin, [creditRoundWin]);

  useEffect(() => {
    if (!autoplay || spinning || !ready || inFreeSpins || showInfo || freeSpinsDoneWon !== null || bigWin) return;
    const id = window.setTimeout(() => {
      runSpin(false);
    }, 700);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, inFreeSpins, showInfo, freeSpinsDoneWon, bigWin, runSpin]);

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
      <div className="absolute top-0 z-10 w-full flex items-center justify-between px-3 py-2">
        <GameHomeButton size={55} />
        {/* <div className="flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400 text-xl font-bold text-cabinet-green">
            $
          </span>
          <span className="font-semibold text-xl text-cabinet-gold">{(user?.balance ?? 0).toFixed(2)}</span>
        </div> */}
      </div>

      <div className="relative mt-1 overflow-hidden rounded-lg">
        <div
          ref={canvasHostRef}
          className="mx-auto"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-cabinet-green text-cabinet-gold/70">
            Loading reels...
          </div>
        )}
        {/* Free-spin counter, sitting inside the top panel of bg_freespin.webp (its inner box is
            799×124 at y 57, horizontally centred on the canvas, like the machine art). */}
        {inFreeSpins && !freeSpinCelebration && (
          <div
            className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center justify-center gap-8 whitespace-nowrap"
            style={{ top: 57, width: 799, height: 124 }}
          >
            <span className="bg-[linear-gradient(180deg,#fff7c2_0%,#ffd84a_45%,#e08a12_100%)] bg-clip-text text-[54px] font-black uppercase tracking-[0.08em] text-transparent [filter:drop-shadow(0_3px_0_#3a1c00)_drop-shadow(0_0_14px_rgba(255,140,20,0.65))]">
              Free Spins
            </span>
            <span
              key={freeSpinsRemaining}
              className="animate-gc-win-pop tabular-nums text-[66px] font-black leading-none text-white [text-shadow:0_3px_0_#053a1b,0_0_18px_rgba(255,170,40,0.9)]"
            >
              {freeSpinsRemaining}
              <span className="mx-2 text-[44px] text-[#ffd84a]">/</span>
              <span className="text-[44px] text-[#ffe9a0]">{freeSpinsTotal}</span>
            </span>
          </div>
        )}
      </div>

      {error && <div className="absolute left-1/2 top-1/2 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">{error}</div>}

      {bigWin && (
        <BigWinOverlay amount={bigWin.amount} tier={bigWin.tier} bottom={CONTROL_BAR_HEIGHT} onDone={() => setBigWin(null)} />
      )}

      {/* Free-spins completion card — displays total amount won after all free spins finish, remains visible until player clicks it */}
      {!inFreeSpins && freeSpinsDoneWon !== null && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm cursor-pointer select-none"
          onClick={() => {
            sound.playWinChime();
            creditRoundWin();
            setFreeSpinsDoneWon(null);
          }}
          role="button"
          tabIndex={0}
          aria-label="Free Spins Complete - Click to close"
        >
          <div className="shamrock-rays" aria-hidden />
          <div className="shamrock-complete-card relative rounded-[28px] bg-[linear-gradient(180deg,#fff2a8_0%,#f5c33b_35%,#a86a06_70%,#ffe07a_100%)] p-[6px] shadow-[0_0_60px_rgba(0,150,12,0.9),0_12px_36px_rgba(0,0,0,0.9)]">
            <div className="min-w-[560px] max-w-[660px] rounded-[22px] bg-[linear-gradient(180deg,#118a42_0%,#0a5f2d_55%,#053a1b_100%)] px-14 py-8 text-center shadow-[inset_0_0_0_2px_rgba(255,226,130,0.55)]">
              <div className="text-4xl font-black uppercase tracking-[0.14em] text-[#ffe27a] [text-shadow:0_3px_0_#3a2600]">
                Free Spins Complete
              </div>
              <div className="my-4 flex items-center justify-center gap-5" aria-hidden>
                <span className="h-[3px] w-24 rounded-full bg-[#f5c33b]" />
                <span className="text-3xl leading-none text-[#ffe27a]">☘</span>
                <span className="h-[3px] w-24 rounded-full bg-[#f5c33b]" />
              </div>
              <div className="text-xl font-bold uppercase tracking-[0.35em] text-[#c9f5d6]">Total Won</div>
              <div className="mt-2 text-7xl font-black tabular-nums leading-none text-white [text-shadow:0_5px_0_#053a1b]">
                ${freeSpinsDoneWon.toFixed(2)}
              </div>
              <div className="mt-7">
                <span className="inline-block rounded-full bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-400 px-8 py-3 text-lg font-black uppercase tracking-wider text-green-950 shadow-lg hover:brightness-110 active:scale-95 transition-all">
                  TAP ANYWHERE TO CONTINUE
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Old footer — commented out per request; GameController2 below is the active control bar
          for ShamrockSpin. To switch back: restore this block, the four helpers it uses at the
          bottom of this file (ctrlButtonClass, ChevronIcon, SoundIcon, AutoplayIcon), and remove the
          GameController2 import + block.
      <div className="absolute bottom-0 flex w-full items-center justify-between gap-2 bg-gradient-to-b from-cabinet-green-light to-cabinet-green px-3 py-2.5">
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowInfo(true)}
            className={ctrlButtonClass(showInfo)}
            aria-label="Game rules and information"
          >
            <span className="text-xl font-black text-black">?</span>
          </button>

          <button
            onClick={() => {
              sound.resumeAudio();
              setMuted(sound.toggleMuted());
            }}
            className={ctrlButtonClass(muted)}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            <SoundIcon muted={muted} />
          </button>
        </div>

        <div className="flex gap-3 items-center">

          <button
            onClick={() => changeBet(-1)}
            disabled={betIndex === 0 || inFreeSpins}
            className={ctrlButtonClass()}
            aria-label="Decrease bet"
          >
            <ChevronIcon direction="left" />
          </button>

          <div className="flex min-w-[92px] flex-col items-center justify-center rounded-lg border border-black/40 bg-gradient-to-b from-[#0c2a18] to-[#051309] px-4 py-1.5 shadow-inner">
            <div className="text-md font-bold uppercase tracking-wide text-amber-400">Total Bet</div>
            <div className="text-3xl font-bold text-lime-300">
              {(inFreeSpins ? lockedBetRef.current : betAmount).toFixed(2)}
            </div>
          </div>

          <button
            onClick={() => changeBet(1)}
            disabled={betIndex === betLevels.length - 1 || inFreeSpins}
            className={ctrlButtonClass()}
            aria-label="Increase bet"
          >
            <ChevronIcon direction="right" />
          </button>

        </div>

        <div className="flex min-w-[510px] flex-col items-center justify-center rounded-full border-2 border-white/70 bg-gradient-to-b from-red-600 via-red-800 to-red-950 px-5 py-1.5 shadow-[inset_0_2px_3px_rgba(255,255,255,0.3),0_2px_4px_rgba(0,0,0,0.4)]">
          <div className="text-md font-bold uppercase tracking-wide text-amber-300">Win</div>
          <div className="text-3xl font-bold text-amber-400">{winAmount.toFixed(2)}</div>
        </div>

        <div className="flex gap-5 items-center">
          <button
            onClick={() => {
              sound.resumeAudio();
              setAutoplay((v) => !v);
            }}
            disabled={inFreeSpins}
            className={ctrlButtonClass(autoplay)}
            aria-label="Autoplay"
          >
            <AutoplayIcon  />
          </button>

          <button
            onClick={() => runSpin(false)}
            disabled={!ready || spinning || inFreeSpins}
            className="rounded-2xl border-2 border-black/50 bg-gradient-to-b from-green-300 via-green-500 to-green-700 px-8 py-3.5 text-2xl font-black italic tracking-wide text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.5),0_3px_6px_rgba(0,0,0,0.5)] disabled:opacity-50 w-[130px]"
          >
            {spinning || inFreeSpins ? "..." : "SPIN"}
          </button>
        </div>
      </div>
      */}
      {freeSpinCelebration && (
        <FreeSpinCelebration
          count={freeSpinCelebration.count}
          startRequested={freeSpinStartRequested}
          onStart={() => setFreeSpinStartRequested(true)}
          onDismiss={() => {
            setFreeSpinCelebration(null);
            setFreeSpinStartRequested(false);
          }}
        />
      )}

      {/* Raised above the "PLAY TO START" banner so its SPIN button can start the free spins */}
      <div className={`absolute bottom-0 w-full ${freeSpinCelebration ? "z-40" : ""}`}>
        <GameController2
          credit={user?.balance ?? 0}
          betAmount={inFreeSpins ? lockedBetRef.current : betAmount}
          onBetDecrease={() => changeBet(-1)}
          onBetIncrease={() => changeBet(1)}
          betDecreaseDisabled={betIndex === 0 || inFreeSpins || freeSpinsDoneWon !== null}
          betIncreaseDisabled={betIndex === betLevels.length - 1 || inFreeSpins || freeSpinsDoneWon !== null}
          win={winAmount}
          // Free-spin wins are only held in WIN until the round's card is tapped away — the
          // balance must not count up with them.
          holdBalance={inFreeSpins || freeSpinsDoneWon !== null}
          // the free-spin bonus round runs on its own, so the bar shows STOP / busy for all of it —
          // except while "PLAY TO START" is up, when SPIN is back and pressing it starts the round
          spinning={spinning || (inFreeSpins && !freeSpinCelebration)}
          spinDisabled={
            !ready || spinning || freeSpinsDoneWon !== null || (inFreeSpins && !freeSpinCelebration) || freeSpinStartRequested
          }
          onSpin={() => {
            if (freeSpinCelebration) {
              sound.resumeAudio();
              setFreeSpinStartRequested(true);
              return;
            }
            runSpin(false);
          }}
          // free spins just won: the key reads START while the banner waits for the player
          spinLabel={freeSpinCelebration ? "START" : undefined}
          // ShamrockSpin's reels can't be cut short once a spin starts
          allowQuickStop={false}
          auto={autoplay}
          onToggleAuto={() => {
            sound.resumeAudio();
            setAutoplay((v) => !v);
          }}
          autoDisabled={inFreeSpins || freeSpinsDoneWon !== null}
          muted={muted}
          onToggleMute={() => {
            sound.resumeAudio();
            setMuted(sound.toggleMuted());
          }}
          onInfo={() => setShowInfo(true)}
        />
      </div>
    </div>
    </div>

    {showInfo && config && (
      <InfoScreen bet={betAmount} maxTotalFreeSpins={config.maxTotalFreeSpins} onClose={() => setShowInfo(false)} />
    )}

    {showLoadingScreen && (
      <LoadingScreen
        title="Shamrock Spin"
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

/** The cream, beveled, rounded-square button style shared by ?/-/+/autoplay. */
/* Old-footer helpers — only the commented-out footer above used these; restore them with it.
function ctrlButtonClass(active = false): string {
  return `flex h-12 w-12 items-center justify-center rounded-xl border-2 border-black/80 bg-gradient-to-b ${
    active ? "from-amber-200 to-amber-400" : "from-white to-neutral-200"
  } shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_2px_3px_rgba(0,0,0,0.4)] hover:brightness-95 disabled:opacity-40`;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const points = direction === "left" ? "15,4 6,12 15,20" : "9,4 18,12 9,20";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <polygon points={points} fill="black" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
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

function AutoplayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.2">
      <path d="M17 2 21 6 17 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12v-2a4 4 0 0 1 4-4h14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 22 3 18 7 14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 12v2a4 4 0 0 1-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="16" fontSize="9" fontWeight="900" fill="black" textAnchor="middle" stroke="none">
        A
      </text>
    </svg>
  );
}
*/
