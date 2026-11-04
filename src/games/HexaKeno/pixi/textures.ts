import type { Texture } from "pixi.js";
import { cssLinear, insetBands, paint, roundRectPath, withStops, type Band, type Ctx, type Stops } from "../../shared/pixi/paint";

export type CellState = "idle" | "picked" | "hit" | "miss";

/** Flat-top hexagon filling the w x h box (points left/right). */
function hexPath(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x + w * 0.25, y);
  ctx.lineTo(x + w * 0.75, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w * 0.75, y + h);
  ctx.lineTo(x + w * 0.25, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
}

const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;

// ---------- Background ----------

export function backgroundTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      // radial-gradient(ellipse at center, ...) — a circle squashed to the canvas aspect.
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(1, h / w);
      const r = (w / 2) * Math.SQRT2;
      ctx.fillStyle = withStops(ctx.createRadialGradient(0, 0, 0, 0, 0, r), [
        [0, "#29570c"],
        [0.35, "#216b11"],
        [0.65, "#093809"],
        [1, "#000000"],
      ]);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      // Faint diagonal shimmer stripes.
      ctx.strokeStyle = "rgba(255,255,255,0.015)";
      ctx.lineWidth = 2;
      const step = 14 * Math.SQRT2;
      for (let x = 0; x < w + h; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - h, h);
        ctx.stroke();
      }
    },
    0,
    // Soft full-screen gradient: half density is indistinguishable and a quarter the GPU memory.
    0.5
  );
}

// ---------- Hex cells ----------

export const HEX_PAD = 16;

const HEX_FACES: Record<CellState, { face: Stops; hi: [string, number]; lo: [string, number]; glow?: [string, number] }> = {
  idle: {
    face: [
      [0, "#586cff"],
      [0.42, "#3945dc"],
      [0.7, "#2930b7"],
      [1, "#202087"],
    ],
    hi: ["130,145,255", 0.45],
    lo: ["10,8,80", 0.65],
  },
  picked: {
    face: [
      [0, "#2bd600"],
      [0.45, "#008204"],
      [1, "#2bd600"],
    ],
    hi: ["200,255,220", 0.5],
    lo: ["5,60,35", 0.65],
    glow: ["rgba(209,4,4,0.75)", 16],
  },
  miss: {
    face: [
      [0, "#ff6b5e"],
      [0.55, "#d61f1f"],
      [1, "#7a0d0d"],
    ],
    hi: ["255,180,170", 0.4],
    lo: ["60,5,5", 0.65],
  },
  hit: {
    face: [
      [0, "#ffcc00"],
      [0.5, "#f8d820"],
      [1, "#e0c56b"],
    ],
    hi: ["255,240,180", 0.55],
    lo: ["90,70,0", 0.6],
    glow: ["rgba(255,204,0,0.9)", 20],
  },
};

/** A hex cell: blue outer ring + state-colored inner face with a top-lit bevel. */
export function hexTexture(state: CellState, w: number, h: number): Texture {
  const spec = HEX_FACES[state];
  return paint(
    w,
    h,
    (ctx) => {
      hexPath(ctx, 0, 0, w, h);
      if (spec.glow) {
        ctx.shadowColor = spec.glow[0];
        ctx.shadowBlur = spec.glow[1];
      }
      ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 135, [
        [0, "#231075"],
        [0.45, "#2d32de"],
        [1, "#4B55E8"],
      ]);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      const inset = 6;
      const iw = w - inset * 2;
      const ih = h - inset * 2;
      hexPath(ctx, inset, inset, iw, ih);
      ctx.fillStyle = cssLinear(ctx, inset, inset, iw, ih, 135, spec.face);
      ctx.fill();

      ctx.save();
      ctx.clip();
      ctx.fillStyle = withStops(ctx.createLinearGradient(0, inset, 0, inset + ih), [
        [0, rgba(spec.hi[0], spec.hi[1])],
        [0.16, rgba(spec.hi[0], 0)],
        [0.76, rgba(spec.lo[0], 0)],
        [1, rgba(spec.lo[0], spec.lo[1])],
      ]);
      ctx.fillRect(inset, inset, iw, ih);
      ctx.restore();
    },
    HEX_PAD
  );
}

// ---------- Drawn balls ----------

export function ballTexture(size: number): Texture {
  return paint(size, size, (ctx) => {
    const r = size / 2;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fc4a04";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.stroke();
  });
}

// ---------- Paytable rows ----------

export function paytableRowTexture(w: number, h: number, active: boolean): Texture {
  return paint(w, h, (ctx) => {
    roundRectPath(ctx, 0, 0, w, h, 8);
    if (active) {
      ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 90, [
        [0, "rgba(255,224,102,0.25)"],
        [1, "rgba(255,159,28,0.15)"],
      ]);
      ctx.fill();
      roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, 8);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,224,102,0.4)";
      ctx.stroke();
    } else {
      const cx = w * 0.32;
      const cy = h * 0.28;
      const r = Math.hypot(w - cx, h - cy);
      ctx.fillStyle = withStops(ctx.createRadialGradient(cx, cy, 0, cx, cy, r), [
        [0, "#3a2d63"],
        [0.55, "#241a47"],
        [1, "#180f34"],
      ]);
      ctx.fill();
    }
  });
}

