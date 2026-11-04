import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import gsap from "gsap";
import { useAuth } from "../../context/AuthContext";
import {
  LifeOfLuxuryScene,
  GRID_WIDTH,
  GRID_HEIGHT,
  CELL_WIDTH,
  CELL_HEIGHT,
  COLUMN_GAP,
  PaylinePattern,
  WinHighlightGroup,
} from "./pixi/LifeOfLuxuryScene";
import { getLifeOfLuxuryConfig, spinRequest, logSpinResult, Grid, syncLifeOfLuxuryRtpConfigFromServer, LifeOfLuxuryConfigResponse } from "./api";
import { InfoScreen } from "./InfoScreen";
import * as sound from "../shared/sound/soundEngine";
import { FreeSpinIntro } from "./FreeSpinIntro";
import { FreeSpinOutro } from "./FreeSpinOutro";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import { GameHomeButton } from "../shared/GameHomeButton";
import GameController from "../shared/GameController";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

// const LINE_COUNT = 15;
const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
const AUTOPLAY_GAP_MS = 700;
const FREE_SPIN_GAP_MS = 700;
/** Blink cadence for the active winning line's border+bridge (canvas) and its sidebar tick —
 * both driven off this same clock so they never drift out of sync. */
const WIN_BLINK_TOGGLE_MS = 320;
/** How long each winning line gets "on stage" before the cycle moves to the next one. Runs
 * forever (wrapping back to the first line) until the next spin cancels it — see stopWinCycle. */
const WIN_LINE_HOLD_MS = 1280;

/** Decorative payline dots strung along both sides of the reel frame — one color per line,
 * also used to color that line's win overlay drawn in Pixi (see LifeOfLuxuryScene.
 * buildWinGroups/drawActiveGroup) so a lit line's HTML dot and its on-grid line always match. */
 const LINE_DOT_COLORS = [
  "#FF2424", "#0062FF", "#FFC71E", "#00EF58", "#008734", "#A60000", "#002791", "#A21CAF",
  "#FF6A00", "#03FFEA", "#5905E9", "#00D9FF", "#FF0080", "#1500FF", "#99FF00",
];
/** The 15 fixed payline patterns — mirrors backEnd/src/games/LifeOfLuxury/config.ts's PAYLINES
 * exactly (row index 0=top/1=mid/2=bottom per reel). Used both for the "show all paylines"
 * reference overlay (see the LINES box below) and to lay out the sidebar dots below — the
 * server is what actually evaluates wins, this is display-only. */
const PAYLINES: PaylinePattern[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [2, 1, 0, 1, 2],
  [0, 1, 2, 1, 0],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];

interface PaylineDotSpec {
  lineIndex: number;
  /** Rotation for the little connector tick. Left-side dots use the pattern's *start* — its
   * reel-1→reel-2 step (down/up/flat). Right-side dots use the pattern's *end* — its
   * reel-4→reel-5 step — since the right-side dot sits past the line's finish, not its start. */
  angleDeg: number;
}

const WILD_GIF_SRC = "/symbols/lifeOfLuxury/diamond.webp";
/** Durations (seconds) for one wild's flight: reel cell -> scale up -> center of screen -> hold
 * -> free-spin wild counter. Sequenced one wild at a time when more than one lands in a spin
 * (see playWildFlights). */
const WILD_FLIGHT_SCALE_UP_S = 0.4;
const WILD_FLIGHT_TO_CENTER_S = 0.6;
const WILD_FLIGHT_HOLD_S = 1.5;
const WILD_FLIGHT_TO_COUNTER_S = 0.5;
const WILD_FLIGHT_HIDE_S = 0.15;

/** Every WILD cell in a landed grid, left-to-right (reel), top-to-bottom (row) within a reel —
 * matches WILD_ALLOWED_REELS' natural order, and the order the user sees them settle in. */
function findWildPositions(grid: Grid): [number, number][] {
  const positions: [number, number][] = [];
  grid.forEach((reel, reelIndex) => {
    reel.forEach((symbol, rowIndex) => {
      if (symbol === "WILD") positions.push([reelIndex, rowIndex]);
    });
  });
  return positions;
}

const TICK_ANGLE_DEG = 30;

function tickAngle(from: number, to: number): number {
  return to > from ? TICK_ANGLE_DEG : to < from ? -TICK_ANGLE_DEG : 0;
}

