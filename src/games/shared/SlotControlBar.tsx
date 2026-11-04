import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBalanceCountUp } from "./useCountUp";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "./SoundSettings";

/**
 * SlotControlBar — the shared 3D key-cap slot-machine control bar (info / mute / CREDIT / BET
 * -/+ / WIN / Turbo / AUTO / SPIN), used across every slot game that wants this look. It's a
 * fully controlled, game-agnostic component: every value and action comes in through props, so
 * it has no idea which game is rendering it. A game's own `XGame.tsx` wires its own real balance,
 * bet levels, spin handler, turbo/autoplay state, etc. into these same props — see
 * `Crazy777Game.tsx`'s usage for a working example of the wiring.
 *
 * Assumes exactly this control set (info/mute/credit/bet/win/turbo/auto/spin). A game that needs
 * something different (an extra readout, no turbo, a free-spins counter, ...) should get a new
 * optional prop added here rather than a one-off fork of this file — ask before forking.
 *
 * Styled entirely with Tailwind utility classes (including arbitrary-value syntax for the
 * gradients/shadows with no named Tailwind equivalent) — no injected stylesheet. The four custom
 * keyframe animations it uses (scb-glow-y, scb-glow-r, scb-pop, scb-win-flash) are registered in
 * tailwind.config.js's theme.extend.keyframes/animation, alongside this app's other custom
 * animations — Tailwind utility classes can only ever reference a keyframe by name, never define
 * one inline. Its Chakra Petch font is self-hosted (src/fonts.css), loaded app-wide.
 *
 * Designed at 1280px wide and scales (via ResizeObserver + CSS transform) to fill whatever width
 * its parent gives it, so it renders the same proportions regardless of the host game's own
 * canvas size.
 */
export interface SlotControlBarProps {
  credit: number;
  betLabel: string;
  onBetDecrease: () => void;
  onBetIncrease: () => void;
  betDecreaseDisabled?: boolean;
  betIncreaseDisabled?: boolean;
  win: number;
  spinning: boolean;
  spinDisabled?: boolean;
  onSpin: () => void;
  /** Omit both to hide the turbo key entirely — not every game has a turbo-speed concept. */
  turbo?: boolean;
  onToggleTurbo?: () => void;
  auto: boolean;
  onToggleAuto: () => void;
  autoDisabled?: boolean;
  /** Omit to hide the max-bet key — only some games offer a one-tap "jump to the highest bet". */
  onMaxBet?: () => void;
  maxBetDisabled?: boolean;
  /** No longer used — the Sound key opens the shared sound settings popup (see SoundSettings.tsx)
   * and its icon follows those settings. Kept so existing callers still compile. */
  muted: boolean;
  onToggleMute: () => void;
  onInfo: () => void;
}

const DESIGN_W = 1280;
const DESIGN_H = 110;

/* ------------------------------------------------------------------ */
/*  3D key-cap building blocks                                         */
/* ------------------------------------------------------------------ */

type KeyColor = "white" | "yellow" | "spin" | "stop";

/* Key style — every key uses the "button-14" reference's layers (see Key below); only each
 * key's size, place and colors are its own. Tailwind needs every class spelled out in full.
 *  - bottom: the key's body/sides (button-14's #803), cap: its top surface (button-14's
 *    radial-gradient(#cd3f64,#9d3656)), text: the label color. */
const KEY_COLORS: Record<KeyColor, { bottom: string; cap: string; text: string }> = {
  white: { bottom: "bg-[#8d8d94]", cap: "bg-[radial-gradient(#ffffff,#d4d4da)]", text: "text-[#2b2b2b]" },
  yellow: { bottom: "bg-[#a37a05]", cap: "bg-[radial-gradient(#fff9b8,#ffd21c)]", text: "text-[#2b2b2b]" },
  spin: { bottom: "bg-[#997a00]", cap: "bg-[radial-gradient(#ffe88a,#FFD21A)]", text: "text-[#123B2A]" },
  stop: { bottom: "bg-[#75061a]", cap: "bg-[radial-gradient(#ff3149,#db0f2c)]", text: "text-white" },
};

