import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "./SoundSettings";
import { useBalanceCountUp } from "./useCountUp";

/**
 * GameController2 — a React port of the standalone "Slot Controller" HTML reference (gold-railed
 * blue bar, steel-framed keys, purple LINE PLAY / TOTAL PLAY panel, curved WIN / BALANCE frame,
 * rocket TURBO, green SPIN / STOP with hold-for-autospin). Everything is drawn with CSS/SVG — no
 * image assets and no web fonts: all lettering is the reference's built-in vector face (VText,
 * below), so it looks identical offline and on every device.
 *
 * Unlike the reference (a class that owned its own balance/bet/spin flow), this is a fully
 * controlled component, same contract style as GameController / SlotControlBar: the host game
 * owns the real balance, bet levels, spin and autoplay, and wires them in through props. The SPIN
 * key still recognises the reference's gestures itself (tap = spin, hold = start autospin, tap
 * while auto = stop auto, tap while spinning = quick stop) and reports them upward.
 *
 * Dynamic slots so it fits any game:
 *   - LINES key when the game passes `lines` + `onCycleLines`; otherwise that slot shows stacked
 *     Info and Sound keys in the same style.
 *   - Bet panel: LINE PLAY / TOTAL PLAY when `linePlay` is given; otherwise TOTAL BET.
 *   - TURBO (rocket) when `onToggleTurbo` is given; otherwise that slot shows an AUTO key.
 *
 * Colours use a sharper, more saturated take on the reference palette. Its three keyframes
 * (gc2-pulse, gc2-winpop, gc2-flame) live in tailwind.config.js. The idle pulse is an
 * opacity-animated overlay rather than the reference's animated `filter` — same look, but
 * composited on the GPU instead of repainting every frame.
 *
 * Designed on a 1440 × 156 stage and scaled (ResizeObserver + CSS transform) to its container width.
 */

export interface GameController2Props {
  /** Player balance — shown as BALANCE. */
  credit: number;
  /** Total bet — shown as TOTAL PLAY (with lines) or TOTAL BET (flat-bet games). */
  betAmount: number;
  onBetDecrease: () => void;
  onBetIncrease: () => void;
  betDecreaseDisabled?: boolean;
  betIncreaseDisabled?: boolean;
  /** Per-line bet. When given, the panel shows LINE PLAY / TOTAL PLAY; otherwise TOTAL BET. */
  linePlay?: number;
  /** Line count + cycle action. When both are given the LINES key shows; otherwise Info + Sound. */
  lines?: number;
  onCycleLines?: () => void;
  win: number;
  /** True while WIN is a held total that isn't in the balance yet (a free-spin round). No longer
   * needed — BALANCE now only counts up when `credit` itself rises — kept so callers still compile. */
  holdBalance?: boolean;
  spinning: boolean;
  /** Blocks *starting* a spin (not loaded yet, mid bonus round, …). STOP still works. */
  spinDisabled?: boolean;
  onSpin: () => void;
  /** Replaces the idle SPIN lettering (and hides HOLD FOR AUTOSPIN), e.g. "START" while a
   * free-spin banner waits for the player. Letters: S P I N T O A R. */
  spinLabel?: string;
  auto: boolean;
  onToggleAuto: () => void;
  autoDisabled?: boolean;
  /** Tap on SPIN while a spin is in flight (not auto). Only used when allowQuickStop is true. */
  onQuickStop?: () => void;
  allowQuickStop?: boolean;
  /** Turbo state + toggle. Omit onToggleTurbo to show an AUTO key in the TURBO slot instead. */
  turbo?: boolean;
  onToggleTurbo?: () => void;
  /** How long SPIN must be held to start autospin (ms). */
  holdMs?: number;
  onInfo?: () => void;
  /** Pass to show the Sound key — pressing it opens the shared sound settings popup (see
   * SoundSettings.tsx), and its icon follows those settings. `muted` and the callback itself are no
   * longer used; kept so existing callers still compile. */
  muted?: boolean;
  onToggleMute?: () => void;
  /** Space bar = tap SPIN, like the reference. */
  spaceToSpin?: boolean;
  className?: string;
}

const STAGE_W = 1440;
const STAGE_H = 136; // bar height in design px (was 156) — the component height is STAGE_H × scale

/* ===================================================================== */
/*  VText — the reference's built-in vector lettering (no font files)     */
/*  Two faces: 'c' tall condensed (labels, numbers), 'w' wide heavy       */
/*  slanted (SPIN / STOP). Each text is layered SVG strokes: glow → 3D    */
/*  drop edge → outline → gradient fill → top shine.                      */
/* ===================================================================== */

