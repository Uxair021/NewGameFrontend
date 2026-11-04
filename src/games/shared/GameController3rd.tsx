import React, { useEffect, useId, useRef, useState } from "react";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "./SoundSettings";
import { COUNT_UP_MS, useCountUp } from "./useCountUp";

/* ------------------------------------------------------------------ */
/*  GameController3rd — React + Tailwind clone of the "Slot Controller */
/*  Bar" reference. Every number is the reference's, measured from its */
/*  video in 1878×212 bar units; the bar keeps that aspect ratio and   */
/*  scales with its container's width.                                */
/*                                                                     */
/*  Controlled: the game owns bets, spinning, autoplay and wins; this  */
/*  renders them and reports presses (− / + fire on touch, the rest on */
/*  release inside the key, SPIN held 1s = auto — as the reference).   */
/* ------------------------------------------------------------------ */

export interface GameController3rdProps {
  /** TOTAL PLAY (or TOTAL BET for flat-bet games) */
  betAmount: number;
  /** LINE PLAY; omit for flat-bet games (the readout then shows TOTAL BET and BALANCE) */
  linePlay?: number;
  /** BALANCE, shown under TOTAL BET when `linePlay` is omitted */
  credit?: number;
  onBetDecrease: () => void;
  onBetIncrease: () => void;
  /** at the lowest bet — − dims */
  betDecreaseDisabled?: boolean;
  /** at the highest bet — + dims */
  betIncreaseDisabled?: boolean;
  turbo?: boolean;
  /** omit to show TURBO dimmed */
  onToggleTurbo?: () => void;
  /** games without turbo: the TURBO slot becomes MAX BET (jump to the highest bet) */
  onMaxBet?: () => void;
  /** already at the highest bet — MAX BET dims */
  maxBetDisabled?: boolean;
  win: number;
  spinning: boolean;
  /** a spin can't start right now (loading, …) */
  spinDisabled?: boolean;
  onSpin: () => void;
  /** tap on SPIN while the reels spin (omit when the game has no quick stop) */
  onQuickStop?: () => void;
  auto: boolean;
  /** the AUTO key toggles it; holding SPIN also starts it and a tap on SPIN while on auto stops it */
  onToggleAuto: () => void;
  /** game has no autoplay: AUTO is hidden (MAX BET / TURBO centres in the shared slot), SPIN has no
   *  hold-for-auto and no "HOLD FOR AUTO" line, and reads STOP while the reels spin */
  noAuto?: boolean;
  autoDisabled?: boolean;
  /** hold time that turns SPIN into AUTO (reference: 1000ms) */
  holdMs?: number;
  onInfo?: () => void;
  /** Icon on the Help key: "help" (default) shows "?"; "menu" shows ☰ for games where that key
   * opens their pop-up GameMenu instead of the rules directly (like 777 Fruity's Menu key). */
  helpIcon?: "help" | "menu";
  /** Pass to show the Sound key — pressing it opens the shared sound settings popup (see
   * SoundSettings.tsx), and its icon follows those settings. `muted` and the callback itself are no
   * longer used; kept so existing callers still compile. Omit it to show the sound key dimmed. */
  muted?: boolean;
  onToggleMute?: () => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Artwork data (the reference's measurements)                        */
/* ------------------------------------------------------------------ */

const BAR_W = 1878;
const BAR_H = 212;

/** CONTROLLER HEIGHT — the visible band of the 212-unit artwork (top edge + height, in bar units).
 *  Only the empty space above/below the keys is trimmed, so keys, text and the WIN well keep their
 *  size; lower VIEW_H for a shorter bar (keys span about y 23–181). Full reference: 0 / 212. */
const VIEW_Y = 6;
const VIEW_H = 147;

/** the reference's rounded UI face (its earlier build named Fredoka); loaded below */
const FONT = "Fredoka, 'Arial Rounded MT Bold', system-ui, sans-serif";

/** WIN well outline: measured points on the left half, mirrored, smoothed with Catmull-Rom */
const WELL_LEFT: [number, number][] = [
  [470, 10], [502, 10], [528, 14], [556, 28], [574, 46], [583, 58], [590, 70], [596, 88], [601, 103],
  [607, 121], [613, 136], [619, 148], [629, 160], [638, 168], [653, 174], [673, 176], [700, 176], [760, 176],
];
const WELL_PTS: [number, number][] = [...WELL_LEFT, ...WELL_LEFT.map(([x, y]) => [1875 - x, y] as [number, number]).reverse()];
const GOLD_D = (() => {
  const p = WELL_PTS;
  let d = `M${p[0]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2}`;
  }
  return d;
})();
const WELL_D = `${GOLD_D} L${WELL_PTS[WELL_PTS.length - 1][0]},0 L${WELL_PTS[0][0]},0 Z`;

/** static sparkles: x, y, strength */
const STARS = [
  1245, 51, 40, 816, 57, 22, 1063, 59, 27, 1131, 59, 26, 1171, 62, 40, 739, 67, 16, 1262, 69, 31, 728, 73, 19, 709, 75, 19,
  1047, 78, 41, 1052, 81, 37, 1085, 86, 31, 1134, 91, 35, 797, 92, 32, 1014, 95, 47, 731, 97, 69, 807, 97, 14, 859, 100, 29,
  1161, 100, 52, 778, 105, 81, 1167, 108, 50, 660, 121, 35, 1191, 122, 87, 1217, 130, 19, 1202, 149, 31, 669, 153, 35,
  908, 162, 37, 970, 164, 18, 1147, 167, 13, 682, 33, 15, 1211, 35, 15, 823, 22, 14, 1110, 22, 12, 1142, 24, 13,
];

/** gradient stops "offset color [opacity], …" (the reference's compact format) */
const STOPS = {
  blueBtn: "0 #f0e4f0,.05 #fbf8ff,.13 #faf7ff,.17 #eef7fc,.28 #e0f1fb,.39 #dbf0ff,.43 #cfe9fa,.5 #bbe0f7,.56 #b2dcf9,.67 #a7d5f7,.79 #96cffb,.86 #91ccf6,.9 #a8e3ff,.93 #b7f0ff,.96 #93bdd8,1 #6f86a2",
  blueSide: "0 #6a90c0 .22,.06 #6a90c0 0,.94 #6a90c0 0,1 #6a90c0 .22",
  glyph: "0 #2a49c2,1 #1b3196",
  greenBtn: "0 #e8b8b0,.036 #f3e3e0,.062 #fef2d6,.089 #f9f79d,.116 #f3f77b,.143 #eefa61,.196 #e6f654,.25 #d8f24b,.3 #c9eb42,.357 #b6e338,.41 #a3db30,.464 #8ace22,.518 #70c21e,.571 #63bf1a,.652 #57b817,.73 #4db712,.81 #49b812,.866 #59c919,.893 #68d41a,.92 #66ce1c,.946 #399712,.973 #1f6a00,1 #245010",
  greenGlow: "0 #8cff2e .85,1 #8cff2e 0",
  spinText: "0 #ffffff,.6 #f6fdee,1 #ddf5c8",
  goldText: "0 #fff8de,.22 #fff0b0,.38 #ffec90,.6 #ffd56c,.82 #f8bf42,1 #f0a63a",
  winText: "0 #ffe2ff,.3 #ffcdf4,.6 #ffb6e1,.85 #fb96c6,1 #e57aa8",
  starGlow: "0 #ffd8ff .9,.35 #e9a2e2 .35,1 #c060c0 0",
  body: "0 #6a1f13,.0094 #a56a4a,.019 #703c1a,.033 #430d00,.038 #622927,.0425 #a56c6a,.047 #fcb8b6,.052 #e19d9b,.057 #db6760,.066 #c43134,.075 #ca1d30,.085 #c80837,.123 #a40036,.16 #9d0033,.274 #96002e,.5 #84052c,.613 #78062a,.726 #6f0829,.745 #640522,.764 #5a001c,.877 #4d001b,.99 #410117,1 #320416",
  well: "0 #6a1f13,.0094 #b67567,.025 #7a2a30,.042 #730d30,.057 #7a0558,.085 #7f0061,.123 #70025b,.16 #6d025d,.198 #6b0856,.236 #660b54,.274 #661455,.311 #5f134b,.325 #57103f,.34 #4c0032,.462 #49002d,.613 #4a002e,.651 #54002d,.689 #5e0030,.726 #65002f,.764 #710032,.802 #6a0026,.83 #650020,1 #650020",
  readoutBg: "0 #41001a .35,.12 #41001a .8,.3 #3f0019 1,.8 #3f0019 1,1 #450020 .55",
  betPanel: "0 #52001f,.18 #42001a,.75 #370015,1 #2c0010",
  goldLine: "0 #fcb8b6,.03 #ffcf6a,.5 #f5a630,.97 #ffcf6a,1 #fcb8b6",
  underWell: "0 #7a1420 .55,1 #4d001b 0",
} as const;
type GradId = keyof typeof STOPS;

const stopEls = (spec: string) =>
  spec.split(",").map((s, i) => {
    const [o, c, a] = s.trim().split(" ");
    return <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />;
  });

/* ------------------------------------------------------------------ */
/*  Text fitting — each text fills its measured box (the reference's   */
/*  canvas ink measurement: height → font size, width → x-stretch)     */
/* ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null = null;
function ink(s: string, weight: number): [number, number, number, number] {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return [0, s.length * 50, 70, 0];
  measureCtx.font = `${weight} 100px ${FONT}`;
  const m = measureCtx.measureText(s);
  return [m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent];
}

function FitText({
  box,
  anchor,
  weight,
  fill,
  sample,
  children,
  ...rest
}: {
  /** x, y, w, h — the ink box in the parent's units */
  box: [number, number, number, number];
  anchor: "l" | "c" | "r";
  weight: number;
  fill: string;
  /** size/stretch from this text (values), so changing digits keep one size */
  sample?: string;
  children: string;
} & Omit<React.SVGProps<SVGTextElement>, "children">) {
  const [x, y, w, h] = box;
  const [l, r, a, d] = ink(sample ?? children, weight);
  const k = h / Math.max(1, a + d);
  const sx = w / Math.max(1, (l + r) * k);
  const base = y + a * k;
  const [l2, r2] = ink(children, weight);
  const L = l2 * k * sx;
  const R = r2 * k * sx;
  const tx = anchor === "l" ? x + L : anchor === "r" ? x + w - R : x + w / 2 - (R - L) / 2;
  return (
    <text
      {...rest}
      fontFamily={FONT}
      fontWeight={weight}
      fontSize={(100 * k).toFixed(3)}
      fill={fill}
      transform={`translate(${tx.toFixed(2)} ${base.toFixed(2)}) scale(${sx.toFixed(4)} 1)`}
    >
      {children}
    </text>
  );
}

