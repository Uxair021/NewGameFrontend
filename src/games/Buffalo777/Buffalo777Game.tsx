import { useEffect, useMemo, useRef, useState, useCallback, CSSProperties } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { Buffalo777Scene, CANVAS_WIDTH, CANVAS_HEIGHT, RENDER_QUALITY } from "./pixi/Buffalo777Scene";
import {
  getBuffalo777Config,
  spinRequest,
  logSpinResult,
  Buffalo777ConfigResponse,
  PayoutRow,
  BONUS_FREE_SPINS,
  syncBuffaloRtpConfigFromServer,
} from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import { BullsStampede, preloadBullsRunFrames } from "./BullsStampede";
import { InfoScreen } from "./InfoScreen";
import { GameMenu, BUFFALO_MENU_THEME } from "../shared/GameMenu";
import * as sound from "../shared/sound/soundEngine";
import { useJackpot } from "../shared/jackpot/useJackpot";
import { JackpotBar } from "../shared/jackpot/JackpotBar";
import { JackpotPending } from "../shared/jackpot/jackpotApi";

const DEFAULT_BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];
const WIN_GLOW_MIN_DISPLAY_MS = 2000;
/** How long the 3x Gold Coin animation plays on the payline before the herd stampede starts. */
const BONUS_COIN_ANIM_MS = 2500;
/** Pause after each free spin so its result can be read — longer when it won. */
const FREE_SPIN_PAUSE_MS = 600;
const FREE_SPIN_WIN_PAUSE_MS = 1600;
/** The 10 free spins always pay at least this many times the bet in total — if the total is
 * still short going into the last free spin, that spin is guaranteed to cover the difference. */
const BONUS_MIN_WIN_BET_MULTIPLE = 2;
const WINNING_BOARD_URL = "/symbols/buffalo777/winningBoard.jpg";
/** Jackpot result sequence on the winning board: the tier win and the bonus win each show this
 * long (or until tapped), then the total stays until tapped. */
const JACKPOT_STEP_MS = 2800;
const BOARD_COUNT_UP_MS = 1200;

const COIN_IMAGE_URL = "/symbols/buffalo777/Coin.webp";
/** Gold coins raining over the winning board (loops until the board is tapped). */
const COIN_RAIN_COUNT = 100;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const BG_MUSIC_URL = "/Sound/atlasaudio-game-game-music-576637.mp3";

const BUTTON_IMAGES = {
  minus: "/symbols/buffalo777/Minus Button Buffalo777.webp",
  plus: "/symbols/buffalo777/Plus Button Buffalo777.webp",
  setting: "/symbols/buffalo777/Setting Button Buffalo777.webp",
  spinGreen: "/symbols/buffalo777/Spin Button Green Buffalo777.webp",
  spinRed: "/symbols/buffalo777/Spin Button Red Buffalo777.webp",
  auto: "/symbols/buffalo777/Auto Button Buffalo777.webp",
  turbo: "/symbols/buffalo777/Turbo Button Buffalo777.webp",
} as const;

/** Maps the backend's winTierKey (SpinResponse.winTierKey) to the ladder sign it should pour
 * coins out of — see Buffalo777Scene's LADDER_POSITIONS. Keys mirror engine.ts's TierKey. */
const TIER_KEY_TO_LADDER_SYMBOL: Record<string, PayoutRow["symbol"]> = {
  ten: "TEN",
  jack: "JACK",
  queen: "QUEEN",
  king: "KING",
  ace: "ACE",
  bull: "BULL",
  anyBar: "ANY_BAR",
  singleBar: "SINGLE_BAR",
  doubleBar: "DOUBLE_BAR",
  tripleBar: "TRIPLE_BAR",
  moneyBag: "MONEY_BAG",
  coin: "COIN",
};

