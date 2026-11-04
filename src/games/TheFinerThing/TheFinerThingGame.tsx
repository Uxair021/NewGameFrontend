import { useEffect, useRef, useState, useCallback } from "react";
import { Application } from "pixi.js";
import { fitResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import gsap from "gsap";
import { useAuth } from "../../context/AuthContext";
import {
  TheFinerThingScene,
  REEL_COUNT,
  GRID_WIDTH,
  GRID_HEIGHT,
  CELL_WIDTH,
  CELL_HEIGHT,
  COLUMN_GAP,
  PaylinePattern,
  WinHighlightGroup,
} from "./pixi/TheFinerThingScene";
import { getTheFinerThingConfig, spinRequest, logSpinResult, Grid, syncTheFinerThingRtpConfigFromServer } from "./api";
import { FreeSpinIntro } from "./FreeSpinIntro";
import { FreeSpinOutro } from "./FreeSpinOutro";
import { InfoScreen } from "./InfoScreen";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import { GameHomeButton } from "../shared/GameHomeButton";
import GameController from "../shared/GameController";
import * as sound from "../shared/sound/soundEngine";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
/** Design space = bg.webp / freespinBg.webp's own pixel size; every overlay below (reel canvas,
 * value wells, payline tabs, buttons) is positioned in these units, measured straight off the
 * art, and the whole card is then CSS-scaled to fit the viewport (see useFitScale). */
export const CANVAS_WIDTH = 1354;
export const CANVAS_HEIGHT = 784;

const BG_SRC = "/symbols/theFinerThing/bg.webp";
/** GPU-memory cap on the reel canvas's backing resolution. gameRendererOptions(2) allows up to
 * 2.5× (the card is CSS-scaled up past its 1354px design size), which on a hi-DPI screen made each
 * canvas buffer ~12 MB; the symbol textures are only 288px (see pixi/symbols.ts), so rendering
 * sharper than this adds GPU memory, not detail. */
const MAX_RESOLUTION = 1.4;
/** Same cabinet art with the reel frame recoloured green — swapped in for the whole of a
 * free-games round. */
const FREE_SPIN_BG_SRC = "/symbols/theFinerThing/freespinBg.webp";

/** Top-left of the art's first white reel window — the Pixi canvas is pinned here. */
const GRID_LEFT = 143;
const GRID_TOP = 176;

const DEFAULT_BET_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10];
const AUTOPLAY_GAP_MS = 700;
const FREE_SPIN_GAP_MS = 700;
/** Blink cadence for the active winning line's border+bridge (canvas) and its payline tab —
 * both driven off this same clock so they never drift out of sync. */
const WIN_BLINK_TOGGLE_MS = 320;
/** How long each winning line gets "on stage" before the cycle moves to the next one. Runs
 * forever (wrapping back to the first line) until the next spin cancels it — see stopWinCycle. */
const WIN_LINE_HOLD_MS = 1280;

/** The 15 fixed payline patterns — mirrors backEnd/src/games/TheFinerThing/config.ts's PAYLINES
 * exactly (row index 0=top/1=mid/2=bottom per reel). Display-only: the server is what actually
 * evaluates wins. */
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

interface PaylineTab {
  lineNumber: number;
  /** Vertical center of the tab baked into bg.webp, in design-space px. */
  y: number;
  color: string;
}

/** The art's 15 coloured payline tabs (10 down the left, 5 down the right), each assigned the
 * line whose start (left side) or end (right side) row sits at that tab's height — so a lit tab
 * always lines up with where its line enters/leaves the reels. Colours are sampled from the art,
 * and double as each line's win-overlay colour on the canvas. */
const LEFT_TABS: PaylineTab[] = [
  { lineNumber: 2, y: 163, color: "#d81e1e" },
  { lineNumber: 5, y: 195, color: "#f2541a" },
  { lineNumber: 6, y: 228, color: "#f08a22" },
  { lineNumber: 10, y: 261, color: "#f2c230" },
  { lineNumber: 1, y: 359, color: "#a8d846" },
  { lineNumber: 8, y: 391, color: "#6cd431" },
  { lineNumber: 9, y: 424, color: "#3ccf63" },
  { lineNumber: 3, y: 543, color: "#1bb4d0" },
  { lineNumber: 4, y: 576, color: "#1883d6" },
  { lineNumber: 11, y: 608, color: "#1b4fc8" },
];
const RIGHT_TABS: PaylineTab[] = [
  { lineNumber: 7, y: 204, color: "#1f2fbf" },
  { lineNumber: 12, y: 232, color: "#5a1fc0" },
  { lineNumber: 14, y: 383, color: "#d8217a" },
  { lineNumber: 15, y: 411, color: "#e8895a" },
  { lineNumber: 13, y: 540, color: "#e07a1f" },
];
/** Indexed by lineNumber - 1 — what the scene uses to colour each line's win overlay. */
const LINE_COLORS: string[] = (() => {
  const colors: string[] = new Array(PAYLINES.length).fill("#ffffff");
  [...LEFT_TABS, ...RIGHT_TABS].forEach((t) => (colors[t.lineNumber - 1] = t.color));
  return colors;
})();

