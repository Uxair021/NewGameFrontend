import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Application } from "pixi.js";
import { budgetResolution, gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { getSuperKenoBallsConfig, spinSuperKenoBalls, SuperKenoBallsConfigResponse } from "./api";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GAME_EXIT_PATH } from "../shared/gameExit";
import { KenoInfoPopup } from "../shared/KenoInfoPopup";
import { GameMenu, SUPER_KENO_MENU_THEME } from "../shared/GameMenu";
import { logKenoDraw, syncKenoRtpConfigFromServer } from "../shared/keno";
import type { InfoTheme } from "../shared/GameInfoPopup";
import {
  SuperKenoBallsScene,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type SuperKenoBallsHandlers,
  type SuperKenoBallsView,
} from "./pixi/SuperKenoBallsScene";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const INFO_THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #1d3a63 0%, #0e1b2e 50%, #050a12 100%)",
  accent: "#38bdf8",
  titleGradient: "linear-gradient(180deg, #fef9c3 0%, #fde047 45%, #f59e0b 100%)",
  buttonBackground: "linear-gradient(180deg, #7dd3fc 0%, #0ea5e9 55%, #0369a1 100%)",
  buttonEdge: "#0c4a6e",
};

const BG_MUSIC_URL = "/Sound/echobrainz-casino-96-bitrates.mp3";

const DEFAULT_BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];
const DEFAULT_POOL_SIZE = 80;
const DEFAULT_DRAWN_COUNT = 20;
const DEFAULT_MAX_PICKS = 10;
const DEFAULT_BONUS_MULTIPLIER = 4;
/** How long each drawn number takes to "land" during the reveal sequence. */
const REVEAL_STAGGER_MS = 180;
/** How long a win takes to count up into CASH after the draw. */
const CREDIT_COUNT_MS = 1200;
/** Spot count used by the "Quick pick" shortcut — a reasonable default, not a hard rule. */
const QUICK_PICK_COUNT = 10;

/** GPU-memory budget for the canvas's backing buffer, in pixels (~12 bytes of GPU memory each —
 * see budgetResolution). ~0.8 MP keeps the whole game around 10-15 MB of GPU memory; on smaller
 * screens the canvas renders even fewer pixels (just what's visible). Raise for sharper output. */
const MAX_BACKING_PIXELS = 800_000;