/**
 * Groups all 15 lines by their reel-1 (leftmost) row — exactly 5 lines land in each of the 3
 * row groups (top/mid/bottom), since the pattern set is balanced. Per group: the first 3 lines
 * (by line number) become the left-side dots at that row's height, the remaining 2 become the
 * right-side dots at that SAME row height (not their own reel-5 row) — so left (3x3=9) + right
 * (2x3=6) accounts for all 15 lines exactly once, none shown twice.
 */
function buildPaylineDotGroups(): { left: PaylineDotSpec[][]; right: PaylineDotSpec[][] } {
  const left: PaylineDotSpec[][] = [[], [], []];
  const right: PaylineDotSpec[][] = [[], [], []];
  for (let row = 0; row < 3; row++) {
    const lineIndices = PAYLINES.map((_, i) => i).filter((i) => PAYLINES[i][0] === row);
    lineIndices.forEach((lineIndex, j) => {
      const pattern = PAYLINES[lineIndex];
      if (j < 3) left[row].push({ lineIndex, angleDeg: tickAngle(pattern[0], pattern[1]) });
      else right[row].push({ lineIndex, angleDeg: tickAngle(pattern[3], pattern[4]) });
    });
  }
  return { left, right };
}

const { left: LEFT_DOT_GROUPS, right: RIGHT_DOT_GROUPS } = buildPaylineDotGroups();

