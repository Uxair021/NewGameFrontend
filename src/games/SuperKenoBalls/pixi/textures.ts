import type { Texture } from "pixi.js";
import {
  cornerBevels,
  cssLinear,
  cssRadial,
  edgeBevels,
  insetBands,
  paint,
  polygonPath,
  roundRectPath,
  withStops,
  type Band,
  type Ctx,
  type Stops,
} from "../../shared/pixi/paint";

export type CellState = "idle" | "picked" | "hit" | "miss";

/** Room around cells/buttons for their drop shadows. */
export const SHADOW_PAD = 14;

// ---------- Background ----------

export function backgroundTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(1, h / w);
      // radial-gradient(ellipse at center, ...) — a circle squashed to the canvas aspect.
      const r = (w / 2) * Math.SQRT2;
      ctx.fillStyle = withStops(ctx.createRadialGradient(0, 0, 0, 0, 0, r), [
        [0, "#241a00"],
        [0.45, "#150f00"],
        [1, "#000000"],
      ]);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    },
    0,
    // Soft full-screen gradient: half density is indistinguishable and a quarter the GPU memory.
    0.5
  );
}

// ---------- Metal frames ----------

/** The "SUPER KENO BALLS" plaque: bevelled metal with a recessed inner panel. */
export function titlebarTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = "#3f4038";
      ctx.fillRect(-2, -2, w + 4, h + 4);
      ctx.shadowColor = "transparent";

      ctx.fillStyle = "#a9aa9d";
      ctx.fillRect(0, 0, w, h);
      const b = 3;
      ctx.fillStyle = cssLinear(ctx, b, b, w - b * 2, h - b * 2, 180, [
        [0, "#b7b7a9"],
        [0.1, "#77776b"],
        [0.45, "#68685d"],
        [0.82, "#77776b"],
        [1, "#bdbdb0"],
      ]);
      ctx.fillRect(b, b, w - b * 2, h - b * 2);
      insetBands(ctx, b, b, w - b * 2, h - b * 2, [
        ["top", 3, "#d7d8ca"],
        ["top", 6, "#8c8d81"],
        ["bottom", 3, "#c3c4b7"],
        ["bottom", 7, "#55564d"],
        ["left", 3, "#c5c6b9"],
        ["right", 3, "#77786e"],
      ]);

      const px = b + 12;
      const py = b + 10;
      const pw = w - px * 2;
      const ph = h - py * 2;
      ctx.fillStyle = "#484941";
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = cssLinear(ctx, px + 2, py + 2, pw - 4, ph - 4, 180, [
        [0, "#77776b"],
        [0.45, "#696960"],
        [1, "#707066"],
      ]);
      ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
      insetBands(ctx, px + 2, py + 2, pw - 4, ph - 4, [
        ["top", 2, "rgba(210,211,199,0.5)"],
        ["bottom", 3, "rgba(35,36,32,0.65)"],
        ["left", 2, "rgba(180,181,169,0.35)"],
        ["right", 2, "rgba(35,36,32,0.5)"],
      ]);
    },
    10
  );
}

/** Teal-steel frame around both number grids, with its dark recessed interior. */
export function boardFrameTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 35;
      ctx.shadowOffsetY = 15;
      ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 180, [
        [0, "#a8c5c4"],
        [0.18, "#719493"],
        [0.5, "#536f70"],
        [0.82, "#789a99"],
        [1, "#a9c4c2"],
      ]);
      ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = "transparent";
      insetBands(ctx, 0, 0, w, h, [
        ["top", 4, "rgba(220,240,238,0.75)"],
        ["bottom", 5, "rgba(35,55,55,0.85)"],
        ["left", 4, "rgba(190,215,212,0.5)"],
        ["right", 4, "rgba(45,65,66,0.7)"],
      ]);
      const i = 7;
      ctx.fillStyle = cssLinear(ctx, i, i, w - i * 2, h - i * 2, 180, [
        [0, "#364a49"],
        [0.45, "#263b3b"],
        [1, "#344b4a"],
      ]);
      ctx.fillRect(i, i, w - i * 2, h - i * 2);
      insetBands(ctx, i, i, w - i * 2, h - i * 2, [
        ["top", 2, "rgba(0,0,0,0.55)"],
        ["bottom", 3, "rgba(120,150,148,0.35)"],
      ]);
    },
    50
  );
}