/* Press: a quick, shallow tap — the key snaps down the instant it is touched (written straight to
 * the element on pointerdown, no transition) and comes straight back. Each press lasts at least
 * minMs so even the fastest tap is drawn. */
const PRESS = {
  mouse: { scale: 0.97, minMs: 60 },
  touch: { scale: 0.97, minMs: 80 },
} as const;
type PressKind = keyof typeof PRESS;
const PRESS_OUT = "transform 100ms ease-out";

/* ------------------------------------------------------------------ */
/*  Keys — natural press shrink; 50% brightness when disabled          */
/* ------------------------------------------------------------------ */

function Key({
  label,
  x,
  y,
  w,
  h,
  r,
  green = false,
  dim = false,
  locked = false,
  holdMs,
  onDown,
  onUp,
  onHold,
  url,
  children,
}: {
  label: string;
  /** face box + corner radius in bar units (the key adds the reference's 8-unit shadow pad) */
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  green?: boolean;
  /** disabled look (50% brightness) — also ignores presses */
  dim?: boolean;
  /** ignores presses without the dimmed look (e.g. while the reels spin) */
  locked?: boolean;
  holdMs: number;
  /** fires on touch */
  onDown?: () => void;
  /** fires on release inside the key (not after a hold) */
  onUp?: () => void;
  /** fires after holding `holdMs` */
  onHold?: () => void;
  url: (id: GradId | "textShadow" | "soft" | "btnShadow") => string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  const held = useRef(false);
  const keyDown = useRef(false);
  const timer = useRef(0);
  const off = dim || locked;

  const pressedAt = useRef(0);
  const releaseTimer = useRef(0);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(releaseTimer.current);
    },
    [],
  );

  const pressKind = useRef<PressKind>("mouse");
  /** a touch runs the key's tap action the instant the finger lands; the release must not repeat it */
  const actedOnDown = useRef(false);

  /** snap down now: no transition, no React render — shows on the very next frame */
  const press = (kind: PressKind) => {
    window.clearTimeout(releaseTimer.current);
    pressKind.current = kind;
    pressedAt.current = performance.now();
    const el = ref.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = `scale(${PRESS[kind].scale})`;
    }
    onDown?.();
  };
  /** come back up — not before the minimum press time, so a fast tap is still seen */
  const unpress = () => {
    window.clearTimeout(releaseTimer.current);
    const lift = () => {
      const st = ref.current?.style;
      if (!st) return;
      st.transition = PRESS_OUT;
      st.transform = "";
    };
    const left = PRESS[pressKind.current].minMs - (performance.now() - pressedAt.current);
    if (left > 0) releaseTimer.current = window.setTimeout(lift, left);
    else lift();
  };
  const end = (ok: boolean) => {
    if (!down.current) return;
    down.current = false;
    window.clearTimeout(timer.current);
    unpress();
    if (ok && !held.current && !actedOnDown.current) onUp?.();
  };

  const W = w + 16;
  const H = h + 16;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-disabled={off || undefined}
      className={`absolute cursor-pointer outline-none [touch-action:none] [-webkit-tap-highlight-color:transparent] will-change-transform focus-visible:drop-shadow-[0_0_3px_#fff] ${dim ? "cursor-default brightness-50" : ""} ${locked ? "cursor-default" : ""}`}
      style={{
        left: `${((x - 8) / BAR_W) * 100}%`,
        top: `${((y - 8 - VIEW_Y) / VIEW_H) * 100}%`,
        width: `${(W / BAR_W) * 100}%`,
        height: `${(H / VIEW_H) * 100}%`,
      }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button > 0 || off) return;
        down.current = true;
        held.current = false;
        ref.current?.setPointerCapture?.(e.pointerId);
        const touch = e.pointerType !== "mouse";
        press(touch ? "touch" : "mouse");
        // phone / tablet: act the instant the finger lands (mouse keeps acting on release)
        actedOnDown.current = touch && !!onUp;
        if (actedOnDown.current) onUp?.();
        if (onHold)
          timer.current = window.setTimeout(() => {
            held.current = true;
            onHold();
          }, holdMs);
      }}
      onPointerUp={(e) => {
        const b = ref.current?.getBoundingClientRect();
        end(!!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom);
      }}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(false)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat && !off) {
          e.preventDefault();
          keyDown.current = true;
          actedOnDown.current = false;
          press("mouse");
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === "Enter" || e.key === " ") && keyDown.current) {
          keyDown.current = false;
          unpress();
          onUp?.();
        }
      }}
    >
      <svg viewBox={`-8 -8 ${W} ${H}`} className="pointer-events-none block h-full w-full overflow-visible" aria-hidden>
        <rect x={-2.5} y={-2} width={w + 5} height={h + (green ? 7 : 5)} rx={r + 3} fill="#4a0622" opacity=".55" />
        {green ? (
          <>
            <rect x={-1} y={4} width={w + 2} height={h + 2} rx={r + 1} fill="#2e2a06" opacity=".9" filter={url("btnShadow")} />
            <rect x={0} y={0} width={w} height={h} rx={r} fill={url("greenBtn")} />
            <ellipse cx={w / 2} cy={h - 9} rx={w * 0.31} ry={9} fill={url("greenGlow")} />
          </>
        ) : (
          <>
            <rect x={-1} y={3} width={w + 2} height={h + 1} rx={r + 1} fill="#3c0b2a" filter={url("btnShadow")} />
            <rect x={0} y={0} width={w} height={h} rx={r} fill={url("blueBtn")} />
            <rect x={0} y={0} width={w} height={h} rx={r} fill={url("blueSide")} />
          </>
        )}
        {children}
      </svg>
    </div>
  );
}