export function LifeOfLuxuryGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<LifeOfLuxuryScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;
  /** Fixed-position overlay (viewport coordinates, see playWildFlights) that flying wild GIFs are
   * mounted into directly — imperative DOM, not React state, since these are short-lived and
   * don't need to survive re-renders. */
  const wildFlightLayerRef = useRef<HTMLDivElement | null>(null);
  /** The free-spins header's wild-count badge — the on-screen destination every flying wild
   * animates toward (see playWildFlights). */
  const wildCounterRef = useRef<HTMLDivElement | null>(null);
  /** Just the number inside wildCounterRef — given its own little "pop" each time it bumps. */
  const wildCountTextRef = useRef<HTMLSpanElement | null>(null);

  const [ready, setReady] = useState(false);
  /** True for the whole duration a wild is flying to the counter — dims every symbol on the
   * reels (see the overlay in the Reels section below) and, since playWildFlights is awaited
   * before runSpin returns, also blocks the next free spin from starting underneath it. */
  const [dimReelsForWildFlight, setDimReelsForWildFlight] = useState(false);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Set when Pixi/WebGL init or asset loading fails — see the init effect below. Distinct
  // from `error` above, which is for in-game spin failures after the game has already loaded.
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [fast, setFast] = useState(false);
  const [muted, setMuted] = useState(() => sound.isMuted());
  const [showInfo, setShowInfo] = useState(false);
  /** Paytable / paylines / scatter rules for the info popup — null until loaded. */
  const [config, setConfig] = useState<LifeOfLuxuryConfigResponse | null>(null);
  // const [paylinesVisible, setPaylinesVisible] = useState(true);
  /** The current spin's winning lines/scatter, cycled through one at a time (see the three
   * effects below) — infinitely, until stopWinCycle cancels it at the start of the next spin. */
  const [winGroups, setWinGroups] = useState<WinHighlightGroup[]>([]);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [winBlinkOn, setWinBlinkOn] = useState(true);

  const [freeSpins, setFreeSpins] = useState<{
    remaining: number;
    total: number;
    totalWin: number;
    lockedBetIndex: number;
  } | null>(null);
  const [freeSpinAward, setFreeSpinAward] = useState<number | null>(null);
  /** Player pressed SPIN while the free-spins banner was up — plays its exit, then the round starts. */
  const [freeSpinStartRequested, setFreeSpinStartRequested] = useState(false);
  /** Running total of the current free-spins round (wild bonus included once it ends) — shown in
   * the WIN box during the round and only credited to the balance once the outro is tapped away. */
  const roundWinRef = useRef(0);
  /** The triggering spin's own win, held in roundWinRef — the round minimum counts free-spin wins only. */
  const triggerWinRef = useRef(0);
  const [freeSpinsSummary, setFreeSpinsSummary] = useState<{
    totalWin: number;
    wildCount: number;
    multiplier: number;
    bonusWin: number;
    finalWin: number;
    /** The triggering spin's own win, held and paid out with the round (not multiplied). */
    triggerWin: number;
  } | null>(null);
  /** How many wilds have landed so far this free-spin round, as shown by the header badge —
   * bumped one at a time as each flying-wild animation lands (see playWildFlights), reset when a
   * new round starts. Purely cosmetic: the real payout multiplier comes from the server's
   * freeSpinRoundResult, never from this. */
  const [displayWildCount, setDisplayWildCount] = useState(0);

  const bet = betLevels[betIndex] ?? betLevels[0];
  // const balance = user?.balance ?? 0;
  const inFreeSpins = freeSpins !== null;

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncLifeOfLuxuryRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getLifeOfLuxuryConfig()
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
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        ...gameRendererOptions(),
        // The card is CSS-scaled by fitScale — render only the pixels that actually reach the screen.
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
          const scene = await LifeOfLuxuryScene.create(app);
          if (cancelled) {
            scene.destroy();
            return;
          }
          sceneRef.current = scene;
          // Shown by default on load — before any spin, so the 15 line patterns can be
          // visually checked against the reference diagram with no click needed. runSpin
          // hides it again once the player actually spins (see setPaylinesVisible(false)
          // there).
          scene.setAllPaylinesVisible(false, PAYLINES, LINE_DOT_COLORS);
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
        console.error("Life of Luxury: failed to initialize", err);
        setInitError("Failed to load the game. Please check your connection and try again.");
      });

    return () => {
      cancelled = true;
      sound.stopReelSpinLoop();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      releaseTextures();
    };
  }, [initRetryKey]);

  // Keep the canvas's backing resolution matched to its on-screen size: the game card is
  // CSS-scaled by fitScale, so rendering at full design size is mostly pixels the browser throws
  // away (each canvas buffer is width × height × resolution² × 4 bytes of GPU memory). Debounced
  // so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = fitResolution(fitScale);
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      app.renderer.resize(GRID_WIDTH, GRID_HEIGHT, resolution);
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  /** Cancels the infinite win-line cycle (blink + one-at-a-time rotation) and clears the canvas
   * highlight — called at the start of every spin so a fresh spin always starts from a clean
   * slate, no matter where the previous spin's cycle was mid-blink. */
  const stopWinCycle = useCallback(() => {
    setWinGroups([]);
    setActiveGroupIndex(0);
    setWinBlinkOn(true);
    sceneRef.current?.clearWinHighlights();
  }, []);

  /** Flies one landed wild from its reel cell to the free-spins wild counter: scales up in place,
   * moves to the center of the screen and holds there, then shrinks into the counter and bumps
   * it. Pure viewport-coordinate DOM/GSAP overlay (via wildFlightLayerRef), independent of the
   * Pixi canvas and of any CSS scale — getBoundingClientRect already reflects on-screen size. */
  const playOneWildFlight = useCallback((reel: number, row: number): Promise<void> => {
    return new Promise((resolve) => {
      const layer = wildFlightLayerRef.current;
      const canvasEl = canvasHostRef.current;
      const cardEl = gameCardRef.current;
      const counterEl = wildCounterRef.current;
      if (!layer || !canvasEl || !cardEl || !counterEl) {
        resolve();
        return;
      }

      const canvasRect = canvasEl.getBoundingClientRect();
      const cardRect = cardEl.getBoundingClientRect();
      const counterRect = counterEl.getBoundingClientRect();

      const fx = (reel * (CELL_WIDTH + COLUMN_GAP) + CELL_WIDTH / 2) / GRID_WIDTH;
      const fy = (row * CELL_HEIGHT + CELL_HEIGHT / 2) / GRID_HEIGHT;
      const startX = canvasRect.left + fx * canvasRect.width;
      const startY = canvasRect.top + fy * canvasRect.height;
      const centerX = cardRect.left + cardRect.width / 2;
      const centerY = cardRect.top + cardRect.height / 2;
      const destX = counterRect.left + counterRect.width / 2;
      const destY = counterRect.top + counterRect.height / 2;
      const size = Math.max(48, (CELL_WIDTH * canvasRect.width) / GRID_WIDTH);

      const img = document.createElement("img");
      img.src = WILD_GIF_SRC;
      img.alt = "";
      Object.assign(img.style, {
        position: "fixed",
        width: `${size}px`,
        height: `${size}px`,
        left: `${startX - size / 2}px`,
        top: `${startY - size / 2}px`,
        transformOrigin: "center center",
        pointerEvents: "none",
        zIndex: "9999",
        filter: "drop-shadow(0 0 16px rgba(125,211,252,0.85))",
      });
      layer.appendChild(img);

      gsap
        .timeline({
          onComplete: () => {
            img.remove();
            setDisplayWildCount((c) => c + 1);
            if (wildCountTextRef.current) {
              gsap.fromTo(wildCountTextRef.current, { scale: 1.7 }, { scale: 1, duration: 0.35, ease: "elastic.out(1, 0.6)" });
            }
            resolve();
          },
        })
        .to(img, { scale: 2, duration: WILD_FLIGHT_SCALE_UP_S, ease: "back.out(1.7)" })
        .to(img, { left: centerX - size / 2, top: centerY - size / 2, duration: WILD_FLIGHT_TO_CENTER_S, ease: "power2.inOut" })
        .to({}, { duration: WILD_FLIGHT_HOLD_S })
        .to(img, {
          left: destX - size / 2,
          top: destY - size / 2,
          scale: 0.6,
          duration: WILD_FLIGHT_TO_COUNTER_S,
          ease: "power1.in",
        })
        // Fully arrives at the counter (still visible) before hiding — a distinct "landed, then
        // gone" beat instead of fading away mid-flight.
        .to(img, { scale: 0.2, opacity: 0, duration: WILD_FLIGHT_HIDE_S, ease: "power1.in" });
    });
  }, []);

  /** Runs one wild's flight at a time, in landed order (left-to-right reel) — see
   * findWildPositions. Dims the reels for the whole sequence and, since callers await this
   * before runSpin's finally clears `spinning`, blocks the next spin from starting underneath
   * it — no-op (no dim, resolves immediately) when nothing landed. */
  const playWildFlights = useCallback(
    async (positions: [number, number][]) => {
      if (positions.length === 0) return;
      setDimReelsForWildFlight(true);
      try {
        for (const position of positions) {
          await playOneWildFlight(position[0], position[1]);
        }
      } finally {
        setDimReelsForWildFlight(false);
      }
    },
    [playOneWildFlight]
  );

  // Blink ticking: only runs while there's something to blink; resets whenever winGroups
  // changes (a fresh spin's groups, or stopWinCycle clearing them to []).
  useEffect(() => {
    if (winGroups.length === 0) return;
    const id = window.setInterval(() => setWinBlinkOn((v) => !v), WIN_BLINK_TOGGLE_MS);
    return () => window.clearInterval(id);
  }, [winGroups]);

  // Cycle advancing: only meaningful with more than one winning line/scatter to rotate through;
  // wraps back to the first forever (per the spec — infinite until the next spin cancels it).
  useEffect(() => {
    if (winGroups.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveGroupIndex((i) => (i + 1) % winGroups.length);
      setWinBlinkOn(true); // each line's turn always starts "on" (its real color), not mid-fade
    }, WIN_LINE_HOLD_MS);
    return () => window.clearInterval(id);
  }, [winGroups]);

  // Renders whichever group is currently active, in its real color or black — the single place
  // that actually touches the canvas for this feature, driven purely by the state above so the
  // canvas and the sidebar ticks (see PaylineDot below) blink off the exact same clock.
  useEffect(() => {
    sceneRef.current?.drawActiveGroup(winGroups[activeGroupIndex] ?? null, winBlinkOn);
  }, [winGroups, activeGroupIndex, winBlinkOn]);

  const runSpin = useCallback(
    async (isFreeSpin: boolean) => {
      if (!sceneRef.current || spinning || spinLockRef.current) return;
      if (!isFreeSpin && (!user || user.balance < bet)) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }

      setError(null);
      setSpinning(true);
      sound.resumeAudio();
      // The bet leaves the balance the moment SPIN is pressed (free spins cost nothing); a win is
      // added back once the reels land (result.balance = balanceBefore - bet + win).
      spinLockRef.current = true;
      const spinBet = isFreeSpin ? betLevels[freeSpins?.lockedBetIndex ?? betIndex] : bet;
      const balanceBefore = balanceRef.current;
      /** Set once the spin result is in — after that a failure must not refund the bet. */
      let spinResolved = false;
      if (!isFreeSpin) setBalance(Math.round((balanceBefore - spinBet) * 100) / 100);
      setWinAmount(isFreeSpin ? roundWinRef.current : 0);
      // setPaylinesVisible(false);
      stopWinCycle();
      if (!sceneRef.current) {
        spinLockRef.current = false;
        if (!isFreeSpin) setBalance(balanceBefore);
        return;
      }

      try {
        const result = await spinRequest(spinBet, isFreeSpin, balanceBefore);
        spinResolved = true;
        sound.startReelSpinLoop();
        await sceneRef.current.spin(result.grid, fast, sound.reelStopSounds(5));
        sound.stopReelSpinLoop();
        if (result.freeSpinsAwarded) sound.playFreeSpinsJingle();
        else if (result.winAmount > 0) sound.playWinChime();

        let balanceAfter = result.balance;
        if (isFreeSpin) {
          // Free-spin wins (and, on the last spin, the round's wild bonus) pile up in the WIN box;
          // the balance is only credited when the round's outro is tapped away (see collectRoundWin).
          roundWinRef.current =
            Math.round((roundWinRef.current + result.winAmount + (result.freeSpinRoundResult?.bonusWin ?? 0)) * 100) / 100;
          setWinAmount(roundWinRef.current);
          balanceAfter = Math.round((balanceRef.current + roundWinRef.current) * 100) / 100;
        } else {
          setWinAmount(result.winAmount);
          // A spin that starts a free-spin round holds its own win too — it's credited with the
          // round's total when the round's result is tapped away.
          if (!(result.freeSpinsAwarded)) setBalance(result.balance);
        }

        // Fire-and-forget — purely for the admin dashboard's record-keeping, gameplay never
        // waits on or depends on this succeeding. winAmount includes this spin's own line/
        // scatter win plus, on the free spin that ends a round, the round-end wild bonus —
        // mirrors what the old backend's SpinHistory recorded (result.winAmount + bonusWin).
        logSpinResult({
          betAmount: isFreeSpin ? 0 : spinBet,
          winAmount: result.winAmount + (result.freeSpinRoundResult?.bonusWin ?? 0),
          reelSymbols: result.grid,
          balanceAfter,
        }).catch(() => {});

        if (result.evaluation.winningPositions.length > 0 || result.evaluation.scatter.triggered) {
          const groups = sceneRef.current.buildWinGroups(result.evaluation.lineWins, result.evaluation.scatter.positions, LINE_DOT_COLORS);
          setWinGroups(groups);
        }

        if (isFreeSpin) {
          const wildPositions = findWildPositions(result.grid);
          if (result.freeSpinRoundResult) {
            // Round just ended (server-authoritative) — let this spin's own wilds finish flying
            // to the counter before the outro covers the screen with the final multiplied total.
            await playWildFlights(wildPositions);
            const r = result.freeSpinRoundResult;
            setFreeSpinsSummary({
              totalWin: r.totalWin,
              wildCount: r.wildCount,
              multiplier: r.multiplier,
              bonusWin: r.bonusWin,
              // What's actually credited on tap: the round's multiplied total plus the held trigger win.
              finalWin: roundWinRef.current,
              triggerWin: triggerWinRef.current,
            });
            setFreeSpins(null);
            // Autoplay stops once a bonus round ends — the player resumes with SPIN or AUTO.
            setAutoplay(false);
          } else {
            // No retriggering — a coin during an active free-spins round only ever adds to
            // totalWin via its cash scatter prize (already folded into result.winAmount), never
            // more free spins (the server never sets freeSpinsAwarded on a free spin).
            setFreeSpins((prev) => (prev ? { ...prev, remaining: prev.remaining - 1, totalWin: prev.totalWin + result.winAmount } : prev));
            // Awaited (not fire-and-forget) — spinning stays true for the whole flight, so the
            // next free spin can't start behind it, and the dim overlay below actually applies.
            await playWildFlights(wildPositions);
          }
        } else if (result.freeSpinsAwarded) {
          // The round's total starts from the triggering spin's own (held) win.
          roundWinRef.current = result.winAmount;
          triggerWinRef.current = result.winAmount;
          setFreeSpinAward(result.freeSpinsAwarded);
          setDisplayWildCount(0);
          setFreeSpins({
            remaining: result.freeSpinsAwarded,
            total: result.freeSpinsAwarded,
            totalWin: 0,
            lockedBetIndex: betIndex,
          });
        }
      } catch (err) {
        // The spin request itself failed — give the bet back.
        if (!spinResolved && !isFreeSpin) setBalance(balanceBefore);
        const message = err instanceof Error ? err.message : "Spin failed";
        setError(message);
        if (isFreeSpin) {
          // The round can't continue — still show (and credit) what it had won so far.
          setFreeSpins(null);
          const won = roundWinRef.current;
          setFreeSpinsSummary((prev) => prev ?? { totalWin: won, wildCount: 0, multiplier: 1, bonusWin: 0, finalWin: won, triggerWin: 0 });
        }
        setAutoplay(false);
      } finally {
        sound.stopReelSpinLoop();
        spinLockRef.current = false;
        setSpinning(false);
      }
    },
    [bet, betIndex, betLevels, freeSpins, spinning, user, setBalance, fast, stopWinCycle, playWildFlights]
  );

  const startManualSpin = useCallback(() => {
    // The free-spins banner is up — SPIN starts the round, same as tapping the banner.
    if (freeSpinAward !== null) {
      setFreeSpinStartRequested(true);
      return;
    }
    if (!sceneRef.current || spinning || freeSpins || freeSpinsSummary) return;
    runSpin(false);
  }, [freeSpinAward, freeSpins, freeSpinsSummary, runSpin, spinning]);

  /** Closes the round's outro and only now adds the round's total to the balance. */
  const collectRoundWin = useCallback(() => {
    const total = roundWinRef.current;
    roundWinRef.current = 0;
    setFreeSpinsSummary(null);
    if (total > 0) setBalance(Math.round((balanceRef.current + total) * 100) / 100);
  }, [setBalance]);

  useEffect(() => {
    if (!autoplay || spinning || !ready || freeSpins || freeSpinsSummary) return;
    const id = window.setTimeout(() => runSpin(false), AUTOPLAY_GAP_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, freeSpins, freeSpinsSummary, runSpin]);

  // Round-ending is handled synchronously inside runSpin (the server's freeSpinRoundResult is
  // authoritative on when the round is over), so freeSpins here is only ever seen with spins
  // still remaining — this just paces the next one.
  useEffect(() => {
    if (!freeSpins || spinning || !ready || freeSpinAward !== null) return;
    const id = window.setTimeout(() => runSpin(true), FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeSpins, spinning, ready, freeSpinAward, runSpin]);

  const changeBet = (direction: 1 | -1) => {
    if (spinning || autoplay || freeSpins) return;
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };

  // const togglePaylines = () => {
  //   if (!sceneRef.current || spinning) return;
  //   const next = !paylinesVisible;
  //   setPaylinesVisible(next);
  //   sceneRef.current.setAllPaylinesVisible(next, PAYLINES, LINE_DOT_COLORS);
  // };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;
  // While the free-spins banner is up SPIN is live again — pressing it starts the round.
  const spinDisabled =
    !ready || spinning || freeSpinsSummary !== null || freeSpinStartRequested || (inFreeSpins && freeSpinAward === null);
  /** Whichever line's sidebar dot should blink right now, in step with the canvas — null while
   * nothing's cycling, or while the scatter (no sidebar dot) is the active group. */
  const activeLineNumber = winGroups[activeGroupIndex]?.lineNumber ?? null;

  return (
    <>
      <div className="relative overflow-hidden" style={{ width: scaledWidth, height: scaledHeight }}>
        <div
          ref={gameCardRef}
          className="relative flex flex-col overflow-hidden rounded-2xl shadow-2xl"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            background: "radial-gradient(ellipse at center, #0f2f4f 0%, #04101f 75%)",
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="life-of-luxury" />

          {/* Header */}
          <div className="relative z-10 flex w-full items-center justify-between px-10 pt-6">
            <div className="flex items-center gap-4">
              <GameHomeButton size={81} />
              {/* <div className="flex items-center gap-2 rounded-full border-2 border-amber-300 bg-black/70 px-5 py-2 shadow-[0_0_12px_rgba(0,0,0,0.6)]">
                <CoinIcon size={30} />
                <span className="text-2xl font-black text-white">{balance.toFixed(2)}</span>
              </div> */}
              {/* Paylines toggle — moved here from the old footer when GameController replaced it. */}
              {/* <button
                onClick={togglePaylines}
                disabled={spinning}
                aria-label={paylinesVisible ? "Hide paylines" : "Show paylines"}
                aria-pressed={paylinesVisible}
                className={`flex flex-col items-center justify-center rounded-lg border-2 px-4 py-1.5 leading-tight transition-colors disabled:opacity-50 ${
                  paylinesVisible ? "border-amber-300 bg-amber-500/20" : "border-amber-400 bg-black/70 hover:bg-black/50"
                }`}
              >
                <span className="text-3xl font-black text-white">{LINE_COUNT}</span>
                <span className="text-xs font-bold uppercase tracking-wide text-amber-300">Lines</span>
              </button> */}
            </div>

            <div className="pointer-events-none absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center">
              <div
                className="relative flex items-center justify-center px-16 py-3"
                style={{
                  background: "linear-gradient(180deg,#fff2b0 0%,#f2c14e 35%,#c8890f 70%,#8a5a00 100%)",
                  clipPath:
                    "polygon(4% 0%, 96% 0%, 100% 30%, 92% 50%, 100% 70%, 96% 100%, 4% 100%, 8% 70%, 0% 50%, 8% 30%)",
                  boxShadow: "0 6px 14px rgba(0,0,0,0.55)",
                }}
              >
                <span
                  className="text-4xl font-black italic tracking-wide"
                  style={{ color: "#1a2a52", textShadow: "0 1px 0 rgba(255,255,255,0.5)" }}
                >
                  LIFE OF LUXURY
                </span>
              </div>
              <span
                className="-mt-1 text-2xl font-black italic tracking-widest"
                style={{ color: "#f2c14e", textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}
              >
                GOOD LUCK
              </span>
            </div>

            {inFreeSpins ? (
              <div className="flex items-center gap-3 rounded-full bg-black/80 border-2 border-amber-400 px-5 py-2 text-amber-300 font-black text-lg tracking-wide">
                <span>FREE SPINS</span>
                <span className="text-white">
                  {freeSpins!.remaining} left (of {freeSpins!.total})
                </span>
                <span className="text-lime-300">Win: {freeSpins!.totalWin.toFixed(2)}</span>
                <div ref={wildCounterRef} className="flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-950/80 px-2.5 py-1">
                  <img src="/symbols/lifeOfLuxury/daimond.webp" alt="Wild" className="h-6 w-6 rounded-full object-cover" />
                  <span ref={wildCountTextRef} className="inline-block text-sky-200">
                    x{displayWildCount}
                  </span>
                </div>
              </div>
            ) : (
              <button
                aria-label="Menu"
                className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-transparent bg-transparent text-black hover:bg-transparent"
              >
                {/* <MenuIcon size={28} /> */}
              </button>
            )}
          </div>

          {/* Reels */}
          <div className="relative z-10 flex flex-1 items-center justify-center px-10">
            <div
              className="relative flex items-stretch rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
              style={
                inFreeSpins
                  ? {
                      backgroundImage: "url(/symbols/lifeOfLuxury/reelBg.webp)",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : { backgroundColor: "#ffffff" }
              }
            >
              {/* Left payline dots — 3 per row, grouped by each line's reel-1 row */}
              <div className="absolute right-full top-0 flex h-full flex-col justify-between py-2">
                {LEFT_DOT_GROUPS.map((group, row) => (
                  <div key={row} className="flex flex-col gap-2">
                    {group.map(({ lineIndex, angleDeg }) => (
                      <PaylineDot
                        key={lineIndex}
                        color={LINE_DOT_COLORS[lineIndex]}
                        side="left"
                        value={bet}
                        angleDeg={angleDeg}
                        blinking={lineIndex + 1 === activeLineNumber}
                        blinkOn={winBlinkOn}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {/* Right payline dots — 2 per row, same row grouping as the left side */}
              <div className="absolute left-full top-0 flex h-full flex-col justify-between py-2">
                {RIGHT_DOT_GROUPS.map((group, row) => (
                  <div key={row} className="flex flex-col gap-2">
                    {group.map(({ lineIndex, angleDeg }) => (
                      <PaylineDot
                        key={lineIndex}
                        color={LINE_DOT_COLORS[lineIndex]}
                        side="right"
                        value={bet}
                        angleDeg={angleDeg}
                        blinking={lineIndex + 1 === activeLineNumber}
                        blinkOn={winBlinkOn}
                      />
                    ))}
                  </div>
                ))}
              </div>

              <div ref={canvasHostRef} style={{ width: GRID_WIDTH, height: GRID_HEIGHT }} />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center text-sky-900/60">Loading reels...</div>
              )}
              {/* Covers every symbol while a wild is flying to the counter (see
                  dimReelsForWildFlight/playWildFlights) so nothing spins behind it and the eye
                  stays on the animation. */}
              {dimReelsForWildFlight && (
                <div className="pointer-events-none absolute inset-0 z-20 bg-black/75 transition-opacity duration-200" />
              )}
            </div>
          </div>

          {error && (
            <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 mx-3 rounded bg-red-900/60 px-10 py-5 text-4xl text-center text-red-100">
              {error}
            </div>
          )}

          {freeSpinAward !== null && (
            <FreeSpinIntro
              startRequested={freeSpinStartRequested}
              onDismiss={() => {
                setFreeSpinAward(null);
                setFreeSpinStartRequested(false);
              }}
            />
          )}

          {/* GameController (Crazy777's control bar) — raised above the free-spins banner while
              it's up so SPIN can start the round. */}
          <div className={`relative ${freeSpinAward !== null ? "z-40" : "z-10"} w-full`}>
            <GameController
              betAmount={inFreeSpins && freeSpins ? betLevels[freeSpins.lockedBetIndex] ?? bet : bet}
              credit={user?.balance ?? 0}
              onBetDecrease={() => changeBet(-1)}
              onBetIncrease={() => changeBet(1)}
              betDecreaseDisabled={betIndex === 0 || spinning || autoplay || inFreeSpins}
              betIncreaseDisabled={betIndex === betLevels.length - 1 || spinning || autoplay || inFreeSpins}
              win={winAmount}
              spinning={spinning}
              spinDisabled={spinDisabled}
              onSpin={startManualSpin}
              auto={autoplay}
              onToggleAuto={() => {
                if (!inFreeSpins) setAutoplay((v) => !v);
              }}
              allowQuickStop={false}
              fast={fast}
              onToggleFast={() => setFast((v) => !v)}
              onInfo={() => setShowInfo((v) => !v)}
              muted={muted}
              onToggleMute={() => {
                sound.resumeAudio();
                setMuted(sound.toggleMuted());
              }}
            />
          </div>
        </div>
      </div>

      {/* Flying wild-to-counter GIFs are mounted here imperatively (see playOneWildFlight) — a
          plain fixed overlay outside the scaled/transformed game card so getBoundingClientRect
          viewport coordinates apply directly, with no containing-block transform to fight. */}
      <div ref={wildFlightLayerRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }} />


      {showInfo && config && (
        <InfoScreen
          config={config}
          bet={freeSpins ? betLevels[freeSpins.lockedBetIndex] ?? bet : bet}
          onClose={() => setShowInfo(false)}
        />
      )}

      {freeSpinsSummary && (
        <FreeSpinOutro
          totalWin={freeSpinsSummary.totalWin}
          wildCount={freeSpinsSummary.wildCount}
          multiplier={freeSpinsSummary.multiplier}
          finalWin={freeSpinsSummary.finalWin}
          triggerWin={freeSpinsSummary.triggerWin}
          onDismiss={collectRoundWin}
        />
      )}

      {showLoadingScreen && (
        <LoadingScreen
          title="Life of Luxury"
          ready={ready && rtpReady}
          error={initError}
          onRetry={retryInit}
          onDone={() => setShowLoadingScreen(false)}
        />
      )}
    </>
  );
}

function PaylineDot({
  color,
  side,
  value,
  angleDeg,
  blinking = false,
  blinkOn = true,
}: {
  color: string;
  side: "left" | "right";
  value: number;
  angleDeg: number;
  /** True while this line is the currently-active one in the win cycle (see LifeOfLuxuryGame's
   * winGroups/activeGroupIndex) — makes the tick blink black/color in step with its canvas
   * border+bridge, off the same winBlinkOn clock. */
  blinking?: boolean;
  blinkOn?: boolean;
}) {
  const tickColor = blinking && !blinkOn ? "#000000" : color;
  return (
    <div className={`flex items-center gap-1.5 ${side === "right" ? "flex-row-reverse" : ""}`}>
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full text-[18px] font-black invert shadow-[0_0_6px_rgba(0,0,0,0.6)]"
        style={{ backgroundColor: color, border: "2px solid rgba(255,255,255,0.8)" }}
      >
        {value.toFixed(2)}
      </span>
      <span className="h-[8px] w-10" style={{ backgroundColor: tickColor, transform: `rotate(${angleDeg}deg)` }} />
    </div>
  );
}

// function MenuIcon({ size = 18 }: { size?: number }) {
//   return (
//     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
//       <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
//       <line x1="4" y1="12" x2="20" y2="12" strokeLinecap="round" />
//       <line x1="4" y1="17" x2="20" y2="17" strokeLinecap="round" />
//     </svg>
//   );
// }

// function CoinIcon({ size = 24 }: { size?: number }) {
//   return (
//     <svg width={size} height={size} viewBox="0 0 24 24">
//       <circle cx="12" cy="12" r="10" fill="#fbbf24" stroke="#92400e" strokeWidth="1.5" />
//       <text x="12" y="16.5" fontSize="12" fontWeight="bold" fill="#92400e" textAnchor="middle">
//         $
//       </text>
//     </svg>
//   );
// }

