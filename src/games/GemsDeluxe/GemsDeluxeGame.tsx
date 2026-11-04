import { useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { Application } from "pixi.js";
import { budgetResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { GemsDeluxeScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/GemsDeluxeScene";
import {
  getGemsDeluxeConfig,
  spinRequest,
  bonusResolveRequest,
  logSpinResult,
  GemsDeluxeConfigResponse,
  PayoutRow,
  SpinResponseBonus,
  ReelResult,
  GemsDeluxeSymbol,
  syncGemsDeluxeRtpConfigFromServer,
} from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
/** DOLLAR only ever lands on reel index 2 (confirmed: backend's DOLLAR_REEL_INDEX), at the
 * payline/middle row — used to target the same win-highlight glow/scale effect at it on a
 * bonus trigger (see runSpin). */
const DOLLAR_HIGHLIGHT_ROWS: [number[], number[], number[]] = [[], [], [1]];

const BG_MUSIC_URL = "/Sound/casino-vip-music-game-casino-music-5-469384.mp3";
// The track plays at full volume from the very first second (nothing to trim at the front), but
// fades out into ~1.2s of true silence right at its own tail (271.2s total) — trimming to 270s
// cuts that dead air so the loop doesn't have an audible gap before jumping back to the start.
const BG_MUSIC_TRIM_END_SECONDS = 270;

const DEFAULT_BET_LEVELS = [10, 25, 50, 100];

const PAYOUT_LABELS: Record<PayoutRow["key"], string> = {
  SEVEN: "3× 7",
  TRIPLE_BAR: "3× Triple Bar",
  DOUBLE_BAR: "3× Double Bar",
  SINGLE_BAR: "3× Single Bar",
  ANY_BAR: "Any 3 Bars (mixed)",
  DIAMOND_THREE: "3× Diamond",
  DIAMOND_TWO: "2× Diamond",
  DIAMOND_ONE: "1× Diamond",
};

/** This game's own symbol art (frontEnd/public/symbols/gemsDeluxe/) — used to illustrate the
 * paytable in the info popup with the actual symbols instead of text-only labels, per user
 * request ("use this game symbols to define the rules"). Same raw files pixi/symbols.ts loads
 * for the reels (that module chroma-keys them for canvas use; here the plain white-card PNG is
 * shown directly, which reads fine since it matches the reel window's own white-glass look). */
const SYMBOL_ICON_SRC: Record<GemsDeluxeSymbol, string> = {
  SEVEN: "/symbols/gemsDeluxe/7.webp",
  TRIPLE_BAR: "/symbols/gemsDeluxe/TripleBar.webp",
  DOUBLE_BAR: "/symbols/gemsDeluxe/doubleBar.webp",
  SINGLE_BAR: "/symbols/gemsDeluxe/singleBar.webp",
  DIAMOND: "/symbols/gemsDeluxe/daimond.webp",
  DOLLAR: "/symbols/gemsDeluxe/dollar.webp",
};

/** Which symbols (and how many) illustrate each paytable row. */
const PAYOUT_ICONS: Record<PayoutRow["key"], GemsDeluxeSymbol[]> = {
  SEVEN: ["SEVEN", "SEVEN", "SEVEN"],
  TRIPLE_BAR: ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"],
  DOUBLE_BAR: ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"],
  SINGLE_BAR: ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"],
  ANY_BAR: ["TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"],
  DIAMOND_THREE: ["DIAMOND", "DIAMOND", "DIAMOND"],
  DIAMOND_TWO: ["DIAMOND", "DIAMOND"],
  DIAMOND_ONE: ["DIAMOND"],
};

function SymbolIcon({ symbol, size = 32 }: { symbol: GemsDeluxeSymbol; size?: number }) {
  return (
    <img
      src={SYMBOL_ICON_SRC[symbol]}
      alt={symbol}
      className="rounded-md bg-white object-contain p-0.5 shadow"
      style={{ width: size, height: size }}
    />
  );
}

/** What gets spoken (see soundEngine's speak) the instant the picked gem's amount pops out —
 * there's no Take It/Try Again ladder here, one gem pick is the whole bonus round, so this is
 * just an announcement, not a question. */
function buildOfferSpeech(amount: number): string {
  const amountText = `${amount} dollar${amount === 1 ? "" : "s"}`;
  return `You won ${amountText}!`;
}

/** Figures out which symbols actually made up a line win, purely from the returned reel grid —
 * the backend doesn't send winning positions explicitly, but this game's outcome tiers are
 * mutually exclusive (see backend engine.ts's rollTier) so the pattern alone is enough to tell:
 * either the 3 payline (middle-row) symbols form the win (7s/bars, matching or mixed), or — if
 * they don't — it's a diamond-count win. Diamond only ever scores from the PAYLINE row (index
 * 1) — engine.ts's buildLineForTier places diamondOne/Two/Three's diamonds exclusively there,
 * the above/below rows are pure random filler that can coincidentally also render as DIAMOND
 * with nothing to do with the actual win, so those must never be highlighted (checking every
 * row here was the bug: a decorative DIAMOND landing off the payline in one reel lit up
 * alongside a real payline DIAMOND in another). Returns one row-index array per reel (0=above,
 * 1=middle, 2=below) for Reel.playWinHighlight. */
function computeWinHighlightRows(reels: [ReelResult, ReelResult, ReelResult]): [number[], number[], number[]] {
  const middle = reels.map((r) => r.symbols[1]);
  const isBar = (s: string) => s === "TRIPLE_BAR" || s === "DOUBLE_BAR" || s === "SINGLE_BAR";
  const paylineWin = (middle[0] === middle[1] && middle[1] === middle[2]) || middle.every(isBar);

  if (paylineWin) return [[1], [1], [1]];

  return reels.map((r) => (r.symbols[1] === "DIAMOND" ? [1] : [])) as [number[], number[], number[]];
}

interface BonusUiState {
  bonusId: string;
  amount: number;
  reelSymbols: GemsDeluxeSymbol[][];
}

/** GPU-memory budget for the canvas's backing buffer, in pixels (~12 bytes of GPU memory each —
 * see budgetResolution). ~0.6 MP keeps the whole game around 10-15 MB of GPU memory; on smaller
 * screens the canvas renders even fewer pixels (just what's visible). Raise for sharper output. */
const MAX_BACKING_PIXELS = 600_000;

export function GemsDeluxeGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GemsDeluxeScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<GemsDeluxeConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [muted, setMuted] = useState(false);
  const [bonus, setBonus] = useState<BonusUiState | null>(null);
  const [bonusBusy, setBonusBusy] = useState(false);
  // True from the moment the camera starts scrolling up to the bonus board until it's fully
  // back down on the base screen — wider than `bonus` alone (which only becomes true *after*
  // the scroll finishes), so the HTML control bar (not part of the Pixi canvas, so it can't
  // scroll with it) hides for the whole transition instead of sitting fixed in place while the
  // background scrolls out from under it.
  const [bonusViewActive, setBonusViewActive] = useState(false);
  // False until the one-time intro (hold on the top screen, then scroll down to the base game —
  // see playIntroScroll) finishes — gates the HTML control bar the same way bonusViewActive
  // does, so the player can't spin while the intro is still mid-scroll.
  const [introDone, setIntroDone] = useState(false);

  const betAmount = betLevels[betIndex] ?? betLevels[0];

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncGemsDeluxeRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getGemsDeluxeConfig()
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
    // Kicks off the background-music fetch/decode now, in parallel with the Pixi/loading-screen
    // work below, so it's already cached by the time the intro scroll starts (it used to first
    // load right as the scroll began, and that decode/trim work landing mid-scroll was the
    // jerk/hitch the player saw — confirmed with user).
    sound.preloadBackgroundMusic(BG_MUSIC_URL, BG_MUSIC_TRIM_END_SECONDS);
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
          const scene = await GemsDeluxeScene.create(app);
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
        console.error("Gems Deluxe: failed to initialize", err);
        setInitError("Failed to load the game. Please check your connection and try again.");
      });

    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      releaseTextures();
      sound.stopReelSpinLoop();
      sound.stopBonusAlarmLoop();
      sound.cancelSpeech();
      sound.stopBackgroundMusic();
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

  // Keeps the LCD-style BET/WIN readout baked into the reel window in sync — see
  // GemsDeluxeScene's buildReadouts/updateReadouts.
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.updateReadouts(betAmount, winAmount);
  }, [ready, betAmount, winAmount]);

  // Plays once, right as the loading screen hands off — holds briefly on the top (bonus board)
  // screen so the player sees it, then scrolls down to the base game before any control becomes
  // usable (confirmed with user: see the top screen first, then scroll down, then can play).
  const playIntroScroll = useCallback(async () => {
    if (!sceneRef.current) {
      setIntroDone(true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    await sceneRef.current.scrollToBase();
    setIntroDone(true);
  }, []);

  const runSpin = useCallback(async () => {
    if (!sceneRef.current || spinning || spinLockRef.current || bonus || !introDone) return;
    if (!user || user.balance < betAmount) {
      setError("Insufficient balance");
      return;
    }

    sound.resumeAudio();
    setError(null);
    setSpinning(true);
    setWinAmount(0);

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
      const emptyReelIndex = result.bonusTriggered ? null : result.emptyReelIndex;
      await sceneRef.current.spin(result.reels, emptyReelIndex);
      sound.stopReelSpinLoop();
      setBalance(result.balance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding. A bonus trigger logs the stake now (win 0) and
      // the credited offer separately once resolved (see handleTakeIt below) — same two-rows-
      // per-round pattern Crazy 777's respins already use.
      logSpinResult({
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: result.reels.map((r) => r.symbols),
        balanceAfter: result.balance,
      }).catch(() => {});

      if (result.bonusTriggered) {
        const bonusResult = result as SpinResponseBonus;
        // Call out the DOLLAR symbol with the same glow/scale highlight a line win gets, and
        // start the bonus bell ringing — both run for 2s before the screen scrolls up. The bell
        // keeps ringing through the scroll and the pause that follows it, right up until the
        // gem grid actually appears (confirmed with user: this exact sequencing).
        sceneRef.current.playWinHighlights(DOLLAR_HIGHLIGHT_ROWS);
        sound.startBonusAlarmLoop();
        await new Promise((resolve) => setTimeout(resolve, 2000));
        sceneRef.current.clearWinHighlights();
        setBonusViewActive(true);
        await sceneRef.current.scrollToBonus();
        await new Promise((resolve) => setTimeout(resolve, 1750));
        sound.stopBonusAlarmLoop();
        // Fire-and-forget — tells the player what to do the instant the grid appears, paired
        // with the pulsing "PICK A GEM!" text (see GemsDeluxeScene's startGemIdle).
        sound.speak("Pick a gem!");
        // Waits for the player to tap one of the 8 gems, then plays its shake/blast/number-pop
        // reveal — there's no Try Again here, this single pick is the whole bonus round.
        await sceneRef.current.showGemPicker(bonusResult.currentOffer, {
          onShake: () => sound.playShakeRattle(),
          onBlast: () => sound.playBurst(),
          onReveal: (amount) => sound.speak(buildOfferSpeech(amount)),
        });
        setBonus({
          bonusId: bonusResult.bonusId,
          amount: bonusResult.currentOffer,
          reelSymbols: result.reels.map((r) => r.symbols),
        });
      } else {
        setWinAmount(result.winAmount);
        if (result.winAmount > 0) {
          sceneRef.current.playWinHighlights(computeWinHighlightRows(result.reels));
        }
      }
    } catch (err) {
      // The spin request itself failed — give the bet back.
      if (!spinResolved) setBalance(balanceBefore);
      const message = err instanceof Error ? err.message : "Spin failed";
      setError(message);
    } finally {
      spinLockRef.current = false;
      setSpinning(false);
    }
  }, [betAmount, spinning, bonus, introDone, user, setBalance]);

  const handleTakeIt = useCallback(async () => {
    if (!bonus || bonusBusy) return;
    // The reveal line may still be talking — stop it immediately rather than let it keep going
    // over the payout animation.
    sound.cancelSpeech();
    setBonusBusy(true);
    try {
      // Spin/drop the revealed amount down toward the credit meter before actually crediting it.
      sound.playSweepDown();
      await sceneRef.current?.playTakeItPayout();
      const res = await bonusResolveRequest(bonus.bonusId, user?.balance ?? 0);
      setBalance(res.balance);
      setWinAmount(res.winAmount);
      // Fire-and-forget — the other half of this round's two-rows pattern (see runSpin above):
      // stake was already logged at trigger time, this logs the credited offer, bet 0.
      logSpinResult({
        betAmount: 0,
        winAmount: res.winAmount,
        reelSymbols: bonus.reelSymbols,
        balanceAfter: res.balance,
      }).catch(() => {});
      // Hide the TAKE IT button immediately, before the scroll even starts — otherwise it stays
      // mounted (fixed on screen) for the whole ~900ms scroll while the bonus board slides away
      // underneath it, which reads as the button itself sliding down with it.
      setBonus(null);
      await sceneRef.current?.scrollToBase();
      setBonusViewActive(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve bonus");
    } finally {
      setBonusBusy(false);
    }
  }, [bonus, bonusBusy, setBalance]);

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
          <GameJackpotBar gameId="gems-deluxe" />

          <div className="absolute top-0 z-10 w-full flex items-center justify-start px-3 py-2">
            <GameHomeButton size={81} />
          </div>

          <div className="relative overflow-hidden" style={{ height: CANVAS_HEIGHT }}>
            <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-blue-950 text-amber-300/70">
                Loading reels...
              </div>
            )}

            {bonus && (
              <div className="absolute inset-x-0 bottom-[10%] flex items-center w-full justify-center">
                <button
                  onClick={handleTakeIt}
                  disabled={bonusBusy}
                  className="z-10 rounded-2xl border-2 border-green-950 bg-gradient-to-b from-lime-300 via-green-500 to-green-700 px-12 py-4 text-5xl font-black italic text-white shadow-lg disabled:opacity-50"
                >
                  TAKE IT
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">
              {error}
            </div>
          )}

          {/* Sits directly on the cabinet's own glossy control-deck panel (baked into
              bottomScreen.webp, right below the reel window) instead of a separate opaque bar —
              first-pass placement (top/bottom fractions), tune by eye as needed. Hidden during
              the bonus round: these buttons are positioned to sit on the BOTTOM screen's control
              deck, which scrolls out of view once the bonus board (top screen) is showing —
              being plain HTML they don't scroll with the canvas, so left visible they'd just
              float over the bonus board art instead, which already has its own Take-It/Try-Again
              controls. */}
          {!bonusViewActive && introDone && (
            // The cabinet's control-deck panel (baked into bottomScreen.webp) has real painted
            // perspective — it curves/recedes rather than sitting flat-on — so the previously
            // flat HTML button row read as a 2D sticker pasted over a 3D surface (confirmed with
            // user). perspective+rotateX here tilts the whole row back as one rigid plane (top
            // edge receding toward the reels, bottom edge advancing toward the player) so it
            // reads as mounted into that same deck instead of floating flat on top of it.
            <div className="absolute inset-x-0 top-[46%] bottom-[5%]" style={{ perspective: "900px" }}>
              <div
                className="flex h-full items-center justify-between gap-8 pl-[180px] pr-[220px]"
                style={{ transform: "rotateX(24deg)", transformOrigin: "50% 100%" }}
              >
                {/* Utility keys: rules + sound. */}
                <div className="flex items-center gap-[14px]">
                  <CtrlButton onClick={() => setShowPaytable((v) => !v)} ariaLabel="Paytable" className="h-24 w-24 rounded-full">
                    <InfoIcon />
                  </CtrlButton>
                  <CtrlButton
                    onClick={() => {
                      sound.resumeAudio();
                      setMuted(sound.toggleMuted());
                    }}
                    ariaLabel={muted ? "Unmute" : "Mute"}
                    className="h-24 w-24 rounded-full"
                  >
                    <SoundIcon muted={muted} />
                  </CtrlButton>
                </div>

                <CreditScreen balance={user?.balance ?? 0} />

                {/* Bet picker — same framed-glass panel as CREDIT, one chip per level in a row. */}
                <DeckPanel label="Bet">
                  <div className="flex items-center gap-[10px]">
                    {betLevels.map((level, i) => (
                      <BetButton
                        key={level}
                        value={level}
                        active={i === betIndex}
                        disabled={spinning}
                        onClick={() => setBetIndex(i)}
                      />
                    ))}
                  </div>
                </DeckPanel>

                <SpinButton onClick={() => runSpin()} disabled={!ready || spinning || !introDone} spinning={spinning} />
              </div>
            </div>
          )}
        </div>
      </div>

      {showPaytable && config && <PaytableModal config={config} onClose={() => setShowPaytable(false)} />}

      {showLoadingScreen && (
        <LoadingScreen
          title="Gems Deluxe"
          ready={ready && rtpReady}
          error={initError}
          onRetry={retryInit}
          onDone={() => {
            setShowLoadingScreen(false);
            sound.startBackgroundMusic(BG_MUSIC_URL, BG_MUSIC_TRIM_END_SECONDS);
            playIntroScroll();
          }}
        />
      )}
    </>
  );
}