/** Brushed-metal control rail with its light recessed inner panel (octagonal corners). */
export function railTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 180, [
        [0, "#d0d0c8"],
        [0.12, "#9b9c95"],
        [0.45, "#777973"],
        [0.82, "#9b9c95"],
        [1, "#c9cac3"],
      ]);
      ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = "transparent";
      insetBands(ctx, 0, 0, w, h, [
        ["top", 4, "rgba(230,230,225,0.45)"],
        ["bottom", 5, "rgba(8,8,8,0.85)"],
        ["left", 4, "rgba(230,230,225,0.45)"],
        ["right", 4, "rgba(173,173,172,0.7)"],
      ]);

      const i = 5;
      const iw = w - i * 2;
      const ih = h - i * 2;
      const cx = iw * 0.02;
      const cy = ih * 0.02;
      polygonPath(ctx, [
        [i + cx, i],
        [i + iw - cx, i],
        [i + iw, i + cy],
        [i + iw, i + ih - cy],
        [i + iw - cx, i + ih],
        [i + cx, i + ih],
        [i, i + ih - cy],
        [i, i + cy],
      ]);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = cssLinear(ctx, i, i, iw, ih, 180, [
        [0, "#b8b7b7"],
        [0.45, "#cecece"],
        [1, "#cecece"],
      ]);
      ctx.fillRect(i, i, iw, ih);
      insetBands(ctx, i, i, iw, ih, [
        ["top", 2, "rgba(226,226,226,0.65)"],
        ["bottom", 2, "rgba(255,255,255,0.3)"],
      ]);
      ctx.restore();
    },
    20
  );
}

// ---------- Number cells ----------

interface FlatCellSpec {
  face: Stops;
  faceDeg: number;
  bands: Band[];
  shadow: string;
  topBevel: Stops;
  bottomBevel: Stops;
}

const FLAT_CELLS: Record<Exclude<CellState, "picked">, FlatCellSpec> = {
  idle: {
    face: [
      [0, "#07b307"],
      [0.35, "#0baa0b"],
      [0.7, "#009900"],
      [1, "#006800"],
    ],
    faceDeg: 180,
    bands: [
      ["top", 5, "#07a307"],
      ["left", 6, "#0fad0f"],
      ["right", 6, "#006b00"],
      ["bottom", 6, "#087508"],
    ],
    shadow: "rgb(11,121,4)",
    topBevel: [
      [0, "rgba(90,255,90,0.8)"],
      [0.35, "rgba(0,255,0,0.15)"],
      [0.55, "rgba(0,255,0,0)"],
    ],
    bottomBevel: [
      [0.55, "rgba(0,70,0,0)"],
      [0.56, "rgba(0,70,0,0.65)"],
      [1, "rgba(0,40,0,0.85)"],
    ],
  },
  miss: {
    face: [
      [0, "#992f66"],
      [0.6, "#831342"],
      [1, "#91005e"],
    ],
    faceDeg: 135,
    bands: [
      ["top", 5, "#91005e"],
      ["left", 6, "#992f66"],
      ["right", 6, "#831342"],
      ["bottom", 6, "#3b0220"],
    ],
    shadow: "#91005e",
    topBevel: [
      [0, "#a75680"],
      [0.35, "#c76b9a"],
      [0.55, "rgba(199,107,154,0)"],
    ],
    bottomBevel: [
      [0.55, "rgba(88,7,49,0)"],
      [0.56, "#580731"],
      [1, "#3b0220"],
    ],
  },
  hit: {
    face: [
      [0, "#ff6b5e"],
      [0.55, "#d61f1f"],
      [1, "#8f0d0d"],
    ],
    faceDeg: 135,
    bands: [
      ["top", 5, "#ff6b5e"],
      ["left", 6, "#d61f1f"],
      ["right", 6, "#d61f1f"],
      ["bottom", 6, "#8f0d0d"],
    ],
    shadow: "#8f0d0d",
    topBevel: [
      [0, "#ff6b5e"],
      [0.35, "#d61f1f"],
      [0.55, "rgba(214,31,31,0)"],
    ],
    bottomBevel: [
      [0.55, "rgba(70,0,0,0)"],
      [0.56, "rgba(70,0,0,0.65)"],
      [1, "rgba(40,0,0,0.85)"],
    ],
  },
};