/* Pressed look — applied through the button's own `data-pressed` attribute (set directly on the
 * DOM in Key's pointer handlers, never through React state), so it paints in the same frame as
 * the press. When a key flashes a *different* color while held (`pressedColor`, e.g. the bet
 * −/+ keys going yellow), its body and cap switch to that color. */
const KEY_PRESSED_AS: Record<KeyColor, { bottom: string; cap: string }> = {
  white: { bottom: "group-data-[pressed=true]:bg-[#8d8d94]", cap: "group-data-[pressed=true]:bg-[radial-gradient(#ffffff,#d4d4da)]" },
  yellow: { bottom: "group-data-[pressed=true]:bg-[#a37a05]", cap: "group-data-[pressed=true]:bg-[radial-gradient(#fff9b8,#ffd21c)]" },
  spin: { bottom: "group-data-[pressed=true]:bg-[#997a00]", cap: "group-data-[pressed=true]:bg-[radial-gradient(#ffe88a,#FFD21A)]" },
  stop: { bottom: "group-data-[pressed=true]:bg-[#75061a]", cap: "group-data-[pressed=true]:bg-[radial-gradient(#ff3149,#db0f2c)]" },
};

/** button-14's 0.2s motion for the release back up; the press itself snaps instantly
 * (duration 0 while pressed) so a tap never feels delayed. */
const KEY_MOTION = "duration-200 group-data-[pressed=true]:duration-0";

interface KeyProps {
  color: KeyColor;
  width: number;
  height: number;
  /** The key's bottom area under the top (button-14's 12px padding-bottom); the top drops
   * half of it when pressed (button-14's 6px). Keeps each key's current overall height. */
  depth?: number;
  className?: string;
  ariaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Color the key switches to while it's held down (e.g. the bet −/+ keys flash "yellow",
   * matching an active Turbo/AUTO key). Omit to keep `color` while pressed. */
  pressedColor?: KeyColor;
  children: React.ReactNode;
}

/** A quick tap still shows the pressed look for at least this long, so the flash is visible. */
const MIN_PRESS_FLASH_MS = 70;

/** Runs `fn` right after the browser's next paint: rAF fires just before that paint, and the
 * setTimeout inside it lands just after. Used so a key's pressed look is on screen before the
 * game's own (heavier) state update and re-render happens. */
function afterNextPaint(fn: () => void) {
  requestAnimationFrame(() => window.setTimeout(fn, 0));
}

/** The press behavior every key shares: instant pressed look via a
 * `data-pressed` DOM attribute, the action run right after that paint, a double-tap guard, a
 * live disabled re-check, and keyboard activation. Spread `pressProps` onto the <button>. */
