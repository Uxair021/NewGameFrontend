/**
 * Every art file the game uses (public/symbols/zeusVsHades/game/, produced from the provided
 * sheets by scripts/zeusVsHades-slice.mjs) plus the frame rectangles of the animation sheets.
 * Shared by the Pixi scene and the React UI, so both always show the same image.
 */
import type { Profile } from "./engine";

export const GAME_ART = "/symbols/zeusVsHades/game";

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const f = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h });

/** Symbol ids that have art: 1 scatter, 2 wild, 3-12 paying symbols, 13 expanding wild. */
export const SYMBOL_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

export const symbolUrl = (symbol: number, profile: Profile) => `${GAME_ART}/sym/${profile}-${symbol}.png`;

/** Display names, used by the paytable/info screen. */
export const SYMBOL_NAMES: Record<Profile, Record<number, string>> = {
  olympus: {
    1: "Scatter", 2: "Wild", 3: "Zeus", 4: "Pegasus", 5: "Eagle", 6: "Helmet", 7: "Chalice",
    8: "Ace", 9: "King", 10: "Queen", 11: "Jack", 12: "Ten", 13: "Expanding Wild",
  },
  hades: {
    1: "Scatter", 2: "Wild", 3: "Hades", 4: "Cerberus", 5: "Fire Eagle", 6: "Helmet", 7: "Chalice",
    8: "Ace", 9: "King", 10: "Queen", 11: "Jack", 12: "Ten", 13: "Expanding Wild",
  },
};
export const blurUrl = (symbol: number, profile: Profile) => `${GAME_ART}/blur/${profile}-${symbol}.png`;

export const BACKGROUNDS = {
  olympusSky: `${GAME_ART}/bg/olympus-sky.jpg`,
  olympusTemple: `${GAME_ART}/bg/olympus-temple.png`,
  hades: `${GAME_ART}/bg/hades.jpg`,
};

/** Reel frames; `hole` is the transparent window the 5x5 board sits in. */
export const REEL_FRAMES: Record<Profile, { src: string; hole: Frame }> = {
  olympus: { src: `${GAME_ART}/frame-olympus.png`, hole: f(62, 92, 991, 754) },
  hades: { src: `${GAME_ART}/frame-hades.png`, hole: f(50, 88, 989, 754) },
};

export const LOGO = `${GAME_ART}/logo.png`;

/**
 * Animated frame drawn around each winning symbol: crackling lightning (Olympus) and a burning
 * border with a flame on top (Hades). The frames have slightly different sizes; each is
 * stretched to `scale` x the cell, shifted up by `liftY` x the cell height (for the flame).
 */