/** The art's 7 purple buttons (y 698–774) are replaced by GameController (Crazy777's control
 * bar): the art is cropped just above them, right under the CREDITS / PLAY / WIN / PRIZES wells,
 * and the controller sits below. Its bar starts BAR_TOP (34 of its 1912×196 design px) under its
 * top edge — that strip only holds the top of SPIN — so it's tucked up over the art by that much. */
const CABINET_CUT = 692;
const CONTROLLER_HEIGHT = Math.round((CANVAS_WIDTH * 196) / 1912);
const CONTROLLER_TOP = CABINET_CUT - Math.round((CANVAS_WIDTH * 34) / 1912);
/** The whole card: cropped cabinet art + the controller under it. */
const CARD_HEIGHT = CONTROLLER_TOP + CONTROLLER_HEIGHT;

/** The 4 dark value wells under the reels (CREDITS / PLAY / WIN / PRIZES). */
const VALUE_BOX_TOP = 657;
const VALUE_BOX_HEIGHT = 31;
const VALUE_BOX_XS: [number, number][] = [
  [293, 396],
  [573, 676],
  [852, 955],
  [1134, 1235],
];

const DISPLAY_FONT = "Arial, Helvetica, sans-serif";

const WILD_GIF_SRC = "/symbols/theFinerThing/diamond.webp";
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