function usePressableKey(onClick: (() => void) | undefined, disabled: boolean | undefined) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const pressStartRef = useRef(0);
  const releaseTimerRef = useRef<number | undefined>(undefined);
  // True from a press until its action has run and React has had a frame to re-render (so e.g.
  // SPIN's `disabled` is applied). Stops a fast double-tap from queuing the action twice.
  const actionPendingRef = useRef(false);

  // The pressed look is a DOM attribute, not React state: setting it costs no re-render, so it
  // paints on the very next frame no matter how much work the game does in response.
  const setPressedLook = (on: boolean) => {
    const btn = btnRef.current;
    if (!btn) return;
    if (on) btn.dataset.pressed = "true";
    else delete btn.dataset.pressed;
  };
  const press = () => {
    window.clearTimeout(releaseTimerRef.current);
    pressStartRef.current = Date.now();
    setPressedLook(true);
  };
  const release = () => {
    const remaining = MIN_PRESS_FLASH_MS - (Date.now() - pressStartRef.current);
    window.clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = window.setTimeout(() => setPressedLook(false), Math.max(0, remaining));
  };
  /** Show the press now; run the game's action right after that frame is painted. */
  const activate = () => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    press();
    afterNextPaint(() => {
      // Re-check against the live DOM: if the key became disabled in the meantime (e.g. autoplay
      // started a spin), drop the action exactly as a press on a disabled key would be dropped.
      if (!btnRef.current?.disabled) onClick?.();
      requestAnimationFrame(() => {
        actionPendingRef.current = false;
      });
    });
  };
  // A disabled button stops receiving pointer events, so a press that disables the key (e.g. + up
  // to the max bet, or SPIN starting a spin) would never see its pointerup — release it through
  // the normal path instead (min flash, then the same eased return), so it never snaps up.
  useEffect(() => {
    if (disabled) release();
  }, [disabled]); // only on the disabled flip — `release` reads refs, so a stale copy is fine
  useEffect(() => () => window.clearTimeout(releaseTimerRef.current), []);

  const pressProps = {
    ref: btnRef,
    // Fire on press-down rather than on release (click), so the action lands the instant the
    // key goes down. onClick only handles keyboard activation (Enter/Space report detail 0),
    // so a mouse/touch press never fires twice.
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || disabled) return;
      activate();
    },
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail === 0 && !disabled) {
        activate();
        release();
      }
    },
  };
  return pressProps;
}

/** button-14's layer shapes. "regular" is the reference 1:1; "compact" is the same recipe with
 * every radius / highlight / padding halved, for keys too narrow for the reference's fixed px
 * values (Info/Mute at 25px wide — the reference's 16px top padding alone is wider than their
 * cap). The bottom's height/top padding are shared (see Key): its top padding equals the top's
 * press drop (depth/2), so both layers travel the same distance and stay in sync. */
const KEY_SHAPE = {
  regular: {
    base: "rounded-[12px]",
    bottom:
      "[border-radius:8px/16px_16px_8px_8px] group-data-[pressed=true]:[border-radius:10px_10px_8px_8px/8px] bg-[radial-gradient(4px_8px_at_4px_calc(100%-8px),rgba(255,255,255,.25),transparent),radial-gradient(4px_8px_at_calc(100%-4px)_calc(100%-8px),rgba(255,255,255,.25),transparent),radial-gradient(16px_at_-4px_0,white,transparent),radial-gradient(16px_at_calc(100%+4px)_0,white,transparent)]",
    top: "px-4 py-2",
    cap: "rounded-[4px] group-data-[pressed=true]:rounded-[6px]",
  },
  compact: {
    base: "rounded-[6px]",
    bottom:
      "[border-radius:4px/8px_8px_4px_4px] group-data-[pressed=true]:[border-radius:5px_5px_4px_4px/4px] bg-[radial-gradient(2px_4px_at_2px_calc(100%-4px),rgba(255,255,255,.25),transparent),radial-gradient(2px_4px_at_calc(100%-2px)_calc(100%-4px),rgba(255,255,255,.25),transparent),radial-gradient(8px_at_-2px_0,white,transparent),radial-gradient(8px_at_calc(100%+2px)_0,white,transparent)]",
    top: "p-0",
    cap: "rounded-[3px] group-data-[pressed=true]:rounded-[4px]",
  },
} as const;

/* A port of the "button-14" reference. Layers, back to front:
 *  - base:   a faint dark well the key sits in (rgba black .15, light rim + inner shadow);
 *  - bottom: the key's body/sides (color + four highlight gradients), visible below the top;
 *  - top:    the label row, with its ::after (here a real span) as the gradient cap.
 * Press: the top drops depth/2, the cap rounds to 6px and widens 2px a side, and the bottom's
 * domed radius flattens with its 6px top padding collapsing. `isolate` keeps the reference's
 * negative z-indexes inside this button. Very narrow keys (Info/Mute) use the "compact" shape
 * and a 4px side padding instead of 8px so the cap keeps a usable width. */