export function SuperKenoBallsGame() {
  const navigate = useNavigate();
  const { user, setBalance } = useAuth();
  const balance = user?.balance ?? 0;

  // The whole cabinet is one fixed 1740x960 Pixi canvas (see pixi/SuperKenoBallsScene.ts),
  // uniformly scaled to fill the screen like the slot games — every device renders the exact
  // same layout, just zoomed, so nothing can reflow or overlap.
  const gameCardRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<SuperKenoBallsScene | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const [config, setConfig] = useState<SuperKenoBallsConfigResponse | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initRetryKey, setInitRetryKey] = useState(0);
  const ready = configLoaded && sceneReady;
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [betLevels, setBetLevels] = useState<number[]>(DEFAULT_BET_LEVELS);
  const [betIndex, setBetIndex] = useState(0);
  const bet = betLevels[betIndex] ?? betLevels[0];

  const [picks, setPicks] = useState<number[]>([]);
  const [drawn, setDrawn] = useState<number[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [matched, setMatched] = useState<number[]>([]);
  const [bonusHit, setBonusHit] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  /** What the CASH box shows while a draw plays out — the balance with only the bet taken off,
   * then counting up as a win is added. null = show the real balance. The real balance itself is
   * updated straight away, so leaving mid-draw never loses a win. */
  const [creditShown, setCreditShown] = useState<number | null>(null);
  /** True while a win is counting up into CASH (drives the CASH pulse). */
  const [creditCounting, setCreditCounting] = useState(false);
  const creditRaf = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (creditRaf.current !== null) cancelAnimationFrame(creditRaf.current);
    },
    []
  );

  /** Counts the CASH box from `from` up to `to` (ease-out), resolving when done. */
  function countCredit(from: number, to: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / CREDIT_COUNT_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        setCreditShown(from + (to - from) * eased);
        if (t < 1) {
          creditRaf.current = requestAnimationFrame(tick);
        } else {
          creditRaf.current = null;
          resolve();
        }
      };
      creditRaf.current = requestAnimationFrame(tick);
    });
  }

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncKenoRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reads the (now server-synced) config — runs once the sync above is done.
  useEffect(() => {
    if (!rtpReady) return;
    getSuperKenoBallsConfig()
      .then((c) => {
        setConfig(c);
        setBetLevels(c.betLevels);
      })
      .catch(() => {
        /* fall back to defaults already set */
      })
      .finally(() => setConfigLoaded(true));
  }, [rtpReady]);

  // The scene is created once; it calls back through this ref so it always reaches the
  // latest closures (current picks, bet, etc.).
  const handlersRef = useRef<SuperKenoBallsHandlers | null>(null);

  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        ...gameRendererOptions(),
        resolution: budgetResolution(fitScaleRef.current, CANVAS_WIDTH, CANVAS_HEIGHT, MAX_BACKING_PIXELS),
        autoDensity: true,
        background: 0x000000,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        canvasHostRef.current.appendChild(app.canvas);
        try {
          const scene = await SuperKenoBallsScene.create(app, () => handlersRef.current!);
          if (cancelled) {
            scene.destroy();
            return;
          }
          sceneRef.current = scene;
          setSceneReady(true);
        } catch (err) {
          // Tear the half-built canvas down so a retry starts clean instead of stacking a second one.
          app.canvas.remove();
          app.destroy(true, { children: true });
          appRef.current = null;
          throw err;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Super Keno Balls: failed to initialize", err);
        setInitError("Failed to load the game. Please check your connection and try again.");
      });

    return () => {
      cancelled = true;
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

  // Keep the canvas's backing resolution matched to its on-screen size (it's CSS-scaled by
  // fitScale), within the GPU-memory budget. Debounced so a window drag doesn't reallocate every frame.
  useEffect(() => {
    if (!sceneReady) return;
    const id = window.setTimeout(() => {
      const app = appRef.current;
      if (!app) return;
      const resolution = budgetResolution(fitScale, CANVAS_WIDTH, CANVAS_HEIGHT, MAX_BACKING_PIXELS);
      if (Math.abs(resolution - app.renderer.resolution) < 0.02) return;
      app.renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT, resolution);
    }, 200);
    return () => window.clearTimeout(id);
  }, [fitScale, sceneReady]);

  const retryInit = useCallback(() => {
    setInitError(null);
    setSceneReady(false);
    setInitRetryKey((k) => k + 1);
  }, []);

  const poolSize = config?.poolSize ?? DEFAULT_POOL_SIZE;
  const drawnCount = config?.drawnCount ?? DEFAULT_DRAWN_COUNT;
  const maxPicks = config?.maxPicks ?? DEFAULT_MAX_PICKS;
  const bonusMultiplier = config?.bonusMultiplier ?? DEFAULT_BONUS_MULTIPLIER;
  const paytable = config?.paytable ?? [];

  const numbers = useMemo(() => Array.from({ length: poolSize }, (_, i) => i + 1), [poolSize]);
  const revealedBalls = useMemo(() => drawn.slice(0, revealedCount), [drawn, revealedCount]);

  const drawComplete = drawn.length > 0 && revealedCount >= drawn.length;
  const canPlay = ready && !spinning && picks.length > 0 && balance >= bet;

  // Compact hits/pays list for the rail — base payout only (the bonus-ball
  // multiplier is a surprise applied after the draw, not baked into the
  // preview). Payouts are rounded to cents, the same as the win a draw actually
  // pays (shared/keno.ts). Drops the "0 matches" row and collapses the streak of
  // zero-pay rows at the low end into one; equal non-zero pays stay separate.
  const displayPaytableRows = useMemo(() => {
    if (picks.length === 0) return [];
    const row = paytable[picks.length] ?? [];
    const rows = row
      .map((multiplier, matches) => ({ matches, payout: Math.round(multiplier * bet * 100) / 100 }))
      .filter((r) => r.matches !== 0);

    const collapsed: { matches: number; payout: number }[] = [];
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (rows[i].payout === 0 && j + 1 < rows.length && rows[j + 1].payout === 0) j++;

      if (i === j) {
        collapsed.push(rows[i]);
      } else {
        const activeInRange = drawComplete && matched.length >= rows[i].matches && matched.length <= rows[j].matches;
        collapsed.push({ matches: activeInRange ? matched.length : rows[i].matches, payout: rows[i].payout });
      }
      i = j + 1;
    }
    return collapsed;
  }, [paytable, picks.length, bet, drawComplete, matched]);

  function togglePick(n: number) {
    if (spinning) return;
    setPicks((current) => {
      if (current.includes(n)) return current.filter((p) => p !== n);
      if (current.length >= maxPicks) return current;
      return [...current, n];
    });
  }

  async function handleExit() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    navigate(GAME_EXIT_PATH);
  }

  function handleHelp() {
    sound.resumeAudio();
    setShowMenu((v) => !v);
  }

  function handleWipeCard() {
    if (spinning) return;
    setPicks([]);
    setDrawn([]);
    setRevealedCount(0);
    setMatched([]);
    setBonusHit(false);
  }

  function handleQuickPick() {
    if (spinning) return;
    const pool = [...numbers];
    const chosen: number[] = [];
    for (let i = 0; i < Math.min(QUICK_PICK_COUNT, maxPicks); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }
    setDrawn([]);
    setRevealedCount(0);
    setMatched([]);
    setBonusHit(false);
    setPicks(chosen);
  }

  function changeBet(direction: 1 | -1) {
    if (spinning) return;
    setBetIndex((i) => Math.min(Math.max(i + direction, 0), betLevels.length - 1));
  }

  async function handlePlay() {
    if (!canPlay) return;
    sound.resumeAudio();
    setSpinning(true);
    setError(null);
    setDrawn([]);
    setRevealedCount(0);
    setMatched([]);
    setBonusHit(false);
    setLastWin(0);

    try {
      const result = await spinSuperKenoBalls(bet, picks, balance);
      logKenoDraw("super-keno-balls", { betAmount: bet, winAmount: result.winAmount, picks, drawn: result.drawn, matched: result.matched }).catch(() => {});
      // CASH drops by the bet the moment PLAY is hit; any win is added after the draw.
      const afterBet = Math.round((balance - bet) * 100) / 100;
      setCreditShown(afterBet);
      setBalance(result.balance);
      setDrawn(result.drawn);
      setMatched(result.matched);

      // Reveal the drawn numbers one at a time — the last one revealed is
      // always the Bonus Ball, so this doubles as the reveal for that too.
      await new Promise<void>((resolve) => {
        let i = 0;
        const id = setInterval(() => {
          i += 1;
          setRevealedCount(i);
          if (i >= result.drawn.length) {
            clearInterval(id);
            resolve();
          }
        }, REVEAL_STAGGER_MS);
      });

      setBonusHit(result.bonusHit);
      setLastWin(result.winAmount);
      if (result.winAmount > 0) sound.playWinChime();
      if (result.winAmount > 0) {
        setCreditCounting(true);
        await countCredit(afterBet, result.balance);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draw failed");
    } finally {
      setCreditShown(null);
      setCreditCounting(false);
      setSpinning(false);
    }
  }

  handlersRef.current = {
    onToggle: togglePick,
    onWipe: handleWipeCard,
    onQuickPick: handleQuickPick,
    onBetChange: changeBet,
    onPlay: () => void handlePlay(),
    onExit: () => void handleExit(),
    onHelp: handleHelp,
  };

  const message = error
    ? error
    : !spinning && picks.length > 0 && balance < bet
      ? "Not enough balance for this bet."
      : null;

  const view = useMemo<SuperKenoBallsView>(() => {
    const revealedSet = new Set(revealedBalls);
    return {
      poolSize,
      picks,
      revealed: revealedBalls,
      // Only matches that have actually been revealed light up, so hits appear in step with the draw.
      matched: matched.filter((n) => revealedSet.has(n)),
      spinning,
      canPlay,
      balance: creditShown ?? balance,
      creditCounting,
      lastWin,
      bet,
      betAtMin: betIndex === 0,
      betAtMax: betIndex === betLevels.length - 1,
      bonusMultiplier,
      bonusWon: bonusHit && lastWin > 0,
      paytable: displayPaytableRows.map((row) => ({
        ...row,
        active: drawComplete && matched.length === row.matches,
      })),
      message: message?.toUpperCase() ?? null,
    };
  }, [
    poolSize,
    picks,
    revealedBalls,
    matched,
    spinning,
    canPlay,
    balance,
    creditShown,
    creditCounting,
    lastWin,
    bet,
    betIndex,
    betLevels.length,
    bonusMultiplier,
    bonusHit,
    displayPaytableRows,
    drawComplete,
    message,
  ]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.render(view);
  }, [sceneReady, view]);

  return (
    <>
      <div className="relative overflow-hidden" style={{ width: CANVAS_WIDTH * fitScale, height: CANVAS_HEIGHT * fitScale }}>
        <div
          ref={gameCardRef}
          className="relative select-none overflow-hidden bg-black"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: fitScale !== 1 ? `scale(${fitScale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="super-keno-balls" />

          <div ref={canvasHostRef} style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />

          {showMenu && (
            <GameMenu
              theme={SUPER_KENO_MENU_THEME}
              muted={false}
              onToggleSound={() => {}}
              onInfo={() => setShowInfo(true)}
              onClose={() => setShowMenu(false)}
              hideHome
              // Just under the HELP button on the right-hand rail, in design pixels.
              style={{ left: 1462, top: 105 }}
            />
          )}

          {initError && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/90 text-center text-white">
              <p className="text-3xl font-bold">{initError}</p>
              <button
                type="button"
                onClick={retryInit}
                className="rounded-full bg-gradient-to-b from-amber-400 to-amber-500 px-10 py-4 text-2xl font-semibold text-slate-950 hover:brightness-110"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {showInfo && (
        <KenoInfoPopup
          name="Super Keno Balls"
          theme={INFO_THEME}
          paytable={paytable}
          bet={bet}
          picksCount={picks.length}
          poolSize={poolSize}
          drawnCount={drawnCount}
          maxPicks={maxPicks}
          bonusMultiplier={bonusMultiplier}
          controls={[
            ["Play Game", "Draws the numbers for your picks at the current bet."],
            ["Quik Pick", "Picks a random set of numbers for you."],
            ["Wipe Card", "Removes all your picks."],
            ["Bet ▲ / ▼", "Raise or lower your bet."],
            ["Help", "Opens the menu: sound settings and these rules."],
            ["Exit", "Back to the lobby."],
          ]}
          onClose={() => setShowInfo(false)}
        />
      )}


      {showLoadingScreen && !initError && (
        <LoadingScreen
          title="Super Keno Balls"
          ready={ready && rtpReady}
          onDone={() => {
            setShowLoadingScreen(false);
            sound.startStreamingMusic(BG_MUSIC_URL);
          }}
        />
      )}
    </>
  );
}
