import React, { useEffect, useRef, useState } from "react";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "./SoundSettings";
import { useBalanceCountUp } from "./useCountUp";

/**
 * GameController — a faithful port of the dark-metallic "slot game controller" bar from the
 * E:\Office Games\game-controller reference project (info / bet stepper / WIN count-up with
 * big-win sparkle rain / FAST toggle / SPIN). Styled entirely with Tailwind utility classes
 * (arbitrary-value syntax for the many gradients/shadows with no named Tailwind equivalent),
 * same convention as `SlotControlBar.tsx` in this folder — no injected stylesheet. The custom
 * keyframe animation it uses (gc-win-pop) is registered
 * in tailwind.config.js's theme.extend.keyframes/animation, same place this app's other custom
 * animations live.
 *
 * Two deliberate deviations from the reference, both because this is a real game's control bar
 * rather than a standalone demo:
 *   - The reference bar has no credit/balance display at all (its own demo shows that separately,
 *     outside the bar). This port doesn't invent one either — whatever game uses this still needs
 *     its own place to show the player's balance.
 *   - The reference's LINES box + LINE PLAY/TOTAL PLAY bet panel assumes a lines-based paytable.
 *     Crazy777 (and most games here) just has a single flat bet, so the LINES box is dropped and
 *     the bet panel shows one BET value instead of a line/total split.
 *
 * Fully controlled, like SlotControlBar: every value and action comes in via props. The SPIN
 * button still recognizes the reference's tap / hold / tap-while-busy gestures itself (that's
 * pure UI gesture recognition, not game state), but reports them upward as `onSpin` / `onToggleAuto`
 * / `onQuickStop` rather than managing spinning/auto state internally — the host game owns that,
 * exactly like it owns the real spin duration, win amount, etc. `allowQuickStop` (default true)
 * lets a game disable the mid-spin quick-stop gesture entirely when its spin can't actually be
 * interrupted once started (Crazy777's server-resolved, fixed-duration reel landing can't be).
 *
 * Designed at 1912px wide and scales (via ResizeObserver + CSS transform) to fill whatever width
 * its parent gives it, matching the reference's own 1912px native design width.
 */

export interface GameControllerProps {
  betAmount: number;
  /** Player's balance, shown as BAL under BET. Omit to show BET only. */
  credit?: number;
  onBetDecrease: () => void;
  onBetIncrease: () => void;
  betDecreaseDisabled?: boolean;
  betIncreaseDisabled?: boolean;
  win: number;
  spinning: boolean;
  spinDisabled?: boolean;
  onSpin: () => void;
  auto: boolean;
  onToggleAuto: () => void;
  /** Called when the player taps SPIN while a spin is genuinely in flight (not auto-armed) —
   * only reachable when `allowQuickStop` is true. */
  onQuickStop?: () => void;
  /** Default true, matching the reference. Set false for a game whose spin can't be interrupted
   * once started — the button then just stays put (not stoppable) while `spinning` is true. */
  allowQuickStop?: boolean;
  /** Turbo state + toggle. Omit onToggleFast for a game without a turbo mode — the TURBO key is then
   * hidden and AUTO sits alone, centred between WIN and SPIN. */
  fast?: boolean;
  onToggleFast?: () => void;
  /** Win >= betAmount * this triggers the sparkle "big win" rain. Matches the reference's own
   * default. */
  bigWinMultiplier?: number;
  /** Called once the WIN display's animation for a new win (> 0) has fully finished — the
   * count-up, plus the sparkle rain on a big win — so a game can hold SPIN until then. */
  onWinAnimationEnd?: () => void;
  onInfo?: () => void;
  /** Max-bet action. A game without a turbo mode can pass this instead of onToggleFast — the TURBO
   * slot then shows a MAX BET key (same round design, "MAX BET" text). TURBO wins if both are given. */
  onMaxBet?: () => void;
  /** True when the bet is already at the top level — MAX BET then shows as active (bright) and can't
   * be pressed again; below max it shows as inactive (dim) and can be pressed. */
  maxBetDisabled?: boolean;
  /** Pass to show the Sound key — pressing it opens the shared sound settings popup (see
   * SoundSettings.tsx), and its icon follows those settings. `muted` and the callback itself are no
   * longer used; kept so existing callers still compile. */
  muted?: boolean;
  onToggleMute?: () => void;
  className?: string;
}

const DESIGN_W = 1912;
const DESIGN_H = 196;
const BAR_TOP = 34;