/** A FitText money readout that counts up (see useCountUp). Its own component so the per-frame
 * count re-renders only this one <text>, not the whole bar SVG (keys, filters, every FitText's
 * text measuring) — that full re-render 60×/s competed with the reels and win animation. */
function CountUpText({
  value,
  snapFirstLoad = false,
  ...fit
}: { value: number; snapFirstLoad?: boolean } & Omit<React.ComponentProps<typeof FitText>, "children">) {
  const shown = useCountUp(value, COUNT_UP_MS, snapFirstLoad);
  return <FitText {...fit}>{shown.toFixed(2)}</FitText>;
}

/** re-render once the bar font has loaded, so text is fitted with its real metrics */
function useFontReady() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    let alive = true;
    Promise.all([fonts.load("600 100px Fredoka"), fonts.load("700 100px Fredoka")])
      .catch(() => undefined)
      .then(() => alive && setTick((t) => t + 1));
    return () => {
      alive = false;
    };
  }, []);
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function GameController3rd({
  betAmount,
  linePlay,
  credit,
  onBetDecrease,
  onBetIncrease,
  betDecreaseDisabled,
  betIncreaseDisabled,
  turbo = false,
  onToggleTurbo,
  onMaxBet,
  maxBetDisabled,
  win,
  spinning,
  spinDisabled,
  onSpin,
  onQuickStop,
  auto,
  onToggleAuto,
  noAuto = false,
  autoDisabled,
  holdMs = 1000,
  onInfo,
  helpIcon = "help",
  onToggleMute,
  className = "",
}: GameController3rdProps) {
  const soundSettings = useSoundSettings();
  const [soundOpen, setSoundOpen] = useState(false);
  const soundSilent = isSilent(soundSettings);
  useFontReady();
  const p = useId().replace(/:/g, "");
  const gid = (n: string) => `gc3rd${p}${n}`;
  const url = (n: string) => `url(#${gid(n)})`;

  const V = { x1: "0", y1: "0", x2: "0", y2: "1" };
  const U = { x1: "0", y1: "0", x2: "0", y2: "212", gradientUnits: "userSpaceOnUse" as const };
  const H = { x1: "0", y1: "0", x2: "1", y2: "0" };
  const RAD = { cx: ".5", cy: ".5", r: ".5" };
  const G = url("glyph");
  const spinStroke = { stroke: "#2f7a0e", strokeLinejoin: "round" as const, paintOrder: "stroke fill" };

  // the reels are turning (or autoplay runs): bet keys are locked, not dimmed
  const busy = spinning || auto;

  /* SPIN: tap = spin; hold = autoplay; while on auto a tap stops it; while spinning a tap = quick stop */
  const spinTap = () => {
    if (auto) return onToggleAuto();
    if (spinning) return onQuickStop?.();
    onSpin();
  };
  const spinLocked = !auto && spinning && !onQuickStop;
  const spinDim = !auto && !spinning && !!spinDisabled;

  return (
    <div className={`w-full select-none bg-[#410117] pb-[env(safe-area-inset-bottom,0px)] ${className}`}>
      <div className="relative w-full" style={{ aspectRatio: `${BAR_W} / ${VIEW_H}` }}>
        {/* ---------- artwork ---------- */}
        <svg viewBox={`0 ${VIEW_Y} ${BAR_W} ${VIEW_H}`} preserveAspectRatio="none" className="absolute block h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gid("blueBtn")} {...V}>{stopEls(STOPS.blueBtn)}</linearGradient>
            <linearGradient id={gid("blueSide")} {...H}>{stopEls(STOPS.blueSide)}</linearGradient>
            <linearGradient id={gid("glyph")} {...V}>{stopEls(STOPS.glyph)}</linearGradient>
            <linearGradient id={gid("greenBtn")} {...V}>{stopEls(STOPS.greenBtn)}</linearGradient>
            <radialGradient id={gid("greenGlow")} {...RAD}>{stopEls(STOPS.greenGlow)}</radialGradient>
            <linearGradient id={gid("spinText")} {...V}>{stopEls(STOPS.spinText)}</linearGradient>
            <linearGradient id={gid("goldText")} {...V}>{stopEls(STOPS.goldText)}</linearGradient>
            <linearGradient id={gid("winText")} {...V}>{stopEls(STOPS.winText)}</linearGradient>
            <radialGradient id={gid("starGlow")} {...RAD}>{stopEls(STOPS.starGlow)}</radialGradient>
            <linearGradient id={gid("body")} {...U}>{stopEls(STOPS.body)}</linearGradient>
            <linearGradient id={gid("well")} {...U}>{stopEls(STOPS.well)}</linearGradient>
            <linearGradient id={gid("readoutBg")} {...V}>{stopEls(STOPS.readoutBg)}</linearGradient>
            <linearGradient id={gid("betPanel")} {...V}>{stopEls(STOPS.betPanel)}</linearGradient>
            <linearGradient id={gid("goldLine")} {...H}>{stopEls(STOPS.goldLine)}</linearGradient>
            <linearGradient id={gid("underWell")} {...V}>{stopEls(STOPS.underWell)}</linearGradient>
            <filter id={gid("textShadow")} x="-10%" y="-20%" width="120%" height="150%">
              <feDropShadow dx="0" dy="2" stdDeviation=".6" floodColor="#3c0420" floodOpacity=".9" />
            </filter>
            <filter id={gid("soft")} x="-10%" y="-20%" width="120%" height="140%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <filter id={gid("btnShadow")} x="-10%" y="-10%" width="120%" height="130%">
              <feGaussianBlur stdDeviation="1.2" />
            </filter>
          </defs>

          <rect x={0} y={0} width={BAR_W} height={BAR_H} fill={url("body")} />
          {/* WIN well — shortened to 80% of its height so it closes inside the shorter bar */}
          <g transform="scale(1 0.8)">
          <path d={WELL_D} fill={url("well")} />
          {Array.from({ length: STARS.length / 3 }, (_, i) => {
            const [x, y, k] = STARS.slice(i * 3, i * 3 + 3);
            const a = Math.min(1, 0.35 + k / 110);
            return (
              <React.Fragment key={i}>
                <circle cx={x} cy={y} r={(4 + k / 6).toFixed(1)} fill={url("starGlow")} opacity={a.toFixed(2)} />
                <circle cx={x} cy={y} r={(0.7 + k / 70).toFixed(1)} fill="#fff4ff" opacity={(a * 0.55).toFixed(2)} />
              </React.Fragment>
            );
          })}
          <rect x={660} y={177} width={560} height={14} fill={url("underWell")} />
          <path d={GOLD_D} fill="none" stroke="#ff9a2a" strokeOpacity=".35" strokeWidth={6} />
          <path d={GOLD_D} fill="none" stroke={url("goldLine")} strokeWidth={2.2} />
          </g>
          <rect x={0} y={0} width={2} height={212} fill="#2a1f1d" />
          <rect x={2} y={0} width={2.5} height={212} fill="#4a1c27" opacity=".8" />
          <rect x={1871} y={9} width={3} height={203} fill="#ff8aa0" opacity=".14" />
          <rect x={1874.5} y={0} width={3.5} height={212} fill="#220106" />

          {/* bet readout */}
          {/* BET / BAL readout — a plain box (no border) joined edge-to-edge between − and + */}
          <rect x={188} y={30} width={258} height={92} rx={6} fill={url("betPanel")} />
          {linePlay !== undefined ? (
            <>
              <FitText box={[204, 45, 107, 17]} anchor="l" weight={600} fill="#e488aa">LINE PLAY:</FitText>
              <FitText box={[203, 95, 128, 16]} anchor="l" weight={600} fill="#e488aa">TOTAL PLAY:</FitText>
              <FitText box={[370, 39, 62, 20]} anchor="r" weight={560} fill="#ffd2ea" sample="0.70">{linePlay.toFixed(2)}</FitText>
              <FitText box={[357, 89, 75, 20]} anchor="r" weight={580} fill="#ffd2ea" sample="14.00">{betAmount.toFixed(2)}</FitText>
            </>
          ) : (
            <>
              {/* flat bet: TOTAL BET and BALANCE, same rows, sizes and colours */}
              <FitText box={[204, 45, 50, 17]} anchor="l" weight={500} fill="#e488aa">BET :</FitText>
              <FitText box={[357, 39, 75, 20]} anchor="r" weight={580} fill="#ffd2ea" sample="14.00">{betAmount.toFixed(2)}</FitText>
              {credit !== undefined && (
                <>
                  <FitText box={[203, 95, 48, 16]} anchor="l" weight={500} fill="#e488aa">BAL :</FitText>
                  <CountUpText value={credit} snapFirstLoad box={[357, 89, 75, 20]} anchor="r" weight={580} fill="#ffd2ea" sample="14.00" />
                </>
              )}
            </>
          )}

          {/* WIN */}
          <CountUpText value={win} box={[880, 26, 121, 38]} anchor="c" weight={700} fill={url("goldText")} sample="0.00" filter={url("textShadow")} />
          <FitText box={[884, 76, 109, 40]} anchor="c" weight={700} fill={url("winText")} filter={url("textShadow")}>
            WIN
          </FitText>
        </svg>

        {/* ---------- keys ---------- */}
        {/* ? and sound — stacked in the reference's ? slot, smaller keys, same UI */}
        <Key label={helpIcon === "menu" ? "Menu" : "Help"} x={20} y={20} w={64} h={56} r={14} url={url} holdMs={holdMs} dim={!onInfo} onUp={onInfo}>
          {helpIcon === "menu" ? (
            <>
              <rect x={18} y={15.5} width={28} height={5} rx={2.5} fill={G} />
              <rect x={18} y={25.5} width={28} height={5} rx={2.5} fill={G} />
              <rect x={18} y={35.5} width={28} height={5} rx={2.5} fill={G} />
            </>
          ) : (
            <FitText box={[23, 13, 18, 30]} anchor="c" weight={700} fill={G}>?</FitText>
          )}
        </Key>
        <Key
          label="Sound settings"
          x={20}
          y={85}
          w={64}
          h={56}
          r={14}
          url={url}
          holdMs={holdMs}
          dim={!onToggleMute}
          onUp={onToggleMute ? () => setSoundOpen(true) : undefined}
        >
          {/* speaker (drawn for a 76-wide face, scaled to this one) */}
          <g transform="scale(.842)">
            <path d="M20,26 H28 L40,16 V50 L28,40 H20 Z" fill={G} stroke={G} strokeWidth={2.5} strokeLinejoin="round" />
            {soundSilent ? (
              <path d="M46,26 L58,40 M58,26 L46,40" fill="none" stroke={G} strokeWidth={5} strokeLinecap="round" />
            ) : (
              <path d="M46,26 Q51,33 46,40 M52,20 Q61,33 52,46" fill="none" stroke={G} strokeWidth={4.5} strokeLinecap="round" />
            )}
          </g>
        </Key>

        {soundOpen && <SoundSettingsPopup onClose={() => setSoundOpen(false)} />}

        {/* − / + change the bet on touch (as the reference) */}
        <Key
          label="Decrease bet"
          x={118}
          y={20}
          w={75}
          h={112}
          r={23}
          url={url}
          holdMs={holdMs}
          dim={!!betDecreaseDisabled}
          locked={busy}
          onDown={onBetDecrease}
        >
          <rect x={17} y={51.25} width={40} height={9.5} rx={4.75} fill={G} />
        </Key>
        <Key
          label="Increase bet"
          x={442}
          y={20}
          w={75}
          h={112}
          r={23}
          url={url}
          holdMs={holdMs}
          dim={!!betIncreaseDisabled}
          locked={busy}
          onDown={onBetIncrease}
        >
          <rect x={17} y={51.25} width={40} height={9.5} rx={4.75} fill={G} />
          <rect x={32.25} y={36} width={9.5} height={40} rx={4.75} fill={G} />
        </Key>

        {/* TURBO + AUTO — share the reference's MAX BET slot, same key UI; on = the green SPIN skin */}
        {/* this slot is dynamic per game: TURBO if the game has a turbo mode, otherwise MAX BET if it
            offers one (same key, same place), otherwise a dimmed TURBO */}
        {!onToggleTurbo && onMaxBet ? (
          <Key
            label="Max bet"
            x={noAuto ? 1385 : 1330}
            y={25}
            w={90}
            h={106}
            r={23}
            url={url}
            holdMs={holdMs}
            dim={!!maxBetDisabled}
            locked={busy}
            onUp={onMaxBet}
          >
            <FitText box={[14, 30, 62, 22]} anchor="c" weight={700} fill={G}>MAX</FitText>
            <FitText box={[21, 58, 48, 22]} anchor="c" weight={700} fill={G}>BET</FitText>
          </Key>
        ) : (
          <Key
            label="Turbo"
            x={noAuto ? 1385 : 1330}
            y={25}
            w={90}
            h={106}
            r={23}
            green={turbo}
            url={url}
            holdMs={holdMs}
            dim={!onToggleTurbo}
            onUp={onToggleTurbo}
          >
            <FitText box={[14, 41, 68, 24]} anchor="c" weight={700} fill={turbo ? url("spinText") : G} {...(turbo ? { strokeWidth: 2.6, ...spinStroke } : {})}>
              TURBO
            </FitText>
          </Key>
        )}
        {!noAuto && (
        <Key
          label={auto ? "Stop autoplay" : "Autoplay"}
          x={1440}
          y={25}
          w={90}
          h={106}
          r={23}
          green={auto}
          url={url}
          holdMs={holdMs}
          dim={!!autoDisabled && !auto}
          onUp={onToggleAuto}
        >
          <FitText box={[16, 41, 56, 24]} anchor="c" weight={700} fill={auto ? url("spinText") : G} {...(auto ? { strokeWidth: 2.6, ...spinStroke } : {})}>
            AUTO
          </FitText>
        </Key>
        )}

        {/* SPIN — tap spins, hold starts autoplay; on auto it reads STOP / AUTO PLAY and a tap stops it */}
        <Key
          label={auto ? "Stop autoplay" : noAuto ? (spinning ? "Stop" : "Spin") : "Spin, hold for auto"}
          x={1546}
          y={18}
          w={305}
          h={120}
          r={23}
          green
          url={url}
          holdMs={holdMs}
          dim={spinDim}
          locked={spinLocked}
          onUp={spinTap}
          onHold={noAuto || auto || spinning ? undefined : onToggleAuto}
        >
          {/* no autoplay: one centred line, SPIN → STOP while the reels spin (same lettering) */}
          <FitText
            box={noAuto ? [88, 40, 127, 41] : [88, 22, 127, 41]}
            anchor="c"
            weight={700}
            fill={url("spinText")}
            sample="SPIN"
            strokeWidth={3.4}
            {...spinStroke}
          >
            {auto || (noAuto && spinning) ? "STOP" : "SPIN"}
          </FitText>
          {!noAuto && (
            <FitText box={[29, 75, 243, 20]} anchor="c" weight={600} fill={url("spinText")} sample="HOLD FOR AUTO" strokeWidth={2.6} {...spinStroke}>
              {auto ? "AUTO PLAY" : "HOLD FOR AUTO"}
            </FitText>
          )}
        </Key>
      </div>
    </div>
  );
}