/* Shared letter skeletons: (w = width between stem centres, r = corner radius). */
const R = 22;
const rb = (x0: number, y0: number, x1: number, y1: number, k: number) => {
  k = Math.min(k, (x1 - x0) / 2, (y1 - y0) / 2);
  return `M${x0},${y0 + k} Q${x0},${y0} ${x0 + k},${y0} L${x1 - k},${y0} Q${x1},${y0} ${x1},${y0 + k} L${x1},${y1 - k} Q${x1},${y1} ${x1 - k},${y1} L${x0 + k},${y1} Q${x0},${y1} ${x0},${y1 - k} Z`;
};
const box = (w: number, k: number) => rb(0, 0, w, 100, k);
const SH: Record<string, (w: number, r: number) => string> = {
  "0": (w, r) => box(w, r),
  O: (w, r) => box(w, r),
  "1": (w) => `M0,16 L${w},2 L${w},100`,
  "2": (w, r) => `M0,${Math.min(r, 30)} Q0,0 ${w / 2},0 Q${w},0 ${w},${Math.min(r, 30)} L${w},34 Q${w},46 ${w - 7},55 L0,93 L0,100 L${w},100`,
  "3": (w, r) =>
    `M0,${Math.min(r, 24)} Q0,0 ${w / 2},0 Q${w},0 ${w},${Math.min(r, 22)} L${w},34 Q${w},47 ${w * 0.55},47 Q${w},47 ${w},60 L${w},${100 - Math.min(r, 24)} Q${w},100 ${w / 2},100 Q0,100 0,${100 - Math.min(r, 24)} M${w * 0.3},47 L${w * 0.55},47`,
  "4": (w) => `M${w * 0.72},0 L0,68 L${w},68 M${w * 0.72},34 L${w * 0.72},100`,
  "5": (w, r) =>
    `M${w},0 L2,0 L0,46 Q${w * 0.2},42 ${w / 2},42 Q${w},42 ${w},${42 + Math.min(r, 24)} L${w},${100 - Math.min(r, 24)} Q${w},100 ${w / 2},100 Q0,100 0,${100 - Math.min(r, 24)}`,
  "6": (w, r) =>
    `M${w},${Math.min(r, 20) * 0.9} Q${w},0 ${w / 2},0 Q0,0 0,${r} L0,${100 - r} Q0,100 ${w / 2},100 Q${w},100 ${w},${100 - r} L${w},${44 + r} Q${w},44 ${w / 2},44 Q0,44 0,${44 + r}`,
  "7": (w) => `M0,0 L${w},0 L${w},8 L${w * 0.32},100`,
  "8": (w, r) => rb(2, 0, w - 2, 47, r) + " " + rb(0, 47, w, 100, r),
  "9": (w, r) =>
    `M0,${100 - Math.min(r, 20) * 0.9} Q0,100 ${w / 2},100 Q${w},100 ${w},${100 - r} L${w},${r} Q${w},0 ${w / 2},0 Q0,0 0,${r} L0,${56 - r} Q0,56 ${w / 2},56 Q${w},56 ${w},${56 - r}`,
  ".": () => `M0,99 L0,100`,
  ":": () => `M0,44 L0,45 M0,99 L0,100`,
  // '?' is an addition in the same style, for the Info key (the reference has no '?').
  "?": (w) => `M0,22 Q0,0 ${w / 2},0 Q${w},0 ${w},22 Q${w},42 ${w / 2},50 L${w / 2},70 M${w / 2},99 L${w / 2},100`,
  A: (w) => `M0,100 L${w * 0.3},0 L${w * 0.7},0 L${w},100 M${w * 0.13},64 L${w * 0.87},64`,
  B: (w, r) =>
    `M0,0 L0,100 L${w - r},100 Q${w},100 ${w},${100 - r} L${w},${48 + r} Q${w},48 ${w - r},48 L0,48 M0,0 L${w - 3 - r},0 Q${w - 3},0 ${w - 3},${r} L${w - 3},${48 - r} Q${w - 3},48 ${w - 3 - r},48`,
  C: (w, r) => `M${w},28 L${w},${r} Q${w},0 ${w - r},0 L${r},0 Q0,0 0,${r} L0,${100 - r} Q0,100 ${r},100 L${w - r},100 Q${w},100 ${w},${100 - r} L${w},72`,
  D: (w, r) => `M0,0 L0,100 L${w - r},100 Q${w},100 ${w},${100 - r} L${w},${r} Q${w},0 ${w - r},0 Z`,
  E: (w) => `M${w},0 L0,0 L0,100 L${w},100 M0,48 L${w * 0.85},48`,
  F: (w) => `M${w},0 L0,0 L0,100 M0,48 L${w * 0.85},48`,
  H: (w) => `M0,0 L0,100 M${w},0 L${w},100 M0,48 L${w},48`,
  I: () => `M0,0 L0,100`,
  L: (w) => `M0,0 L0,100 L${w},100`,
  N: (w) => `M0,100 L0,0 L${w},100 L${w},0`,
  P: (w, r) => `M0,100 L0,0 L${w - r},0 Q${w},0 ${w},${r} L${w},${52 - r} Q${w},52 ${w - r},52 L0,52`,
  R: (w, r) => `M0,100 L0,0 L${w - r},0 Q${w},0 ${w},${r} L${w},${50 - r} Q${w},50 ${w - r},50 L0,50 M${w * 0.55},50 L${w},100`,
  S: (w, r) =>
    `M${w},24 L${w},${r} Q${w},0 ${w - r},0 L${r},0 Q0,0 0,${r} L0,${48 - r} Q0,48 ${r},48 L${w - r},48 Q${w},48 ${w},${48 + r} L${w},${100 - r} Q${w},100 ${w - r},100 L${r},100 Q0,100 0,${100 - r} L0,76`,
  T: (w) => `M0,0 L${w},0 M${w / 2},0 L${w / 2},100`,
  U: (w, r) => `M0,0 L0,${100 - r} Q0,100 ${r},100 L${w - r},100 Q${w},100 ${w},${100 - r} L${w},0`,
  W: (w) => `M0,0 L${w * 0.14},100 L${w / 2},30 L${w * 0.86},100 L${w},0`,
  Y: (w) => `M0,0 L${w / 2},54 L${w},0 M${w / 2},54 L${w / 2},100`,
};
type Glyph = { w: number; d: string };
type Face = { g: Record<string, Glyph>; space: number };
/** Build a face: widths per glyph + its corner-radius rule. */
const mk = (widths: Record<string, number>, rad: (ch: string, w: number) => number, space: number): Face => {
  const g: Record<string, Glyph> = {};
  for (const ch in widths) {
    const w = widths[ch];
    g[ch] = { w, d: SH[ch](w, rad(ch, w)) };
  }
  return { g, space };
};
/** 'h' heavy block (WIN, BALANCE). */
const FACE_H = mk({ A: 31, B: 26, C: 26, D: 26, E: 19, I: 0, L: 19, N: 29, O: 26, W: 46, S: 26, P: 26 }, (ch, w) => ("CO".includes(ch) ? w / 2 : "S".includes(ch) ? 9 : 5), 26);
/** 'c' narrow square (LINE PLAY, TOTAL PLAY, LINES, HOLD FOR AUTOSPIN, TOTAL BET, AUTO, ?). */
const FACE_C = mk(
  { A: 30, B: 26, C: 25, D: 26, E: 22, F: 22, H: 27, I: 0, L: 21, N: 28, O: 26, P: 26, R: 27, S: 26, T: 28, U: 26, W: 44, Y: 30, ":": 0, ".": 0, "?": 26 },
  (ch) => ("OCDUS".includes(ch) ? 7 : 4),
  28
);
/** 'r' tall rounded numbers (money, bet values, the LINES count). */
const FACE_R = mk({ "0": 25, "1": 15, "2": 25, "3": 25, "4": 27, "5": 25, "6": 25, "7": 24, "8": 25, "9": 25, ".": 0, ":": 0 }, (_ch, w) => w / 2, 26);
/** 'w' wide heavy face (SPIN / STOP). */
const GLYPHS_W: Record<string, [number, (w: number) => string]> = {
  S: [104, (w) => `M${w},0 L${R},0 Q0,0 0,${R} L0,${50 - R} Q0,50 ${R},50 L${w - R},50 Q${w},50 ${w},${50 + R} L${w},${100 - R} Q${w},100 ${w - R},100 L0,100`],
  P: [100, (w) => `M0,100 L0,0 L${w - R},0 Q${w},0 ${w},${R} L${w},${58 - R} Q${w},58 ${w - R},58 L0,58`],
  I: [0, () => `M0,0 L0,100`],
  N: [94, (w) => `M0,100 L0,0 L${w - R},0 Q${w},0 ${w},${R} L${w},100`],
  T: [66, (w) => `M0,0 L0,${100 - R} Q0,100 ${R},100 L${w},100 M0,34 L${w},34`],
  O: [106, (w) => box(w, R)],
  // A / R: additions in the same style, for START (the reference has neither).
  A: [100, (w) => `M0,100 L0,${R} Q0,0 ${R},0 L${w - R},0 Q${w},0 ${w},${R} L${w},100 M0,56 L${w},56`],
  R: [100, (w) => `M0,100 L0,0 L${w - R},0 Q${w},0 ${w},${R} L${w},${54 - R} Q${w},54 ${w - R},54 L0,54 M${w * 0.5},54 L${w},100`],
};
const FACE_W: Face = {
  g: Object.fromEntries(Object.entries(GLYPHS_W).map(([k, [w, fn]]) => [k, { w, d: fn(w) }])),
  space: 44,
};
const FACES: Record<"c" | "h" | "r" | "w", Face> = { c: FACE_C, h: FACE_H, r: FACE_R, w: FACE_W };

