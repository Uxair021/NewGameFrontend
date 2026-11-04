import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Application } from "pixi.js";
import { gameRendererOptions } from "../shared/pixi/appOptions";
import { trackGameTextures } from "../shared/pixi/textureCleanup";
import { useAuth } from "../../context/AuthContext";
import { ZeusVsHadesScene, CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/ZeusVsHadesScene";
import { SYMBOL_NAMES } from "./pixi/symbols";
import { CELEBRATION_FX, COLUMN_STONE, REEL_FRAMES, UI, symbolUrl } from "./art";
import { BET_LEVELS, DEFAULT_BET_INDEX, buyCost, buyCostX, coinValueFor, logSpinResult, playBuy, playSpin, spinCost, type PlayedRound, syncZeusRtpConfigFromServer } from "./api";
import {
  RULES,
  MULTIPLIER_VALUES,
  PAYLINES,
  PAYTABLES,
  SPECIAL_BET_COINS,
  SUPER2_MULTIPLIER,
  type BuyOption,
  type Profile,
  type SpecialBet,
} from "./engine";
import { LoadingScreen } from "../shared/LoadingScreen";
import { useFitScale } from "../shared/useFitScale";
import * as sound from "../shared/sound/soundEngine";
import { GameHomeButton } from "../shared/GameHomeButton";

import { GameJackpotBar } from "../shared/jackpot/JackpotBar";
const BG_MUSIC_URL = "/Sound/kulakovka-casino-291450.mp3";
/** Animated "choose volatility" start screen (provided art). */
const START_BG_URL = "/symbols/zeusVsHades/bgStart.gif";
const FONT = "'Lilita One', 'Arial Black', sans-serif";
const AUTOPLAY_DELAY_MS = 400;
const BANNER_AUTO_DISMISS_MS = 2600;
const IDLE_MESSAGES = ["PLACE YOUR BETS!"];

type Modal = "buy" | "special" | "info" | "settings" | null;
type Banner = { kind: "fsIntro" } | { kind: "fsOutro"; amount: number; capped: boolean };
type Message = { kind: "idle" } | { kind: "luck" } | { kind: "win"; amount: number; winner: boolean } | { kind: "fsLeft"; left: number; total: number };

const PROFILE_INFO: Record<Profile, { name: string; volatility: string }> = {
  olympus: { name: "OLYMPUS", volatility: "HIGH" },
  hades: { name: "HADES", volatility: "VERY HIGH" },
};

const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Gold display text with dark outline, matching the original's labels. */
const gold: CSSProperties = {
  fontFamily: FONT,
  backgroundImage: "linear-gradient(180deg, #fff6b0 0%, #ffd23a 45%, #e07a00 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextStroke: "1.5px #4a1d00",
  filter: "drop-shadow(0 2px 0 rgba(0,0,0,0.65))",
};

/** Lilita One is self-hosted (src/fonts.css), but the browser only fetches it once something uses it. */
function ensureFont(): Promise<void> {
  // Pixi text needs the font loaded before it rasterizes; never block the game on it for long.
  return Promise.race([
    document.fonts.load(`40px "Lilita One"`).then(() => undefined),
    new Promise<void>((r) => window.setTimeout(r, 2500)),
  ]).catch(() => undefined);
}

export function ZeusVsHadesGame() {
  const { user, setBalance } = useAuth();
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ZeusVsHadesScene | null>(null);
  const appRef = useRef<Application | null>(null);
  const gameCardRef = useRef<HTMLDivElement | null>(null);
  const fitScale = useFitScale([gameCardRef], { fillViewport: true });

  const [ready, setReady] = useState(false);

  /** True once the admin-saved RTP config has been fetched from the server into localStorage (see
   * shared/serverRtpConfig.ts) — the loading screen waits for it, so the very first spin uses it. */
  const [rtpReady, setRtpReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void syncZeusRtpConfigFromServer().then(() => {
      if (!cancelled) setRtpReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX);
  const [special, setSpecial] = useState<SpecialBet>("none");
  const [busy, setBusy] = useState(false);
  const [inFreeSpins, setInFreeSpins] = useState(false);
  const [message, setMessage] = useState<Message>({ kind: "idle" });
  const [idleIndex, setIdleIndex] = useState(0);
  const [turbo, setTurbo] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [muted, setMuted] = useState(sound.isMuted());
  const [modal, setModal] = useState<Modal>(null);
  const [confirmBuy, setConfirmBuy] = useState<BuyOption | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bet = BET_LEVELS[betIndex];
  const balance = user?.balance ?? 0;

  // Refs read inside the async round flow, so a long free-spins round never works from stale state.
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const turboRef = useRef(turbo);
  turboRef.current = turbo;
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const bannerResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    new Image().src = START_BG_URL;
  }, []);

  // Idle message alternates like the original's bottom ticker.
  useEffect(() => {
    if (message.kind !== "idle") return;
    const id = window.setInterval(() => setIdleIndex((i) => (i + 1) % IDLE_MESSAGES.length), 3500);
    return () => window.clearInterval(id);
  }, [message.kind]);

  // --- Pixi lifecycle -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    const releaseTextures = trackGameTextures();
    Promise.all([
      app.init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        ...gameRendererOptions(),
        autoDensity: true,
        background: 0x000000,
      }),
      ensureFont(),
    ]).then(async () => {
      if (cancelled || !canvasHostRef.current) {
        app.destroy(true, { children: true });
        return;
      }
      appRef.current = app;
      canvasHostRef.current.appendChild(app.canvas);
      const scene = await ZeusVsHadesScene.create(app, "olympus");
      if (cancelled) {
        scene.destroy();
        return;
      }
      sceneRef.current = scene;
      setReady(true);
    });

    return () => {
      cancelled = true;
      sound.stopReelSpinLoop();
      sound.stopBackgroundMusic();
      bannerResolveRef.current?.();
      sceneRef.current?.destroy();
      sceneRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      releaseTextures();
    };
  }, []);

  useEffect(() => {
    if (ready && profile) sceneRef.current?.setProfile(profile);
  }, [ready, profile]);

  // --- Round flow -------------------------------------------------------------------------

  /** Shows the free-spins intro/outro panel; resolves when dismissed (click, or auto in autoplay). */
  const showBanner = useCallback((b: Banner) => {
    return new Promise<void>((resolve) => {
      let timer = 0;
      const done = () => {
        window.clearTimeout(timer);
        bannerResolveRef.current = null;
        setBanner(null);
        resolve();
      };
      bannerResolveRef.current = done;
      setBanner(b);
      if (autoplayRef.current) timer = window.setTimeout(done, BANNER_AUTO_DISMISS_MS);
    });
  }, []);

  const playRoundFlow = useCallback(
    async (played: PlayedRound, anticipation: boolean) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const { result, coinValue } = played;
      const startBalance = balanceRef.current;
      setBalance(round2(startBalance - played.cost));
      logSpinResult(played, round2(startBalance - played.cost + played.win)).catch(() => {});
      setMessage({ kind: "luck" });

      const spinOpts = {
        turbo: turboRef.current,
        anticipation,
        onReelStop: (_reel: number, hasScatter: boolean) => {
          sound.playReelStop();
          if (hasScatter && anticipation) sound.playDrumBeat();
        },
        onExpand: () => sound.playBurst(),
      };

      let baseWin = 0;
      if (result.base) {
        sound.startReelSpinLoop();
        await scene.spin(result.base, spinOpts);
        sound.stopReelSpinLoop();
        baseWin = round2(result.base.coins * coinValue);
        if (baseWin > 0) {
          setMessage({ kind: "win", amount: baseWin, winner: true });
          sound.playWinChime();
          await scene.presentWins(result.base, turboRef.current);
        }
      }

      const fs = result.freeSpins;
      if (fs) {
        if (result.base) await scene.presentScatters(result.base.scatterCells);
        sound.playFreeSpinsJingle();
        setInFreeSpins(true);
        await showBanner({ kind: "fsIntro" });
        scene.clearWins();
        scene.clearWildColumns();
        scene.setFreeSpinsMode(true);
        let total = baseWin;
        for (let i = 0; i < fs.spins.length; i++) {
          const spin = fs.spins[i];
          setMessage({ kind: "fsLeft", left: RULES.freeSpinsAwarded - i - 1, total });
          sound.startReelSpinLoop();
          await scene.spin(spin, { ...spinOpts, turbo: turboRef.current, anticipation: false });
          sound.stopReelSpinLoop();
          const spinWin = round2(spin.coins * coinValue);
          total = round2(total + spinWin);
          setMessage({ kind: "fsLeft", left: RULES.freeSpinsAwarded - i - 1, total });
          if (spinWin > 0) {
            sound.playWinChime();
            await scene.presentWins(spin, turboRef.current);
          } else {
            await new Promise((r) => window.setTimeout(r, turboRef.current ? 150 : 400));
          }
          if (!sceneRef.current) return;
        }
        const fsWin = round2(fs.coins * coinValue);
        await showBanner({ kind: "fsOutro", amount: fsWin, capped: fs.capped });
        scene.clearWins();
        scene.setFreeSpinsMode(false);
        setInFreeSpins(false);
      }

      setBalance(round2(startBalance - played.cost + played.win));
      setMessage(played.win > 0 ? { kind: "win", amount: played.win, winner: false } : { kind: "idle" });
      // No Big/Mega/Jackpot win words — every win just shows its amount.
    },
    [setBalance, showBanner]
  );

  const startRound = useCallback(
    async (cost: number, play: () => PlayedRound, anticipation: boolean) => {
      sound.resumeAudio();
      if (!ready || !profile || busy || !sceneRef.current) return;
      if (!user || balanceRef.current < cost) {
        setError("Insufficient balance");
        setAutoplay(false);
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await playRoundFlow(play(), anticipation);
      } catch (err) {
        sound.stopReelSpinLoop();
        setError(err instanceof Error ? err.message : "Spin failed");
        setAutoplay(false);
      } finally {
        setBusy(false);
      }
    },
    [ready, profile, busy, user, playRoundFlow]
  );

  const runSpin = useCallback(() => {
    if (!profile) return;
    return startRound(spinCost(bet, special), () => playSpin(bet, profile, special), special === "none");
  }, [startRound, bet, profile, special]);

  const runBuy = useCallback(
    (option: BuyOption) => {
      if (!profile) return;
      setModal(null);
      setConfirmBuy(null);
      setAutoplay(false);
      return startRound(buyCost(bet, profile, option), () => playBuy(bet, profile, option), false);
    },
    [startRound, bet, profile]
  );

  useEffect(() => {
    if (!autoplay || busy || !ready || !profile || modal) return;
    const id = window.setTimeout(() => void runSpin(), AUTOPLAY_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, busy, ready, profile, modal, runSpin]);

  // Space / Enter spins; also dismisses panels.
  const runSpinRef = useRef(runSpin);
  runSpinRef.current = runSpin;
  const modalRef = useRef(modal);
  modalRef.current = modal;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.code !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (bannerResolveRef.current) bannerResolveRef.current();
      else if (sceneRef.current && !modalRef.current) void runSpinRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeBet = (dir: 1 | -1) => setBetIndex((i) => Math.min(Math.max(i + dir, 0), BET_LEVELS.length - 1));
  const locked = busy || !ready;

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
            fontFamily: FONT,
          }}
        >
          {/* Shared jackpot bar (tap a tier for the Jackpot Record screen). */}
          <GameJackpotBar gameId="zeus-vs-hades" />

          <div ref={canvasHostRef} style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />

          <LeftPanel
            profile={profile}
            inFreeSpins={inFreeSpins}
            locked={locked}
            onBuy={() => setModal("buy")}
            onProfile={(p) => setProfile(p)}
          />

          <SpecialBetsButton
            special={special}
            disabled={locked || inFreeSpins}
            onOpen={() => setModal("special")}
            onToggle={() => setSpecial("none")}
          />

          {modal === "special" && (
            <SpecialBetsPanel
              bet={bet}
              current={special}
              onChoose={(s) => {
                setSpecial(s);
                setModal(null);
              }}
              onClose={() => setModal(null)}
            />
          )}

          <BottomBar
            balance={balance}
            bet={spinCost(bet, special)}
            message={message}
            idleText={IDLE_MESSAGES[idleIndex]}
            busy={busy}
            locked={locked}
            canDecrease={betIndex > 0}
            canIncrease={betIndex < BET_LEVELS.length - 1}
            autoplay={autoplay}
            muted={muted}
            hideCenter={modal === "buy"}
            onDecrease={() => changeBet(-1)}
            onIncrease={() => changeBet(1)}
            onSpin={() => void runSpin()}
            onAutoplay={() => {
              sound.resumeAudio();
              setAutoplay((v) => !v);
            }}
            onInfo={() => setModal("info")}
            onMenu={() => setModal(modal === "settings" ? null : "settings")}
            onMute={() => {
              sound.resumeAudio();
              setMuted(sound.toggleMuted());
            }}
          />

          {modal === "settings" && (
            <SettingsPopover
              turbo={turbo}
              muted={muted}
              onTurbo={() => setTurbo((v) => !v)}
              onMute={() => setMuted(sound.toggleMuted())}
              onClose={() => setModal(null)}
            />
          )}

          {modal === "buy" && profile && (
            <BuyPanel
              profile={profile}
              bet={bet}
              balance={balance}
              canDecrease={betIndex > 0}
              canIncrease={betIndex < BET_LEVELS.length - 1}
              onDecrease={() => changeBet(-1)}
              onIncrease={() => changeBet(1)}
              onPick={(o) => setConfirmBuy(o)}
              onClose={() => setModal(null)}
            />
          )}
          {confirmBuy && profile && (
            <ConfirmBuy
              option={confirmBuy}
              price={buyCost(bet, profile, confirmBuy)}
              onCancel={() => setConfirmBuy(null)}
              onConfirm={() => void runBuy(confirmBuy)}
            />
          )}

          {modal === "info" && <InfoScreen profile={profile ?? "olympus"} bet={bet} onClose={() => setModal(null)} />}

          {banner && (
            <FreeSpinsPanel banner={banner} profile={profile ?? "olympus"} onDismiss={() => bannerResolveRef.current?.()} />
          )}

          {error && (
            <div className="absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-amber-300 bg-black/85 px-10 py-5 text-center text-3xl text-amber-100">
              {error}
              <button className="mt-3 block w-full text-base text-amber-200 underline" onClick={() => setError(null)}>
                OK
              </button>
            </div>
          )}

          <GameHomeButton size={54} anchor="bottom-left" className="absolute bottom-[6px] left-[10px] z-10" />

          {!showLoadingScreen && !profile && <ProfileChooser onChoose={(p) => setProfile(p)} />}
        </div>
      </div>

      {showLoadingScreen && (
        <LoadingScreen
          title="Zeus vs Hades"
          ready={ready && rtpReady}
          onDone={() => {
            setShowLoadingScreen(false);
            sound.startBackgroundMusic(BG_MUSIC_URL);
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------
// Left side: BUY FREE SPINS button + CHOOSE VOLATILITY banner
// ------------------------------------------------------------------------------------------

/**
 * The hanging banner sways as if in wind: hinged at the rod, it tilts toward and away from the
 * viewer (rotateX in perspective) with a slight side ripple. Small angles keep the buttons on it
 * easy to tap; turned off for players who prefer reduced motion.
 */
const BANNER_WIND_CSS = `
@keyframes zvh-banner-wind {
  0%   { transform: perspective(700px) rotateX(0deg)  rotateZ(0deg)    skewX(0deg); }
  20%  { transform: perspective(700px) rotateX(8deg)  rotateZ(1deg)    skewX(-1.2deg); }
  45%  { transform: perspective(700px) rotateX(-4deg) rotateZ(-0.7deg) skewX(0.8deg); }
  70%  { transform: perspective(700px) rotateX(6deg)  rotateZ(0.6deg)  skewX(-0.8deg); }
  100% { transform: perspective(700px) rotateX(0deg)  rotateZ(0deg)    skewX(0deg); }
}
.zvh-banner-wind {
  transform-origin: 50% 0;
  animation: zvh-banner-wind 4.6s ease-in-out infinite;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .zvh-banner-wind { animation: none; }
}
`;

function LeftPanel({
  profile,
  inFreeSpins,
  locked,
  onBuy,
  onProfile,
}: {
  profile: Profile | null;
  inFreeSpins: boolean;
  locked: boolean;
  onBuy: () => void;
  onProfile: (p: Profile) => void;
}) {
  return (
    <>
      <button
        onClick={onBuy}
        disabled={locked || inFreeSpins}
        className="absolute left-[20px] top-[64px] flex h-[84px] w-[216px] flex-col items-center justify-center transition hover:brightness-110 active:scale-[0.97] disabled:cursor-default disabled:hover:brightness-100"
        style={{ backgroundImage: `url(${UI.buyButton})`, backgroundSize: "100% 100%" }}
      >
        <span className="text-[30px] leading-[28px]" style={gold}>
          {inFreeSpins ? "BONUS" : "BUY"}
        </span>
        <span className="text-[30px] leading-[30px]" style={gold}>
          {inFreeSpins ? "ACTIVE" : "FREE SPINS"}
        </span>
      </button>

      <div className={`absolute left-[8px] top-[166px] w-[240px] transition ${inFreeSpins ? "opacity-60" : ""}`}>
        <img src={UI.rodRed} alt="" className="relative z-10 h-[26px] w-[240px]" draggable={false} />
        <style>{BANNER_WIND_CSS}</style>
        <div
          className="zvh-banner-wind relative -mt-[10px] ml-[12px] h-[370px] w-[216px] pt-[30px] text-center"
          style={{ backgroundImage: `url(${UI.volatilityBanner})`, backgroundSize: "100% 100%" }}
        >
          <div className="text-[32px] leading-[30px]" style={gold}>
            CHOOSE
            <br />
            VOLATILITY
          </div>
          <div className="mt-[22px] flex justify-center gap-[10px]">
            {(["olympus", "hades"] as const).map((p) => (
              <button
                key={p}
                disabled={locked || inFreeSpins}
                onClick={() => onProfile(p)}
                className={`flex w-[88px] flex-col items-center transition ${profile === p ? "" : "opacity-70 hover:opacity-100"}`}
              >
                <span className="text-[17px]" style={gold}>
                  {PROFILE_INFO[p].volatility}
                </span>
                <img
                  src={symbolUrl(13, p)}
                  alt=""
                  draggable={false}
                  className="my-[4px] h-[76px] w-[76px] object-contain"
                  style={profile === p ? { filter: "drop-shadow(0 0 8px #ffe680) drop-shadow(0 0 4px #ffe680)" } : undefined}
                />
                <span className="text-[20px]" style={gold}>
                  {PROFILE_INFO[p].name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------
// Special bets (right side, as in the 250 version)
// ------------------------------------------------------------------------------------------

const SPECIAL_INFO: Record<Exclude<SpecialBet, "none">, { title: [string, string]; text: string }> = {
  super1: { title: ["SUPER", "SPIN 1"], text: "GUARANTEED EXPANDING WILD" },
  super2: { title: ["SUPER", "SPIN 2"], text: `GUARANTEED EXPANDING WILD WITH ${SUPER2_MULTIPLIER}x MULTIPLIER` },
};

function SpecialBetsButton({
  special,
  disabled,
  onOpen,
  onToggle,
}: {
  special: SpecialBet;
  disabled: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const active = special !== "none";
  return (
    <div
      className={`absolute left-[1058px] top-[415px] flex h-[160px] w-[182px] flex-col items-center rounded-[6px] border-[5px] pt-[12px] ${disabled ? "opacity-60" : ""}`}
      style={{
        borderColor: "#e3a72f",
        background: "linear-gradient(180deg, #a35ad8 0%, #7a2fb5 45%, #4c1580 100%)",
        boxShadow: "inset 0 0 0 2px #fff0a0, 0 6px 14px rgba(0,0,0,0.5)",
      }}
    >
      <button disabled={disabled} onClick={onOpen} className="flex flex-col items-center leading-[26px] hover:brightness-110">
        <span className="text-[27px]" style={gold}>
          {active ? SPECIAL_INFO[special].title.join(" ") : "SPECIAL"}
        </span>
        <span className="text-[27px]" style={gold}>
          {active ? "ACTIVE" : "BETS"}
        </span>
        {!active && (
          <span className="text-[24px]" style={gold}>
            2 OPTIONS
          </span>
        )}
      </button>
      <button
        aria-label={active ? "Turn special bet off" : "Choose special bet"}
        disabled={disabled}
        onClick={active ? onToggle : onOpen}
        className={`mt-[8px] flex h-[42px] w-[132px] items-center rounded-[10px] border-2 border-[#2a0a40] bg-[#2a0a40] p-[3px] ${active ? "justify-end" : "justify-start"}`}
      >
        <span
          className="flex h-full w-[78px] items-center justify-center rounded-[8px] text-[26px] leading-none text-white"
          style={{
            background: active ? "linear-gradient(180deg,#6ff26f,#1fa01f)" : "linear-gradient(180deg,#ff5a6a,#c8142a)",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.5)",
          }}
        >
          {active ? "✔" : "➜"}
        </span>
      </button>
    </div>
  );
}

function SpecialBetsPanel({
  bet,
  current,
  onChoose,
  onClose,
}: {
  bet: number;
  current: SpecialBet;
  onChoose: (s: SpecialBet) => void;
  onClose: () => void;
}) {
  const card = (id: Exclude<SpecialBet, "none">, x: number, rod: string, bannerImg: string, rays: string) => {
    const info = SPECIAL_INFO[id];
    const isActive = current === id;
    return (
      <div className="absolute top-[56px] w-[340px]" style={{ left: x }}>
        <div className="pointer-events-none absolute -inset-[90px] opacity-80" style={{ background: rays }} />
        <img src={rod} alt="" draggable={false} className="relative z-10 mx-auto h-[38px] w-[340px]" />
        <div
          className="relative -mt-[16px] ml-[18px] flex h-[470px] w-[304px] flex-col items-center pt-[44px]"
          style={{ backgroundImage: `url(${bannerImg})`, backgroundSize: "100% 100%" }}
        >
          <div className="text-center text-[56px] leading-[54px]" style={gold}>
            {info.title[0]}
            <br />
            {info.title[1]}
          </div>
          <div
            className="mt-[12px] flex h-[104px] w-[270px] items-center justify-center px-[40px] text-center text-[18px] leading-[21px]"
            style={{ backgroundImage: `url(${UI.ribbonRed})`, backgroundSize: "100% 100%" }}
          >
            <span style={gold}>{info.text}</span>
          </div>
          <div className="mt-[4px] text-[19px]" style={gold}>
            BET MULTIPLIER {SPECIAL_BET_COINS[id]}x
          </div>
          <button
            onClick={() => onChoose(isActive ? "none" : id)}
            className="absolute top-[318px] flex h-[78px] w-[210px] items-center justify-center pb-[4px] transition hover:brightness-110 active:scale-95"
            style={{ backgroundImage: `url(${UI.btnGreen})`, backgroundSize: "100% 100%" }}
          >
            <span className="text-[38px] leading-[38px]" style={gold}>
              {money(spinCost(bet, id))}
            </span>
          </button>
          <div className="absolute top-[406px] text-[19px]" style={gold}>
            {isActive ? "ACTIVE - CLICK PRICE TO TURN OFF" : "PER SPIN"}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="absolute inset-0 z-30 bg-black/55">
      <div className="absolute left-0 right-0 top-[6px] text-center text-[34px]" style={gold}>
        SELECT A SPECIAL BET
      </div>
      {card("super1", 200, UI.rodPurple, UI.bannerPurple, "radial-gradient(circle, rgba(190,60,255,0.55) 0%, rgba(120,20,200,0.25) 35%, transparent 65%)")}
      {card("super2", 740, UI.rodOrange, UI.bannerOrange, "radial-gradient(circle, rgba(255,190,60,0.6) 0%, rgba(255,120,0,0.25) 35%, transparent 65%)")}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute left-[560px] top-[524px] h-[96px] w-[160px] transition hover:brightness-110 active:scale-95"
        style={{ backgroundImage: `url(${UI.closeBig})`, backgroundSize: "100% 100%" }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Bottom bar
// ------------------------------------------------------------------------------------------

function BottomBar(props: {
  balance: number;
  bet: number;
  message: Message;
  idleText: string;
  busy: boolean;
  locked: boolean;
  canDecrease: boolean;
  canIncrease: boolean;
  autoplay: boolean;
  muted: boolean;
  hideCenter: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onSpin: () => void;
  onAutoplay: () => void;
  onInfo: () => void;
  onMenu: () => void;
  onMute: () => void;
}) {
  const { message } = props;
  return (
    <>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[90px] bg-gradient-to-t from-black/70 to-transparent" />
      {/* menu / sound / info */}
      <button aria-label="Menu" onClick={props.onMenu} className="absolute left-[130px] top-[644px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/80 bg-black/50">
        <MenuIcon />
      </button>
      <button aria-label={props.muted ? "Unmute" : "Mute"} onClick={props.onMute} className="absolute left-[130px] top-[679px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/80 bg-black/50">
        <SoundIcon muted={props.muted} />
      </button>
      <button aria-label="Information" onClick={props.onInfo} className="absolute left-[159px] top-[650px] flex h-[44px] w-[44px] items-center justify-center rounded-full border-2 border-white/90 bg-black/50 text-[26px] italic text-white" style={{ fontFamily: "Georgia, serif" }}>
        i
      </button>

      <div className="absolute left-[228px] top-[648px] leading-[25px]">
        <div className="text-[22px]">
          <span style={gold}>CREDIT </span>
          <span className="text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">{money(props.balance)}</span>
        </div>
        <div className="text-[22px]">
          <span style={gold}>BET </span>
          <span className="text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]">{money(props.bet)}</span>
        </div>
      </div>

      {!props.hideCenter && (
        <div className="pointer-events-none absolute left-[480px] top-[634px] flex w-[320px] flex-col items-center leading-none text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]">
          {message.kind === "idle" && <span className="mt-[10px] text-[30px]">{props.idleText}</span>}
          {message.kind === "luck" && <span className="mt-[10px] text-[30px]">GOOD LUCK!</span>}
          {message.kind === "win" && (
            <>
              <span className="mt-[6px] text-[32px]">
                <span style={gold}>WIN </span>
                {money(message.amount)}
              </span>
              {message.winner && <span className="mt-[2px] text-[15px]">WINNER</span>}
            </>
          )}
          {message.kind === "fsLeft" && (
            <>
              {message.total > 0 && (
                <span className="text-[32px]">
                  <span style={gold}>WIN </span>
                  {money(message.total)}
                </span>
              )}
              <span className={message.total > 0 ? "mt-[2px] text-[15px]" : "mt-[16px] text-[18px]"}>FREE SPINS LEFT {message.left}</span>
            </>
          )}
        </div>
      )}

      <CircleButton ariaLabel="Decrease bet" x={870} y={630} size={42} disabled={props.locked || !props.canDecrease} onClick={props.onDecrease}>
        <span className="block h-[3px] w-[18px] rounded bg-white" />
      </CircleButton>
      <CircleButton ariaLabel="Increase bet" x={1066} y={630} size={42} disabled={props.locked || !props.canIncrease} onClick={props.onIncrease}>
        <span className="relative block h-[18px] w-[18px]">
          <span className="absolute left-0 top-[7.5px] h-[3px] w-[18px] rounded bg-white" />
          <span className="absolute left-[7.5px] top-0 h-[18px] w-[3px] rounded bg-white" />
        </span>
      </CircleButton>

      <button
        aria-label="Spin"
        onClick={props.onSpin}
        disabled={props.locked}
        className="absolute left-[931px] top-[592px] flex h-[118px] w-[118px] items-center justify-center rounded-full border-[3px] border-white bg-black/55 shadow-[0_0_18px_rgba(0,0,0,0.6)] transition active:scale-95"
      >
        {props.busy ? (
          <span className="block h-[44px] w-[44px] rounded-[6px] border-[3px] border-red-500 bg-red-900/40" />
        ) : (
          <img src={UI.spinArrows} alt="" draggable={false} className="h-[86px] w-[86px] object-contain" />
        )}
      </button>
      <button
        onClick={props.onAutoplay}
        className={`absolute left-[927px] top-[691px] flex h-[26px] w-[126px] items-center justify-center gap-1 rounded-full border-2 text-[15px] ${
          props.autoplay ? "border-amber-300 bg-amber-400 text-black" : "border-white bg-black/70 text-white"
        }`}
      >
        <span className="text-[12px] tracking-[-2px]">❯❯❯</span> {props.autoplay ? "STOP" : "AUTOPLAY"}
      </button>
    </>
  );
}

function CircleButton({
  ariaLabel,
  x,
  y,
  size,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  x: number;
  y: number;
  size: number;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className="absolute flex items-center justify-center rounded-full border-2 border-white bg-black/55 transition active:scale-95 disabled:opacity-40"
      style={{ left: x, top: y, width: size, height: size }}
    >
      {children}
    </button>
  );
}

function SettingsPopover(props: { turbo: boolean; muted: boolean; onTurbo: () => void; onMute: () => void; onClose: () => void }) {
  const row = (label: string, on: boolean, toggle: () => void) => (
    <button onClick={toggle} className="flex w-full items-center justify-between py-2 text-[20px] text-white">
      {label}
      <span className={`flex h-[26px] w-[50px] items-center rounded-full p-[3px] ${on ? "bg-emerald-500" : "bg-white/25"}`}>
        <span className={`h-[20px] w-[20px] rounded-full bg-white transition ${on ? "translate-x-[24px]" : ""}`} />
      </span>
    </button>
  );
  return (
    <div className="absolute inset-0 z-30" onClick={props.onClose}>
      <div className="absolute bottom-[86px] left-[120px] w-[300px] rounded-xl bg-black/85 px-5 py-3" onClick={(e) => e.stopPropagation()}>
        {row("QUICK SPIN", props.turbo, props.onTurbo)}
        {row("SOUND", !props.muted, props.onMute)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Buy free spins
// ------------------------------------------------------------------------------------------

function BuyPanel(props: {
  profile: Profile;
  bet: number;
  balance: number;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onPick: (o: BuyOption) => void;
  onClose: () => void;
}) {
  const standard = buyCost(props.bet, props.profile, "standard");
  const superPrice = buyCost(props.bet, props.profile, "super");
  const card = (option: BuyOption, x: number, rod: string, bannerImg: string, rays: string, children: ReactNode, price: number) => {
    const affordable = props.balance >= price;
    return (
      <div className="absolute top-[56px] w-[340px]" style={{ left: x }}>
        <div className="pointer-events-none absolute -inset-[90px] opacity-80" style={{ background: rays }} />
        <img src={rod} alt="" draggable={false} className="relative z-10 mx-auto h-[38px] w-[340px]" />
        <div
          className="relative -mt-[16px] ml-[18px] flex h-[470px] w-[304px] flex-col items-center pt-[40px]"
          style={{ backgroundImage: `url(${bannerImg})`, backgroundSize: "100% 100%" }}
        >
          {children}
          <button
            disabled={!affordable}
            onClick={() => props.onPick(option)}
            className="absolute top-[318px] flex h-[78px] w-[210px] items-center justify-center pb-[4px] text-[44px] transition hover:brightness-110 active:scale-95 disabled:grayscale"
            style={{ backgroundImage: `url(${UI.btnGreen})`, backgroundSize: "100% 100%" }}
          >
            <span style={gold}>{money(price)}</span>
          </button>
        </div>
      </div>
    );
  };
  return (
    <div className="absolute inset-0 z-30 bg-black/55">
      {card(
        "standard",
        200,
        UI.rodPurple,
        UI.bannerPurple,
        "radial-gradient(circle, rgba(190,60,255,0.55) 0%, rgba(120,20,200,0.25) 35%, transparent 65%)",
        <div className="mt-[30px] text-center text-[64px] leading-[60px]" style={gold}>
          BUY
          <br />
          FREE
          <br />
          SPINS
        </div>,
        standard
      )}
      {card(
        "super",
        740,
        UI.rodOrange,
        UI.bannerOrange,
        "radial-gradient(circle, rgba(255,190,60,0.6) 0%, rgba(255,120,0,0.25) 35%, transparent 65%)",
        <>
          <div className="text-center text-[46px] leading-[41px]" style={gold}>
            BUY
            <br />
            SUPER
            <br />
            FREE
            <br />
            SPINS
          </div>
          <div
            className="mt-[4px] flex h-[94px] w-[270px] items-center justify-center px-[40px] text-center text-[18px] leading-[21px]"
            style={{ backgroundImage: `url(${UI.ribbonRed})`, backgroundSize: "100% 100%" }}
          >
            <span style={gold}>WITH ONE GUARANTEED EXPANDING WILD</span>
          </div>
          <div className="absolute top-[406px] text-[19px]" style={gold}>
            VERY HIGH VOLATILITY
          </div>
        </>,
        superPrice
      )}

      <button
        aria-label="Close"
        onClick={props.onClose}
        className="absolute left-[560px] top-[524px] h-[96px] w-[160px] transition hover:brightness-110 active:scale-95"
        style={{ backgroundImage: `url(${UI.closeBig})`, backgroundSize: "100% 100%" }}
      />

      <div className="absolute left-[518px] top-[634px] flex w-[244px] flex-col items-center">
        <span className="text-[19px] text-white drop-shadow">TOTAL BET</span>
        <div className="mt-[2px] flex items-center gap-[14px]">
          <button aria-label="Decrease bet" disabled={!props.canDecrease} onClick={props.onDecrease} className="flex h-[44px] w-[44px] items-center justify-center rounded-full border-2 border-white bg-black/60 disabled:opacity-40">
            <span className="block h-[3px] w-[18px] rounded bg-white" />
          </button>
          <span className="flex h-[40px] w-[118px] items-center justify-center rounded-md bg-black/70 text-[22px] text-white">{money(props.bet)}</span>
          <button aria-label="Increase bet" disabled={!props.canIncrease} onClick={props.onIncrease} className="flex h-[44px] w-[44px] items-center justify-center rounded-full border-2 border-white bg-black/60 disabled:opacity-40">
            <span className="relative block h-[18px] w-[18px]">
              <span className="absolute left-0 top-[7.5px] h-[3px] w-[18px] rounded bg-white" />
              <span className="absolute left-[7.5px] top-0 h-[18px] w-[3px] rounded bg-white" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmBuy({ option, price, onCancel, onConfirm }: { option: BuyOption; price: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="absolute inset-0 z-40 bg-black/40">
      <div
        className="absolute left-[372px] top-[162px] flex h-[350px] w-[536px] flex-col items-center pt-[30px]"
        style={{ backgroundImage: `url(${UI.panelOrange})`, backgroundSize: "100% 100%" }}
      >
        <div className="text-center text-[50px] leading-[52px]" style={gold}>
          BUY
          <br />
          {option === "super" ? "SUPER FREE SPINS" : "FREE SPINS"}
        </div>
        <div className="mt-[8px] text-[56px]" style={gold}>
          {money(price)}
        </div>
        <div className="mt-[14px] flex gap-[140px]">
          <button aria-label="Cancel" onClick={onCancel} className="h-[72px] w-[118px] transition hover:brightness-110 active:scale-95" style={{ backgroundImage: `url(${UI.btnX})`, backgroundSize: "100% 100%" }} />
          <button aria-label="Confirm" onClick={onConfirm} className="h-[72px] w-[118px] transition hover:brightness-110 active:scale-95" style={{ backgroundImage: `url(${UI.btnCheck})`, backgroundSize: "100% 100%" }} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Free spins intro / outro panel
// ------------------------------------------------------------------------------------------

/** Border slices of each reel-frame image (px from each edge to the board window), so the
 * free-spins panel can reuse the reel frame as its own border via CSS border-image. */
const PANEL_FRAME: Record<Profile, { src: string; slice: [number, number, number, number] }> = {
  olympus: { src: REEL_FRAMES.olympus.src, slice: [92, 63, 60, 62] },
  hades: { src: REEL_FRAMES.hades.src, slice: [88, 50, 51, 50] },
};

/**
 * Free spins intro / outro, laid out like the original at 1280x720: a white flash and a rush of
 * clouds, then a stone panel framed with the reel frame zooms out into place over the dimmed
 * game, "CONGRATULATIONS!" across its top edge and a cloud band across the bottom of the screen.
 */
const HFS = "/symbols/zeusVsHades/game/hfs";
const HADES_FS_CSS = `
@keyframes zvh-fire-rise { from { transform: translateY(105%); } to { transform: translateY(0); } }
@keyframes zvh-fire-flicker { 0%,100% { filter: brightness(1) saturate(1.1); } 50% { filter: brightness(1.25) saturate(1.3); } }
@keyframes zvh-fire-drift { from { background-position-x: 0; } to { background-position-x: -608px; } }
.zvh-fire-band { background-size: 608px 100%; background-repeat: repeat-x; animation: zvh-fire-drift 1.6s linear infinite, zvh-fire-flicker 0.35s ease-in-out infinite; }
`;

/**
 * Hades free spins intro / outro, as in the original: fire floods up over the whole screen, then
 * a lava panel framed by the silver horned frame zooms out into place, with the fire burning on
 * at both sides of the screen. Pieces from the shared sheets (see zeusVsHades-slice.spec.json, hfs/*).
 */
function HadesFreeSpinsPanel({ banner, onDismiss }: { banner: Banner; onDismiss: () => void }) {
  const [phase, setPhase] = useState<"fire" | "panel">("fire");
  useEffect(() => {
    const id = window.setTimeout(() => setPhase("panel"), 900);
    return () => window.clearTimeout(id);
  }, []);
  const title: CSSProperties = {
    fontFamily: FONT,
    backgroundImage: "linear-gradient(180deg, #fff6a0 0%, #ffd21a 45%, #e88a00 100%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextStroke: "3px #6a1a00",
    filter: "drop-shadow(0 5px 0 rgba(60,10,0,0.85))",
  };
  // Three fire textures stacked into a wall of flame.
  const fireWall = (style: CSSProperties) => (
    <div className="pointer-events-none absolute" style={style}>
      {[1, 2, 3].map((n) => (
        <div key={n} className="zvh-fire-band h-1/3 w-full" style={{ backgroundImage: `url(${HFS}/fire-${n}.png)`, animationDelay: `${n * -0.4}s` }} />
      ))}
    </div>
  );

  return (
    <button className="absolute inset-0 z-40 overflow-hidden" onClick={onDismiss} aria-label="Continue">
      <style>{HADES_FS_CSS}</style>
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{ opacity: phase === "panel" ? 1 : 0, background: "radial-gradient(ellipse at 50% 50%, rgba(80,10,10,0.55), rgba(20,0,0,0.85))" }}
      />

      {/* Fire flood: rises over the whole screen, then pulls back to the sides. */}
      {fireWall({
        left: 0,
        right: 0,
        bottom: 0,
        height: "100%",
        animation: "zvh-fire-rise 0.6s ease-out both",
        opacity: phase === "fire" ? 1 : 0,
        transition: "opacity 0.5s",
        mixBlendMode: "screen",
        // Soft, ragged top edge instead of a straight line.
        maskImage: "linear-gradient(0deg, #000 80%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(0deg, #000 80%, transparent 100%)",
      })}
      {fireWall({ left: -40, top: 0, width: 300, height: "100%", opacity: phase === "panel" ? 0.45 : 0, transition: "opacity 0.6s", mixBlendMode: "screen", maskImage: "linear-gradient(90deg, #000 30%, transparent)", WebkitMaskImage: "linear-gradient(90deg, #000 30%, transparent)" })}
      {fireWall({ right: -40, top: 0, width: 300, height: "100%", opacity: phase === "panel" ? 0.45 : 0, transition: "opacity 0.6s", mixBlendMode: "screen", maskImage: "linear-gradient(270deg, #000 30%, transparent)", WebkitMaskImage: "linear-gradient(270deg, #000 30%, transparent)" })}

      {/* Panel, zooming out from 1.35x into place. */}
      <div
        className="absolute left-[170px] top-[150px] h-[470px] w-[940px] transition-[transform,opacity] duration-700 ease-out"
        style={{ transform: phase === "panel" ? "scale(1)" : "scale(1.35)", opacity: phase === "panel" ? 1 : 0 }}
      >
        {/* Lava background inside the frame. */}
        <img src={`${HFS}/lava.png`} alt="" draggable={false} className="absolute left-[95px] top-[52px] h-[360px] w-[750px] max-w-none" />
        {/* Silver horned frame: the right half and its mirror. */}
        <img src={`${HFS}/frame-half.png`} alt="" draggable={false} className="absolute left-[470px] top-[0px] h-[440px] w-[480px] max-w-none" style={{ marginLeft: -84 }} />
        <img src={`${HFS}/frame-half.png`} alt="" draggable={false} className="absolute left-[-10px] top-[0px] h-[440px] w-[480px] max-w-none -scale-x-100" style={{ marginLeft: 84 }} />
        <img src={`${HFS}/gem-v.png`} alt="" draggable={false} className="absolute left-[442px] top-[378px] h-[78px] w-[58px]" />
        <img src={`${HFS}/gem-v.png`} alt="" draggable={false} className="absolute left-[112px] top-[318px] h-[56px] w-[42px]" />
        <img src={`${HFS}/gem-v.png`} alt="" draggable={false} className="absolute left-[786px] top-[318px] h-[56px] w-[42px]" />

        <div className="absolute inset-x-0 top-[78px] flex flex-col items-center">
          <div className="text-[48px] leading-none" style={title}>
            YOU HAVE WON
          </div>
          <div className="relative mt-[22px] flex h-[96px] w-[540px] items-center justify-center" style={{ backgroundImage: `url(${HFS}/bar.png)`, backgroundSize: "100% 100%" }}>
            <img src={`${HFS}/gem-h.png`} alt="" draggable={false} className="absolute left-[-46px] top-[24px] h-[48px] w-[66px]" />
            <img src={`${HFS}/gem-h.png`} alt="" draggable={false} className="absolute right-[-46px] top-[24px] h-[48px] w-[66px]" />
            <span className="text-[62px] leading-none" style={title}>
              {banner.kind === "fsIntro" ? RULES.freeSpinsAwarded : money(banner.amount)}
            </span>
          </div>
          <div className="mt-[18px] text-[56px] leading-none" style={title}>
            {banner.kind === "fsIntro"
              ? "FREE SPINS"
              : banner.capped
                ? `MAX WIN ${RULES.maxWinX.toLocaleString()}x`
                : `IN ${RULES.freeSpinsAwarded} FREE SPINS`}
          </div>
          <div className="mt-[10px] text-[18px] text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]" style={{ fontFamily: FONT }}>
            PRESS ANYWHERE TO CONTINUE
          </div>
        </div>
        {/* Arched title over the top. */}
        <div className="absolute inset-x-[-60px] top-[-62px] flex justify-center whitespace-nowrap text-[92px] leading-none">
          {"CONGRATULATIONS!".split("").map((ch, i, all) => {
            const t = i / (all.length - 1) - 0.5;
            return (
              <span key={i} style={{ ...title, display: "inline-block", transform: `translateY(${Math.abs(t) * 46}px) rotate(${t * 18}deg)` }}>
                {ch}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
}

function FreeSpinsPanel(props: { banner: Banner; profile: Profile; onDismiss: () => void }) {
  if (props.profile === "hades") return <HadesFreeSpinsPanel banner={props.banner} onDismiss={props.onDismiss} />;
  return <OlympusFreeSpinsPanel {...props} />;
}

function OlympusFreeSpinsPanel({ banner, profile, onDismiss }: { banner: Banner; profile: Profile; onDismiss: () => void }) {
  const hades = profile === "hades";
  const frame = PANEL_FRAME[profile];
  const [phase, setPhase] = useState<"clouds" | "panel">("clouds");
  useEffect(() => {
    const id = window.setTimeout(() => setPhase("panel"), 650);
    return () => window.clearTimeout(id);
  }, []);

  const titleStyle: CSSProperties = {
    fontFamily: FONT,
    backgroundImage: hades
      ? "linear-gradient(180deg, #fff3b0 0%, #ffb21a 50%, #d43a00 100%)"
      : "linear-gradient(180deg, #ffffff 0%, #9ff0ff 45%, #2a8cff 100%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextStroke: hades ? "2px #3a0a00" : "2px #06215c",
    filter: "drop-shadow(0 4px 0 rgba(0,0,0,0.6))",
  };
  const cloudFilter = hades ? "brightness(0.6) sepia(1) hue-rotate(-25deg) saturate(3)" : undefined;
  const cloud = (style: CSSProperties) => (
    <img src={CELEBRATION_FX.clouds} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ filter: cloudFilter, ...style }} />
  );

  return (
    <button className="absolute inset-0 z-40 overflow-hidden" onClick={onDismiss} aria-label="Continue">
      <div
        className="absolute inset-0 backdrop-blur-[4px] transition-opacity duration-500"
        style={{
          opacity: phase === "panel" ? 1 : 0,
          background: hades
            ? "radial-gradient(ellipse at 50% 42%, rgba(255,120,30,0.5) 0%, rgba(50,5,0,0.78) 45%, rgba(10,0,0,0.85) 100%)"
            : "radial-gradient(ellipse at 50% 42%, rgba(120,230,255,0.55) 0%, rgba(10,25,70,0.78) 45%, rgba(0,5,25,0.85) 100%)",
        }}
      />

      {/* Panel, zooming out from 1.35x into place. */}
      <div
        className="absolute left-[285px] top-[78px] w-[710px] transition-[transform,opacity] duration-700 ease-out"
        style={{ transform: phase === "panel" ? "scale(1)" : "scale(1.35)", opacity: phase === "panel" ? 1 : 0 }}
      >
        <div
          className="relative mt-[62px] flex h-[352px] flex-col items-center pt-[44px]"
          style={{
            borderStyle: "solid",
            borderWidth: `${frame.slice[0] * 0.5}px ${frame.slice[1] * 0.5}px ${frame.slice[2] * 0.5}px ${frame.slice[3] * 0.5}px`,
            borderImage: `url(${frame.src}) ${frame.slice.join(" ")} stretch`,
            backgroundColor: hades ? "#3a0a06" : "#0e3a66",
            backgroundImage: `linear-gradient(${hades ? "rgba(90,15,10,0.55), rgba(30,0,0,0.7)" : "rgba(30,90,150,0.3), rgba(5,30,80,0.55)"}), url(${COLUMN_STONE})`,
            // The stone art is a slanted column; widen it so its transparent edges fall outside.
            backgroundSize: "100% 100%, 190% 100%",
            backgroundPosition: "center",
          }}
        >
          <div className="text-[44px] leading-none" style={gold}>
            YOU HAVE WON
          </div>
          <div
            className="my-[14px] flex h-[84px] w-[440px] items-center justify-center rounded-[10px] border-[5px] text-[62px] leading-none"
            style={{
              borderColor: hades ? "#c79a6a" : "#a8cdf2",
              background: hades ? "linear-gradient(#5a0a0a,#2a0000)" : "linear-gradient(#1a3c9a,#0a1a5c)",
              boxShadow: "inset 0 0 12px rgba(0,0,0,0.7), 0 4px 10px rgba(0,0,0,0.5)",
            }}
          >
            <span style={gold}>{banner.kind === "fsIntro" ? RULES.freeSpinsAwarded : money(banner.amount)}</span>
          </div>
          <div className="text-[50px] leading-none" style={gold}>
            {banner.kind === "fsIntro"
              ? "FREE SPINS"
              : banner.capped
                ? `MAX WIN ${RULES.maxWinX.toLocaleString()}x`
                : `IN ${RULES.freeSpinsAwarded} FREE SPINS`}
          </div>
          <div className="mt-[10px] text-[17px] text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]">PRESS ANYWHERE TO CONTINUE</div>
        </div>
        {/* Title over the panel's top edge, slightly arched as in the original. */}
        <div className="absolute inset-x-[-40px] top-[8px] flex justify-center whitespace-nowrap text-[78px] leading-none">
          {"CONGRATULATIONS!".split("").map((ch, i, all) => {
            const t = i / (all.length - 1) - 0.5;
            return (
              <span key={i} style={{ ...titleStyle, display: "inline-block", transform: `translateY(${Math.abs(t) * 34}px) rotate(${t * 14}deg)` }}>
                {ch}
              </span>
            );
          })}
        </div>
      </div>

      {/* Cloud band across the bottom of the screen, over the panel's foot. */}
      <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: phase === "panel" ? 1 : 0 }}>
        {cloud({ left: -160, top: 380, width: 1600, height: 330 })}
      </div>

      {/* Transition: white flash + clouds rushing across the reels, then parting. */}
      <div className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-500" style={{ opacity: phase === "clouds" ? 0.85 : 0 }} />
      <div
        className="pointer-events-none absolute inset-0 transition-[transform,opacity] duration-700 ease-in"
        style={{ transform: phase === "clouds" ? "scale(1)" : "scale(1.8)", opacity: phase === "clouds" ? 1 : 0 }}
      >
        {cloud({ left: -200, top: 120, width: 1700, height: 420 })}
        {cloud({ left: -300, top: 320, width: 1800, height: 460, transform: "scaleX(-1)" })}
      </div>
    </button>
  );
}

// ------------------------------------------------------------------------------------------
// Start screen
// ------------------------------------------------------------------------------------------

function ProfileChooser({ onChoose }: { onChoose: (p: Profile) => void }) {
  return (
    <div className="absolute inset-0 z-40 flex">
      <img src={UI.chooserBg} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <img src={START_BG_URL} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      {(["olympus", "hades"] as const).map((p) => (
        <button
          key={p}
          onClick={() => {
            sound.resumeAudio();
            onChoose(p);
          }}
          aria-label={`Play in ${PROFILE_INFO[p].name}`}
          className={`group relative flex flex-1 flex-col items-center justify-end pb-[58px] transition`}
        >
          <span className="text-[38px] transition group-hover:scale-110" style={gold}>
            PLAY IN {PROFILE_INFO[p].name}
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Info screen (paged like the original)
// ------------------------------------------------------------------------------------------

function InfoScreen({ profile, bet, onClose }: { profile: Profile; bet: number; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const coin = coinValueFor(bet);
  const pays = (s: number) => [2, 1, 0].map((i) => `${i + 3} - ${money(PAYTABLES[profile][s][i] * coin)}`);
  const pages: { title: string; body: ReactNode }[] = [
    {
      title: "GAME RULES",
      body: (
        <>
          <p className="text-center">
            All symbols pay from left to right on adjacent reels starting from the leftmost reel.
            <br />
            The game has two profiles that can be chosen by the player, OLYMPUS and HADES modes.
            <br />
            When playing in OLYMPUS mode the chance to hit the FREE SPINS feature is higher but the average win of FREE SPINS rounds is lower.
            <br />
            When playing in HADES mode the chance to hit the FREE SPINS feature is lower but the average win of FREE SPINS rounds is higher.
          </p>
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-y-4 text-center">
            {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => (
              <div key={s}>
                <div className="flex justify-center">
                  <img src={symbolUrl(s, profile)} alt={SYMBOL_NAMES[profile][s]} className="h-[32px] sm:h-[44px] w-[38px] sm:w-[52px] object-contain" />
                </div>
                {pays(s).map((t) => (
                  <div key={t} className="text-[12px] sm:text-[11px] leading-[12px] sm:leading-[14px]">
                    {t}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      title: "WILD AND EXPANDING WILD",
      body: (
        <div className="space-y-6">
          <div className="flex items-center gap-3 sm:gap-6 flex-col sm:flex-row">
            <img src={symbolUrl(2, profile)} alt="Wild" className="h-[44px] sm:h-[60px] w-[53px] sm:w-[72px] object-contain" />
            <div>
              {pays(2).map((t) => (
                <div key={t}>{t}</div>
              ))}
              This is the WILD symbol and substitutes for all symbols except for SCATTER. It appears on all reels.
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6 flex-col sm:flex-row">
            <div className="flex gap-1">
              <img src={symbolUrl(13, "olympus")} alt="" className="h-[44px] sm:h-[60px] w-[44px] sm:w-[60px] object-contain" />
              <img src={symbolUrl(13, "hades")} alt="" className="h-[44px] sm:h-[60px] w-[44px] sm:w-[60px] object-contain" />
            </div>
            <div>
              These are EXPANDING WILD symbols. They appear on all reels. Whenever any of them hits in the base game or FREE SPINS, if
              there would be any win after expansion, it expands the whole reel vertically and gets a random multiplier. Possible values
              are {MULTIPLIER_VALUES.map((m) => `${m}x`).join(", ")}. The multiplier applies to all winning combinations that it is part
              of. If more than one WILD is part of the same winning combination, their multipliers add to each other.
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "FREE SPINS",
      body: (
        <div className="flex items-center gap-3 sm:gap-6 flex-col sm:flex-row">
          <div className="flex gap-1">
            <img src={symbolUrl(1, "olympus")} alt="" className="h-[44px] sm:h-[60px] w-[53px] sm:w-[72px] object-contain" />
            <img src={symbolUrl(1, "hades")} alt="" className="h-[44px] sm:h-[60px] w-[53px] sm:w-[72px] object-contain" />
          </div>
          <div>
            These are SCATTER symbols. They appear only on reels 1, 3 and 5 and only in the base game. Hit 3 SCATTER symbols to trigger
            the FREE SPINS feature and get {RULES.freeSpinsAwarded} free spins. During the round any expanding WILD symbol that hits will
            expand, get a random multiplier from the same possible values as in the base game and will remain on the screen until the
            end of the round, for all free spins. The feature cannot be retriggered. Special reels are in play during the feature.
          </div>
        </div>
      ),
    },
    {
      title: "BUY FREE SPINS",
      body: (
        <div className="space-y-3 text-center">
          <p>The FREE SPINS round can be instantly triggered from the base game by buying it.</p>
          <p>When in OLYMPUS mode: cost of {buyCostX("olympus", "standard")}x total bet awards a standard FREE SPINS feature; cost of {buyCostX("olympus", "super")}x total bet awards a special FREE SPINS feature in which one expanding WILD is guaranteed to hit with a random multiplier and in a random position on the first free spin of the round.</p>
          <p>When in HADES mode: cost of {buyCostX("hades", "standard")}x total bet awards a standard FREE SPINS feature; cost of {buyCostX("hades", "super")}x total bet awards the special FREE SPINS feature.</p>
          <p className="pt-4 text-[14px] sm:text-[16px]" style={gold}>SPECIAL BETS</p>
          <p>
            SUPER SPIN 1 - Bet multiplier {SPECIAL_BET_COINS.super1}x - on every spin 1 WILD symbol with random multiplier is guaranteed to hit in a random
            position on the screen and expands if there will be at least a winning combination.
          </p>
          <p>
            SUPER SPIN 2 - Bet multiplier {SPECIAL_BET_COINS.super2}x - on every spin 1 WILD symbol with guaranteed multiplier {SUPER2_MULTIPLIER}x is
            guaranteed to hit in a random position on the screen and expands if there will be at least a winning combination.
          </p>
          <p>Scatters do not appear while a special bet is active. Special bets are not applied to bought features.</p>
          <p className="pt-4 text-[14px] sm:text-[16px]" style={gold}>MAX WIN</p>
          <p>
            The maximum win amount is limited to {RULES.maxWinX.toLocaleString()}x bet in both base game and free spins. If the total win of
            a FREE SPINS round reaches {RULES.maxWinX.toLocaleString()}x bet the round immediately ends, win is awarded and all remaining free
            spins are forfeited.
          </p>
        </div>
      ),
    },
    {
      title: "PAYLINES",
      body: (
        <>
          <div className="mx-auto grid w-full sm:w-[570px] grid-cols-3 sm:grid-cols-5 gap-x-3 sm:gap-x-6 gap-y-4">
            {PAYLINES.map((rows, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-[22px] text-right text-[12px] sm:text-[12px]">{i + 1}</span>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-[2px]">
                  {Array.from({ length: 25 }, (_, k) => (
                    <div key={k} className={`h-[10px] w-[10px] ${rows[k % 5] === Math.floor(k / 5) ? "bg-white" : "bg-white/20"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 sm:mt-6 text-center">
            All symbols pay from left to right on selected paylines. Free spins win is added to the payline win. All wins are multiplied
            by bet per line. Only the highest win is paid per line. When winning on multiple paylines, all wins are added to the total
            win. Free spins round win is awarded to the player after the round completes. SPACE and ENTER buttons on the keyboard can be
            used to start the spin.
          </p>
        </>
      ),
    },
  ];
  const current = pages[page];
  // Covers the real viewport through a portal (the game card is CSS-scaled, so anything inside it
  // would shrink with it on a phone); same dark panel / lime arrows look as the original.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Game rules"
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col rounded-[10px] bg-black/90 px-3 pb-3 pt-3 text-[13px] leading-[19px] text-white sm:px-[40px] sm:pt-[16px] sm:text-[16px] sm:leading-[22px]"
        style={{ width: "min(1030px, 96vw)", height: "min(640px, 94dvh)", fontFamily: "Arial, sans-serif" }}
      >
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2 top-1 text-[34px] leading-none text-white/80 hover:text-white sm:right-4 sm:top-2 sm:text-[44px]"
        >
          ×
        </button>
        <div className="mb-3 pr-8 text-center text-[19px] sm:text-[26px]" style={{ fontFamily: FONT }}>
          {current.title}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{current.body}</div>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-[14px]">
            <button aria-label="Previous page" onClick={() => setPage((p) => (p + pages.length - 1) % pages.length)} className="h-0 w-0 border-y-[16px] border-r-[26px] border-y-transparent border-r-lime-500 hover:border-r-lime-400 sm:border-y-[20px] sm:border-r-[32px]" />
            <button aria-label="Close" onClick={onClose} className="relative h-[32px] w-[32px] hover:brightness-110 sm:h-[38px] sm:w-[38px]">
              <span className="absolute left-[13px] top-[-2px] h-[36px] w-[7px] rotate-45 rounded bg-lime-500 sm:left-[16px] sm:h-[42px] sm:w-[8px]" />
              <span className="absolute left-[13px] top-[-2px] h-[36px] w-[7px] -rotate-45 rounded bg-lime-500 sm:left-[16px] sm:h-[42px] sm:w-[8px]" />
            </button>
            <button aria-label="Next page" onClick={() => setPage((p) => (p + 1) % pages.length)} className="h-0 w-0 border-y-[16px] border-l-[26px] border-y-transparent border-l-lime-500 hover:border-l-lime-400 sm:border-y-[20px] sm:border-l-[32px]" />
          </div>
          <div className="text-[13px] sm:text-[15px]">
            Page {page + 1}/{pages.length}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ------------------------------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------------------------------

function MenuIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" stroke="white" strokeWidth="3" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinejoin="round" fill="white" />
      {muted ? <path d="M17 9 22 15M22 9l-5 6" strokeLinecap="round" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />}
    </svg>
  );
}