export function TheFinerThingGame() {
  const { user, setBalance } = useAuth();
  // Latest balance (runSpin reads it instead of a possibly stale closure) + an in-flight lock so
  // a second spin can never start on top of one already running.
  const balanceRef = useRef(0);
  balanceRef.current = user?.balance ?? 0;
  const spinLockRef = useRef(false);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<TheFinerThingScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;
  /** Fixed-position overlay (viewport coordinates, see playWildFlights) that flying wild GIFs are
   * mounted into directly — imperative DOM, not React state, since these are short-lived and
   * don't need to survive re-renders. */
  const wildFlightLayerRef = useRef<HTMLDivElement | null>(null);
  /** The free-games top bar's wild-count badge — the on-screen destination every flying wild
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
  const [autoplay, setAutoplay] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [muted, setMuted] = useState(() => sound.isMuted());
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
  /** How many wilds have landed so far this free-spin round, as shown by the top-bar badge —
   * bumped one at a time as each flying-wild animation lands (see playWildFlights), reset when a
   * new round starts. Purely cosmetic: the real payout multiplier comes from the server's
   * freeSpinRoundResult, never from this. */
  const [displayWildCount, setDisplayWildCount] = useState(0);
  /** Running total of everything won since the game was opened — the cabinet's PRIZES well. */
  const [sessionPrizes, setSessionPrizes] = useState(0);

  const bet = betLevels[betIndex] ?? betLevels[0];
  const balance = user?.balance ?? 0;
  const inFreeSpins = freeSpins !== null;

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncTheFinerThingRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getTheFinerThingConfig()
      .then((c) => setBetLevels(c.betLevels))
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
        // The card is CSS-scaled up to fill the viewport (the design space is only 1354px wide),
        // so the reels render at a higher backing resolution to stay crisp after that scale.
        ...gameRendererOptions(2),
        // ...but never more than actually reaches the screen at the current fit scale.
        resolution: Math.min(fitResolution(fitScaleRef.current, 2), MAX_RESOLUTION),
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
        const scene = await TheFinerThingScene.create(app);
        if (cancelled) {
          scene.destroy();
          return;
        }
        sceneRef.current = scene;
        // Registers the payline patterns/colours with the scene (buildWinGroups needs them to
        // trace a line past its matched cells) without actually drawing the reference overlay.
        scene.setAllPaylinesVisible(false, PAYLINES, LINE_COLORS);
        setReady(true);
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

  /** Flies one landed wild from its reel cell to the free-games wild counter: scales up in place,
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
      const size = Math.max(48, (CELL_HEIGHT * canvasRect.height) / GRID_HEIGHT);

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
  // wraps back to the first forever (infinite until the next spin cancels it).
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
  // canvas and the payline tabs (see PaylineTabLabel below) blink off the exact same clock.
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
        await sceneRef.current.spin(result.grid, false, sound.reelStopSounds(5));
        sound.stopReelSpinLoop();
        if (result.freeSpinsAwarded) sound.playFreeSpinsJingle();
        else if (result.winAmount > 0) sound.playWinChime();
        setSessionPrizes((p) => p + result.winAmount);

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
        // scatter win plus, on the free spin that ends a round, the round-end wild bonus.
        logSpinResult({
          betAmount: isFreeSpin ? 0 : spinBet,
          winAmount: result.winAmount + (result.freeSpinRoundResult?.bonusWin ?? 0),
          reelSymbols: result.grid,
          balanceAfter,
        }).catch(() => {});

        if (result.evaluation.winningPositions.length > 0 || result.evaluation.scatter.triggered) {
          const groups = sceneRef.current.buildWinGroups(result.evaluation.lineWins, result.evaluation.scatter.positions, LINE_COLORS);
          setWinGroups(groups);
        }

        if (isFreeSpin) {
          const wildPositions = findWildPositions(result.grid);
          if (result.freeSpinRoundResult) {
            // Round just ended (server-authoritative) — let this spin's own wilds finish flying
            // to the counter before the outro covers the screen with the final multiplied total.
            await playWildFlights(wildPositions);
            const r = result.freeSpinRoundResult;
            // The end-of-round wild multiplier bonus is credited on top of the spin wins already
            // counted above — fold it into PRIZES too.
            setSessionPrizes((p) => p + r.bonusWin);
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
    [bet, betIndex, betLevels, freeSpins, spinning, user, setBalance, stopWinCycle, playWildFlights]
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
    if (!autoplay || spinning || !ready || freeSpins || freeSpinsSummary || showInfo) return;
    const id = window.setTimeout(() => runSpin(false), AUTOPLAY_GAP_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, spinning, ready, freeSpins, freeSpinsSummary, showInfo, runSpin]);

  // Round-ending is handled synchronously inside runSpin (the server's freeSpinRoundResult is
  // authoritative on when the round is over), so freeSpins here is only ever seen with spins
  // still remaining — this just paces the next one.
  useEffect(() => {
    if (!freeSpins || spinning || !ready || freeSpinAward !== null || showInfo) return;
    const id = window.setTimeout(() => runSpin(true), FREE_SPIN_GAP_MS);
    return () => window.clearTimeout(id);
  }, [freeSpins, spinning, ready, freeSpinAward, showInfo, runSpin]);

  // Preload the free-games background so mounting it at a round's start shows it straight away.
  useEffect(() => {
    const img = new Image();
    img.src = FREE_SPIN_BG_SRC;
    img.decode().catch(() => {});
  }, []);

  // Keep the canvas's backing resolution matched to its on-screen size (each canvas buffer is
  // width × height × resolution² × 4 bytes of GPU memory). Debounced so a window drag doesn't
  // reallocate every frame.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = Math.min(fitResolution(fitScale, 2), MAX_RESOLUTION);
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      app.renderer.resize(GRID_WIDTH, GRID_HEIGHT, resolution);
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, ready]);

  const betLocked = spinning || autoplay || inFreeSpins;
  const changeBet = (direction: 1 | -1) => {
    if (betLocked) return;
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  };
  const setMaxBet = () => {
    if (betLocked) return;
    setBetIndex(betLevels.length - 1);
  };

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CARD_HEIGHT * fitScale;
  // While the free-spins banner is up SPIN is live again — pressing it starts the round.
  const spinDisabled =
    !ready || spinning || freeSpinsSummary !== null || freeSpinStartRequested || (inFreeSpins && freeSpinAward === null);
  const atMaxBet = betIndex === betLevels.length - 1;
  /** Whichever line's tab should blink right now, in step with the canvas — null while nothing's
   * cycling, or while the scatter (no tab) is the active group. */
  const activeLineNumber = winGroups[activeGroupIndex]?.lineNumber ?? null;

  return (
    <>
      <div className="relative overflow-hidden" style={{ width: scaledWidth, height: scaledHeight }}>
        <div
          ref={gameCardRef}
          className="relative overflow-hidden bg-black shadow-2xl"
          style={{
            width: CANVAS_WIDTH,
            height: CARD_HEIGHT,
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="the-finer-thing" />

          {/* Cabinet art. The free-games layer is only mounted during a round (a hidden, always-mounted
              copy still held its decoded pixels in GPU memory); it's preloaded on mount (see
              below) so the swap doesn't flash, and fades in. */}
          <div className="pointer-events-none absolute left-0 top-0 overflow-hidden" style={{ width: CANVAS_WIDTH, height: CABINET_CUT }}>
            <img
              src={BG_SRC}
              alt=""
              draggable={false}
              className="absolute left-0 top-0 select-none"
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
            />
            {inFreeSpins && (
              <img
                src={FREE_SPIN_BG_SRC}
                alt=""
                draggable={false}
                className="absolute left-0 top-0 select-none"
                style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, animation: "tftFadeIn 0.5s ease-out" }}
              />
            )}
            <style>{`@keyframes tftFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
          </div>

          {/* Home — over the art's red lamp in the top-left corner (EXIT used to be a cabinet button). */}
          <div className="absolute z-30" style={{ left: 14, top: 12 }}>
            <GameHomeButton size={56} />
          </div>

          {/* Top bar — "Current Play" normally; the free-games status (and the wild counter every
              flying wild lands on) during a round. */}
          <div
            className="absolute flex items-center justify-center gap-6 whitespace-nowrap text-[19px] font-bold text-white"
            style={{ left: 319, top: 33, width: 729, height: 28, fontFamily: DISPLAY_FONT }}
          >
            {inFreeSpins ? (
              <>
                <span>
                  Free Games: <span className="text-yellow-300">{freeSpins!.total - freeSpins!.remaining}</span> of{" "}
                  <span className="text-yellow-300">{freeSpins!.total}</span>
                </span>
                <span>
                  Win: <span className="text-yellow-300">{freeSpins!.totalWin.toFixed(2)}</span>
                </span>
                <div ref={wildCounterRef} className="flex items-center gap-1">
                  <img src="/symbols/theFinerThing/daimond.webp" alt="Wild" className="h-6 w-6 object-contain" />
                  <span ref={wildCountTextRef} className="inline-block text-sky-200">
                    x{displayWildCount}
                  </span>
                </div>
              </>
            ) : (
              <span>
                Current Play: <span className="text-yellow-300">{bet.toFixed(2)}</span> Credits
              </span>
            )}
          </div>

          {/* Progressive well — this game has no progressive pool, so it shows the line count
              rather than an invented jackpot figure. */}
          <div
            className="absolute flex items-center justify-center text-[22px] font-bold text-white"
            style={{ left: 1097, top: 93, width: 236, height: 32, fontFamily: DISPLAY_FONT }}
          >
            {PAYLINES.length} LINES
          </div>

          {/* Payline tabs — baked into both bg.webp and freespinBg.webp at the same spots, so the
              numbers stay up in the base game and during free games alike. */}
          {[...LEFT_TABS.map((tab) => ({ tab, side: "left" as const })), ...RIGHT_TABS.map((tab) => ({ tab, side: "right" as const }))].map(
            ({ tab, side }) => (
              <PaylineTabLabel
                key={tab.lineNumber}
                tab={tab}
                side={side}
                blinking={tab.lineNumber === activeLineNumber}
                blinkOn={winBlinkOn}
              />
            )
          )}

          {/* Reels — pinned exactly over the art's 5 white reel windows. */}
          <div className="absolute" style={{ left: GRID_LEFT, top: GRID_TOP, width: GRID_WIDTH, height: GRID_HEIGHT }}>
            <div ref={canvasHostRef} style={{ width: GRID_WIDTH, height: GRID_HEIGHT }} />
            {/* Free-games reel glow — a green rim hugging each reel window's border with a deep inset
                glow bleeding in toward the middle. The reel strip itself stays white; only the
                glow is added on top, fading in/out with the free-games background swap. */}
            {Array.from({ length: REEL_COUNT }, (_, reel) => (
              <div
                key={reel}
                className="pointer-events-none absolute top-0 z-10 transition-opacity duration-500"
                style={{
                  left: reel * (CELL_WIDTH + COLUMN_GAP),
                  width: CELL_WIDTH,
                  height: GRID_HEIGHT,
                  opacity: inFreeSpins ? 1 : 0,
                  border: "3px solid #3dff7a",
                  boxShadow: "inset 0 0 22px 6px rgba(46,235,104,0.9), inset 0 0 70px 18px rgba(46,235,104,0.45), 0 0 10px 2px rgba(46,235,104,0.6)",
                  animation: inFreeSpins ? "tftReelGlow 1.6s ease-in-out infinite" : undefined,
                }}
              />
            ))}
            <style>{`@keyframes tftReelGlow { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }`}</style>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-2xl text-purple-900/60">Loading reels...</div>
            )}
            {/* Covers every symbol while a wild is flying to the counter (see
                dimReelsForWildFlight/playWildFlights) so nothing spins behind it and the eye
                stays on the animation. */}
            {dimReelsForWildFlight && (
              <div className="pointer-events-none absolute inset-0 z-20 bg-black/75 transition-opacity duration-200" />
            )}
          </div>

          {/* CREDITS / PLAY / WIN / PRIZES wells */}
          {[balance.toFixed(2), bet.toFixed(2), `$${winAmount.toFixed(2)}`, `$${sessionPrizes.toFixed(2)}`].map((text, i) => (
            <div
              key={i}
              className="absolute flex items-center justify-center text-[20px] font-bold text-white"
              style={{
                left: VALUE_BOX_XS[i][0],
                top: VALUE_BOX_TOP,
                width: VALUE_BOX_XS[i][1] - VALUE_BOX_XS[i][0],
                height: VALUE_BOX_HEIGHT,
                fontFamily: DISPLAY_FONT,
              }}
            >
              {text}
            </div>
          ))}

          {error && (
            <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-yellow-300 bg-purple-950/90 px-10 py-5 text-center text-3xl text-white">
              {error}
            </div>
          )}

          {/* Free-spins banner — stops above the cabinet's button row so PLAY stays visible and
              pressable (PLAY starts the round, same as tapping the banner). */}
          {freeSpinAward !== null && (
            <FreeSpinIntro
              startRequested={freeSpinStartRequested}
              frameStyle={{ left: 0, top: 0, width: "100%", height: CABINET_CUT }}
              onDismiss={() => {
                setFreeSpinAward(null);
                setFreeSpinStartRequested(false);
              }}
            />
          )}

          {/* GameController (Crazy777's control bar) in place of the art's 7 purple buttons — above
              the free-spins banner so SPIN can start the round. */}
          <div className="absolute left-0 z-40" style={{ top: CONTROLLER_TOP, width: CANVAS_WIDTH }}>
            <GameController
              betAmount={inFreeSpins && freeSpins ? betLevels[freeSpins.lockedBetIndex] ?? bet : bet}
              credit={user?.balance ?? 0}
              onBetDecrease={() => changeBet(-1)}
              onBetIncrease={() => changeBet(1)}
              betDecreaseDisabled={betLocked || betIndex === 0}
              betIncreaseDisabled={betLocked || atMaxBet}
              win={winAmount}
              spinning={spinning}
              spinDisabled={spinDisabled}
              onSpin={startManualSpin}
              auto={autoplay}
              onToggleAuto={() => {
                if (!inFreeSpins) setAutoplay((v) => !v);
              }}
              allowQuickStop={false}
              onMaxBet={setMaxBet}
              maxBetDisabled={betLocked || atMaxBet}
              onInfo={() => setShowInfo((v) => !v)}
              muted={muted}
              onToggleMute={() => {
                sound.resumeAudio();
                setMuted(sound.toggleMuted());
              }}
            />
          </div>

          {showInfo && <InfoScreen bet={bet} paylines={PAYLINES} lineColors={LINE_COLORS} onClose={() => setShowInfo(false)} />}
        </div>
      </div>

      {/* Flying wild-to-counter GIFs are mounted here imperatively (see playOneWildFlight) — a
          plain fixed overlay outside the scaled/transformed game card so getBoundingClientRect
          viewport coordinates apply directly, with no containing-block transform to fight. */}
      <div ref={wildFlightLayerRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }} />


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
        <LoadingScreen title="Final Thing" ready={ready && rtpReady} onDone={() => setShowLoadingScreen(false)} />
      )}
    </>
  );
}

/** The number on one of the art's coloured payline tabs. While its line is the active win in the
 * cycle, the tab is repainted on top in the line colour (or black on the "off" beat) with a white
 * ring, blinking off the same clock as the canvas border+bridge. */
function PaylineTabLabel({
  tab,
  side,
  blinking,
  blinkOn,
}: {
  tab: PaylineTab;
  side: "left" | "right";
  blinking: boolean;
  blinkOn: boolean;
}) {
  return (
    <div
      className="absolute flex items-center justify-center rounded-[6px] text-[17px] font-black text-white"
      style={{
        left: side === "left" ? 33 : 1262,
        top: tab.y - 12,
        width: 64,
        height: 24,
        fontFamily: DISPLAY_FONT,
        textShadow: "0 1px 2px rgba(0,0,0,0.8)",
        ...(blinking
          ? {
              backgroundColor: blinkOn ? tab.color : "#000000",
              boxShadow: "0 0 0 2px #ffffff, 0 0 12px rgba(255,255,255,0.8)",
            }
          : {}),
      }}
    >
      {tab.lineNumber}
    </div>
  );
}