function flatCell(ctx: Ctx, w: number, h: number, spec: FlatCellSpec) {
  ctx.shadowColor = spec.shadow;
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, spec.faceDeg, spec.face);
  ctx.fillRect(0, 0, w, h);
  ctx.shadowColor = "transparent";
  insetBands(ctx, 0, 0, w, h, spec.bands);

  polygonPath(ctx, [
    [0, 0],
    [w, 0],
    [w * 0.92, h * 0.12],
    [w * 0.08, h * 0.12],
  ]);
  ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 135, spec.topBevel);
  ctx.fill();

  polygonPath(ctx, [
    [0, h],
    [0, h * 0.78],
    [w * 0.12, h * 0.88],
    [w * 0.88, h * 0.88],
    [w, h * 0.78],
    [w, h],
  ]);
  ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 135, spec.bottomBevel);
  ctx.fill();
}

/** The gold "picked" tile: four shaded edges, diagonal corner bevels and a raised center. */
function pickedCell(ctx: Ctx, w: number, h: number) {
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#514000";
  ctx.fillRect(0, 0, w, h);
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;

  const x = 1;
  const y = 1;
  const iw = w - 2;
  const ih = h - 2;
  ctx.fillStyle = "#d9aa00";
  ctx.fillRect(x, y, iw, ih);
  edgeBevels(ctx, x, y, iw, ih, [
    ["top", 8, "#8d6a00", "#b78d00"],
    ["left", 8, "#ffff00", "#f5e900"],
    ["right", 8, "#735500", "#9c7600"],
    ["bottom", 8, "#fff500", "#e8d000"],
  ]);
  ctx.strokeStyle = "#bd8f00";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, iw - 1, ih - 1);

  ctx.fillStyle = cssLinear(ctx, 8, 8, w - 16, h - 16, 180, [
    [0, "#e2b300"],
    [0.5, "#d9a800"],
    [1, "#d5a300"],
  ]);
  ctx.fillRect(8, 8, w - 16, h - 16);
  insetBands(ctx, 8, 8, w - 16, h - 16, [
    ["top", 2, "rgba(120,80,0,0.25)"],
    ["bottom", 2, "rgba(255,220,0,0.3)"],
  ]);

  cornerBevels(ctx, x, y, iw, ih, [
    ["tl", 10, "#725400", "#9b7400"],
    ["tr", 10, "#765800", "#a07800"],
    ["bl", 10, "#ffff00", "#f3e400"],
    ["br", 10, "#fff900", "#e8d600"],
  ]);
}

export function cellTexture(state: CellState, w: number, h: number): Texture {
  return paint(w, h, (ctx) => (state === "picked" ? pickedCell(ctx, w, h) : flatCell(ctx, w, h, FLAT_CELLS[state])), SHADOW_PAD);
}

// ---------- Bonus banner ----------

export function bonusBannerTexture(w: number, h: number): Texture {
  return paint(w, h, (ctx) => {
    roundRectPath(ctx, 1, 1, w - 2, h - 2, 8);
    ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 180, [
      [0, "#4d3b00"],
      [1, "#2e2400"],
    ]);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#8fa8ac";
    ctx.stroke();
  });
}

// ---------- Balls + tank floor ----------

export const BALL_PAD = 16;

export function ballTexture(size: number, hit: boolean): Texture {
  return paint(
    size,
    size,
    (ctx) => {
      const r = size / 2;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.shadowColor = hit ? "rgba(255,204,0,0.65)" : "rgba(0,0,0,0.5)";
      ctx.shadowBlur = hit ? 12 : 6;
      ctx.shadowOffsetY = hit ? 0 : 3;
      ctx.fillStyle = cssRadial(
        ctx,
        0,
        0,
        size,
        size,
        0.32,
        0.28,
        hit
          ? [
              [0, "#fff3b0"],
              [0.55, "#ffcc00"],
              [1, "#9d7f0f"],
            ]
          : [
              [0, "#fefefe"],
              [0.55, "#d8dde8"],
              [1, "#aeb6c9"],
            ]
      );
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.beginPath();
      ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = hit ? "rgba(255,224,102,0.7)" : "rgba(255,255,255,0.4)";
      ctx.stroke();
    },
    BALL_PAD
  );
}