interface VStyle {
  face?: "c" | "h" | "r" | "w";
  /** cap height in px */
  cap: number;
  /** stroke thickness (glyph units, 100 = cap) */
  s: number;
  /** letter spacing / spacing around a dot */
  ls?: number;
  dotLs?: number;
  /** horizontal stretch, slant (deg) */
  wx?: number;
  skew?: number;
  /** gradient fill stops, top → bottom */
  fill: string[];
  /** outline width + colour */
  o?: number;
  oc?: string;
  /** 3D drop edge depth + colour */
  depth?: number;
  dc?: string;
  /** soft glow behind the letters */
  glow?: { c: string; w: number; b?: number; a?: number };
  /** white shine on the upper half of each stroke */
  shine?: number;
}

/** Text styles matched to the reference. */
const VSTYLES = {
  linesLbl: { face: "c", cap: 18, s: 16, ls: 6, wx: 1.4, fill: ["#e6e4ec", "#d4d7db", "#c6d0d0", "#bbcad2", "#b0cad3", "#d4fbff", "#8ea8bc"], o: 2.5, oc: "#3a3d68" },
  linesVal: { face: "r", cap: 26, s: 17, ls: 4, wx: 1.25, fill: ["#f8ecee", "#fffcc8", "#fffcc7", "#fffcc7", "#fffad6", "#f9eded"] },
  playLbl: {
    face: "c",
    cap: 18,
    s: 16,
    ls: 8,
    wx: 1.32,
    fill: ["#d8faff", "#c0eefa", "#b3edff", "#98cff4", "#8bb7f8", "#6b81db", "#6c65d0", "#776bcd", "#887bd6", "#6054a6"],
    depth: 1,
    dc: "#0e0630",
  },
  playVal: { face: "r", cap: 27, s: 14, ls: 8, dotLs: 7, wx: 1.38, fill: ["#ffffcc", "#f9ffb6", "#fbffbb", "#fcfed0", "#fdffd5", "#fbffd8", "#f8ffd8", "#f6fee0"] },
  bigLbl: {
    face: "h",
    cap: 28,
    s: 21,
    ls: 4,
    wx: 1.42,
    fill: ["#ffffff", "#e6fcff", "#c4f8ff", "#9dfdff", "#86fcff", "#72f0ff", "#5ac6f8", "#64a2f8", "#6b86fa", "#6767f5", "#7a67f8", "#9272fb", "#7a5ae0"],
    o: 1.2,
    oc: "#08002a",
  },
  money: {
    face: "r",
    cap: 38,
    s: 15,
    ls: 30,
    dotLs: 10,
    wx: 1.3,
    fill: ["#fffce0", "#fff79e", "#fffa6c", "#fff452", "#fff048", "#ffdc3a", "#f9c02e", "#ec951a", "#e48418", "#f58e1d", "#ff9e22", "#ffb51f", "#ffc830", "#ffd632", "#f7c86b", "#d1982d"],
    o: 1.2,
    oc: "#6a2c0c",
    depth: 1.5,
    dc: "#26062a",
    shine: 0.25,
  },
  // SPIN key (lit SPIN look, STOP) — matched to the reference video
  spinLit: {
    face: "w",
    cap: 43,
    s: 37,
    ls: 9,
    skew: 7,
    wx: 1.03,
    fill: ["#ffffff", "#f3f8de", "#dcedbc", "#c8e3a2", "#d6ecb6"],
    o: 4.5,
    oc: "#0b3000",
    depth: 4,
    dc: "#051a00",
    glow: { c: "#a6f02c", w: 4, b: 3, a: 0.8 },
  },
  stop: {
    face: "w",
    cap: 43,
    s: 37,
    ls: 9,
    skew: 7,
    wx: 1.03,
    fill: ["#f6fadc", "#e9f4c8", "#cfe7ae", "#b9dc98", "#cce8b0"],
    o: 5,
    oc: "#0a4416",
    depth: 4,
    dc: "#05280b",
    glow: { c: "#22e078", w: 6, b: 3.5, a: 0.95 },
  },
  holdLit: { face: "c", cap: 19, s: 18, ls: 5, wx: 1.45, fill: ["#fbfdf3", "#e9f0dc", "#d2dec0"], o: 3, oc: "#0f3200", depth: 2, dc: "#061800" },
} satisfies Record<string, VStyle>;