export const WIN_FRAMES: Record<Profile, { srcs: string[]; scaleX: number; scaleY: number; liftY: number; fps: number }> = {
  olympus: {
    srcs: [1, 2, 3, 4, 5].map((n) => `${GAME_ART}/fx/winframe-lightning-${n}.png`),
    scaleX: 1.12,
    scaleY: 1.16,
    liftY: 0,
    fps: 14,
  },
  hades: {
    srcs: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${GAME_ART}/fx/winframe-fire-${n}.png`),
    scaleX: 1.16,
    scaleY: 1.3,
    liftY: 0.08,
    fps: 12,
  },
};

/** Full-reel burst played when an expanding wild expands: 12 tall frames per profile. */
export const COLUMN_FX: Record<Profile, { src: string; frames: Frame[] }> = {
  olympus: {
    src: `${GAME_ART}/fx/column-lightning.png`,
    frames: Array.from({ length: 12 }, (_, k) => f(k * 155, 155, 153, 608)),
  },
  hades: {
    src: `${GAME_ART}/fx/column-fire.png`,
    frames: Array.from({ length: 12 }, (_, k) => f(1 + k * 157, 160, 154, 608)),
  },
};

/** A multiplier number drawn into a wild video: where it is, when it's visible, and the colour
 * of the background around it (used for the patch that covers it when relabelling). */
export interface VideoNumberSpot {
  fromSec: number;
  toSec: number;
  /** Rectangle in video pixels. */
  box: Frame;
  /** Background colour around the number. */
  plate: number;
  /** When relabelling: draw the real multiplier here (false = just cover the number). */
  showValue: boolean;
}

export interface WildVideoSpec {
  src: string;
  /** The multiplier drawn into the clip itself. */
  multiplier: number;
  /** Video size in pixels (the sprite is stretched to the reel). */
  width: number;
  height: number;
  /** When "WILD Nx" has appeared (wins wait for it). */
  revealSec: number;
  /** After the clip ends, playback loops from here while the wild stays on the reel. */
  loopFromSec: number;
  numberSpots: VideoNumberSpot[];
}

/**
 * Full-reel expanding-wild animations (provided GIFs, converted by scripts/zeusVsHades-gif2webm.cjs).
 * Each profile has a "Zeus wins" and a "Hades wins" clip. Spot boxes/timings were measured from
 * the clips (in video pixels).
 */
export type WildClipId = "olympusZeus" | "olympusHades" | "hadesZeus" | "hadesHades";

export const WILD_VIDEOS: Record<WildClipId, WildVideoSpec> = {
  olympusZeus: {
    src: `${GAME_ART}/fx/wild-olympus-zeus.webm`,
    multiplier: 3,
    width: 208,
    height: 830,
    revealSec: 2.8,
    loopFromSec: 3.2,
    numberSpots: [
      { fromSec: 0.06, toSec: 2.6, box: f(55, 10, 105, 72), plate: 0xc5b9ae, showValue: false },
      { fromSec: 0.06, toSec: 2.68, box: f(65, 746, 80, 62), plate: 0x381b17, showValue: true },
      { fromSec: 2.7, toSec: Infinity, box: f(77, 52, 56, 42), plate: 0x6a8399, showValue: true },
    ],
  },
  olympusHades: {
    src: `${GAME_ART}/fx/wild-olympus-hades.webm`,
    multiplier: 3,
    width: 176,
    height: 718,
    revealSec: 2.9,
    loopFromSec: 3.2,
    numberSpots: [
      { fromSec: 0.06, toSec: 2.7, box: f(48, 10, 90, 62), plate: 0xc1cac8, showValue: true },
      { fromSec: 0.06, toSec: 2.7, box: f(44, 638, 92, 66), plate: 0x221a22, showValue: false },
      { fromSec: 2.76, toSec: Infinity, box: f(60, 46, 62, 40), plate: 0x827d7e, showValue: true },
    ],
  },
  hadesZeus: {
    src: `${GAME_ART}/fx/wild-hades-zeus.webm`,
    multiplier: 5,
    width: 208,
    height: 834,
    revealSec: 3.0,
    loopFromSec: 3.2,
    numberSpots: [
      { fromSec: 0.3, toSec: 2.5, box: f(59, 14, 90, 59), plate: 0x6a636a, showValue: true },
      { fromSec: 0.3, toSec: 2.5, box: f(40, 740, 110, 75), plate: 0x4c3027, showValue: false },
      { fromSec: 2.88, toSec: Infinity, box: f(74, 53, 61, 41), plate: 0x6d3329, showValue: true },
    ],
  },
  hadesHades: {
    src: `${GAME_ART}/fx/wild-hades-hades.webm`,
    multiplier: 3,
    width: 176,
    height: 716,
    revealSec: 3.1,
    loopFromSec: 3.2,
    numberSpots: [
      { fromSec: 0, toSec: 2.6, box: f(48, 4, 92, 60), plate: 0x3d1d17, showValue: false },
      { fromSec: 0, toSec: 2.7, box: f(50, 644, 88, 68), plate: 0x38231e, showValue: true },
      { fromSec: 3.0, toSec: Infinity, box: f(62, 44, 58, 38), plate: 0xa93f19, showValue: true },
    ],
  },
};

/**
 * Which clip a wild plays: even multipliers show Zeus winning, odd ones Hades winning, in the
 * clip set of the current profile. When the clip's drawn number differs from the real
 * multiplier it's covered and rewritten (`relabel`).
 */
export function wildVideoFor(multiplier: number, profile: Profile): { clip: WildClipId; relabel: boolean } {
  const zeusWins = multiplier % 2 === 0;
  const clip: WildClipId =
    profile === "olympus" ? (zeusWins ? "olympusZeus" : "olympusHades") : zeusWins ? "hadesZeus" : "hadesHades";
  return { clip, relabel: WILD_VIDEOS[clip].multiplier !== multiplier };
}

/** Replacement numbers are drawn this much taller than the clip's own number. */
export const RELABEL_TEXT_SCALE = 1.45;

/** Gold digit sheet (0-9 and x) used to write the replacement multipliers. */
export const DIGIT_SHEET = `${GAME_ART}/fx/digits.png`;
export const DIGIT_FRAMES: Record<string, Frame> = {
  "0": f(283, 20, 66, 83),
  "1": f(376, 135, 19, 82),
  "2": f(273, 136, 58, 81),
  "3": f(209, 20, 43, 83),
  "4": f(439, 132, 61, 84),
  "5": f(185, 141, 53, 79),
  "6": f(93, 138, 61, 84),
  "7": f(14, 268, 57, 81),
  "8": f(374, 20, 56, 83),
  "9": f(9, 150, 60, 85),
  x: f(306, 364, 52, 55),
};

/** Expanded-wild column backing (Olympus stone; Hades uses the same stone tinted). */
export const COLUMN_STONE = `${GAME_ART}/fx/column-stone.png`;
export const COLUMN_BORDER = `${GAME_ART}/fx/column-border.png`;

/** Celebration pieces (shared sheet 572c31e6): light burst behind big-win words and the
 * free-spins panel, the cloud band they sit on, and lightning bolts around them. */
export const CELEBRATION_FX = {
  lightBurst: `${GAME_ART}/fx/light-burst.png`,
  clouds: `${GAME_ART}/fx/clouds.png`,
  bolts: [1, 2, 3, 4].map((n) => `${GAME_ART}/fx/bolt-${n}.png`),
};

/**
 * Win animations played on winning symbols (provided frame folders, packed into sprite sheets by
 * scripts/zeusVsHades-anims.mjs: game/anim/<name>.webp + .json). Symbols without one keep the
 * pulse animation.
 */
export const SYMBOL_ANIMS: Record<Profile, Partial<Record<number, string>>> = {
  olympus: { 1: "olympus-temple", 2: "wild", 4: "pegasus", 5: "eagle", 7: "olympus-chalice" },
  hades: { 1: "hades-temple", 2: "wild", 3: "hades", 4: "cerberus", 7: "hades-chalice" },
};
export const symbolAnimUrl = (name: string, ext: "webp" | "json") => `${GAME_ART}/anim/${name}.${ext}`;

/** Layout of one packed animation sheet (written by scripts/zeusVsHades-anims.mjs). */
export interface SymbolAnimMeta {
  frames: number;
  cols: number;
  frameW: number;
  frameH: number;
  /** The sheet is drawn at this multiple of on-screen size. */
  textureScale: number;
  /** Centre of the symbol in the first frame, in frame pixels (placed on the cell centre). */
  anchorX: number;
  anchorY: number;
  fps: number;
}

/**
 * Olympus win effect behind a winning symbol (art/symbolsLighting.png): two small smoky clouds at
 * the centre with a lightning bolt crackling through them. Rectangles measured from the sheet
 * (padded to keep each bolt's glow). Bolt order: the strike (bottom row) then it fading (top row).
 */
export const SYMBOL_LIGHTNING = {
  src: `${GAME_ART}/fx/symbol-lightning.png`,
  bolts: [
    f(0, 252, 310, 200),
    f(311, 250, 310, 196),
    f(629, 252, 305, 192),
    f(948, 251, 304, 191),
    f(8, 7, 285, 179),
    f(366, 9, 241, 152),
    f(773, 13, 147, 119),
    f(1144, 13, 90, 104),
  ],
  clouds: [f(1270, 34, 165, 155), f(1421, 8, 128, 182)],
};

/**
 * Hades "10" win animation, rebuilt from the original's packed parts (art/10AnimationHades.png).
 * Matches the demo's cycle: the 10 jumps to ~1.3x and flashes, flames burst around it, then it
 * settles and rests before repeating. Rectangles measured from the sheet; `rot` frames were
 * stored sideways by the packer and are turned upright when shown.
 */
export const TEN_HADES = {
  src: `${GAME_ART}/fx/ten-hades.png`,
  fire: [
    [426, 4, 82, 75, 0], [516, 27, 82, 64, 0], [665, 18, 75, 82, 1], [749, 68, 76, 83, 1],
    [833, 75, 83, 75, 0], [923, 74, 82, 74, 0], [1012, 70, 73, 82, 1], [503, 114, 82, 67, 0],
    [641, 159, 72, 82, 1], [726, 159, 75, 82, 1], [810, 162, 82, 71, 0], [899, 163, 82, 70, 0],
    [989, 159, 73, 82, 1], [653, 248, 82, 75, 0], [743, 251, 82, 73, 0], [836, 246, 73, 82, 1],
    [921, 248, 75, 83, 1], [653, 342, 82, 66, 0], [747, 334, 73, 82, 1], [830, 336, 74, 82, 1],
    [913, 343, 82, 71, 0], [1046, 333, 82, 72, 0],
  ].map(([x, y, w, h, rot]) => ({ frame: f(x, y, w, h), rot: rot === 1 })),
  /** Fire burning in the shape of "10" (behind the symbol). */
  fireTen: f(8, 410, 167, 113),
  /** Loop length and phases, in ms (from the demo recording). */
  cycleMs: 2500,
  burstMs: 250,
  burnMs: 650,
  settleMs: 300,
  scale: 1.3,
};

/**
 * Hades letter-fire win animations, by symbol: 10 (TEN_HADES), J and K. Each is the original's
 * packed fire flipbook (frames shaped like the letter) plus a letter-shaped glow burning behind;
 * all use TEN_HADES's cycle (jump + flash, burn inside the letter, settle, rest). Only upright
 * frames are listed for J and K (their sideways copies aren't needed).
 */
const upright = (rects: number[][]) => rects.map(([x, y, w, h]) => ({ frame: f(x, y, w, h), rot: false }));
export const LETTER_FIRE_HADES: Record<number, { src: string; fire: { frame: Frame; rot: boolean }[]; shape: Frame | null }> = {
  12: { src: TEN_HADES.src, fire: TEN_HADES.fire, shape: TEN_HADES.fireTen },
  11: {
    src: `${GAME_ART}/fx/j-hades.png`,
    fire: upright([
      [7, 52, 121, 156], [144, 57, 121, 148], [280, 72, 121, 152], [417, 72, 121, 149], [555, 74, 120, 149],
      [691, 77, 121, 144], [827, 77, 121, 145], [8, 223, 121, 152], [144, 225, 121, 148], [280, 238, 121, 150],
      [418, 238, 121, 152], [554, 239, 121, 152], [692, 238, 121, 152], [828, 240, 121, 149], [964, 242, 121, 148],
    ]),
    shape: f(16, 396, 136, 125),
  },
  10: {
    src: `${GAME_ART}/fx/q-hades.png`,
    fire: upright([
      [5, 142, 147, 141], [162, 139, 146, 144], [319, 138, 147, 143], [476, 140, 147, 144], [632, 137, 149, 148],
      [790, 138, 147, 149], [947, 141, 148, 145], [1103, 139, 149, 148], [1260, 136, 149, 151], [1417, 138, 149, 152],
      [5, 308, 147, 141], [162, 305, 147, 140], [319, 304, 146, 144], [475, 300, 149, 148], [633, 301, 147, 149],
      [790, 303, 147, 145], [946, 301, 149, 147], [1103, 298, 149, 151], [1261, 300, 148, 149], [1417, 299, 149, 152],
    ]),
    shape: f(1576, 9, 146, 117),
  },
  /** Helmet: no sheet of its own — reuses the 10's fire, with a glowing copy of the helmet behind. */
  6: { src: TEN_HADES.src, fire: TEN_HADES.fire, shape: null },
  9: {
    src: `${GAME_ART}/fx/k-hades.png`,
    fire: upright([
      [4, 24, 135, 151], [152, 32, 136, 152], [303, 45, 132, 150], [449, 73, 135, 150], [598, 75, 134, 147],
      [5, 202, 133, 144], [303, 205, 132, 150], [4, 364, 135, 145], [154, 368, 133, 148], [300, 366, 136, 153],
    ]),
    shape: f(152, 209, 124, 136),
  },
};

/**
 * Symbols whose image has decoration sticking out (e.g. flames above the card), as the vertical
 * span [top, bottom] in image pixels of the part that should fill the cell. The rest overflows
 * the cell instead of shrinking the symbol.
 */
export const SYMBOL_BODY_Y: Record<Profile, Partial<Record<number, [number, number]>>> = {
  olympus: {},
  hades: { 3: [43, 231] },
};

/** Scale + vertical offset (as a fraction of image height) to fit a symbol image in a cell. */
export function symbolFit(symbol: number, profile: Profile, texW: number, texH: number, cellW: number, cellH: number) {
  const body = SYMBOL_BODY_Y[profile][symbol];
  const bodyH = body ? body[1] - body[0] : texH;
  const scale = Math.min(cellW / texW, cellH / bodyH);
  // Image-centre offset that puts the body's centre on the cell centre.
  const shiftY = body ? (texH / 2 - (body[0] + body[1]) / 2) * scale : 0;
  return { scale, shiftY };
}

/**
 * Olympus letter win animations (art/<L>AnimationOlympus.png), by symbol. Each sheet holds a
 * coloured glow blob (behind), lightning strands (crackling around) and white light-sweep
 * outlines of the letter (`shine`, flashed over it). Q and the helmet have no sheet of their own
 * and reuse J's glow and lightning, with the symbol's own bright flash instead of a shine.
 * Uses TEN_HADES's cycle timing.
 */
export const LETTER_LIGHTNING_OLYMPUS: Record<number, { src: string; glow: Frame; bolt: Frame; shine: Frame[] }> = {
  8: {
    src: `${GAME_ART}/fx/a-olympus.png`,
    glow: f(38, 177, 124, 124),
    bolt: f(20, 27, 105, 100),
    shine: [f(469, 209, 89, 104), f(571, 211, 111, 102), f(833, 218, 113, 95), f(1089, 226, 114, 88)],
  },
  9: {
    src: `${GAME_ART}/fx/k-olympus.png`,
    glow: f(30, 93, 113, 113),
    bolt: f(191, 74, 101, 155),
    shine: [f(943, 10, 105, 103), f(1064, 9, 105, 104), f(969, 134, 109, 103), f(1094, 134, 101, 108)],
  },
  11: {
    src: `${GAME_ART}/fx/j-olympus.png`,
    glow: f(189, 102, 81, 77),
    bolt: f(14, 56, 104, 155),
    shine: [f(1341, 4, 80, 102)],
  },
  10: { src: `${GAME_ART}/fx/j-olympus.png`, glow: f(189, 102, 81, 77), bolt: f(14, 56, 104, 155), shine: [] },
  6: { src: `${GAME_ART}/fx/j-olympus.png`, glow: f(189, 102, 81, 77), bolt: f(14, 56, 104, 155), shine: [] },
};

/** Big-win words, smallest tier first. */
export const WIN_WORDS = {
  nice: `${GAME_ART}/words/nice.png`,
  mega: `${GAME_ART}/words/mega.png`,
  superb: `${GAME_ART}/words/superb.png`,
  sensational: `${GAME_ART}/words/sensational.png`,
  bar: `${GAME_ART}/words/bar.png`,
};

/** DOM UI pieces. */
export const UI = {
  volatilityBanner: `${GAME_ART}/ui/volatility-banner.png`,
  rodRed: `${GAME_ART}/ui/rod-red.png`,
  buyButton: `${GAME_ART}/ui/buy-button.png`,
  bannerOrange: `${GAME_ART}/ui/banner-orange.png`,
  bannerPurple: `${GAME_ART}/ui/banner-purple.png`,
  rodOrange: `${GAME_ART}/ui/rod-orange.png`,
  rodPurple: `${GAME_ART}/ui/rod-purple.png`,
  ribbonRed: `${GAME_ART}/ui/ribbon-red.png`,
  closeBig: `${GAME_ART}/ui/btn-close-big.png`,
  panelOrange: `${GAME_ART}/ui/panel-orange.png`,
  btnX: `${GAME_ART}/ui/btn-x.png`,
  btnCheck: `${GAME_ART}/ui/btn-check.png`,
  btnGreen: `${GAME_ART}/ui/btn-green.png`,
  spinArrows: `${GAME_ART}/ui/spin-arrows.png`,
  volatilityIcon: {
    olympus: `${GAME_ART}/ui/volatility-olympus.png`,
    hades: `${GAME_ART}/ui/volatility-hades.png`,
  } as Record<Profile, string>,
  chooserBg: `${GAME_ART}/bg/chooser.jpg`,
};