/** Animates a number up to `target` whenever `target` or `key` changes, starting from the value
 * currently shown (so 20 → 30 counts 20…30, not 0…30). A drop (e.g. reset to 0 for a new spin)
 * snaps straight down. Based on the reference's useCountUp hook. */
function useCountUp(target: number, durationMs: number, key: number): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const raf = useRef<number>();

  useEffect(() => {
    const set = (v: number) => {
      valueRef.current = v;
      setValue(v);
    };
    const from = valueRef.current;
    if (target <= from || durationMs <= 0) {
      set(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      set(t < 1 ? from + (target - from) * eased : target);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, key]);

  return value;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Square key in the info style — crimson rim, chrome-silver face, black glyph with a gold
 * outline. Used by the stacked Info and Sound (mute) buttons, 60 × 60 each. */
function SquareKey({ ariaLabel, ariaPressed, onClick, children }: { ariaLabel: string; ariaPressed?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
      className="group relative h-[60px] w-[60px] rounded-[12px] p-[3px] shadow-[0_4px_8px_rgba(0,0,0,.6)] transition active:scale-95 bg-[linear-gradient(180deg,#7a0a14,#1a0205)]"
    >
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[10px] shadow-[inset_0_-6px_10px_rgba(60,0,0,.45),inset_0_3px_4px_rgba(255,255,255,.35)] bg-[radial-gradient(ellipse_at_35%_18%,#ffffff_0%,#e6e8ee_30%,#b9bdc8_62%,#6e7380_100%)]">
        <span className="absolute left-[7px] top-[5px] h-[18px] w-[28px] rounded-full bg-white/25 blur-[2px]" />
        {children}
      </span>
    </button>
  );
}

function InfoButton({ onClick }: { onClick?: () => void }) {
  return (
    <SquareKey ariaLabel="Game info" onClick={onClick}>
      <svg viewBox="0 0 40 90" className="relative h-[40px] w-[18px] group-hover:brightness-110">
        <defs>
          <linearGradient id="gcInfoGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a4a4f" />
            <stop offset="1" stopColor="#0a0a0c" />
          </linearGradient>
        </defs>
        <ellipse cx="25" cy="13" rx="9" ry="9" fill="url(#gcInfoGrad)" stroke="#b8860b" strokeWidth="3.5" />
        <path
          d="M18 30 L33 30 L23 84 L8 84 Z"
          fill="url(#gcInfoGrad)"
          stroke="#b8860b"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M20 34 L27 34 L21 66" stroke="#ffffff" strokeWidth="2" fill="none" opacity=".6" strokeLinecap="round" />
        <circle cx="22" cy="10" r="2.5" fill="#ffffff" opacity=".8" />
      </svg>
    </SquareKey>
  );
}

/** Sound key (opens the sound settings popup) — same square key as Info: speaker with waves when
 * on, speaker with an ✕ when nothing can be heard. */
function SoundButton({ muted, onToggle }: { muted: boolean; onToggle?: () => void }) {
  return (
    <SquareKey ariaLabel="Sound settings" onClick={onToggle}>
      <svg viewBox="0 0 48 48" className="relative h-[34px] w-[34px] group-hover:brightness-110" aria-hidden>
        <defs>
          <linearGradient id="gcSoundGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a4a4f" />
            <stop offset="1" stopColor="#0a0a0c" />
          </linearGradient>
        </defs>
        <path
          d="M6 18 H15 L26 8 V40 L15 30 H6 Z"
          fill="url(#gcSoundGrad)"
          stroke="#b8860b"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {muted ? (
          <path d="M32 18 L44 30 M44 18 L32 30" stroke="#0a0a0c" strokeWidth="5" strokeLinecap="round" fill="none" />
        ) : (
          <>
            <path d="M31 17 Q36 24 31 31" stroke="#0a0a0c" strokeWidth="4" strokeLinecap="round" fill="none" />
            <path d="M36 11 Q45 24 36 37" stroke="#0a0a0c" strokeWidth="4" strokeLinecap="round" fill="none" />
          </>
        )}
      </svg>
    </SquareKey>
  );
}

/** Gold −/+ icon sized for the tall 110px key. */
const STEP_ICON_CLASS = "relative h-[52px] w-[52px] [filter:drop-shadow(0_3px_0_#5a2a00)]";

/** Bet −/+ — a straight (tall) key in the same design as TURBO / AUTO, with a gold − or + icon. Fires on press-down so
 * the bet changes the instant the key goes down; dims (and doesn't press) when unavailable. */
/** ring of − / + / TURBO / AUTO: gold normally, dark olive while a spin runs or autoplay is on */
const STEP_RING = "#ffd700";
const STEP_RING_SPINNING = "#524500";

function StepButton({
  kind,
  disabled,
  spinning = false,
  onClick,
}: {
  kind: "minus" | "plus";
  disabled?: boolean;
  /** spin running / autoplay on — ring turns dark, back to gold when it ends */
  spinning?: boolean;
  onClick?: () => void;
}) {
  const gradId = kind === "minus" ? "gcMinusGold" : "gcPlusGold";
  return (
    <RoundKey
      ariaLabel={kind === "minus" ? "Decrease bet" : "Increase bet"}
      shape="tall"
      iconOn={!disabled}
      disabled={disabled}
      onPress={onClick}
      ringColor={spinning ? STEP_RING_SPINNING : STEP_RING}
    >
      <svg viewBox="0 0 48 48" className={STEP_ICON_CLASS} aria-hidden>
        <GoldGradientDef id={gradId} />
        <path
          d={kind === "minus" ? "M8 20 H40 V28 H8 Z" : "M20 8 H28 V20 H40 V28 H28 V40 H20 V28 H8 V20 H20 Z"}
          fill={`url(#${gradId})`}
          stroke="#7a4a00"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </RoundKey>
  );
}

/** The LINE PLAY/TOTAL PLAY panel in the reference — shows Crazy777's single flat bet instead,
 * same chassis/styling, one row. */
/** One label/value row of the bet panel (BET, BAL) — gold label, amber LCD value. */
function PanelRow({ label, value, compact }: { label: string; value: string; compact: boolean }) {
  return (
    <div className="flex w-full flex-1 items-center justify-between pl-[26px] pr-[36px]">
      <span
        className={`font-['Oswald',Arial_Narrow,sans-serif] font-semibold leading-none tracking-tight text-[#ffd700] [text-shadow:0_1px_0_#3a1e08] ${
          compact ? "text-[22px]" : "text-[26px]"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-['Oswald',Arial_Narrow,sans-serif] font-semibold leading-none tabular-nums text-[#ffe37a] [text-shadow:0_2px_0_#000,0_0_8px_rgba(255,179,0,.45)] ${
          compact ? "text-[36px]" : "text-[44px]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** BET (and, when the game passes `credit`, the player's balance as BAL directly below it) —
 * both rows styled identically; slightly smaller text when there are two rows so they fit. */
function BetPanel({ betAmount, credit }: { betAmount: number; credit?: number }) {
  const twoRows = credit !== undefined;
  const shownCredit = useBalanceCountUp(credit ?? 0);
  return (
    <div className={`flex h-[132px] w-[274px] flex-col items-center justify-center rounded-[8px] border-[2px] border-[#d4a017] shadow-[0_0_0_2px_#0a0102,inset_0_0_14px_rgba(0,0,0,.65),0_0_6px_rgba(255,179,0,.3)] bg-[linear-gradient(180deg,#1f0406_0%,#0a0102_100%)] ${
      twoRows ? "py-[8px]" : ""
    }`}>
      <PanelRow label="BET:" value={betAmount.toFixed(2)} compact={twoRows} />
      {twoRows && <PanelRow label="BAL:" value={shownCredit.toFixed(2)} compact />}
    </div>
  );
}

/** The round key shared by TURBO, AUTO and the bet −/+: the same border as SPIN (2px dark-gold
 * outline around a dark bronze frame, 3px bright-gold inner ring), a brushed metallic-black core
 * (conic light streaks + darkened rim) with SPIN's gloss band, and a centred gold icon. No glow.
 * `iconOn` = full gold; otherwise the icon is dimmed (a toggle that's off, or an unavailable key).
 * Activation: `onClick` (on release, for toggles) or `onPress` (on press-down, for −/+).
 * Shape: "round" (TURBO / AUTO, 112×112) or "tall" (bet −/+, a 110×132 straight key) — same design. */
const KEY_SHAPE = {
  round: {
    button: "h-[112px] w-[112px] rounded-full",
    core: "rounded-full",
    gloss: "left-[14%] top-[5px] h-[42%] w-[72%] rounded-full",
  },
  tall: {
    button: "h-[132px] w-[110px] rounded-[12px]",
    core: "rounded-[9px]",
    gloss: "left-[10%] top-[4px] h-[34%] w-[80%] rounded-[8px]",
  },
} as const;

function RoundKey({
  ariaLabel,
  ariaPressed,
  shape = "round",
  iconOn,
  disabled,
  onClick,
  onPress,
  ringColor = "#ffd700",
  children,
}: {
  ariaLabel: string;
  ariaPressed?: boolean;
  shape?: keyof typeof KEY_SHAPE;
  iconOn: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPress?: () => void;
  /** colour of the key's inner ring border (default gold) */
  ringColor?: string;
  children: React.ReactNode;
}) {
  const sh = KEY_SHAPE[shape];
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={(e) => {
        if (onPress) {
          // keyboard only (Enter/Space report detail 0) — a pointer press already fired onPointerDown
          if (e.detail === 0) onPress();
        } else {
          onClick?.();
        }
      }}
      onPointerDown={
        onPress
          ? (e) => {
              if (e.button === 0 && !disabled) onPress();
            }
          : undefined
      }
      className={`relative ${sh.button} p-[4px] shadow-[0_0_0_2px_#b8860b,0_6px_12px_rgba(0,0,0,.6)] [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] transition enabled:active:scale-95 disabled:cursor-default bg-[linear-gradient(180deg,#7a1a00,#2a0800)]`}
    >
      <span
        style={{ "--ring": ringColor } as React.CSSProperties}
        className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden ${sh.core} shadow-[inset_0_0_0_3px_var(--ring),inset_0_-10px_16px_rgba(0,0,0,.55),inset_0_6px_6px_rgba(255,255,255,.35)] bg-[radial-gradient(circle_at_50%_50%,transparent_58%,rgba(0,0,0,.55)_100%),conic-gradient(from_20deg,#050506,#3a3b40_10%,#0b0b0c_22%,#2a2b2f_34%,#050506_46%,#3a3b40_58%,#0b0b0c_70%,#2a2b2f_82%,#050506)]`}>
        {/* SPIN's finish in round form: its glossy highlight band (same strength, sized for a circle)
            and inner depth shading (black instead of SPIN's brown, to keep the metal black). */}
        <span className={`pointer-events-none absolute ${sh.gloss} bg-gradient-to-b from-white/35 to-white/0`} />
        <span
          className={`relative flex items-center justify-center transition-[opacity,filter] duration-150 ${
            iconOn ? "opacity-100" : "opacity-50 saturate-50"
          }`}
        >
          {children}
        </span>
      </span>
    </button>
  );
}

/** TURBO / AUTO: a RoundKey that toggles — full-gold icon when on, dimmed when off. */
function RoundToggleButton({
  enabled,
  onToggle,
  ariaLabel,
  darkRing = false,
  children,
}: {
  enabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
  /** dark ring (spin running / autoplay on), gold otherwise */
  darkRing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <RoundKey
      ariaLabel={ariaLabel}
      ariaPressed={enabled}
      iconOn={enabled}
      onClick={onToggle}
      ringColor={darkRing ? STEP_RING_SPINNING : STEP_RING}
    >
      {children}
    </RoundKey>
  );
}

/** Gold icon for the round keys (TURBO, AUTO, −, +) with a small depth shadow (no glow). */
const TOGGLE_ICON_CLASS = "relative h-[58px] w-[58px] [filter:drop-shadow(0_3px_0_#5a2a00)]";

function GoldGradientDef({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff2a0" />
        <stop offset="0.5" stopColor="#ffd700" />
        <stop offset="1" stopColor="#e09b00" />
      </linearGradient>
    </defs>
  );
}

/** Turbo / fast-spin toggle — a gold lightning bolt (like Crazy777's own turbo art). */
function FastButton({ enabled, onToggle, darkRing }: { enabled: boolean; onToggle: () => void; darkRing?: boolean }) {
  return (
    <RoundToggleButton enabled={enabled} onToggle={onToggle} ariaLabel="Turbo spin" darkRing={darkRing}>
      <svg viewBox="0 0 48 48" className={TOGGLE_ICON_CLASS} aria-hidden>
        <GoldGradientDef id="gcTurboGold" />
        <path
          d="M28 3 L9 27 H22 L18 45 L39 19 H26 L31 3 Z"
          fill="url(#gcTurboGold)"
          stroke="#7a4a00"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </RoundToggleButton>
  );
}

/** Autoplay toggle — same chassis as FAST, with an icon (two circling arrows around a play
 * triangle) instead of a text label, in FAST's gold. */
/** MAX BET — the same round key as TURBO / AUTO, with gold "MAX BET" text in place of an icon.
 * Reads like TURBO / AUTO: dim = inactive (bet below max), bright gold = active (bet at max, i.e.
 * MAX BET has been pressed). Fires on press-down (like −/+) and jumps the bet to the top level;
 * can't be pressed while already at max or mid-spin. */
function MaxBetButton({ active, disabled, onPress }: { active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <RoundKey ariaLabel="Max bet" ariaPressed={active} iconOn={active} disabled={disabled} onPress={onPress}>
      <span className="flex flex-col items-center font-['Oswald',Arial_Narrow,sans-serif] text-[26px] font-bold leading-[0.95] tracking-[0.02em] [background-image:linear-gradient(180deg,#fff2a0_0%,#ffd700_50%,#e09b00_100%)] [-webkit-background-clip:text] [background-clip:text] text-transparent [filter:drop-shadow(0_3px_0_#5a2a00)]">
        <span>MAX</span>
        <span>BET</span>
      </span>
    </RoundKey>
  );
}

function AutoButton({ enabled, onToggle, darkRing }: { enabled: boolean; onToggle: () => void; darkRing?: boolean }) {
  return (
    <RoundToggleButton enabled={enabled} onToggle={onToggle} ariaLabel={enabled ? "Stop autoplay" : "Autoplay"} darkRing={darkRing}>
      <svg viewBox="0 0 48 48" className={TOGGLE_ICON_CLASS} aria-hidden>
        <GoldGradientDef id="gcAutoGold" />
        {/* upper arc + arrowhead (clockwise) */}
        <path d="M9 22 A15 15 0 0 1 36.5 13.5" fill="none" stroke="url(#gcAutoGold)" strokeWidth="5" strokeLinecap="round" />
        <path d="M30.5 8.5 L40.5 11.5 L35.5 20.5 Z" fill="url(#gcAutoGold)" />
        {/* lower arc + arrowhead */}
        <path d="M39 26 A15 15 0 0 1 11.5 34.5" fill="none" stroke="url(#gcAutoGold)" strokeWidth="5" strokeLinecap="round" />
        <path d="M17.5 39.5 L7.5 36.5 L12.5 27.5 Z" fill="url(#gcAutoGold)" />
        {/* play triangle */}
        <path d="M20 17.5 L31 24 L20 30.5 Z" fill="url(#gcAutoGold)" />
      </svg>
    </RoundToggleButton>
  );
}

/** Falling fiery orange/gold glitter rain shown behind the WIN amount on big wins — ported verbatim
 * (canvas drawing isn't expressible as Tailwind classes, it's genuine per-frame JS drawing). */
function Sparkles({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = (canvas.width = canvas.offsetWidth * 2);
    const H = (canvas.height = canvas.offsetHeight * 2);

    interface Streak {
      x: number;
      y: number;
      len: number;
      speed: number;
      hue: number;
      alpha: number;
      size: number;
    }
    const make = (): Streak => ({
      x: Math.random() * W,
      y: Math.random() * -H,
      len: 20 + Math.random() * 90,
      speed: 3 + Math.random() * 7,
      hue: 15 + Math.random() * 40,
      alpha: 0.4 + Math.random() * 0.6,
      size: 1 + Math.random() * 3,
    });
    const streaks: Streak[] = Array.from({ length: 340 }, () => {
      const s = make();
      s.y = Math.random() * H;
      return s;
    });

    let raf = 0;
    const draw = () => {
      ctx.fillStyle = "rgba(60,5,5,0.32)";
      ctx.fillRect(0, 0, W, H);
      for (const s of streaks) {
        const g = ctx.createLinearGradient(s.x, s.y - s.len, s.x, s.y);
        g.addColorStop(0, `hsla(${s.hue},100%,70%,0)`);
        g.addColorStop(1, `hsla(${s.hue},100%,75%,${s.alpha})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = s.size * 0.9;
        ctx.shadowColor = `hsla(${s.hue},100%,70%,1)`;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - s.len);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.fillStyle = `hsla(${s.hue},100%,${80 + Math.random() * 20}%,${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        s.y += s.speed;
        if (s.y - s.len > H) Object.assign(s, make(), { y: 0 });
      }
      raf = requestAnimationFrame(draw);
    };
    ctx.fillStyle = "#3a0505";
    ctx.fillRect(0, 0, W, H);
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500 ${active ? "opacity-100" : "opacity-0"}`}
    />
  );
}

function WinDisplay({ value, bigWin, popKey }: { value: number; bigWin: boolean; popKey: number }) {
  return (
    <div className="relative h-[162px] w-[508px] rounded-full p-[4px] shadow-[0_0_0_3px_#0a0102,0_0_14px_rgba(255,179,0,.5),0_6px_12px_rgba(0,0,0,.6)] bg-[linear-gradient(180deg,#ffe58a_0%,#c8901c_50%,#ffd700_100%)]">
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-full shadow-[inset_0_0_0_3px_#0a0102,inset_0_8px_18px_rgba(0,0,0,.6)] bg-[radial-gradient(ellipse_at_50%_35%,#4a0a10_0%,#24050a_55%,#100204_100%)]">
        <Sparkles active={bigWin} />
        <span className="pointer-events-none absolute left-[12%] top-[6px] h-[40px] w-[76%] rounded-full bg-gradient-to-b from-white/10 to-transparent" />
        <span
          key={popKey}
          className="relative animate-gc-win-pop font-['Oswald',Arial_Narrow,sans-serif] text-[66px] font-bold leading-[1] tracking-[0.08em] tabular-nums [background-image:linear-gradient(180deg,#fff6a8_0%,#ffd83a_38%,#f5a300_62%,#c86a00_100%)] [-webkit-background-clip:text] [background-clip:text] text-transparent [-webkit-text-stroke:1.5px_#5a2a00] [filter:drop-shadow(0_2px_0_#2a1400)_drop-shadow(0_0_6px_rgba(255,170,0,.35))]"
        >
          {value.toFixed(2)}
        </span>
        <span className="relative mt-[6px] font-['Oswald',Arial_Narrow,sans-serif] text-[38px] font-bold leading-none tracking-wide [background-image:linear-gradient(180deg,#fff6a8_0%,#ffd83a_38%,#f5a300_62%,#c86a00_100%)] [-webkit-background-clip:text] [background-clip:text] text-transparent [-webkit-text-stroke:1.5px_#5a2a00] [filter:drop-shadow(0_2px_0_#2a1400)_drop-shadow(0_0_6px_rgba(255,170,0,.35))]">
          WIN
        </span>
      </div>
    </div>
  );
}

/** SPIN's look: "ready" (idle) or "busy" (reels turning) — the same for manual and auto spins. */
type SpinVisual = "ready" | "busy";

function SpinButton({
  visual,
  holdMs = 650,
  onSpin,
  onHold,
  onStop,
}: {
  visual: SpinVisual;
  holdMs?: number;
  onSpin: () => void;
  onHold: () => void;
  onStop: () => void;
}) {
  const timer = useRef<number>();
  const held = useRef(false);

  const down = () => {
    held.current = false;
    if (visual !== "ready") return;
    timer.current = window.setTimeout(() => {
      held.current = true;
      onHold();
    }, holdMs);
  };
  const up = () => {
    window.clearTimeout(timer.current);
    if (held.current) return;
    if (visual === "ready") onSpin();
    else onStop();
  };
  const cancel = () => window.clearTimeout(timer.current);

  const busy = visual === "busy";

  /* Every spin start (ready → busy) plays the same press animation a finger/mouse press gives:
   * a brief 98% squeeze that springs back — so spins started by AUTO look exactly like a manual
   * SPIN press. A manual press is already squeezed via :active, so this adds nothing there. */
  const [autoPress, setAutoPress] = useState(false);
  const prevBusy = useRef(busy);
  useEffect(() => {
    const started = busy && !prevBusy.current;
    prevBusy.current = busy;
    if (!started) return;
    setAutoPress(true);
    const t = window.setTimeout(() => setAutoPress(false), 150);
    return () => window.clearTimeout(t);
  }, [busy]);

  return (
    <button
      type="button"
      aria-label="Spin"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative h-[126px] w-[400px] select-none rounded-full p-[4px] shadow-[0_0_0_2px_#b8860b,0_6px_12px_rgba(0,0,0,.6)] transition active:scale-[0.98] bg-[linear-gradient(180deg,#7a1a00,#2a0800)] ${
        autoPress ? "scale-[0.98]" : ""
      }`}
    >
      <span
        className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-full shadow-[inset_0_0_0_3px_#ffd700,inset_0_-10px_16px_rgba(120,40,0,.55),inset_0_6px_6px_rgba(255,255,255,.35)] transition-[filter] duration-300 bg-[linear-gradient(180deg,#ffe680_0%,#ffc61a_22%,#ff9f0a_55%,#f07a00_85%,#c45a00_100%)] ${
          busy ? "saturate-[.85] brightness-90" : ""
        }`}
      >
        <span className="pointer-events-none absolute left-[6%] top-[5px] h-[42%] w-[88%] rounded-full bg-gradient-to-b from-white/35 to-white/0" />

        <>
            <span
              className={`relative -mb-[2px] font-['Audiowide',Oswald,sans-serif] text-[70px] leading-[0.95] tracking-[0.04em] ${
                busy
                  ? "text-[#7a3000] [text-shadow:0_2px_0_rgba(255,230,160,.35),0_-1px_0_rgba(0,0,0,.4)]"
                  : "text-[#fff4c2] [text-shadow:0_4px_0_#8a3a00,0_0_3px_#8a3a00]"
              }`}
            >
              SPIN
            </span>
            {/* <span
              className={`relative font-['Oswald',Arial_Narrow,sans-serif] text-[28px] font-semibold leading-none tracking-[0.03em] ${
                busy ? "text-[#7a3000] [text-shadow:0_1px_0_rgba(255,230,160,.3)]" : "text-[#fff4c2] [text-shadow:0_2px_0_#8a3a00]"
              }`}
            >
              HOLD FOR AUTOSPIN
            </span> */}
        </>
      </span>
    </button>
  );
}

/** Crimson-to-black bar with a glowing gold top edge and the raised hump behind the WIN display —
 * ported verbatim (an SVG shape isn't expressible as Tailwind classes). */
function BarBackground() {
  const hump =
    `M0 ${BAR_TOP} L716 ${BAR_TOP} C736 ${BAR_TOP} 738 14 768 12 L1144 12 ` +
    `C1174 14 1176 ${BAR_TOP} 1196 ${BAR_TOP} L${DESIGN_W} ${BAR_TOP}`;
  return (
    <svg className="absolute inset-0" width={DESIGN_W} height={DESIGN_H} viewBox={`0 0 ${DESIGN_W} ${DESIGN_H}`} aria-hidden>
      <defs>
        <linearGradient id="gcBarFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a0a12" />
          <stop offset="0.18" stopColor="#3a060c" />
          <stop offset="0.55" stopColor="#1f0306" />
          <stop offset="1" stopColor="#0d0102" />
        </linearGradient>
        <linearGradient id="gcEdge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b8860b" />
          <stop offset="0.5" stopColor="#ffd700" />
          <stop offset="1" stopColor="#b8860b" />
        </linearGradient>
        <filter id="gcGlow" x="-5%" y="-200%" width="110%" height="500%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <path d={`${hump} L${DESIGN_W} ${DESIGN_H} L0 ${DESIGN_H} Z`} fill="url(#gcBarFill)" />
      <path d={hump} transform="translate(0 6)" stroke="#0a0102" strokeWidth="6" fill="none" opacity=".7" />
      <path d={hump} stroke="#ffb300" strokeWidth="6" fill="none" filter="url(#gcGlow)" opacity=".8" />
      <path d={hump} stroke="url(#gcEdge)" strokeWidth="3" fill="none" />
      <path d={hump} transform="translate(0 3)" stroke="#5a0a0a" strokeWidth="2" fill="none" />
      <rect x="0" y={DESIGN_H - 14} width={DESIGN_W} height="14" fill="#2a0505" opacity=".5" />
    </svg>
  );
}


/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function GameController({
  betAmount,
  credit,
  onBetDecrease,
  onBetIncrease,
  betDecreaseDisabled,
  betIncreaseDisabled,
  win,
  spinning,
  spinDisabled,
  onSpin,
  auto,
  onToggleAuto,
  onQuickStop,
  allowQuickStop = true,
  fast = false,
  onToggleFast,
  bigWinMultiplier = 10,
  onWinAnimationEnd,
  onInfo,
  onMaxBet,
  maxBetDisabled,
  onToggleMute,
  className = "",
}: GameControllerProps) {
  const soundSettings = useSoundSettings();
  const [soundOpen, setSoundOpen] = useState(false);

  /* ---------- responsive scaling ---------- */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / DESIGN_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- win count-up + big-win sparkle, derived from the real `win` prop ---------- */
  const [winKey, setWinKey] = useState(0);
  const [bigWin, setBigWin] = useState(false);
  const prevWin = useRef(win);
  useEffect(() => {
    if (win === prevWin.current) return;
    prevWin.current = win;
    setWinKey((k) => k + 1);
    setBigWin(win > 0 && win >= betAmount * bigWinMultiplier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  useEffect(() => {
    if (!bigWin) return;
    const t = window.setTimeout(() => setBigWin(false), 4000);
    return () => window.clearTimeout(t);
  }, [bigWin]);

  const countDuration = fast ? 450 : 1100;
  const shownWin = useCountUp(win, countDuration, winKey);

  // Report when a new win's animation (count-up, plus the 4s sparkle rain on a big win) is done.
  const onWinAnimationEndRef = useRef(onWinAnimationEnd);
  onWinAnimationEndRef.current = onWinAnimationEnd;
  useEffect(() => {
    if (winKey === 0 || win <= 0) return;
    const isBig = win >= betAmount * bigWinMultiplier;
    const t = window.setTimeout(() => onWinAnimationEndRef.current?.(), Math.max(countDuration, isBig ? 4000 : 0));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winKey]);

  // − / + / TURBO rings go dark while a spin runs or autoplay is on; AUTO's goes dark only for a
  // manual spin (on autoplay it stays gold — it's the button that stops it).
  const darkRing = spinning || auto;
  const autoDarkRing = spinning && !auto;

  // Autoplay uses SPIN's normal look; stop it with the AUTO button (or by tapping SPIN mid-spin).
  // A disabled SPIN (e.g. a win animation still playing) keeps the dimmed "busy" look too, so it
  // only lights up once a spin is actually allowed.
  const visual: SpinVisual = spinning || spinDisabled ? "busy" : "ready";

  return (
    <div ref={wrapRef} className={`relative w-full select-none ${className}`} style={{ height: DESIGN_H * scale }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})` }}>
        <BarBackground />
        {soundOpen && <SoundSettingsPopup onClose={() => setSoundOpen(false)} />}

        <div className="absolute flex flex-col gap-[12px]" style={{ left: 78, top: BAR_TOP + 14 }}>
          <InfoButton onClick={onInfo} />
          {onToggleMute && <SoundButton muted={isSilent(soundSettings)} onToggle={() => setSoundOpen(true)} />}
        </div>
        <div className="absolute" style={{ left: 194, top: BAR_TOP + 14 }}>
          <StepButton kind="minus" disabled={spinDisabled || betDecreaseDisabled} spinning={darkRing} onClick={onBetDecrease} />
        </div>
        <div className="absolute" style={{ left: 304, top: BAR_TOP + 14 }}>
          <BetPanel betAmount={betAmount} credit={credit} />
        </div>
        <div className="absolute" style={{ left: 578, top: BAR_TOP + 14 }}>
          <StepButton kind="plus" disabled={spinDisabled || betIncreaseDisabled} spinning={darkRing} onClick={onBetIncrease} />
        </div>
        <div className="absolute" style={{ left: 704, top: BAR_TOP - 10 }}>
          <WinDisplay value={shownWin} bigWin={bigWin} popKey={winKey} />
        </div>
        {/* The slot left of AUTO is dynamic per game: TURBO if the game has a turbo mode, otherwise
            MAX BET if it offers one, otherwise empty (AUTO then sits alone, centred). */}
        {onToggleFast ? (
          <div className="absolute" style={{ left: 1239, top: BAR_TOP + 24 }}>
            <FastButton enabled={fast} onToggle={onToggleFast} darkRing={darkRing} />
          </div>
        ) : onMaxBet ? (
          <div className="absolute" style={{ left: 1239, top: BAR_TOP + 24 }}>
            <MaxBetButton active={!!maxBetDisabled} disabled={spinDisabled || maxBetDisabled} onPress={onMaxBet} />
          </div>
        ) : null}
        <div className="absolute" style={{ left: onToggleFast || onMaxBet ? 1365 : 1302, top: BAR_TOP + 24 }}>
          <AutoButton enabled={auto} onToggle={onToggleAuto} darkRing={autoDarkRing} />
        </div>
        <div className="absolute" style={{ left: 1504, top: BAR_TOP + 14 }}>
          <SpinButton
            visual={visual}
            onSpin={onSpin}
            onHold={onToggleAuto}
            onStop={() => {
              if (auto) {
                onToggleAuto();
              } else if (spinning && allowQuickStop) {
                onQuickStop?.();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