export function Buffalo777Game() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Buffalo777Scene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Buffalo777ConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [freeSpinsLeft, setFreeSpinsLeft] = useState<number | null>(null);
  /** The winning board: `from` is where the amount counts up from; `autoCloseMs` closes it by
   * itself (a tap still closes it sooner); without it, it stays until tapped. */
  const [bonusBoard, setBonusBoard] = useState<{
    title: string;
    amount: number;
    from: number;
    highlight: boolean;
    autoCloseMs?: number;
    /** Shown instead of the counted-up money amount (the free-spins start board shows a count). */
    amountText?: string;
    /** Replaces the board's "Tap to continue" line. */
    footer?: string;
  } | null>(null);
  /** The free-spins start board is up — SPIN is live (green) again and starts the round. */
  const [awaitingBonusStart, setAwaitingBonusStart] = useState(false);
  const bonusBoardCloseRef = useRef<(() => void) | null>(null);
  const [showStampede, setShowStampede] = useState(false);
  const { info: jackpotInfo, takePending: takeJackpotHit, claim: claimJackpot } = useJackpot("buffalo-777", { canDeliver: true });
  const stampedeDoneRef = useRef<(() => void) | null>(null);
  const winGlowActiveRef = useRef(false);
  const winGlowStartRef = useRef(0);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  // Warm the bonus herd frames up front so the stampede doesn't wait on a download.
  useEffect(() => {
    preloadBullsRunFrames().catch(() => {});
  }, []);

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncBuffaloRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getBuffalo777Config()
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
        canvasHostRef.current.appendChild(app.canvas);
        // If a phone's browser still drops the WebGL context (out of graphics memory), say so and
        // offer Retry instead of leaving a blank canvas behind the DOM controls.
        app.canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          if (cancelled) return;
          console.error("Buffalo 777: WebGL context lost");
          setInitError("The game's graphics were interrupted. Please try again.");
          setReady(false);
          setShowLoadingScreen(true); // bring the loading screen back so its Retry is reachable
        });
        try {
          const scene = await Buffalo777Scene.create(app);
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
        console.error("Buffalo 777: failed to initialize", err);
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

  /** Clears the previous spin's win glow, but only after it has been visible for at least
   * WIN_GLOW_MIN_DISPLAY_MS. */
  const clearWinGlow = async () => {
    if (!winGlowActiveRef.current) return;
    const remaining = WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winGlowStartRef.current);
    if (remaining > 0) await wait(remaining);
    sceneRef.current?.setWinGlow(false);
    winGlowActiveRef.current = false;
  };

  /** Gold Coin bonus: the coin animation plays on the payline, the herd stampedes across the
   * bottom, the background switches to BonusSpinBg, then BONUS_FREE_SPINS spins run on their own
   * at the triggering bet (no bet deducted). Ends on the winning board with the bonus total.
   * When `jackpotHit` is set (the bonus was forced for a jackpot), the jackpot is claimed and
   * credited on top of the free spins' own wins, and the board shows tier win → bonus win →
   * total. */
  /** Shows the winning board and resolves when it's tapped (or auto-closes). */
  const showBoard = (board: NonNullable<typeof bonusBoard>) =>
    new Promise<void>((resolve) => {
      let timer: number | null = null;
      const close = () => {
        if (timer !== null) window.clearTimeout(timer);
        if (bonusBoardCloseRef.current !== close) return;
        bonusBoardCloseRef.current = null;
        setBonusBoard(null);
        resolve();
      };
      bonusBoardCloseRef.current = close;
      setBonusBoard(board);
      if (board.autoCloseMs) timer = window.setTimeout(close, board.autoCloseMs);
    });

  /** `balanceAtStart` already includes the trigger spin's win (`triggerWin`), which is held — shown
   * in WIN and paid with the bonus total when its final board is tapped away. */
  const runFreeSpinsBonus = async (balanceAtStart: number, jackpotHit: JackpotPending | null, triggerWin: number) => {
    const scene = sceneRef.current;
    if (!scene) return;

    await wait(BONUS_COIN_ANIM_MS);
    if (!sceneRef.current) return;
    await new Promise<void>((resolve) => {
      stampedeDoneRef.current = resolve;
      setShowStampede(true);
    });
    if (!sceneRef.current) return;

    scene.setWinGlow(false);
    winGlowActiveRef.current = false;
    await scene.setBonusMode(true);
    setFreeSpinsLeft(BONUS_FREE_SPINS);
    setWinAmount(triggerWin);

    // The round waits for the player (autoplay included): tap the board or press SPIN to start.
    setAwaitingBonusStart(true);
    await showBoard({
      title: "FREE SPINS",
      amount: BONUS_FREE_SPINS,
      from: BONUS_FREE_SPINS,
      highlight: true,
      amountText: String(BONUS_FREE_SPINS),
      footer: "Tap or press SPIN to start",
    });
    setAwaitingBonusStart(false);
    if (!sceneRef.current) return;

    let balance = balanceAtStart;
    // Starts from the trigger spin's held win; the 2x minimum below counts the free spins only.
    let bonusTotal = triggerWin;
    for (let i = 0; i < BONUS_FREE_SPINS; i++) {
      if (!sceneRef.current) return;
      await clearWinGlow();
      setFreeSpinsLeft(BONUS_FREE_SPINS - i);

      const isLastFreeSpin = i === BONUS_FREE_SPINS - 1;
      const minWin = isLastFreeSpin ? Math.max(0, betAmount * BONUS_MIN_WIN_BET_MULTIPLE - (bonusTotal - triggerWin)) : 0;
      const r = await spinRequest(betAmount, true, minWin);
      sound.startReelSpinLoop();
      await sceneRef.current?.spin(r.reels, () => sound.playReelStop(), turbo);
      sound.stopReelSpinLoop();
      if (!sceneRef.current) return;

      // Free-spin wins pile up in the WIN box; the balance is only credited once the round's
      // final board is tapped away (below).
      bonusTotal = Math.round((bonusTotal + r.winAmount) * 100) / 100;
      balance = Math.round((balance + r.winAmount) * 100) / 100;
      setWinAmount(bonusTotal);
      logSpinResult({
        betAmount: 0,
        winAmount: r.winAmount,
        reelSymbols: r.reels,
        balanceAfter: balance,
      }).catch(() => {});

      if (r.winAmount > 0) {
        sceneRef.current.setWinGlow(true);
        winGlowActiveRef.current = true;
        winGlowStartRef.current = Date.now();
        const ladderSymbol = r.winTierKey ? TIER_KEY_TO_LADDER_SYMBOL[r.winTierKey] : undefined;
        if (ladderSymbol) sceneRef.current.playCoinFall(ladderSymbol);
        sound.playWinChime();
        await wait(FREE_SPIN_WIN_PAUSE_MS);
      } else {
        await wait(FREE_SPIN_PAUSE_MS);
      }
    }
    setFreeSpinsLeft(0);

    // A forced jackpot bonus is paid first, so the board can show it: "MINI WIN" (or MAJOR /
    // MEGA / JACKPOT), then "BONUS WIN", then "TOTAL WIN" counting up from the jackpot to the
    // sum. If the payout fails (it then waits for an admin retry), only the bonus board shows.
    const paid = jackpotHit ? await claimJackpot(jackpotHit.hitId) : null;
    if (paid) {
      balance = Math.round((balance + paid.amount) * 100) / 100;
      const total = Math.round((paid.amount + bonusTotal) * 100) / 100;
      sound.playCelebration("JACKPOT");
      await showBoard({ title: `${paid.label.toUpperCase()} WIN`, amount: paid.amount, from: 0, highlight: true, autoCloseMs: JACKPOT_STEP_MS });
      sound.playWinChime();
      await showBoard({ title: "BONUS WIN", amount: bonusTotal, from: 0, highlight: false, autoCloseMs: JACKPOT_STEP_MS });
      sound.playCelebration("MEGA WIN");
      await showBoard({ title: "TOTAL WIN", amount: total, from: paid.amount, highlight: true });
    } else {
      // Plain bonus total — no Big/Mega/Jackpot win tiers in this game.
      sound.playWinChime();
      await showBoard({ title: "BONUS WIN", amount: bonusTotal, from: bonusTotal, highlight: false });
    }
    // Board tapped away — only now does the round's total (and any jackpot) reach the balance.
    setBalance(balance);
    // Autoplay stops once a bonus round ends — the player resumes with SPIN or AUTO.
    setAutoplay(false);

    await clearWinGlow();
    sceneRef.current?.setWinGlow(false);
    winGlowActiveRef.current = false;
    await sceneRef.current?.setBonusMode(false);
    setFreeSpinsLeft(null);
  };

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

    // The bet leaves the balance the moment SPIN is pressed; a win is added back once the reels
    // land (a loss leaves it as already deducted).
    spinLockRef.current = true;
    const balanceBefore = balanceRef.current;
    /** Set once the spin result is in — after that a failure must not refund the bet. */
    let spinResolved = false;
    setBalance(Math.round((balanceBefore - betAmount) * 100) / 100);

    // A previous spin's win glow must stay visible for at least WIN_GLOW_MIN_DISPLAY_MS
    // before this new spin can clear it, even if the player hits SPIN again immediately.
    if (winGlowActiveRef.current) {
      const remaining = WIN_GLOW_MIN_DISPLAY_MS - (Date.now() - winGlowStartRef.current);
      if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
      sceneRef.current?.setWinGlow(false);
      winGlowActiveRef.current = false;
    }
    if (!sceneRef.current) {
      spinLockRef.current = false;
      setBalance(balanceBefore);
      return;
    }

    // A jackpot hit that's ready for this player forces the free spins bonus on this spin.
    const jackpotHit = takeJackpotHit();

    try {
      const result = await spinRequest(betAmount, false, 0, jackpotHit !== null);
      spinResolved = true;
      sound.startReelSpinLoop();
      await sceneRef.current.spin(result.reels, () => sound.playReelStop(), turbo);
      sound.stopReelSpinLoop();
      setWinAmount(result.winAmount);
      // Buffalo777 is a fully offline test game — there's no server balance to read back, so
      // this mirrors the same deduct-bet-then-credit-win math the backend used to do.
      const newBalance = Math.round((balanceBefore - betAmount + result.winAmount) * 100) / 100;
      // A spin that starts the bonus holds its own win too — it's paid with the bonus total.
      setBalance(result.bonusTriggered ? Math.round((balanceBefore - betAmount) * 100) / 100 : newBalance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding.
      logSpinResult({
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: result.reels,
        balanceAfter: newBalance,
      }).catch(() => {});

      // The glow is what plays the payline symbol's win animation — including the 3x Gold Coin
      // animation before the bonus, which also runs when a jackpot forces the bonus (that
      // trigger spin pays 0, so it can't rely on winAmount alone).
      if (result.winAmount > 0 || result.bonusTriggered) {
        sceneRef.current.setWinGlow(true);
        winGlowActiveRef.current = true;
        winGlowStartRef.current = Date.now();
      }
      if (result.winAmount > 0) {
        const ladderSymbol = result.winTierKey ? TIER_KEY_TO_LADDER_SYMBOL[result.winTierKey] : undefined;
        if (ladderSymbol) sceneRef.current.playCoinFall(ladderSymbol);
      }

      if (result.bonusTriggered) {
        sound.playWinChime();
        await runFreeSpinsBonus(newBalance, jackpotHit, result.winAmount);
      } else if (result.winAmount > 0) {
        // Every win gets the plain chime — no Big/Mega/Jackpot celebration in this game.
        sound.playWinChime();
      }
    } catch (err) {
      sound.stopReelSpinLoop();
      const message = err instanceof Error ? err.message : "Spin failed";
      setError(message);
      setAutoplay(false);
      // The spin request itself failed — give the bet back.
      if (!spinResolved) setBalance(balanceBefore);
    } finally {
      spinLockRef.current = false;
      setSpinning(false);
    }
  }, [betAmount, spinning, user, setBalance, turbo, takeJackpotHit]);

  useEffect(() => {
    if (!autoplay || spinning || !ready || showInfo || recordsOpen) return;
    const id = window.setTimeout(() => {
      runSpin();
    }, 700);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, showInfo, recordsOpen, runSpin]);

  // Keep the ladder's win-value readouts in sync with the current bet.
  useEffect(() => {
    if (!ready || !config || !sceneRef.current) return;
    sceneRef.current.updatePayoutValues(config.paytable, betAmount);
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
        height: CANVAS_HEIGHT,
        transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
        transformOrigin: "top left",
      }}
    >
      <div className="relative overflow-hidden rounded-lg">
        <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-amber-950 text-amber-300/70">
            Loading reels...
          </div>
        )}
      </div>

      {error && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">
          {error}
        </div>
      )}

      {/*
       * Every control below sits exactly on the slot pre-drawn into bg.webp's own control-bar
       * art (gear/minus/plus/win-panel/turbo/auto/spin) — absolute, in canvas pixels
       * (CANVAS_WIDTH x CANVAS_HEIGHT = 1672x941), centered on each element via
       * translate(-50%, -50%). First-pass estimate read off the art; tune by eye as needed,
       * same convention as Buffalo777Scene.ts's own LADDER_POSITIONS. Home and sound on/off
       * live in the menu opened from the settings button (see GameMenu).
       */}

      {/* Warm amber-to-dark-wood gradient bar grounding the whole control row — bg.webp's own
       * art here is just open sky/desert fading to sand, with no distinct control-bar shape
       * baked in, so without this the buttons/text below float directly on that busy scene with
       * weak contrast. Colors pulled from the game's own palette (the gold/amber of the BAR and
       * SPIN button art, the dark wood-brown of the side ladder signs) so it reads as part of
       * the same machine rather than a bolted-on strip. Placed first among these siblings (no
       * z-index needed) so every control below stacks on top of it in normal DOM order. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: 107,
          background:
            "linear-gradient(180deg, rgba(74,40,12,0) 0%, rgba(112,64,20,0.55) 16%, rgba(112,60,18,0.88) 34%, rgba(58,30,8,0.95) 64%, rgba(16,8,3,0.98) 100%)",
          // borderTop: "1px solid rgba(255,205,110,0.55)",
        }}
      />

      <div className="absolute" style={{ left: 49, top: 880, width: 84, height: 74, transform: "translate(-50%, -50%)" }}>
        <ImgButton onClick={() => setShowMenu((v) => !v)} active={showMenu} src={BUTTON_IMAGES.setting} alt="Menu" className="h-full w-full" />
      </div>

      {/* Menu that opens from the settings button: Home, sound on/off, game info. */}
      {showMenu && (
        <GameMenu
          theme={BUFFALO_MENU_THEME}
          muted={muted}
          onToggleSound={() => {
            sound.resumeAudio();
            setMuted(sound.toggleMuted());
          }}
          onInfo={() => setShowInfo(true)}
          onClose={() => setShowMenu(false)}
          style={{ left: 4, bottom: CANVAS_HEIGHT - 836 }}
        />
      )}

      <div
        className="absolute flex flex-col items-center justify-center leading-tight rounded-xl border"
        style={{
          left: 211,
          top: 880,
          width: 190,
          height: 46,
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(180deg, rgba(122,72,24,0.85), rgba(52,27,8,0.9))",
          borderColor: "rgba(255,205,110,0.45)",
          boxShadow: "inset 0 1px 2px rgba(255,255,255,0.18), inset 0 -3px 6px rgba(0,0,0,0.35), 0 2px 5px rgba(0,0,0,0.4)",
        }}
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-200/90">Credit</span>
        <span className="text-xl font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
          {(user?.balance ?? 0).toFixed(2)}
        </span>
      </div>

      <div className="absolute" style={{ left: 372, top: 880, width: 72, height: 72, transform: "translate(-50%, -50%)" }}>
        <ImgButton onClick={() => changeBet(-1)} disabled={betIndex === 0} src={BUTTON_IMAGES.minus} alt="Decrease bet" className="h-full w-full" />
      </div>

      <div
        className="absolute flex flex-col items-center justify-center leading-tight rounded-xl border"
        style={{
          left: 454,
          top: 880,
          width: 70,
          height: 46,
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(180deg, rgba(122,72,24,0.85), rgba(52,27,8,0.9))",
          borderColor: "rgba(255,205,110,0.45)",
          boxShadow: "inset 0 1px 2px rgba(255,255,255,0.18), inset 0 -3px 6px rgba(0,0,0,0.35), 0 2px 5px rgba(0,0,0,0.4)",
        }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Bet</span>
        <span className="text-lg font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
          {betAmount.toFixed(2)}
        </span>
      </div>

      <div className="absolute" style={{ left: 537, top: 880, width: 75, height: 75, transform: "translate(-50%, -50%)" }}>
        <ImgButton
          onClick={() => changeBet(1)}
          disabled={betIndex === betLevels.length - 1}
          src={BUTTON_IMAGES.plus}
          alt="Increase bet"
          className="h-full w-full"
        />
      </div>

      <div
        className="absolute flex items-center justify-center gap-2 rounded-xl border"
        style={{
          left: 836,
          top: 878,
          width: 420,
          height: 67,
          transform: "translate(-50%, -50%)",
          background: "linear-gradient(180deg, rgba(122,72,24,0.85), rgba(52,27,8,0.9))",
          borderColor: "rgba(255,205,110,0.45)",
          boxShadow: "inset 0 1px 2px rgba(255,255,255,0.18), inset 0 -3px 6px rgba(0,0,0,0.35), 0 2px 5px rgba(0,0,0,0.4)",
        }}
      >
        <span className="text-md font-bold uppercase tracking-wide text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">Win</span>
        <span className="text-3xl font-black text-amber-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
          {winAmount.toFixed(2)}
        </span>
      </div>

      <div className="absolute" style={{ left: 1214, top: 880, width: 77, height: 77, transform: "translate(-50%, -50%)" }}>
        <ImgButton onClick={() => setTurbo((v) => !v)} active={turbo} src={BUTTON_IMAGES.turbo} alt="Turbo spin" className="h-full w-full" />
      </div>

      <div className="absolute" style={{ left: 1325, top: 883, width: 108, height: 75, transform: "translate(-50%, -50%)" }}>
        <ImgButton
          onClick={() => {
            sound.resumeAudio();
            setAutoplay((v) => !v);
          }}
          active={autoplay}
          src={BUTTON_IMAGES.auto}
          alt="Autoplay"
          className="h-full w-full"
        />
      </div>

      {/* Raised above the free-spins start board while it's up so SPIN can start the round. */}
      <div
        className={`absolute ${awaitingBonusStart ? "z-30" : ""}`}
        style={{ left: 1409, top: 834, width: 245, height: 105, transform: "translate(-50%, -50%)," }}
      >
        <ImgButton
          onClick={() => (awaitingBonusStart ? bonusBoardCloseRef.current?.() : runSpin())}
          disabled={!ready || (spinning && !awaitingBonusStart)}
          dimDisabled={!spinning}
          src={spinning && !awaitingBonusStart ? BUTTON_IMAGES.spinRed : BUTTON_IMAGES.spinGreen}
          alt="Spin"
          className="h-full w-full"
        />
      </div>

      {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
      <JackpotBar info={jackpotInfo} onRecordsOpenChange={setRecordsOpen} />

      {/* Free spins remaining — beside BonusSpinBg's own "FREE 10 GAMES" title. */}
      {freeSpinsLeft !== null && (
        <div
          className="absolute z-10 flex items-center gap-2 rounded-xl border px-5 py-2"
          style={{
            left: 1190,
            // Drops below the jackpot bar when it's showing.
            top: jackpotInfo?.inPool ? 108 : 58,
            transform: "translate(-50%, -50%)",
            background: "linear-gradient(180deg, rgba(122,72,24,0.92), rgba(52,27,8,0.95))",
            borderColor: "rgba(255,205,110,0.6)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          <span className="text-sm font-bold uppercase tracking-wide text-amber-200">Free Spins</span>
          <span className="text-3xl font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
            {freeSpinsLeft}
          </span>
        </div>
      )}

      {showStampede && (
        <BullsStampede
          onDone={() => {
            setShowStampede(false);
            stampedeDoneRef.current?.();
            stampedeDoneRef.current = null;
          }}
        />
      )}

      {/* End-of-bonus result on the wooden winning board (with coins raining) — a jackpot shows
       * tier win → bonus win → total win on it in turn. */}
      {bonusBoard && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/55"
          onClick={() => bonusBoardCloseRef.current?.()}
          role="button"
          tabIndex={0}
        >
          <div
            // Re-keyed per step so each one pops in again.
            key={bonusBoard.title}
            className="relative flex flex-col items-center justify-center gap-6"
            style={{
              width: 690,
              height: 557,
              backgroundImage: `url("${WINNING_BOARD_URL}")`,
              backgroundSize: "100% 100%",
              borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
              animation: "buffaloBoardIn 420ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <style>{`
              @keyframes buffaloBoardIn { from { transform: scale(0.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
              @keyframes buffaloWinPulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.06) } }
            `}</style>
            <div className="text-2xl font-black uppercase tracking-widest text-amber-900/80">
               
            </div>
            <div
              // Longer titles ("JACKPOT WIN", "TOTAL WIN") step down so they fit the board.
              className={`${bonusBoard.title.length > 8 ? "text-7xl" : "text-8xl"} whitespace-nowrap font-black uppercase`}
              style={{
                animation: "buffaloWinPulse 1.2s ease-in-out infinite",
                color: bonusBoard.highlight ? "#ffd23f" : "#fff1b8",
                WebkitTextStroke: "3px #5a2a06",
                textShadow: "0 5px 0 #5a2a06, 0 10px 18px rgba(0,0,0,0.45)",
              }}
            >
              {bonusBoard.title}
            </div>
            <div
              className="text-7xl font-black"
              style={{
                color: "#ffffff",
                WebkitTextStroke: "2px #5a2a06",
                textShadow: "0 4px 0 #5a2a06",
                animation: "buffaloWinPulse 1.2s ease-in-out 0.15s infinite",
              }}
            >
              {bonusBoard.amountText ?? <BoardAmount from={bonusBoard.from} to={bonusBoard.amount} />}
            </div>
            <div className="text-lg font-bold uppercase tracking-wide text-amber-900/70">{bonusBoard.footer ?? "Tap to continue"}</div>
          </div>
          <CoinRain />
        </div>
      )}

    </div>
    </div>

    {showInfo && <InfoScreen bet={betAmount} onClose={() => setShowInfo(false)} />}


    {showLoadingScreen && (
      <LoadingScreen
        title="Buffalo 777"
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

/** Gold coins falling from the top of the screen to the bottom, on a loop, for as long as it's
 * mounted — each coin gets its own random column, size, speed, start delay and spin. */
/** The board's amount, counting up from `from` to `to` (ease-out) when the step appears. */
function BoardAmount({ from, to }: { from: number; to: number }) {
  const [shown, setShown] = useState(from);
  useEffect(() => {
    if (to <= from) {
      setShown(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / BOARD_COUNT_UP_MS);
      setShown(from + (to - from) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to]);
  return <>{shown.toFixed(2)}</>;
}

function CoinRain() {
  const coins = useMemo(
    () =>
      Array.from({ length: COIN_RAIN_COUNT }, () => ({
        left: Math.random() * 100,
        size: 38 + Math.random() * 34,
        duration: 0.5 + Math.random() * 0.4,
        delay: Math.random() * 1.5,
        spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360),
      })),
    []
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <style>{`
        @keyframes buffaloCoinFall {
          from { transform: translateY(-120px) rotate(0deg) }
          to { transform: translateY(${CANVAS_HEIGHT + 120}px) rotate(var(--coin-spin)) }
        }
      `}</style>
      {coins.map((c, i) => (
        <img
          key={i}
          src={COIN_IMAGE_URL}
          alt=""
          draggable={false}
          className="absolute top-0 select-none"
          style={
            {
              left: `${c.left}%`,
              width: c.size,
              height: c.size,
              transform: "translateY(-120px)",
              animation: `buffaloCoinFall ${c.duration}s linear ${c.delay}s infinite`,
              "--coin-spin": `${c.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * A flat image-based button (the game's own art already includes its bevel/circle or pill
 * chrome, so this is just the click/disabled/active behavior around an <img>) — a shrink on
 * press, dimmed + inert while disabled, and a soft glow while toggled on (turbo/autoplay),
 * since none of the source art ships a separate "active" variant.
 */
function ImgButton({
  onClick,
  src,
  alt,
  active = false,
  disabled = false,
  dimDisabled = true,
  className = "",
}: {
  onClick: () => void;
  src: string;
  alt: string;
  active?: boolean;
  disabled?: boolean;
  /** Set false for a disabled state that should still read at full opacity/crispness (e.g. the
   * Spin button's red "spinning" art) — disabled still blocks clicks either way. */
  dimDisabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={alt}
      className={`relative flex items-center justify-center transition-transform duration-100 ease-out active:scale-90 disabled:active:scale-100 disabled:pointer-events-none ${
        dimDisabled ? "disabled:opacity-40" : ""
      } ${active ? "drop-shadow-[0_0_10px_rgba(251,191,36,0.85)] brightness-110" : ""} ${className}`}
    >
      <img src={src} alt={alt} className="z-10 h-full w-full select-none object-contain" draggable={false} />
    </button>
  );
}