function Key({ color, width, height, depth = 6, className = "", ariaLabel, onClick, disabled, pressedColor, children }: KeyProps) {
  const pressProps = usePressableKey(onClick, disabled);
  const colors = KEY_COLORS[color];
  const pressedAs = pressedColor ? KEY_PRESSED_AS[pressedColor] : { bottom: "", cap: "" };
  // SPIN/STOP stay at full color while disabled (Crazy777's spin-in-progress state); other
  // disabled keys dim.
  const staysFullColorWhenDisabled = color === "spin" || color === "stop";
  const compact = width < 40;
  const shape = KEY_SHAPE[compact ? "compact" : "regular"];
  const sidePad = compact ? 4 : 8;

  return (
    <button
      {...pressProps}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      className={`group relative isolate box-border inline-block flex-none cursor-pointer appearance-none border-0 bg-transparent pt-0 m-0 outline-none [font:inherit] [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] disabled:cursor-default ${
        staysFullColorWhenDisabled ? "" : "disabled:brightness-[.6] disabled:saturate-[.6]"
      } ${className}`}
      style={{ width, height: height + depth, paddingLeft: sidePad, paddingRight: sidePad, paddingBottom: depth, "--depth": `${depth}px` } as React.CSSProperties}
    >
      {/* base */}
      <span className={`absolute left-0 top-1 -z-20 h-[calc(100%-4px)] w-full ${shape.base} bg-[rgba(0,0,0,.15)] shadow-[0_1px_1px_0_rgba(255,255,255,.75),inset_0_2px_2px_rgba(0,0,0,.25)]`} />
      {/* bottom */}
      <span
        className={`absolute bottom-1 left-1 -z-10 box-content h-[calc(100%-4px-var(--depth)/2)] w-[calc(100%-8px)] pt-[calc(var(--depth)/2)] ${shape.bottom} ${colors.bottom} ${pressedAs.bottom} shadow-[0px_2px_3px_0px_rgba(0,0,0,0.5),inset_0_-1px_3px_3px_rgba(0,0,0,.4)] transition-[border-radius,padding-top] ${KEY_MOTION} group-data-[pressed=true]:pt-0`}
      />
      {/* top */}
      <span
        className={`relative z-0 flex h-full select-none items-center justify-center ${shape.top} text-center ${colors.text} [text-shadow:0_-1px_rgba(0,0,0,.25)] will-change-transform transition-transform ${KEY_MOTION} group-data-[pressed=true]:translate-y-[calc(var(--depth)/2)] group-focus-visible:outline group-focus-visible:outline-[3px] group-focus-visible:outline-offset-2 group-focus-visible:outline-[#ffe14d]`}
      >
        {/* top::after — the cap */}
        <span
          className={`absolute left-0 top-0 -z-10 box-content h-full w-full ${shape.cap} ${colors.cap} ${pressedAs.cap} shadow-[inset_0_0_0px_1px_rgba(255,255,255,.2),0_1px_2px_1px_rgba(255,255,255,.2)] transition-[left,padding,border-radius] ${KEY_MOTION} group-data-[pressed=true]:-left-0.5 group-data-[pressed=true]:px-0.5`}
        />
        {children}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const BoltIcon = () => (
  <svg viewBox="0 0 24 32" width="26" height="36" aria-hidden>
    <path d="M14 0 L2 18 H11 L8 32 L22 11 H13 L17 0 Z" fill="#111" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
    <circle cx="11" cy="4" r="2.6" fill="#1a1a1a" />
    <path d="M7 8 H13 L10.5 17 H13 L12.5 19 H5 L5.5 17 H7.5 L9.4 10 H6.5 Z" fill="#1a1a1a" />
  </svg>
);

/** Replaces the reference design's generic MenuIcon — this slot is wired to mute/sound instead
 * (Crazy777 has no menu system), same size/position/key styling. */
const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="14" aria-hidden>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="#1a1a1a" />
    {muted ? (
      <path d="M17 9 22 15M22 9l-5 6" stroke="#1a1a1a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    ) : (
      <>
        <path d="M16 8a5 5 0 0 1 0 8" stroke="#1a1a1a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" stroke="#1a1a1a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      </>
    )}
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function SlotControlBar({
  credit,
  betLabel,
  onBetDecrease,
  onBetIncrease,
  betDecreaseDisabled,
  betIncreaseDisabled,
  win,
  spinning,
  spinDisabled,
  onSpin,
  turbo,
  onToggleTurbo,
  auto,
  onToggleAuto,
  autoDisabled,
  onMaxBet,
  maxBetDisabled,
  onInfo,
}: SlotControlBarProps) {
  const shownCredit = useBalanceCountUp(credit);
  const soundSettings = useSoundSettings();
  const soundSilent = isSilent(soundSettings);
  const [soundOpen, setSoundOpen] = useState(false);
  /* ---------- responsive scaling ---------- */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / DESIGN_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- "pop" bump animation on real value changes ---------- */
  const [winPop, setWinPop] = useState(0);
  const prevWin = useRef(win);
  useEffect(() => {
    if (win !== prevWin.current) {
      prevWin.current = win;
      setWinPop((n) => n + 1);
    }
  }, [win]);
  return (
    <div ref={wrapRef} className="relative w-full select-none overflow-hidden [-webkit-tap-highlight-color:transparent]" style={{ height: DESIGN_H * scale }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` }}>
        <div className="absolute inset-0 flex items-center border-t-4 border-[#5C4204] pl-[60px] pr-[30px] box-border [transform:perspective(500px)_rotateX(5deg)]">
          {/* background panel: solid color fading to transparent at the top */}
          <div className="absolute inset-0 z-0 bg-[#1E3537]" />

          <div className="relative z-[1] flex w-full items-center">
            {/* info + mute */}
            <div className="mr-[40px] mt-1 flex flex-none flex-col gap-[15px]">
              <Key color="white" width={25} height={25} depth={6} ariaLabel="Paytable" onClick={onInfo}>
                <InfoIcon />
              </Key>
              <Key
                color="white"
                width={25}
                height={25}
                depth={6}
               
                ariaLabel="Sound settings"
               
                onClick={() => setSoundOpen(true)}
              >
                <SoundIcon muted={soundSilent} />
              </Key>
              {soundOpen && <SoundSettingsPopup onClose={() => setSoundOpen(false)} />}
            </div>

            {/* credit + bet */}
            {/* fixed width: − key + 165px readout + + key + gaps, so value changes never shift anything */}
            <div className="flex w-[300px] flex-none flex-col gap-2">
              <div className="flex items-center gap-[15px]">
                <Key
                  color="white"
                  width={50}
                  height={66}
                  depth={8}
                  ariaLabel="Decrease bet"
                  pressedColor="yellow"
                  onClick={onBetDecrease}
                  disabled={betDecreaseDisabled}
                  className="[transform:perspective(900px)_rotateX(1deg)]"
                >
                  <span className="font-['Chakra_Petch',sans-serif] text-[42px] font-medium leading-none text-[#2b2b2b]">−</span>
                </Key>
                <div className="flex h-[66px] w-[165px] flex-none flex-col justify-center gap-2 leading-none tabular-nums">
                  <div className="pb-2 grid grid-cols-[60px_110px] items-baseline whitespace-nowrap border-b border-b-[3px] border-b-black">
                    <span className="font-['Chakra_Petch',sans-serif] text-[20px] font-black italic text-white [text-shadow:0_2px_0_#000]">BET : </span>
                    <span className="overflow-hidden text-ellipsis font-['Chakra_Petch',sans-serif] text-[26px] font-black italic text-[#ffe100] [text-shadow:0_2px_0_#000]">{betLabel}</span>
                  </div>
                  <div className="grid grid-cols-[60px_110px] items-baseline whitespace-nowrap">
                    <span className="font-['Chakra_Petch',sans-serif] text-[20px] font-black italic text-white [text-shadow:0_2px_0_#000]">BAL : </span>
                    <span className="overflow-hidden text-ellipsis font-['Chakra_Petch',sans-serif] text-[26px] font-black italic text-[#ffe100] [text-shadow:0_2px_0_#000]">{shownCredit.toFixed(2)}</span>
                  </div>
                </div>
                <Key
                  color="white"
                  width={50}
                  height={66}
                  depth={8}
                  ariaLabel="Increase bet"
                  pressedColor="yellow"
                  onClick={onBetIncrease}
                  disabled={betIncreaseDisabled}
                  className="[transform:perspective(900px)_rotateX(1deg)]"
                >
                  <span className="font-['Chakra_Petch',sans-serif] text-[42px] font-medium leading-none text-[#2b2b2b]">+</span>
                </Key>
              </div>
            </div>

            {/* win display */}
            <div className={`relative mx-6 mr-8 box-border flex h-[70px] min-w-0 flex-1 basis-0 items-center tabular-nums justify-center gap-[22px] overflow-hidden whitespace-nowrap rounded-xl bg-[linear-gradient(180deg,#0F191A_100%,#0F191A_60%,#0F191A_100%)] px-[24px] font-['Chakra_Petch',sans-serif] text-[46px] italic leading-none shadow-[inset_0_1px_1px_rgba(0,0,0,.35),inset_0_1px_1px_rgba(255,120,60,.15),0_0_0_2px_#0b0604,0_1px_0_3px_rgba(255,255,255,.05)] [transform:perspective(500px)_rotateX(5deg)] text-[#ffe100] [text-shadow:0_2px_0_#3a2100]`}>
  <span className="relative z-[1] text-[24px]">WIN</span>
  <span key={winPop} className={`relative z-[1] inline-block ${win > 0 ? "animate-scb-win-hit" : "animate-scb-pop-slow"}`}>
    {win.toFixed(2)}
  </span>
</div>

            {/* max bet / turbo / auto / spin */}
            <div className="ml-auto flex flex-none items-center gap-[35px]">
              {onMaxBet && (
                <Key
                  color="white"
                  width={70}
                  height={65}
                  depth={9}
                  ariaLabel="Max bet"
                  onClick={onMaxBet}
                  disabled={maxBetDisabled}
                  className="[transform:perspective(500px)_rotateX(3  0deg)]"
                >
                  <span className="flex flex-col items-center font-['Chakra_Petch',sans-serif] text-[14px] font-medium leading-tight tracking-[1px] text-[#2b2b2b]">
                    <span>MAX</span>
                    <span>BET</span>
                  </span>
                </Key>
              )}
              {onToggleTurbo && (
                <Key color={turbo ? "yellow" : "white"} width={70} height={65} depth={8} ariaLabel="Turbo" onClick={onToggleTurbo} className="[transform:perspective(500px)_rotateX(20deg)]">
                  <BoltIcon />
                </Key>
              )}
              <Key
                color={auto ? "yellow" : "white"}
                width={70}
                height={65}
                depth={8}
                ariaLabel="Auto spin"
                onClick={onToggleAuto}
                disabled={autoDisabled}
                className="[transform:perspective(500px)_rotateX(20deg)]"
              >
                <span className="font-['Chakra_Petch',sans-serif] text-[22px] font-bold text-[#2b2b2b]">AUTO</span>
              </Key>
              <Key
                color={spinning ? "stop" : "spin"}
                width={220}
                height={75}
                depth={12}
                ariaLabel="Spin"
                onClick={onSpin}
                disabled={spinDisabled}
                className="[transform:perspective(1000px)_rotateX(12deg)_skewX(1deg)]"
              >
                <span className="inline-block font-['Chakra_Petch',sans-serif] italic text-[50px] font-bold">SPIN</span>
              </Key>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
