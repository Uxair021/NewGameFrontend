import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Application } from "pixi.js";
import { gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { FishGameScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/FishGameScene";
import { useFitScale } from "../shared/useFitScale";
import { useAuth } from "../../context/AuthContext";
import { getFishGameConfig, type FishSessionSummary } from "./api";
import { useFishSession } from "./useFishSession";
import { GAME_EXIT_PATH } from "../shared/gameExit";
import { GameHomeButton } from "../shared/GameHomeButton";

// Bet/credit controls around the gun, in canvas px (the whole card is scaled as one unit, so
// these line up with the gun at any screen size). Tune here if the gun art moves.
const CONTROLS_BOTTOM = 22; // px from the canvas's bottom edge to the bottom of the +/- buttons
const BET_BUTTON_SIZE = 110;
const BET_READOUT_SIZE = 62;

/**
 * Credits are charged per bullet that *hits* a creature: firing reserves the bet (so the
 * displayed credits drop right away), hits are sent to the server in batches (see
 * useFishSession), which charges them and rolls each kill; a bullet that leaves the screen
 * without hitting releases its reservation.
 */
export function FishGameGame() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<FishGameScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });

  const { setBalance } = useAuth();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);
  const [autoFire, setAutoFireState] = useState(false);
  const [autoTarget, setAutoTargetState] = useState(false);
  const [betLevels, setBetLevels] = useState<number[]>([0.1]);
  const [betIndex, setBetIndex] = useState(0);
  const [configError, setConfigError] = useState<string | null>(null);
  const bet = betLevels[betIndex];
  const betRef = useRef(bet);
  betRef.current = bet;

  const session = useFishSession(betRef, setBalance);
  const { wallet, credits, phase } = session;
  const error = session.error ?? configError;

  useEffect(() => {
    getFishGameConfig()
      .then((config) => setBetLevels(config.betLevels))
      .catch(() => setConfigError("Couldn't load game settings"));
  }, []);

  const lowerBet = () => setBetIndex((i) => Math.max(0, i - 1));
  const raiseBet = () => setBetIndex((i) => Math.min(betLevels.length - 1, i + 1));
  const cantAfford = phase === "playing" && credits < bet;

  // Catch coins fly into the credits box: the scene asks for the box's center (measured live, so
  // it follows the box wherever it's positioned) and pings us as each coin lands, which "bumps"
  // the box.
  const creditsBoxRef = useRef<HTMLDivElement | null>(null);
  const [creditsBump, setCreditsBump] = useState(false);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coinTarget = useRef({
    getPosition() {
      const host = canvasHostRef.current?.getBoundingClientRect();
      const box = creditsBoxRef.current?.getBoundingClientRect();
      if (!host || !box || host.width === 0) return null;
      const scale = host.width / CANVAS_WIDTH;
      return {
        x: (box.left + box.width / 2 - host.left) / scale,
        y: (box.top + box.height / 2 - host.top) / scale,
      };
    },
    onCoinLanded() {
      setCreditsBump(true);
      if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
      bumpTimerRef.current = setTimeout(() => setCreditsBump(false), 120);
    },
  }).current;

  const toggleAutoFire = () => {
    const next = !autoFire;
    setAutoFireState(next);
    sceneRef.current?.setAutoFire(next);
  };

  const toggleAutoTarget = () => {
    const next = !autoTarget;
    setAutoTargetState(next);
    sceneRef.current?.setAutoTarget(next);
  };

  // No fullscreen request here (nor in GamePage): entering fullscreen makes Chrome on Android
  // show its "to exit full screen, drag from the top…" banner every time, which players found
  // too intrusive. The game simply plays in the normal browser view.

  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();

    app
      .init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        ...gameRendererOptions(),
        autoDensity: true,
      })
      .then(async () => {
        if (cancelled || !canvasHostRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        canvasHostRef.current.appendChild(app.canvas);
        const scene = await FishGameScene.create(app, wallet);
        if (cancelled) {
          scene.destroy();
          return;
        }
        scene.setCoinTarget(coinTarget);
        sceneRef.current = scene;
        setReady(true);
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
    };
  }, []);

  const scaledWidth = CANVAS_WIDTH * fitScale;
  const scaledHeight = CANVAS_HEIGHT * fitScale;

  return (
    <div
      className="flex min-h-screen w-full items-center justify-center overflow-hidden bg-black"
    >
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
          <div className="absolute top-0 z-10 flex items-center justify-between px-3 py-2">
            <GameHomeButton size={81} ariaLabel="Leave game" onClick={() => (phase === "playing" || phase === "idle-warning" ? session.exit() : navigate(GAME_EXIT_PATH))} />
          </div>

          <div className="relative overflow-hidden">
            <div ref={canvasHostRef} className="mx-auto" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-sky-950 text-sky-300/70">
                Loading pond...
              </div>
            )}

            <div className="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-6">
              <ToggleImageButton
                src="/symbols/fishGame/Auto.png"
                label="Toggle auto fire"
                active={autoFire}
                onClick={toggleAutoFire}
              />
              <ToggleImageButton
                src="/symbols/fishGame/Target.png"
                label="Toggle lock target"
                active={autoTarget}
                onClick={toggleAutoTarget}
              />
            </div>

            <div
              ref={creditsBoxRef}
              className={`absolute z-10 flex items-center justify-center rounded-2xl bg-black/85 shadow-2xl transition-transform duration-100 ${
                creditsBump ? "scale-110 ring-4 ring-yellow-300/70" : "scale-100"
              }`}
              style={{
                right: "1460px",
                bottom: CONTROLS_BOTTOM + BET_BUTTON_SIZE / 2 - 40,
                width: 350,
                height: 80,
              }}
              aria-label="Credits"
            >
              <span
                className="bg-gradient-to-b from-yellow-200 via-amber-400 to-orange-500 bg-clip-text font-black tabular-nums text-transparent"
                style={{ fontSize: 50, fontFamily: "Arial Black, Arial, sans-serif" }}
              >
                {credits.toFixed(2)}
              </span>
            </div>

            <BetButton
              kind="minus"
              onClick={lowerBet}
              disabled={betIndex === 0}
              style={{ left: "496px", bottom: "8px" }}
            />
            <BetButton
              kind="plus"
              onClick={raiseBet}
              disabled={betIndex === betLevels.length - 1}
              style={{ left: "763px", bottom: "8px" }}
            />

            <div
              className="pointer-events-none absolute z-10 flex items-center justify-center rounded-full border-[5px] border-amber-500 bg-black/70"
              style={{
                left: "649px",
                bottom: "27px",
                width: BET_READOUT_SIZE,
                height: BET_READOUT_SIZE,
              }}
              aria-label="Bet"
            >
              <span
                className="font-black tabular-nums text-yellow-300"
                style={{ fontSize: 30, fontFamily: "Arial Black, Arial, sans-serif", WebkitTextStroke: "2px #7a3e00", fontWeight: 900 }}
              >
                {bet.toFixed(2)}
              </span>
            </div>

            {phase === "idle-warning" && (
              <GameDialog title="Are you still playing?">
                <p className="text-3xl text-white/80">
                  Leaving the game in <span className="font-black text-yellow-300">{session.countdown}</span>
                </p>
                <DialogButton onClick={session.continuePlaying}>Continue playing</DialogButton>
              </GameDialog>
            )}

            {phase === "ending" && (
              <GameDialog title="Saving your game...">
                <p className="text-3xl text-white/70">One moment</p>
              </GameDialog>
            )}

            {phase === "ended" && (
              <GameDialog title="Game over">
                {session.summary ? (
                  <SessionSummary summary={session.summary} />
                ) : (
                  <p className="text-3xl text-white/70">Your balance is saved.</p>
                )}
                <div className="flex gap-6">
                  <DialogButton onClick={session.playAgain}>Play again</DialogButton>
                  <DialogButton variant="secondary" onClick={() => navigate(GAME_EXIT_PATH)}>
                    Back to lobby
                  </DialogButton>
                </div>
              </GameDialog>
            )}

            {phase === "failed" && (
              <GameDialog title="Couldn't start the game">
                <p className="text-3xl text-rose-300">{error}</p>
                <div className="flex gap-6">
                  <DialogButton onClick={session.playAgain}>Try again</DialogButton>
                  <DialogButton variant="secondary" onClick={() => navigate(GAME_EXIT_PATH)}>
                    Back to lobby
                  </DialogButton>
                </div>
              </GameDialog>
            )}

            {phase !== "failed" && (error || (ready && cantAfford)) && (
              <div
                className="absolute left-1/2 z-10 -translate-x-1/2 rounded-xl bg-black/80 px-6 py-3 font-bold text-rose-300"
                style={{ bottom: CONTROLS_BOTTOM + BET_BUTTON_SIZE + 30, fontSize: 28 }}
              >
                {error ?? "Not enough credits for this bet"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The big round "−"/"+" beside the gun: bronze gear-toothed ring, yellow glyph with a pink outline. */
function BetButton({
  kind,
  onClick,
  disabled,
  style,
}: {
  kind: "minus" | "plus";
  onClick: () => void;
  disabled: boolean;
  style: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={kind === "minus" ? "Lower bet" : "Raise bet"}
      className="absolute z-10 flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
      style={{
        ...style,
        width: BET_BUTTON_SIZE,
        height: BET_BUTTON_SIZE,
        boxShadow: "0 6px 18px rgba(0,0,0,0.7)",
      }}
    >
      <span
        className="flex items-center justify-center rounded-full border-[6px] border-amber-300"
        style={{
          width: BET_BUTTON_SIZE - 26,
          height: BET_BUTTON_SIZE - 26,
          background: "radial-gradient(circle at 50% 35%, #7a2a1a, #2a0c06 75%)",
          boxShadow: "inset 0 0 18px rgba(0,0,0,0.9)",
        }}
      >
        <svg width={78} height={78} viewBox="0 0 24 24">
          <rect x="2" y="9.5" width="20" height="5" rx="2" fill="#ffe135" stroke="#e0197d" strokeWidth="1.2" />
          {kind === "plus" && (
            <rect x="9.5" y="2" width="5" height="20" rx="2" fill="#ffe135" stroke="#e0197d" strokeWidth="1.2" />
          )}
          {kind === "plus" && <rect x="10.1" y="10.1" width="3.8" height="3.8" fill="#ffe135" />}
        </svg>
      </span>
    </button>
  );
}

/** Centered modal over the pond, sized in canvas px like the rest of the in-game UI. */
function GameDialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="flex min-w-[640px] flex-col items-center gap-8 rounded-3xl border-4 border-amber-500 bg-gradient-to-b from-slate-900 to-black px-16 py-12 text-center shadow-2xl">
        <h2 className="text-5xl font-black text-yellow-300" style={{ fontFamily: "Arial Black, Arial, sans-serif" }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function DialogButton({
  onClick,
  children,
  variant = "primary",
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-10 py-5 text-3xl font-black transition-transform hover:scale-105 active:scale-95 ${
        variant === "primary" ? "bg-amber-400 text-black" : "border-2 border-white/40 text-white"
      }`}
    >
      {children}
    </button>
  );
}

function SessionSummary({ summary }: { summary: FishSessionSummary }) {
  const result = summary.won - summary.wagered;
  const rows: [string, string][] = [
    ["Starting balance", summary.startBalance.toFixed(2)],
    ["Ending balance", summary.endBalance?.toFixed(2) ?? "—"],
    ["Hits / catches", `${summary.hits} / ${summary.kills}`],
    ["Total bet", summary.wagered.toFixed(2)],
    ["Total won", summary.won.toFixed(2)],
  ];
  return (
    <div className="flex w-full flex-col gap-3 text-3xl">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-12 text-white/80">
          <span>{label}</span>
          <span className="font-bold tabular-nums text-white">{value}</span>
        </div>
      ))}
      <div className="mt-2 flex justify-between gap-12 border-t border-white/20 pt-4 text-4xl font-black">
        <span className="text-white">{result >= 0 ? "You won" : "You lost"}</span>
        <span className={`tabular-nums ${result >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {Math.abs(result).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

/** AUTO / LOCK toggles: the button art itself, dimmed while off and fully opaque while on. */
function ToggleImageButton({
  src,
  label,
  active,
  onClick,
}: {
  src: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`h-32 w-32 transition-all duration-200 hover:scale-105 active:scale-95 ${
        active ? "opacity-100" : "opacity-50 hover:opacity-75"
      }`}
    >
      <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />
    </button>
  );
}