/**
 * Draws `text` as layered vector strokes. (x, y) is in the parent's px — y is the top of the
 * letters, x is their left / centre / right edge per `align` (same contract as the reference).
 */
function VText({
  text,
  st,
  x,
  y,
  align = "left",
  className = "",
}: {
  text: string;
  st: VStyle;
  x: number;
  y: number;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const geo = useMemo(() => {
    const f = FACES[st.face ?? "c"];
    const s = st.s;
    const o = st.o ?? 0;
    const d = st.depth ?? 0;
    const gw = st.glow ? st.glow.w : 0;
    const chars = [...text];
    let cx = 0;
    const paths: { d: string; x: number }[] = [];
    chars.forEach((ch, i) => {
      if (ch === " ") {
        cx += f.space;
        return;
      }
      const g = f.g[ch.toUpperCase()];
      if (!g) return;
      if (i > 0 && chars[i - 1] !== " ") {
        cx += (ch === "." || chars[i - 1] === ".") && st.dotLs != null ? st.dotLs : st.ls ?? 0;
      }
      paths.push({ d: g.d, x: cx + s / 2 });
      cx += g.w + s;
    });
    const tw = cx;
    const tan = st.skew ? Math.tan((st.skew * Math.PI) / 180) : 0;
    const wx = st.wx ?? 1;
    const pad = s / 2 + o + gw + 3;
    const x0 = (-pad - tan * (100 + pad + d)) * wx;
    const x1 = (tw + pad + tan * pad) * wx;
    const y0 = -pad;
    const y1 = 100 + pad + d;
    const k = st.cap / (100 + s);
    const anchor = (align === "center" ? tw / 2 - tan * 50 : align === "right" ? tw - tan * 50 : -tan * 50) * wx;
    return {
      paths,
      s,
      o,
      d,
      gw,
      wx,
      x0,
      x1,
      y0,
      y1,
      k,
      left: x - (anchor - x0) * k,
      top: y - (-s / 2 - y0) * k,
    };
  }, [text, st, x, y, align]);

  const { paths, s, o, d, gw, wx, x0, x1, y0, y1, k, left, top } = geo;
  const ref = `#vp${id}`;
  const fill = st.fill;
  return (
    <svg
      className={`pointer-events-none absolute overflow-visible ${className}`}
      viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
      width={(x1 - x0) * k}
      height={(y1 - y0) * k}
      style={{ left, top }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`vg${id}`} gradientUnits="userSpaceOnUse" x1="0" y1={-s / 2} x2="0" y2={100 + s / 2}>
          {fill.map((c, i) => (
            <stop key={i} offset={(i / (fill.length - 1)).toFixed(3)} stopColor={c} />
          ))}
        </linearGradient>
        {st.glow && (
          <filter id={`vf${id}`} x="-30%" y="-60%" width="160%" height="220%">
            <feGaussianBlur stdDeviation={st.glow.b ?? 5} />
          </filter>
        )}
        {st.shine && (
          <clipPath id={`vc${id}`}>
            <rect x={x0} y={-s} width={x1 - x0} height={s * 0.55} />
            <rect x={x0} y={50 - s / 2} width={x1 - x0} height={s * 0.4} />
          </clipPath>
        )}
        <g id={`vp${id}`} fill="none" strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={3}>
          {paths.map((p, i) => (
            <path key={i} d={p.d} transform={`translate(${p.x},0)`} />
          ))}
        </g>
      </defs>
      <g transform={`scale(${wx},1)${st.skew ? ` skewX(${-st.skew})` : ""}`}>
        {st.glow && (
          <use href={ref} stroke={st.glow.c} strokeWidth={s + 2 * o + 2 * gw} filter={`url(#vf${id})`} opacity={st.glow.a ?? 0.9} />
        )}
        {d > 0 && <use href={ref} stroke={st.dc ?? st.oc ?? "#000"} strokeWidth={s + 2 * o} transform={`translate(0,${d})`} />}
        {o > 0 && <use href={ref} stroke={st.oc} strokeWidth={s + 2 * o} />}
        <use href={ref} stroke={`url(#vg${id})`} strokeWidth={s} />
        {st.shine && (
          <g clipPath={`url(#vc${id})`}>
            <use href={ref} stroke="#fff" strokeOpacity={st.shine} strokeWidth={s} />
          </g>
        )}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Win count-up                                                       */
/* ------------------------------------------------------------------ */

/** Animates the WIN count up to `target` whenever it changes, from the value currently shown. */
function useCountUp(target: number, durationMs: number): [number, boolean] {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const [counting, setCounting] = useState(false);
  const raf = useRef<number>();
  useEffect(() => {
    const set = (v: number) => {
      valueRef.current = v;
      setValue(v);
    };
    // count up from what's shown now (20 → 30 counts 20…30); a drop (new spin's reset to 0) snaps
    const from = valueRef.current;
    if (target <= from) {
      set(target);
      setCounting(false);
      return;
    }
    const start = performance.now();
    setCounting(true);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / durationMs);
      set(Math.round((from + (target - from) * k) * 100) / 100);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setCounting(false);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return [value, counting];
}

/* ------------------------------------------------------------------ */
/*  Steel-framed key (`.sc-btn`)                                       */
/* ------------------------------------------------------------------ */

interface SteelKeyProps {
  ariaLabel: string;
  ariaPressed?: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  disabled?: boolean;
  /** Idle pulse (LINES / SPIN between spins — not on − / +). */
  pulse?: boolean;
  frameClass?: string;
  faceClass: string;
  glossClass?: string;
  onClick?: () => void;
  buttonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  /** Content inside the face (icons). */
  children?: React.ReactNode;
  /** VText layers, positioned in the key's own px (the reference's `.vt-box`es). */
  overlay?: React.ReactNode;
  /** Deeper press: dips 4px (2px more than the default 2px), same 97% shrink and 80ms timing. */
  deepPress?: boolean;
}

function SteelKey({
  ariaLabel,
  ariaPressed,
  left,
  top,
  width,
  height,
  disabled,
  pulse,
  frameClass = "p-[4px] bg-[linear-gradient(#e4ecf8,#7d8fb2_45%,#1d2540)]",
  faceClass,
  glossClass = "",
  onClick,
  buttonProps,
  children,
  overlay,
  deepPress = false,
}: SteelKeyProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={onClick}
      {...buttonProps}
      className={`absolute box-border cursor-pointer appearance-none rounded-[12px] border-0 shadow-[0_3px_0_#04163a,0_5px_10px_#0008,inset_0_0_0_1px_#0a1430] outline-none [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] transition-[transform,filter] ${
        deepPress
          ? "duration-[80ms] enabled:active:[transform:translateY(1px)_scale(.98)] enabled:active:[filter:brightness(1.08)_saturate(1.45)_contrast(1.15)]"
          : "duration-[80ms] enabled:active:[transform:translateY(2px)_scale(.98)] enabled:active:brightness-[1.2]"
      } disabled:cursor-default disabled:brightness-[.72] disabled:saturate-[.85] ${frameClass}`}
      style={{ left, top, width, height }}
    >
      <span
        className={`relative block h-full w-full overflow-hidden rounded-[9px] shadow-[inset_0_0_0_2px_#0006,inset_0_2px_1px_#fff6] ${faceClass}`}
      >
        {/* glossy top highlight (`.face::before`) */}
        <span
          className={`pointer-events-none absolute left-[6%] right-[6%] top-[4%] h-[38%] [border-radius:8px_8px_40%_40%/8px_8px_100%_100%] bg-[linear-gradient(#ffffff80,#ffffff00)] ${glossClass}`}
        />
        {children}
        {/* idle pulse: a brightening layer whose opacity animates (GPU-composited) */}
        {pulse && !disabled && (
          <span className="pointer-events-none absolute inset-0 rounded-[9px] bg-white/15 mix-blend-screen animate-gc2-pulse" />
        )}
      </span>
      {overlay && <span className="pointer-events-none absolute left-0 top-0 h-0 w-0">{overlay}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  SPIN / STOP key (`.sc-spin`) — matched frame-by-frame to the reference */
/* ------------------------------------------------------------------ */

/* Frame: dark outer line → thin bronze rim → dark inner line → face (no gloss).
 * Two looks: lit SPIN (the default — the reference's hover/flash look, held steady) and STOP
 * (reels spinning). No hover effect and no idle flash. */
const SPIN_FACE_LIT =
  "bg-[linear-gradient(#e6e737_0%,#c1da22_5%,#bbda0c_10%,#aade00_20%,#91dc00_30%,#81d100_35%,#6ebd00_40%,#55a400_50%,#3c8500_55%,#2f7006_60%,#154f00_70%,#073a0b_78%,#023d05_86%,#0c5a04_94%,#1a7f06_100%)]";
const SPIN_FACE_STOP =
  "bg-[linear-gradient(105deg,#ffffff14,#ffffff00_45%),linear-gradient(#41ab28_0%,#2adb42_5%,#1fda47_10%,#01d845_15%,#00ca39_20%,#0cb936_25%,#08aa38_30%,#039f36_35%,#008628_40%,#00742f_45%,#056834_50%,#015c34_55%,#005833_60%,#075733_70%,#004e2c_80%,#06492e_90%,#0e412b_100%)]";

/** One stacked look of the SPIN key (face + lettering). Both looks stay mounted and crossfade by
 * opacity — swapping them in/out made SPIN ↔ STOP jump in one frame and rebuilt the glowing
 * lettering each time. `will-change` keeps each look on its own GPU layer so the fade is cheap. */
function SpinLayer({ face, shown, children }: { face: string; shown: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`absolute inset-0 will-change-[opacity] transition-opacity duration-[220ms] ease-out ${shown ? "opacity-100" : "opacity-0"}`}
      aria-hidden={!shown}
    >
      <span className={`absolute bottom-[7px] left-[7px] right-[7px] top-[7px] overflow-hidden rounded-[6px] ${face}`}>
        <span className="absolute inset-0 rounded-[7px] shadow-[inset_0_1px_0_#ffffff55,inset_0_0_0_1px_#00000040]" />
      </span>
      {children}
    </span>
  );
}

function SpinKey({
  left,
  top,
  stop,
  ending,
  pressed,
  dimmed,
  label,
  buttonProps,
}: {
  left: number;
  top: number;
  /** custom idle lettering in place of SPIN + HOLD FOR AUTOSPIN */
  label?: string;
  /** reels spinning → STOP look */
  stop: boolean;
  /** end-of-spin: STOP dips slightly while it crossfades back into SPIN */
  ending: boolean;
  pressed: boolean;
  /** a spin can't start right now (loading, bonus round, …) */
  dimmed: boolean;
  buttonProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={stop ? "Stop" : label ?? "Spin"}
      {...buttonProps}
      className={`absolute box-border cursor-pointer appearance-none rounded-[13px] border-0 p-0 shadow-[0_0_0_1px_#0a246080,0_2px_5px_#0008] outline-none [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] bg-[linear-gradient(#0d1530,#101a36_60%,#0a1024)] transition-[filter] duration-200 ease-out ${
        dimmed ? "brightness-[.72] saturate-[.85]" : ""
      }`}
      style={{ left, top, width: 316, height: 106 }}
    >
      {/* thin bronze rim with a dark inner line */}
      <span className="absolute inset-[3px] rounded-[10px] bg-[linear-gradient(#c79458_0%,#9a6a36_20%,#6e4720_50%,#7c5228_72%,#cf9a5c_90%,#a87a46_100%)]">
        <span className="absolute inset-[3px] rounded-[7px] bg-[#0a1c04]" />
      </span>
      <SpinLayer face={SPIN_FACE_LIT} shown={!stop}>
        {label ? (
          <VText text={label} st={VSTYLES.spinLit} x={159} y={31} align="center" />
        ) : (
          <>
            <VText text="SPIN" st={VSTYLES.spinLit} x={160} y={18} align="center" />
            <VText text="HOLD FOR AUTOSPIN" st={VSTYLES.holdLit} x={159} y={75} align="center" />
          </>
        )}
      </SpinLayer>
      <SpinLayer face={SPIN_FACE_STOP} shown={stop}>
        <VText text="STOP" st={VSTYLES.stop} x={159} y={31} align="center" />
      </SpinLayer>
      {/* press / end-of-spin darkening: a 20% black veil over the face (≈ brightness .8), faded by
          opacity — quick in on press, eased out on release, so it never snaps */}
      <span
        className={`pointer-events-none absolute bottom-[7px] left-[7px] right-[7px] top-[7px] rounded-[6px] bg-black will-change-[opacity] transition-opacity ease-out ${
          pressed ? "opacity-20 duration-[90ms]" : ending ? "opacity-20 duration-100" : "opacity-0 duration-[220ms]"
        }`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const MinusIcon = () => (
  <svg viewBox="0 0 40 40" className="h-[42px] w-[42px] [filter:drop-shadow(0_1px_0_#fff3a0)]" aria-hidden>
    <rect x="5" y="15" width="30" height="10" rx="3" fill="#2a0a00" />
    <rect x="7" y="16" width="26" height="3" rx="1.5" fill="#8a4a10" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 40 40" className="h-[42px] w-[42px] [filter:drop-shadow(0_1px_0_#fff3a0)]" aria-hidden>
    <path d="M15 5h10v10h10v10H25v10H15V25H5V15h10z" fill="#2a0a00" stroke="#2a0e00" strokeWidth="1" strokeLinejoin="round" />
    <path d="M17 7h6v3h-6zM7 17h6v2H7z" fill="#8a4a10" />
  </svg>
);

function RocketIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 64 86" className="h-[62px] w-[46px] [filter:drop-shadow(0_2px_1px_#5a0003)]" aria-hidden>
      <defs>
        <linearGradient id="gc2Rocket" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".55" stopColor="#fff6dc" />
          <stop offset="1" stopColor="#e3c98e" />
        </linearGradient>
      </defs>
      <path
        d="M25 66 Q32 86 39 66 Z"
        fill="#ffd34a"
        className={on ? "animate-gc2-flame" : ""}
        style={{ transformOrigin: "32px 66px", transformBox: "view-box" }}
      />
      <path d="M32 4 C46 16 48 36 44 58 L20 58 C16 36 18 16 32 4 Z" fill="url(#gc2Rocket)" stroke="#6a0a0a" strokeWidth="2" />
      <path
        d="M20 40 L8 56 L10 64 L21 58 Z M44 40 L56 56 L54 64 L43 58 Z"
        fill="url(#gc2Rocket)"
        stroke="#6a0a0a"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="25" y="58" width="14" height="8" rx="2" fill="#d8b46a" stroke="#6a0a0a" strokeWidth="2" />
      <circle cx="32" cy="30" r="6" fill="#c81418" stroke="#6a0a0a" strokeWidth="2" />
    </svg>
  );
}

/** Autoplay arrows for the AUTO key (used when the game has no turbo). */
const AutoIcon = () => (
  <svg viewBox="0 0 48 48" className="h-[40px] w-[40px] [filter:drop-shadow(0_2px_1px_#5a0003)]" aria-hidden>
    <path d="M9 22 A15 15 0 0 1 36.5 13.5" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    <path d="M30.5 8.5 L40.5 11.5 L35.5 20.5 Z" fill="#fff" />
    <path d="M39 26 A15 15 0 0 1 11.5 34.5" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    <path d="M17.5 39.5 L7.5 36.5 L12.5 27.5 Z" fill="#fff" />
    <path d="M20 17.5 L31 24 L20 30.5 Z" fill="#fff" />
  </svg>
);

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 48 48" className="h-[30px] w-[30px] [filter:drop-shadow(0_2px_1px_#10063a)]" aria-hidden>
    <path d="M6 18 H15 L26 8 V40 L15 30 H6 Z" fill="#fff" stroke="#10063a" strokeWidth="2.5" strokeLinejoin="round" />
    {muted ? (
      <path d="M32 18 L44 30 M44 18 L32 30" stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none" />
    ) : (
      <>
        <path d="M31 17 Q36 24 31 31" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M36 11 Q45 24 36 37" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" />
      </>
    )}
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Bar background (`.sc-bar`) and WIN / BALANCE frame (`.sc-center`) */
/* ------------------------------------------------------------------ */

const BAR_BACKGROUND = [
  "linear-gradient(to bottom,#6a3a00 0,#fff7b0 2px,#ffc400 5px,#b36a00 9px,#2e1a00 11px,transparent 11px)",
  "linear-gradient(to top,#2e1a00 0,#b36a00 3px,#ffc400 6px,#fff7b0 8px,#6a3a00 10px,transparent 10px)",
  "linear-gradient(to bottom,#062a7a 11px,#1e90ff 18px,#0a5ce0 60%,#04256e calc(100% - 10px))",
].join(",");

function CenterFrame() {
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 468 156" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="gc2CpBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c03aff" />
          <stop offset=".22" stopColor="#8a10ff" />
          <stop offset=".5" stopColor="#4010d0" />
          <stop offset=".8" stopColor="#1e0880" />
          <stop offset="1" stopColor="#10044a" />
        </linearGradient>
        <linearGradient id="gc2CpGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4a0" />
          <stop offset=".3" stopColor="#ffc400" />
          <stop offset=".6" stopColor="#b36a00" />
          <stop offset="1" stopColor="#ffe066" />
        </linearGradient>
        <linearGradient id="gc2CpLine" x1="0" x2="1">
          <stop offset="0" stopColor="#ffc400" stopOpacity="0" />
          <stop offset=".1" stopColor="#ffc400" />
          <stop offset=".9" stopColor="#ffc400" />
          <stop offset="1" stopColor="#ffc400" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* outer gold shell */}
      <path d="M0 0 H468 C452 28 446 70 450 106 C452 128 452 146 446 156 H22 C16 146 16 128 18 106 C22 70 16 28 0 0 Z" fill="url(#gc2CpGold)" />
      {/* dark rim */}
      <path d="M14 4 H454 C440 30 434 70 438 106 C440 126 440 144 436 152 H32 C28 144 28 126 30 106 C34 70 28 30 14 4 Z" fill="#3a1a00" />
      {/* purple screen */}
      <path d="M18 6 H450 C437 31 431 70 435 106 C437 126 437 143 433 150 H35 C31 143 31 126 33 106 C37 70 31 31 18 6 Z" fill="url(#gc2CpBg)" />
      {/* top shine */}
      <path d="M22 7 H446 C440 18 437 26 435 34 H33 C31 26 28 18 22 7 Z" fill="#ffffff" opacity=".14" />
      <rect x="34" y="75" width="400" height="2.5" fill="url(#gc2CpLine)" />
      {/* gold side highlight strokes */}
      <path d="M4 1 C20 30 26 70 22 106 C20 128 20 146 26 155" fill="none" stroke="#fff6c0" strokeWidth="2" opacity=".7" />
      <path d="M464 1 C448 30 442 70 446 106 C448 128 448 146 442 155" fill="none" stroke="#fff6c0" strokeWidth="2" opacity=".7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export default function GameController2({
  credit,
  betAmount,
  onBetDecrease,
  onBetIncrease,
  betDecreaseDisabled,
  betIncreaseDisabled,
  linePlay,
  lines,
  onCycleLines,
  win,
  spinning,
  spinDisabled,
  onSpin,
  spinLabel,
  auto,
  onToggleAuto,
  autoDisabled,
  onQuickStop,
  allowQuickStop = true,
  turbo = false,
  onToggleTurbo,
  holdMs = 700,
  onInfo,
  onToggleMute,
  spaceToSpin = true,
  className = "",
}: GameController2Props) {
  const soundSettings = useSoundSettings();
  const [soundOpen, setSoundOpen] = useState(false);
  /* ---------- scaling to container ---------- */
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale((entry.contentRect.width || STAGE_W) / STAGE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const busy = spinning || auto;
  // SPIN shows STOP only while the reels actually spin — between autospins it shows SPIN.
  // When a spin ends, STOP dims for ~0.1s before turning back into SPIN (as in the reference).
  const [spinEnding, setSpinEnding] = useState(false);
  const prevSpinning = useRef(spinning);
  useEffect(() => {
    const ended = prevSpinning.current && !spinning;
    prevSpinning.current = spinning;
    if (!ended) return;
    setSpinEnding(true);
    const t = window.setTimeout(() => setSpinEnding(false), 130);
    return () => window.clearTimeout(t);
  }, [spinning]);
  const stopMode = spinning || spinEnding;

  /* ---------- WIN count-up (+ BALANCE counting up from its old value, over the same time) ---------- */
  const countMs = turbo ? 400 : Math.min(1800, 500 + win * 60);
  const [shownWin, counting] = useCountUp(win, countMs);
  const shownBalance = useBalanceCountUp(credit, countMs);

  /* ---------- SPIN gestures: tap / hold-for-autospin / tap-to-stop ---------- */
  const holdTimer = useRef<number>();
  const held = useRef(false);
  const down = useRef(false);
  const latest = useRef({ spinning, auto, spinDisabled, autoDisabled, allowQuickStop, onSpin, onToggleAuto, onQuickStop });
  latest.current = { spinning, auto, spinDisabled, autoDisabled, allowQuickStop, onSpin, onToggleAuto, onQuickStop };

  const cancelHold = () => window.clearTimeout(holdTimer.current);
  /** A tap on SPIN (pointer release or Space). */
  const tapSpin = () => {
    const l = latest.current;
    if (l.auto) l.onToggleAuto(); // stop autospin
    else if (l.spinning) {
      if (l.allowQuickStop) l.onQuickStop?.();
    } else if (!l.spinDisabled) l.onSpin();
  };
  // SPIN's pressed (darkened) look, tracked here because preventDefault (below) stops :active.
  const [spinPressed, setSpinPressed] = useState(false);
  const spinPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setSpinPressed(true);
    down.current = true;
    held.current = false;
    const l = latest.current;
    if (l.spinning || l.auto || l.spinDisabled || l.autoDisabled) return; // STOP is handled on release
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      cancelHold();
      latest.current.onToggleAuto(); // start autospin
    }, holdMs);
  };
  const spinPointerUp = () => {
    setSpinPressed(false);
    if (!down.current) return;
    down.current = false;
    if (held.current) {
      held.current = false;
      return;
    }
    cancelHold();
    tapSpin();
  };
  const spinPointerLeave = () => {
    setSpinPressed(false);
    if (down.current && !held.current) cancelHold();
    down.current = false;
  };
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  // Space bar = tap SPIN (ignored while typing in a field).
  useEffect(() => {
    if (!spaceToSpin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // Space on a popup's control (e.g. the sound settings On/Off switch) presses that control, not SPIN.
      if (t?.closest('[role="dialog"]')) return;
      e.preventDefault();
      tapSpin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceToSpin]);

  const purpleFace = "bg-[linear-gradient(#8a52ff,#5418ff_45%,#2a0099)] flex flex-col items-center justify-center";
  // − / +: while pressed, sharp gold flows from the top down past the icon to near the bottom edge
  const orangeFace = "bg-[linear-gradient(#ffe600,#ffb300_30%,#ff7400_70%,#c23400)] [button:enabled:active_&]:bg-[linear-gradient(#ffd21a,#ffc800_40%,#ffb800_78%,#ff9000_92%,#c23400)] flex items-center justify-center";
  const redFace = "bg-[linear-gradient(#ff3b3b,#e00010_45%,#8a0008)]";
  const goldFace = "bg-[linear-gradient(#ffd000,#ff8000_45%,#d03a00)]";
  const hasLines = lines !== undefined && !!onCycleLines;

  return (
    <div
      ref={hostRef}
      className={`relative w-full select-none overflow-hidden [touch-action:manipulation] ${className}`}
      style={{ height: STAGE_H * scale }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
        {/* bar body: gold rails top & bottom, blue body, soft gloss */}
        <div className="absolute inset-0" style={{ background: BAR_BACKGROUND }} />
        <div className="pointer-events-none absolute left-0 right-0 top-[11px] h-[40px] bg-[linear-gradient(#ffffff24,#ffffff00)]" />

        {/* LINES — or Info + Sound stacked in the same slot for games without lines */}
        {hasLines ? (
          <SteelKey
            ariaLabel="Lines"
            left={12}
            top={16}
            width={68}
            height={98}
            disabled={busy}
            pulse={!busy}
            faceClass={purpleFace}
            onClick={onCycleLines}
            overlay={
              <>
                <VText text="LINES" st={VSTYLES.linesLbl} x={33} y={26} align="center" />
                <VText text={String(lines)} st={VSTYLES.linesVal} x={33} y={56} align="center" />
              </>
            }
          />
        ) : (
          <>
            <SteelKey
              ariaLabel="Game info"
              left={12}
              top={16}
              width={68}
              height={46}
              faceClass={purpleFace}
              onClick={onInfo}
              overlay={<VText text="?" st={{ ...VSTYLES.linesVal, face: "c", o: 2.5, oc: "#3a3d68" }} x={33} y={10} align="center" />}
            />
            {onToggleMute && (
              <SteelKey
                ariaLabel="Sound settings"
                left={12}
                top={68}
                width={68}
                height={46}
                faceClass={purpleFace}
                onClick={() => setSoundOpen(true)}
              >
                <SoundIcon muted={isSilent(soundSettings)} />
              </SteelKey>
            )}
            {soundOpen && <SoundSettingsPopup onClose={() => setSoundOpen(false)} />}
          </>
        )}

        {/* − */}
        <SteelKey
          ariaLabel="Decrease bet"
          deepPress
          left={94}
          top={16}
          width={72}
          height={102}
          disabled={busy || betDecreaseDisabled}
          faceClass={orangeFace}
          onClick={onBetDecrease}
        >
          <MinusIcon />
        </SteelKey>

        {/* LINE PLAY / TOTAL PLAY — or TOTAL BET for flat-bet games */}
        <div
          className="absolute box-border rounded-[10px] p-[3px] shadow-[0_3px_8px_#0008] bg-[linear-gradient(#b8a8ff,#6a3cff_50%,#2a0a8a)]"
          style={{ left: 172, top: 16, width: 224, height: 102 }}
        >
          <div className="relative box-border h-full w-full rounded-[8px] shadow-[inset_0_0_0_2px_#10063a] bg-[linear-gradient(#4f1fe0,#3110b8_50%,#1c0680)]">
            <div className="absolute left-[10px] right-[10px] top-[48px] h-[2px] bg-[linear-gradient(90deg,transparent,#ffc400_15%,#ffc400_85%,transparent)]" />
          </div>
          {linePlay !== undefined ? (
            <>
              <VText text="LINE  PLAY:" st={VSTYLES.playLbl} x={23} y={19} />
              <VText text="TOTAL PLAY:" st={VSTYLES.playLbl} x={23} y={64} />
              <VText text={fmt(linePlay)} st={VSTYLES.playVal} x={193} y={12} align="right" />
              <VText text={fmt(betAmount)} st={VSTYLES.playVal} x={193} y={61} align="right" />
            </>
          ) : (
            <>
              {/* flat bet: label on the top row, the amount (slightly larger) on the bottom row */}
              <VText text="BET:" st={VSTYLES.playLbl} x={23} y={19} />
              <VText text={fmt(betAmount)} st={{ ...VSTYLES.playVal, cap: 30 }} x={193} y={59} align="right" />
            </>
          )}
        </div>

        {/* + */}
        <SteelKey
          ariaLabel="Increase bet"
          deepPress
          left={402}
          top={16}
          width={74}
          height={102}
          disabled={busy || betIncreaseDisabled}
          faceClass={orangeFace}
          onClick={onBetIncrease}
        >
          <PlusIcon />
        </SteelKey>

        {/* WIN / BALANCE */}
        <div className="absolute" style={{ left: 486, top: 0, width: 468, height: STAGE_H }}>
          <CenterFrame />
          <VText text="WIN" st={VSTYLES.bigLbl} x={95} y={24} />
          <VText text="BALANCE" st={VSTYLES.bigLbl} x={64} y={83} />
          <VText
            text={fmt(shownWin)}
            st={{ ...VSTYLES.money, cap: 34 }}
            x={305}
            y={22}
            align="center"
            className={counting ? "origin-center animate-gc2-winpop" : ""}
          />
          <VText text={fmt(shownBalance)} st={VSTYLES.money} x={305} y={79} align="center" />
        </div>

        {/* TURBO (rocket) — or AUTO for games without a turbo mode */}
        {onToggleTurbo ? (
          <SteelKey
            ariaLabel="Turbo"
            ariaPressed={turbo}
            left={974}
            top={18}
            width={88}
            height={102}
            faceClass={`flex items-center justify-center ${turbo ? goldFace : redFace}`}
            onClick={onToggleTurbo}
          >
            <RocketIcon on={turbo} />
          </SteelKey>
        ) : (
          <SteelKey
            ariaLabel={auto ? "Stop autoplay" : "Autoplay"}
            ariaPressed={auto}
            left={974}
            top={18}
            width={88}
            height={102}
            disabled={autoDisabled}
            faceClass={`flex flex-col items-center pt-[10px] ${auto ? goldFace : redFace}`}
            onClick={onToggleAuto}
            overlay={<VText text="AUTO" st={VSTYLES.linesLbl} x={44} y={70} align="center" />}
          >
            <AutoIcon />
          </SteelKey>
        )}

        {/* SPIN / STOP — tap = spin, hold = autospin, tap while busy = stop */}
        <SpinKey
          left={1088}
          top={16}
          stop={stopMode}
          ending={spinEnding}
          pressed={spinPressed}
          dimmed={!busy && !!spinDisabled}
          label={spinLabel}
          buttonProps={{
            onPointerDown: spinPointerDown,
            onPointerUp: spinPointerUp,
            onPointerLeave: spinPointerLeave,
            onPointerCancel: spinPointerLeave,
            onContextMenu: (e) => e.preventDefault(),
          }}
        />
      </div>
    </div>
  );
}