/** Diamond payouts count anywhere on the grid (not a line match like every other row) — tagged
 * distinctly so the difference reads even without the English label, per user request that this
 * card be understandable "even a non-English person." */
function isDiamondRow(key: PayoutRow["key"]): boolean {
  return key === "DIAMOND_ONE" || key === "DIAMOND_TWO" || key === "DIAMOND_THREE";
}

function PaytableModal({ config, onClose }: { config: GemsDeluxeConfigResponse; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="button"
      tabIndex={0}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border-4 border-amber-400/50 bg-gradient-to-b from-blue-950 to-black p-6 text-white shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="text-3xl font-black uppercase tracking-wide text-amber-400 sm:text-4xl">How to Win</div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 text-2xl text-white/80 hover:bg-black/60"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Payline callout — the yellow bar matches the actual in-game payline color, so the
            "3 in a row wins" idea reads visually even without the caption underneath. */}
        <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-center">
          <div className="text-xl font-black uppercase tracking-wide text-yellow-300 sm:text-2xl">
            3 in a Row = Win
          </div>
          <div className="mx-auto mt-2 h-1.5 w-24 rounded-full bg-yellow-400" />
          <div className="mt-1.5 text-xs text-yellow-100/60 sm:text-sm">on the middle line</div>
        </div>

        <table className="mt-5 w-full">
          <tbody className="divide-y divide-white/10">
            {config.paytable.map((row) => (
              <tr key={row.key}>
                <td className="py-3 pr-2">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:text-xs ${
                      isDiamondRow(row.key) ? "bg-violet-500/25 text-violet-200" : "bg-yellow-400/20 text-yellow-200"
                    }`}
                  >
                    {isDiamondRow(row.key) ? "Anywhere" : "Line"}
                  </span>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    {PAYOUT_ICONS[row.key].map((symbol, i) => (
                      <SymbolIcon key={i} symbol={symbol} size={56} />
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-white/50 sm:text-sm">{PAYOUT_LABELS[row.key]}</div>
                </td>
                <td className="py-3 pl-2 text-right">
                  <span className="inline-block rounded-lg bg-lime-500/20 px-3 py-1.5 text-2xl font-black text-lime-300 sm:px-4 sm:text-3xl">
                    ×{row.payout}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Bonus trigger — the DOLLAR symbol itself + a gold BONUS badge, no sentence required
            to get the point across. */}
        <div className="mt-6 flex items-center justify-center gap-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-4">
          <SymbolIcon symbol="DOLLAR" size={64} />
          <span className="text-4xl font-black text-amber-300">→</span>
          <span className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-2.5 text-xl font-black uppercase tracking-wide text-amber-950 sm:text-2xl">
            Bonus
          </span>
        </div>
        <div className="mt-1.5 text-center text-xs text-amber-100/50 sm:text-sm">on reel 3</div>

        {/* Bonus-round summary — colored to match the real TAKE IT button so the association is
            immediate regardless of language. */}
        <div className="mt-5 rounded-2xl bg-blue-900/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-300 bg-black/30 text-2xl font-black text-amber-300">
              8
            </span>
            <span className="text-sm font-semibold uppercase tracking-wide text-blue-200 sm:text-base">Gems</span>
            <span className="rounded-xl border-2 border-green-950 bg-gradient-to-b from-lime-300 via-green-500 to-green-700 px-4 py-2 text-base font-black italic text-white shadow-md sm:text-lg">
              ✓ Take It
            </span>
          </div>
          <div className="mt-3 text-center text-xs text-blue-200/70 sm:text-sm">
            Pick one of the 8 gems to reveal your prize, then Take It to bank the cash.
          </div>
        </div>
      </div>
    </div>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" />
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

/** Shared look for the deck's keys: dark emerald glass in a gold bezel (the cabinet's own gold
 * trim), with a gloss highlight and a drop-shadow ledge that collapses on press. `active` lights
 * the key up in gold — used for the selected bet. */
const KEY_SHADOW = "0 4px 0 #3a2a06, 0 0 10px 1px rgba(251,191,36,0.35), 0 7px 10px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -4px 6px rgba(0,0,0,0.45)";
const KEY_SHADOW_ACTIVE = "0 4px 0 #5b3a06, 0 0 16px 3px rgba(251,191,36,0.75), 0 7px 10px rgba(0,0,0,0.55), inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -4px 6px rgba(120,53,15,0.45)";

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
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`relative flex items-center justify-center overflow-hidden border-[3px] transition duration-100 ease-out hover:brightness-110 active:translate-y-[3px] disabled:pointer-events-none disabled:opacity-40 ${
        active
          ? "border-amber-200 bg-gradient-to-b from-yellow-200 via-amber-400 to-amber-600 text-emerald-950"
          : "border-amber-400 bg-gradient-to-b from-emerald-700 via-emerald-900 to-emerald-950 text-amber-100"
      } ${className}`}
      style={{ boxShadow: active ? KEY_SHADOW_ACTIVE : KEY_SHADOW }}
    >
      <span className="pointer-events-none absolute inset-x-[12%] top-[6%] h-[34%] rounded-full bg-gradient-to-b from-white/40 to-white/0" />
      <span className="relative drop-shadow-[0_2px_1px_rgba(0,0,0,0.6)]">{children}</span>
    </button>
  );
}

/** Framed dark-glass panel with a small gold caption on top — CREDIT and BET share it, so the
 * deck reads as one matched set of instruments. */
function DeckPanel({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div
      className={`flex h-[132px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-amber-400/80 bg-gradient-to-b from-black/85 to-emerald-950/85 px-5 ${className}`}
      style={{ boxShadow: "0 0 10px 1px rgba(251,191,36,0.35), inset 0 3px 8px rgba(0,0,0,0.9)" }}
    >
      <span className="text-xl font-bold uppercase leading-none tracking-[0.25em] text-amber-300">{label}</span>
      {children}
    </div>
  );
}

/** One bet chip in the BET panel — the selected level lights up gold. */
function BetButton({
  value,
  active,
  disabled,
  onClick,
}: {
  value: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <CtrlButton onClick={onClick} active={active} disabled={disabled} ariaLabel={`Bet ${value}`} className="h-[72px] w-[116px] rounded-lg">
      <span className="text-4xl font-black">${value}</span>
    </CtrlButton>
  );
}

/** The big illuminated SPIN button the panel is built around — emerald face in a thick gold
 * bezel, glossy highlight, and a drop-shadow ledge that collapses on press. */
function SpinButton({ onClick, disabled, spinning }: { onClick: () => void; disabled: boolean; spinning: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Spin"
      className="relative flex h-[132px] w-[300px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[6px] border-amber-300 bg-gradient-to-b from-emerald-400 via-emerald-600 to-emerald-800 transition duration-100 ease-out hover:brightness-110 active:translate-y-[4px] disabled:opacity-50 disabled:active:translate-y-0"
      style={{
        boxShadow:
          "0 7px 0 #3a2a06, 0 0 24px 5px rgba(251,191,36,0.5), 0 14px 20px rgba(0,0,0,0.6), inset 0 3px 3px rgba(255,255,255,0.6), inset 0 -10px 14px rgba(0,0,0,0.35)",
      }}
    >
      <span className="pointer-events-none absolute inset-x-[10%] top-[6%] h-[36%] rounded-full bg-gradient-to-b from-white/50 to-white/0" />
      <span className="relative text-7xl font-black italic tracking-wider text-white drop-shadow-[0_3px_2px_rgba(0,0,0,0.75)]">
        {spinning ? "..." : "SPIN"}
      </span>
    </button>
  );
}

/** The credit meter as a backlit LCD in the shared deck panel — Digital-7 digits, same font the
 * in-canvas BET/WIN readouts use (see GemsDeluxeScene's buildReadouts). */
function CreditScreen({ balance }: { balance: number }) {
  return (
    <DeckPanel label="Credit" className="w-[380px]">
      <span className="text-7xl leading-none text-lime-300" style={{ fontFamily: "Digital-7, monospace", textShadow: "0 0 10px rgba(190,242,100,0.45)" }}>
        {balance.toFixed(2)}
      </span>
    </DeckPanel>
  );
}

function InfoIcon() {
  return (
    <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="11" x2="12" y2="16.5" strokeLinecap="round" />
      <circle cx="12" cy="7.3" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