// ---------- Panels ----------

/** Black rounded box with a faint white border; `glow` adds the yellow under-glow of the banner. */
export function blackBoxTexture(w: number, h: number, glow = false): Texture {
  const pad = glow ? 30 : 0;
  return paint(
    w,
    h,
    (ctx) => {
      roundRectPath(ctx, 0, 0, w, h, 12);
      if (glow) {
        ctx.shadowColor = "rgba(234,179,8,0.5)";
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 8;
      }
      ctx.fillStyle = "#000000";
      ctx.fill();
      ctx.shadowColor = "transparent";
      roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, 12);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.stroke();
    },
    pad
  );
}

/** The green-felt control rail, including its brass border and section dividers at `dividers` (y offsets). */
export function railTexture(w: number, h: number, dividers: number[]): Texture {
  const pad = 30;
  return paint(
    w,
    h,
    (ctx) => {
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 12;
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = "transparent";

      ctx.fillStyle = cssLinear(ctx, 3, 3, w - 6, h - 6, 90, [
        [0, "#004d2a"],
        [0.2, "#006b3a"],
        [0.5, "#087c43"],
        [0.8, "#006b3a"],
        [1, "#004d2a"],
      ]);
      ctx.fillRect(3, 3, w - 6, h - 6);
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(3, 3, w - 6, 1);

      ctx.fillStyle = "#8a6a3a";
      for (const y of dividers) ctx.fillRect(3, y - 1, w - 6, 2);
    },
    pad
  );
}

// ---------- Buttons ----------

export const OVAL_PAD = 12;

/** Black neon oval (EXIT / HELP) with the teal crescent on its left edge. */
export function ovalButtonTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      const ellipse = (dx: number, fill: string | CanvasGradient) => {
        ctx.beginPath();
        ctx.ellipse(w / 2 + dx, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
      };
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 4;
      ellipse(-10, "#20cfa7");
      ctx.shadowColor = "transparent";
      ellipse(-7, "#087d63");
      ellipse(
        0,
        cssLinear(ctx, 0, 0, w, h, 90, [
          [0, "#050505"],
          [0.45, "#111111"],
          [1, "#3c3c3c"],
        ])
      );
    },
    OVAL_PAD
  );
}

interface BevelSpec {
  face: Stops;
  /** Inset bevel bands, listed like CSS box-shadow (first = painted on top). */
  bands: Band[];
}

const RED_BUTTON: BevelSpec = {
  face: [
    [0, "#ff3b3b"],
    [0.45, "#ff2424"],
    [1, "#d90d0d"],
  ],
  bands: [
    ["top", 4, "#ffd0c0"],
    ["bottom", 7, "#8e0909"],
    ["left", 3, "#ff8a72"],
    ["top", 3, "#ff8a72"],
    ["right", 3, "#b20c0c"],
    ["bottom", 5, "#b20c0c"],
  ],
};

const BET_STEPPER: BevelSpec = {
  face: [
    [0, "#ff6b5e"],
    [0.35, "#ff2929"],
    [0.65, "#d61f1f"],
    [1, "#8f0d0d"],
  ],
  bands: [
    ["top", 4, "rgba(255,255,255,0.45)"],
    ["top", 7, "rgba(255,120,120,0.35)"],
    ["bottom", 7, "rgba(90,0,0,0.45)"],
    ["left", 5, "rgba(190,25,25,0.7)"],
    ["right", 5, "rgba(190,25,25,0.7)"],
  ],
};

/** Square-ish red cabinet button with a 5px brass border and inset bevel bands. */
export function bevelButtonTexture(w: number, h: number, kind: "red" | "stepper"): Texture {
  const spec = kind === "red" ? RED_BUTTON : BET_STEPPER;
  return paint(w, h + 2, (ctx) => {
    if (kind === "red") {
      roundRectPath(ctx, 0, 2, w, h, 4);
      ctx.fillStyle = "#6b2b20";
      ctx.fill();
    }
    roundRectPath(ctx, 0, 0, w, h, 4);
    ctx.fillStyle = "#a84a35";
    ctx.fill();

    const x = 5;
    const y = 5;
    const iw = w - 10;
    const ih = h - 10;
    ctx.fillStyle = cssLinear(ctx, x, y, iw, ih, 180, spec.face);
    ctx.fillRect(x, y, iw, ih);
    insetBands(ctx, x, y, iw, ih, spec.bands);
  });
}

/** CLEAR CARD / QUICK PICK button: rounded red slab with a darker red base edge. */
export function actionButtonTexture(w: number, h: number): Texture {
  return paint(w, h + 4, (ctx) => {
    roundRectPath(ctx, 0, 4, w, h, 10);
    ctx.fillStyle = "#9e2626";
    ctx.fill();
    roundRectPath(ctx, 0, 0, w, h, 10);
    ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 160, [
      [0, "#cc5555"],
      [1, "#d10f01"],
    ]);
    ctx.fill();
    roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, 10);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(124,1,1,0.685)";
    ctx.stroke();
  });
}
