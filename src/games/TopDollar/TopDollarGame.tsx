import { useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { TopDollarScene, CANVAS_WIDTH, CANVAS_HEIGHT, INITIAL_VIEW } from "./pixi/TopDollarScene";
import { BOTTOM_SCREEN_URL, TOP_SCREEN_URL } from "./pixi/symbols";
import {
  getTopDollarConfig,
  spinRequest,
  bonusAdvanceRequest,
  bonusResolveRequest,
  logSpinResult,
  TopDollarConfigResponse,
  SpinResponseBonus,
  ReelResult,
  TopDollarSymbol,
  syncTopDollarRtpConfigFromServer,
} from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "../shared/SoundSettings";
import { InfoScreen } from "./InfoScreen";

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

const OFFER_LABELS = ["First Offer", "Second Offer", "Third Offer", "Last Offer"];

/** The last offer is auto-accepted (no real choice left by then) — it stays on screen, with its
 * spoken line, for at least MIN and at most MAX ms before it's credited and the screen scrolls
 * back down (MAX caps it in case the browser's speech never reports finishing). */
const LAST_OFFER_MIN_HOLD_MS = 2000;
const LAST_OFFER_MAX_HOLD_MS = 6000;

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** What gets spoken (see soundEngine's speak) each time an offer is revealed — the last offer
 * auto-accepts with no real choice, so it gets its own line instead of asking a question the
 * player can't actually act on. */
function buildOfferSpeech(offerNumber: number, isLastOffer: boolean, amount: number): string {
  const label = OFFER_LABELS[offerNumber - 1] ?? `Offer ${offerNumber}`;
  const amountText = `${amount} dollar${amount === 1 ? "" : "s"}`;
  return isLastOffer ? `${label}: ${amountText}. This one's locked in.` : `${label}: ${amountText}. Take it, or try again?`;
}

/** Figures out which symbols actually made up a line win, purely from the returned reel grid —
 * the backend doesn't send winning positions explicitly, but this game's outcome tiers are
 * mutually exclusive (see backend engine.ts's rollTier) so the pattern alone is enough to tell:
 * either the 3 payline (middle-row) symbols form the win (7s/bars, matching or mixed), or — if
 * they don't — it's a diamond-count win, scored from every DIAMOND showing anywhere on the grid.
 * Returns one row-index array per reel (0=above, 1=middle, 2=below) for Reel.playWinHighlight. */
function computeWinHighlightRows(reels: [ReelResult, ReelResult, ReelResult]): [number[], number[], number[]] {
  const middle = reels.map((r) => r.symbols[1]);
  const isBar = (s: string) => s === "TRIPLE_BAR" || s === "DOUBLE_BAR" || s === "SINGLE_BAR";
  const paylineWin = (middle[0] === middle[1] && middle[1] === middle[2]) || middle.every(isBar);

  if (paylineWin) return [[1], [1], [1]];

  return reels.map((r) => r.symbols.flatMap((s, row) => (s === "DIAMOND" ? [row] : []))) as [
    number[],
    number[],
    number[],
  ];
}

interface BonusUiState {
  bonusId: string;
  currentOffer: number;
  offerNumber: number;
  offerCount: number;
  isLastOffer: boolean;
  reelSymbols: TopDollarSymbol[][];
}

export function TopDollarGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  /** Both background screens stacked (top screen, then bottom screen) — moved with the scene's
   * camera (see onCameraMove), since the art is HTML behind the cropped canvas. */
  const bgStripRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<TopDollarScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<TopDollarConfigResponse | null>(null);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  // The Sound key opens the shared sound settings popup (same as every other game's control bar);
  // its icon shows muted when nothing can be heard.
  const soundMuted = isSilent(useSoundSettings());
  const [showSound, setShowSound] = useState(false);
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
    void syncTopDollarRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getTopDollarConfig()
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
    // load right as the scroll began, and that decode/trim work landing mid-scroll was a jerk/
    // hitch — same fix as GemsDeluxe).
    sound.preloadBackgroundMusic(BG_MUSIC_URL, BG_MUSIC_TRIM_END_SECONDS);
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        // Only the part of the screen Pixi draws on (see the VIEW rects in TopDollarScene, which
        // resizes it per screen) — the background art is plain <img>s.
        width: INITIAL_VIEW.width,
        height: INITIAL_VIEW.height,
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
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await TopDollarScene.create(app);
          if (cancelled) {
            scene.destroy();
            return;
          }
          scene.onCameraMove = (y) => {
            if (bgStripRef.current) bgStripRef.current.style.transform = `translateY(${y}px)`;
          };
          // A fresh scene starts on the top screen — line the art up with it (matters on a retry).
          scene.onCameraMove(0);
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
        console.error("Top Dollar: failed to initialize", err);
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

  // Keep the canvas's backing resolution matched to its on-screen size: it's 1920x1080 in design
  // space but CSS-scaled by fitScale, so on most screens a full-size backing buffer is mostly
  // pixels the browser throws away. Debounced so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = fitResolution(fitScale);
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      sceneRef.current?.setResolution(resolution);
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  // Keeps the LCD-style BET/WIN readout baked into the reel window in sync — see
  // TopDollarScene's buildReadouts/updateReadouts.
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
      await sceneRef.current.spin(result.reels, emptyReelIndex, sound.reelStopSounds(3));
      sound.stopReelSpinLoop();
      setBalance(result.balance);

      // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
      // waits on or depends on this succeeding. A bonus trigger logs the stake now (win 0) and
      // the credited offer separately once resolved (see handleTakeIt below) — same two-rows-
      // per-round pattern Crazy 777/Gems Deluxe's bonus rounds already use.
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
        // bundle-selection chase actually starts (confirmed with user: this exact sequencing).
        sceneRef.current.playWinHighlights(DOLLAR_HIGHLIGHT_ROWS);
        sound.startBonusAlarmLoop();
        await new Promise((resolve) => setTimeout(resolve, 3500));
        sceneRef.current.clearWinHighlights();
        setBonusViewActive(true);
        await sceneRef.current.scrollToBonus();
        await new Promise((resolve) => setTimeout(resolve, 1750));
        sound.stopBonusAlarmLoop();
        await sceneRef.current.playBundleSelection(bonusResult.currentOffer);
        setBonus({
          bonusId: bonusResult.bonusId,
          currentOffer: bonusResult.currentOffer,
          offerNumber: bonusResult.offerNumber,
          offerCount: bonusResult.offerCount,
          isLastOffer: bonusResult.isLastOffer,
          reelSymbols: result.reels.map((r) => r.symbols),
        });
        // Fire-and-forget — the buttons are usable immediately, not gated on the line finishing.
        sound.speak(buildOfferSpeech(bonusResult.offerNumber, bonusResult.isLastOffer, bonusResult.currentOffer));
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

  /** Credits `state`'s current offer and scrolls back down to the base game. Takes the bonus
   * explicitly (not from a render's closure) so the last offer's auto-accept, which runs right
   * after setBonus, always resolves the offer that's actually showing. Throws on failure. */
  const resolveBonus = useCallback(
    async (state: BonusUiState) => {
      // The offer line may still be talking — stop it rather than let it run over the scroll.
      sound.cancelSpeech();
      const res = await bonusResolveRequest(state.bonusId, balanceRef.current);
      setBalance(res.balance);
      setWinAmount(res.winAmount);
      // Fire-and-forget — the other half of this round's two-rows pattern (see runSpin above):
      // stake was already logged at trigger time, this logs the credited offer, bet 0.
      logSpinResult({
        betAmount: 0,
        winAmount: res.winAmount,
        reelSymbols: state.reelSymbols,
        balanceAfter: res.balance,
      }).catch(() => {});
      // Hide the offer panel immediately, before the scroll even starts — otherwise it stays
      // mounted (fixed on screen) for the whole scroll while the bonus board slides away
      // underneath it, which reads as the panel itself sliding down with it.
      setBonus(null);
      await sceneRef.current?.scrollToBase();
      setBonusViewActive(false);
    },
    [setBalance]
  );

  /** The last offer is auto-accepted (confirmed with user: no real choice left by then): it's
   * shown with its amount while its line is spoken, then credited, then the screen scrolls down. */
  const lockInLastOffer = useCallback(
    async (state: BonusUiState) => {
      const speech = sound.speak(buildOfferSpeech(state.offerNumber, true, state.currentOffer));
      await Promise.race([Promise.all([speech, delay(LAST_OFFER_MIN_HOLD_MS)]), delay(LAST_OFFER_MAX_HOLD_MS)]);
      await resolveBonus(state);
    },
    [resolveBonus]
  );

  const handleTakeIt = useCallback(async () => {
    if (!bonus || bonusBusy) return;
    setBonusBusy(true);
    try {
      await resolveBonus(bonus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve bonus");
    } finally {
      setBonusBusy(false);
    }
  }, [bonus, bonusBusy, resolveBonus]);

  const handleTryAgain = useCallback(async () => {
    if (!bonus || bonusBusy || bonus.isLastOffer) return;
    // Stop the current offer's line before rolling the next one.
    sound.cancelSpeech();
    setBonusBusy(true);
    try {
      const res = await bonusAdvanceRequest(bonus.bonusId);
      await sceneRef.current?.playBundleSelection(res.currentOffer);
      const next = { ...bonus, ...res };
      setBonus(next);
      if (next.isLastOffer) {
        await lockInLastOffer(next);
      } else {
        sound.speak(buildOfferSpeech(res.offerNumber, false, res.currentOffer));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not advance bonus");
    } finally {
      setBonusBusy(false);
    }
  }, [bonus, bonusBusy, lockInLastOffer]);

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
          <GameJackpotBar gameId="top-dollar" />

          <div className="absolute top-0 z-10 w-full flex items-center justify-start px-3 py-2">
            <GameHomeButton size={81} />
          </div>

          <div className="relative overflow-hidden" style={{ height: CANVAS_HEIGHT }}>
            {/* The cropped canvas is pinned inside this host by TopDollarScene (see setView). */}
            <div ref={canvasHostRef} className="relative mx-auto overflow-hidden" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
              <div ref={bgStripRef} className="pointer-events-none absolute left-0 top-0 w-full" style={{ height: CANVAS_HEIGHT * 2 }}>
                <img src={TOP_SCREEN_URL} alt="" draggable={false} className="block w-full select-none" style={{ height: CANVAS_HEIGHT }} />
                <img src={BOTTOM_SCREEN_URL} alt="" draggable={false} className="block w-full select-none" style={{ height: CANVAS_HEIGHT }} />
              </div>
            </div>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-blue-950 text-amber-300/70">
                Loading reels...
              </div>
            )}

            {bonus && (
              <div className="absolute inset-x-0 bottom-[10%] flex items-center w-full justify-center">
                {!bonus.isLastOffer ? (
                  <div className="z-10 flex w-[70%] items-between justify-between gap-6">
                    <button
                      onClick={handleTryAgain}
                      disabled={bonusBusy}
                      className="rounded-2xl border-2 border-red-950 bg-gradient-to-b from-orange-300 via-red-500 to-red-700 px-8 py-3 text-2xl font-black italic text-white shadow-lg disabled:opacity-50"
                    >
                      TRY AGAIN
                    </button>
                    <div className="gap-10 rounded-xl border-2 border-amber-400 bg-black/70 px-8 py-3 text-center">
                      <div className="text-lg font-bold uppercase tracking-wide text-amber-300">
                        {OFFER_LABELS[bonus.offerNumber - 1] ?? `Offer ${bonus.offerNumber}`}
                      </div>
                      <div className="text-5xl font-black text-white">${bonus.currentOffer.toFixed(2)}</div>
                    </div>
                    <button
                      onClick={handleTakeIt}
                      disabled={bonusBusy}
                      className="rounded-2xl border-2 border-green-950 bg-gradient-to-b from-lime-300 via-green-500 to-green-700 px-8 py-3 text-2xl font-black italic text-white shadow-lg disabled:opacity-50"
                    >
                      TAKE IT
                    </button>
                  </div>
                ) : (
                  // The last offer: shown with its amount while it's auto-accepted (see
                  // lockInLastOffer). TAKE IT only appears if that failed, so the round can't stall.
                  <div className="z-10 flex flex-col items-center gap-4">
                    <div className="rounded-xl border-2 border-amber-400 bg-black/70 px-10 py-3 text-center">
                      <div className="text-lg font-bold uppercase tracking-wide text-amber-300">
                        {OFFER_LABELS[bonus.offerNumber - 1] ?? `Offer ${bonus.offerNumber}`}
                      </div>
                      <div className="text-5xl font-black text-white">${bonus.currentOffer.toFixed(2)}</div>
                      <div className="mt-1 text-lg font-bold uppercase tracking-wide text-lime-300">Locked in!</div>
                    </div>
                    {!bonusBusy && (
                      <button
                        onClick={handleTakeIt}
                        className="rounded-2xl border-2 border-green-950 bg-gradient-to-b from-lime-300 via-green-500 to-green-700 px-8 py-3 text-2xl font-black italic text-white shadow-lg"
                      >
                        TAKE IT
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 mx-3 mt-2 rounded bg-red-900/60 px-10 py-5 text-5xl text-center text-red-100">
              {error}
            </div>
          )}

          {/* Sits directly on the cabinet's own glossy control-deck panel (baked into
              bottomScreen.png, right below the reel window) instead of a separate opaque bar —
              first-pass placement (top/bottom fractions), tune by eye as needed. Hidden during
              the bonus round: these buttons are positioned to sit on the BOTTOM screen's control
              deck, which scrolls out of view once the bonus board (top screen) is showing —
              being plain HTML they don't scroll with the canvas, so left visible they'd just
              float over the bonus board art instead, which already has its own Take-It/Try-Again
              controls. */}
          {!bonusViewActive && introDone && (
            <div className="absolute inset-x-0 top-[48%] bottom-[5%] flex items-center justify-between gap-3 pl-[180px] pr-[180px]">
              <div className="flex items-center gap-3">
                <CtrlButton onClick={() => setShowInfo(true)} active={showInfo} ariaLabel="Game rules and information" className="h-20 w-20">
                  <InfoIcon />
                </CtrlButton>
                <CtrlButton onClick={() => setShowSound(true)} active={showSound} ariaLabel="Sound settings" className="h-20 w-20">
                  <SoundIcon muted={soundMuted} />
                </CtrlButton>
              </div>
              <div>
                <CreditScreen balance={user?.balance ?? 0} />
              </div>

              <div className="grid grid-cols-2 gap-2">
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

              <SpinButton onClick={() => runSpin()} disabled={!ready || spinning || !introDone} spinning={spinning} />
            </div>
          )}
        </div>
      </div>

      {showInfo && (
        <InfoScreen bet={betAmount} offerCount={config?.offerCount ?? OFFER_LABELS.length} onClose={() => setShowInfo(false)} />
      )}
      {showSound && <SoundSettingsPopup onClose={() => setShowSound(false)} />}

      {showLoadingScreen && (
        <LoadingScreen
          title="Top Dollar"
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

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
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

/** A physical cabinet button: a chrome/ivory face ringed in gold (matching bottomScreen.png's
 * gold trim), sitting on a drop-shadow "ledge" that collapses on press for a real pushbutton
 * feel — same technique Buffalo 777's CtrlButton uses, reskinned with a gold bezel to match
 * this cabinet's own gold accents instead of a plain flat web button. */
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
  const ledge = active ? "#1e3a8a" : "#3a2a06";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative flex items-center justify-center rounded-xl border-[3px] bg-gradient-to-b p-[3px] transition-transform duration-100 ease-out hover:brightness-105 active:translate-y-[3px] disabled:opacity-40 disabled:active:translate-y-0 disabled:pointer-events-none ${
        active
          ? "border-amber-300 from-green-400 via-green-600 to-green-800"
          : "border-amber-400 from-white via-neutral-100 to-neutral-300"
      } ${className}`}
      style={{
        boxShadow: `0 4px 0 ${ledge}, 0 0 10px 1px rgba(251,191,36,0.5), 0 7px 10px rgba(0,0,0,0.5), inset 0 2px 1px rgba(255,255,255,0.95), inset 0 -4px 5px rgba(0,0,0,0.22)`,
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.boxShadow = `0 0px 0 ${ledge}, 0 0 6px 1px rgba(251,191,36,0.5), 0 1px 2px rgba(0,0,0,0.4), inset 0 3px 6px rgba(0,0,0,0.4)`;
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.boxShadow = `0 4px 0 ${ledge}, 0 0 10px 1px rgba(251,191,36,0.5), 0 7px 10px rgba(0,0,0,0.5), inset 0 2px 1px rgba(255,255,255,0.95), inset 0 -4px 5px rgba(0,0,0,0.22)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = `0 4px 0 ${ledge}, 0 0 10px 1px rgba(251,191,36,0.5), 0 7px 10px rgba(0,0,0,0.5), inset 0 2px 1px rgba(255,255,255,0.95), inset 0 -4px 5px rgba(0,0,0,0.22)`;
      }}
    >
      <span
        className="pointer-events-none absolute inset-x-[10%] top-[8%] h-[32%] rounded-md bg-white/55"
        style={{ filter: "blur(2px)" }}
      />
      {children}
    </button>
  );
}

/** Square 3D bet-selection button — same pressable gold-bezel mechanic as CtrlButton, sized
 * for a text label instead of an icon, with an "active" (currently selected) highlight. */
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
    <CtrlButton onClick={onClick} active={active} disabled={disabled} ariaLabel={`Bet ${value}`} className="h-14 w-28">
      <span className="text-4xl font-black text-black">${value}</span>
    </CtrlButton>
  );
}

/** The big illuminated SPIN button real cabinets center their whole panel on — a domed gold/
 * red button (not a rectangular web button) with a thick metallic bezel, a glossy highlight
 * arc, and the same pressable drop-shadow-ledge mechanic as CtrlButton, scaled up. */
function SpinButton({ onClick, disabled, spinning }: { onClick: () => void; disabled: boolean; spinning: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Spin"
      className="relative flex h-[120px] w-[240px] shrink-0 items-center justify-center rounded-2xl border-[6px] border-amber-300 bg-gradient-to-b from-yellow-200 via-amber-400 to-amber-600 p-0 transition-transform duration-100 ease-out active:translate-y-[4px] disabled:opacity-50 disabled:active:translate-y-0"
      style={{
        boxShadow:
          "0 8px 0 #5b1a0e, 0 0 22px 4px rgba(251,191,36,0.55), 0 14px 20px rgba(0,0,0,0.6), inset 0 3px 3px rgba(255,255,255,0.7), inset 0 -8px 12px rgba(0,0,0,0.35)",
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.boxShadow =
          "0 0px 0 #5b1a0e, 0 0 12px 2px rgba(251,191,36,0.5), 0 3px 6px rgba(0,0,0,0.5), inset 0 5px 10px rgba(0,0,0,0.45)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.boxShadow =
          "0 8px 0 #5b1a0e, 0 0 22px 4px rgba(251,191,36,0.55), 0 14px 20px rgba(0,0,0,0.6), inset 0 3px 3px rgba(255,255,255,0.7), inset 0 -8px 12px rgba(0,0,0,0.35)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow =
          "0 8px 0 #5b1a0e, 0 0 22px 4px rgba(251,191,36,0.55), 0 14px 20px rgba(0,0,0,0.6), inset 0 3px 3px rgba(255,255,255,0.7), inset 0 -8px 12px rgba(0,0,0,0.35)";
      }}
    >
      <span className="absolute inset-1 rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800" />
      <span
        className="pointer-events-none absolute inset-x-[8%] top-[8%] h-[32%] rounded-2xl bg-white/45"
        style={{ filter: "blur(4px)" }}
      />
      <span className="relative text-7xl font-black italic tracking-wide text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
        {spinning ? "..." : "SPIN"}
      </span>
    </button>
  );
}

/** The credit meter as a proper backlit LCD screen — dark glass, gold-lit bezel, Digital-7
 * digits — instead of plain text floating on the cabinet art. Same font Mega 10X Pay/Crazy 777
 * use for their own LCD-style readouts (see TopDollarScene's buildReadouts). */
function CreditScreen({ balance }: { balance: number }) {
  return (
    <div
      className="flex flex-col items-center rounded-lg border-2 border-amber-400/80 bg-gradient-to-b from-neutral-950 to-black px-5 py-1.5"
      style={{
        boxShadow: "0 0 8px 1px rgba(251,191,36,0.45), inset 0 3px 8px rgba(0,0,0,0.9), inset 0 0 12px rgba(0,0,0,0.6)",
      }}
    >
      <span className="text-md font-bold uppercase tracking-widest text-amber-400/90">Credit</span>
      <span className="text-5xl font-bold text-lime-300" style={{ fontFamily: "Digital-7, monospace" }}>
        {balance.toFixed(2)}
      </span>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.4">
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="11" x2="12" y2="16.5" strokeLinecap="round" />
      <circle cx="12" cy="7.3" r="1.1" fill="black" stroke="none" />
    </svg>
  );
}