/** The two-piece teal bar the drawn balls pile up on. */
export function tankFloorTexture(w: number, h: number): Texture {
  return paint(w, h, (ctx) => {
    const half = w / 2;
    const piece = (x: number, points: [number, number][]) => {
      polygonPath(
        ctx,
        points.map(([fx, fy]) => [x + fx * half, fy * h])
      );
      ctx.save();
      ctx.clip();
      ctx.fillStyle = cssLinear(ctx, x, 0, half, h, 180, [
        [0, "#76cfc0"],
        [0.35, "#58b3a8"],
        [0.68, "#3c817d"],
        [1, "#285b59"],
      ]);
      ctx.fillRect(x, 0, half, h);
      // Top highlight and lower shadow bevels.
      ctx.fillStyle = cssLinear(ctx, x, 2, half, 13, 180, [
        [0, "rgba(215,255,248,0.6)"],
        [0.5, "rgba(150,225,215,0.18)"],
        [1, "rgba(150,225,215,0)"],
      ]);
      ctx.fillRect(x + 5, 2, half - 10, 13);
      ctx.fillStyle = cssLinear(ctx, x, h - 17, half, 15, 180, [
        [0, "rgba(38,87,84,0)"],
        [0.3, "rgba(38,87,84,0.25)"],
        [1, "rgba(24,58,57,0.75)"],
      ]);
      ctx.fillRect(x + 6, h - 17, half - 12, 15);
      ctx.restore();
    };
    piece(0, [
      [0.05, 0],
      [0.94, 0],
      [1, 0.12],
      [1, 0.88],
      [0.94, 1],
      [0.05, 1],
      [0, 0.5],
    ]);
    piece(half - 1, [
      [0.06, 0],
      [0.95, 0],
      [1, 0.5],
      [0.95, 1],
      [0.06, 1],
      [0, 0.88],
      [0, 0.12],
    ]);

    // Center diamond joint.
    const dw = 17;
    polygonPath(ctx, [
      [half, 0],
      [half + dw / 2, h / 2],
      [half, h],
      [half - dw / 2, h / 2],
    ]);
    ctx.fillStyle = cssLinear(ctx, half - dw / 2, 0, dw, h, 90, [
      [0, "#255a57"],
      [0.45, "#78d1c2"],
      [0.55, "#3c827d"],
      [1, "#204d4b"],
    ]);
    ctx.fill();
  });
}

// ---------- Panels + buttons ----------

/** Navy readout panel (CASH/BET/WINS and the picks/paytable box). */
export function readoutPanelTexture(w: number, h: number): Texture {
  return paint(w, h, (ctx) => {
    roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, 10);
    ctx.fillStyle = cssLinear(ctx, 0, 0, w, h, 180, [
      [0, "rgba(15,12,46,0.9)"],
      [1, "rgba(8,6,26,0.95)"],
    ]);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(143,168,172,0.35)";
    ctx.stroke();
  });
}

/** Red cabinet button with shaded edges, corner bevels and a raised face. */
export function railButtonTexture(w: number, h: number): Texture {
  return paint(
    w,
    h,
    (ctx) => {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = "#752018";
      ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = "transparent";
      ctx.shadowOffsetX = 0;

      const x = 1;
      const y = 1;
      const iw = w - 2;
      const ih = h - 2;
      ctx.fillStyle = "#f72d2d";
      ctx.fillRect(x, y, iw, ih);
      edgeBevels(ctx, x, y, iw, ih, [
        ["top", 8, "#ff6259", "#d51810"],
        ["left", 7, "#ff554d", "#d92720"],
        ["right", 7, "#ff8a7d", "#df3029"],
        ["bottom", 9, "#9e1c15", "#c52720"],
      ]);
      ctx.strokeStyle = "#ff766b";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, iw - 1, ih - 1);

      const fx = 8;
      const fy = 8;
      const fw = w - 16;
      const fh = h - 17;
      ctx.fillStyle = cssLinear(ctx, fx, fy, fw, fh, 180, [
        [0, "#ff3737"],
        [0.55, "#f52a2a"],
        [1, "#ed2525"],
      ]);
      ctx.fillRect(fx, fy, fw, fh);
      insetBands(ctx, fx, fy, fw, fh, [
        ["top", 2, "rgba(255,120,110,0.4)"],
        ["bottom", 2, "rgba(150,15,10,0.35)"],
      ]);

      cornerBevels(ctx, x, y, iw, ih, [
        ["tl", 8, "#ff8a7d", "#ff5148"],
        ["tr", 8, "#ffb0a0", "#ff5c50"],
        ["bl", 9, "#8f1b15", "#b7221c"],
        ["br", 9, "#a51d17", "#ca2821"],
      ]);
    },
    6
  );
}
