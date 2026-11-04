import {
  AnimatedSprite,
  Application,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  FillGradient,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
  Ticker,
  VideoSource,
} from "pixi.js";
import { EXPANDING_WILD, REELS, REEL_SETS, ROWS, SCATTER, type Profile, type SpinResult, type WildReel } from "../engine";
import { RELABEL_TEXT_SCALE, REEL_FRAMES, SYMBOL_ANIMS, TEN_HADES, WIN_FRAMES, WILD_VIDEOS, wildVideoFor, type WildVideoSpec } from "../art";
import { Reel } from "./Reel";
import { loadArt, type SceneArt, type SymbolTextures } from "./symbols";
import { easeOutBack, easeOutCubic, tween, wait } from "./tween";

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

/** Board geometry, measured from the original game at 1280x720. */
const CELL_W = 143;
const CELL_H = 109;
export const BOARD_W = REELS * CELL_W;
export const BOARD_H = ROWS * CELL_H;
export const BOARD_X = 285;
export const BOARD_Y = 62;

/** Font used for all in-canvas text (loaded by the React side before the scene starts). */
export const DISPLAY_FONT = "'Lilita One', 'Arial Black', sans-serif";

const MS_PER_CELL = { normal: 48, turbo: 22 };
const MIN_TRAVEL = { normal: 13, turbo: 6 };
const STAGGER = { normal: 4, turbo: 1 };
const ANTICIPATION_EXTRA = 24;

/** Big-win tiers by multiple of the bet, smallest first. */
export const BIG_WIN_TIERS = [
  { word: "nice", x: 10 },
  { word: "mega", x: 25 },
  { word: "superb", x: 50 },
  { word: "sensational", x: 100 },
] as const;

const THEME: Record<Profile, { board: [number, number]; column: number; accent: number; flash: number }> = {
  olympus: { board: [0x0d1d6b, 0x061040], column: 0xffffff, accent: 0x7fe7ff, flash: 0xffffff },
  hades: { board: [0x3a1263, 0x1c0636], column: 0xffb070, accent: 0xff8a3a, flash: 0xff6a2a },
};

/**
 * Where the burning border sits inside each winframe-fire image, as fractions of the image
 * [left, right, top, bottom] (measured from the art; the top is large because the flame rises
 * above the border). Used to wrap the fire exactly around the reel frame on profile switch.
 * Frame 2's border is too faint to measure, so it uses the typical values.
 */
const FIRE_FRAME_INSETS: [number, number, number, number][] = [
  [0.023, 0.032, 0.216, 0.027],
  [0.024, 0.03, 0.21, 0.03],
  [0.024, 0.03, 0.21, 0.025],
  [0.024, 0.032, 0.238, 0.031],
  [0.05, 0.05, 0.168, 0.072],
  [0.023, 0.027, 0.202, 0.025],
  [0.049, 0.052, 0.143, 0.064],
  [0.024, 0.027, 0.191, 0.027],
];

/** In Olympus, A, K, Q and 10 zoom bigger than other symbols when they're in a win (up to +BIG_ZOOM). */
const BIG_ZOOM_SYMBOLS = new Set([8, 9, 10, 12]);
const BIG_ZOOM = 0.25;

/** Glow colour behind each Olympus letter win (matches the sheets' glow blobs). */
const OLYMPUS_LETTER_GLOW: Record<number, number> = { 8: 0xd23ab4, 9: 0xe0302a, 11: 0x2f6bff, 10: 0x2f6bff, 6: 0x2f6bff };

const cellX = (reel: number) => BOARD_X + reel * CELL_W;
const cellCenter = (reel: number, row: number) => ({ x: cellX(reel) + CELL_W / 2, y: BOARD_Y + row * CELL_H + CELL_H / 2 });

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

/** A reel covered by an expanded wild. */
interface WildColumn {
  reel: number;
  multiplier: number;
  container: Container;
  emblem: Sprite;
  idleFx: AnimatedSprite | null;
  embers: Particle[];
  embersLayer: Container;
  /** Set when the column plays a provided full-reel video instead of the drawn column. */
  video: HTMLVideoElement | null;
  /** Relabel patches over the clip's drawn numbers, shown only while that number is on screen. */
  numberPatches: { fromSec: number; toSec: number; node: Container }[];
}

export interface SpinOptions {
  turbo: boolean;
  /** Slow the last reel down when reels 1 and 3 already show a scatter. */
  anticipation: boolean;
  onReelStop?: (reel: number, hasScatter: boolean) => void;
  /** Fires as each expanding wild strikes (for sound). */
  onExpand?: (multiplier: number) => void;
}

/**
 * Everything drawn on the canvas: backgrounds, reel frame + logo, the 5 reels, expanded wild
 * columns, win frames and the big-win words. Game flow and all DOM UI live in ZeusVsHadesGame.tsx.
 */
export class ZeusVsHadesScene {
  private readonly root = new Container();
  private readonly bgLayer = new Container();
  private readonly boardLayer = new Container();
  private readonly reelLayer = new Container();
  private readonly wildLayer = new Container();
  private readonly frameLayer = new Container();
  /** Olympus win lightning, drawn *behind* the winning symbols (between board and reels). */
  private readonly winUnderLayer = new Container();
  /** Symbol win animations (they can overflow their cell), drawn under the win frames. */
  private readonly winAnimLayer = new Container();
  private readonly winLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly bigWinLayer = new Container();
  private readonly reels: Reel[] = [];
  private readonly wildColumns = new Map<number, WildColumn>();
  private readonly bgParticles: Particle[] = [];
  private readonly fxParticles: Particle[] = [];
  private readonly flash: Graphics;
  private profile: Profile;
  private freeSpinsMode = false;
  private alive = true;
  private clock = 0;
  private nextSkyFlashAt = 3000;
  private winToken = 0;
  /** Winning symbols zooming in and out; `grow` set = bigger zoom that only grows (A K Q 10). */
  private pulsing: { sprite: Sprite; base: number; grow?: number }[] = [];
  /** Running Hades "10" win animations, driven from update(). */
  private tenAnims: {
    parts: { fire: { tex: Texture; rot: boolean }[]; fireTen: Texture | null };
    cell: Sprite;
    base: number;
    glow: Sprite;
    fireTen: Sprite;
    fire: Sprite;
    /** Copy of the 10 used as the fire's mask, so the flames burn inside the digits. */
    fireMask: Sprite;
    start: number;
    lastFrame: number;
  }[] = [];
  /** Running Olympus letter-lightning win animations, driven from update(). */
  private olyLetters: {
    cell: Sprite;
    base: number;
    flash: Sprite;
    glow: Graphics;
    glowBase: number;
    bolts: Sprite[];
    shine: Sprite | null;
    shineTex: Texture[];
    start: number;
    nextFlicker: number;
  }[] = [];
  /** Static cell sprites hidden while their win animation plays (restored by clearWins). */
  private hiddenForAnim: Sprite[] = [];
  private skipBigWin: (() => void) | null = null;

  private constructor(
    private readonly app: Application,
    private readonly textures: SymbolTextures,
    private readonly art: SceneArt,
    profile: Profile
  ) {
    this.profile = profile;
    this.root.addChild(
      this.bgLayer,
      this.boardLayer,
      this.winUnderLayer,
      this.reelLayer,
      this.wildLayer,
      this.frameLayer,
      this.winAnimLayer,
      this.winLayer,
      this.fxLayer,
      this.bigWinLayer
    );
    app.stage.addChild(this.root);

    const mask = new Graphics().rect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H).fill(0xffffff);
    this.reelLayer.addChild(mask);
    this.reelLayer.mask = mask;

    const initial = REEL_SETS.olympusCold;
    for (let r = 0; r < REELS; r++) {
      const strip = initial[r];
      const start = (r * 7) % strip.length;
      const reel = new Reel(
        this.textures,
        { cellWidth: CELL_W, cellHeight: CELL_H, symbolFit: 0.98 },
        Array.from({ length: ROWS }, (_, i) => strip[(start + i) % strip.length])
      );
      reel.container.x = cellX(r);
      reel.container.y = BOARD_Y;
      reel.setProfile(profile);
      this.reelLayer.addChild(reel.container);
      this.reels.push(reel);
    }

    this.flash = new Graphics().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(0xffffff);
    this.flash.alpha = 0;
    this.fxLayer.addChild(this.flash);

    this.buildTheme();
    app.ticker.add(this.update);
  }

  static async create(app: Application, profile: Profile): Promise<ZeusVsHadesScene> {
    const { symbols, scene } = await loadArt();
    return new ZeusVsHadesScene(app, symbols, scene, profile);
  }

  private readonly isAlive = () => this.alive;
  private get ticker(): Ticker {
    return this.app.ticker;
  }

  // ------------------------------------------------------------------------------------
  // Theme
  // ------------------------------------------------------------------------------------

  setProfile(profile: Profile) {
    if (profile === this.profile) return;
    this.profile = profile;
    this.clearWins();
    this.clearWildColumns();
    this.reels.forEach((r) => r.setProfile(profile));
    this.buildTheme();
    this.playBoardFrameFx();
  }

  /**
   * Profile switch: the same lightning (Olympus) / fire (Hades) frame used around winning
   * symbols runs around the whole reel frame for a moment, then fades out.
   */
  private playBoardFrameFx() {
    const hades = this.profile === "hades";
    const spec = WIN_FRAMES[this.profile];

    // Outer edge of the reel-frame image as it's drawn (see buildFrame).
    const frameSpec = REEL_FRAMES[this.profile];
    const frameTex = this.art.reelFrames[this.profile];
    const sx = BOARD_W / frameSpec.hole.w;
    const sy = BOARD_H / frameSpec.hole.h;
    const outer = {
      x: BOARD_X - frameSpec.hole.x * sx,
      y: BOARD_Y - frameSpec.hole.y * sy,
      w: frameTex.width * sx,
      h: frameTex.height * sy,
    };
    // Lightning: its border runs close to the image edge, so a slightly oversized image wraps
    // just outside the frame. Fire: each frame's burning border sits at a different inset (and
    // ~20% down, under the flame), so every frame is placed from its own measured border.
    const w = outer.w * 1.07;
    const h = outer.h * 1.1;
    const cx = outer.x + outer.w / 2;
    const cy = outer.y + outer.h / 2;
    // Centre the ~25px fire band on the ~36px metal border, so the frame itself burns.
    const pad = -5;
    const ring = { x: outer.x - pad, y: outer.y - pad, w: outer.w + pad * 2, h: outer.h + pad * 2 };

    const makeFx = () => {
      const fx = new AnimatedSprite(this.art.winFrames[this.profile]);
      const fit = () => {
        if (hades) {
          // Map this frame's border box exactly onto `ring`.
          const [l, r, t, b] = FIRE_FRAME_INSETS[fx.currentFrame] ?? FIRE_FRAME_INSETS[0];
          fx.anchor.set(0);
          fx.width = ring.w / (1 - l - r);
          fx.height = ring.h / (1 - t - b);
          fx.x = ring.x - l * fx.width;
          fx.y = ring.y - t * fx.height;
        } else {
          fx.anchor.set(0.5);
          fx.width = w;
          fx.height = h;
          fx.position.set(cx, cy);
        }
      };
      fit();
      fx.onFrameChange = fit;
      fx.animationSpeed = spec.fps / 60;
      fx.alpha = 0;
      fx.play();
      return fx;
    };
    // Front: the crisp lightning / fire wrapped around the frame.
    const front = makeFx();
    if (!hades) front.blendMode = "add";
    this.fxLayer.addChild(front);
    // Behind the frame: a bigger, blurred copy that makes the whole frame glow.
    const glow = makeFx();
    glow.filters = [new BlurFilter({ strength: 12 })];
    glow.blendMode = "add";
    this.frameLayer.addChildAt(glow, 0);

    this.flash.tint = THEME[this.profile].flash;
    this.flash.alpha = 0.25;
    void tween(this.ticker, 400, (p) => (this.flash.alpha = 0.25 * (1 - p)), undefined, this.isAlive);
    const setAlpha = (a: number) => {
      if (!front.destroyed) front.alpha = a;
      if (!glow.destroyed) glow.alpha = a * 0.8;
    };
    void (async () => {
      // ~1.25s in total: quick fade in, short burn, fade out.
      await tween(this.ticker, 150, setAlpha, undefined, this.isAlive);
      await wait(this.ticker, 800, this.isAlive);
      await tween(this.ticker, 300, (p) => setAlpha(1 - p), undefined, this.isAlive);
      if (!front.destroyed) front.destroy();
      if (!glow.destroyed) glow.destroy();
    })();
  }

  setFreeSpinsMode(on: boolean) {
    if (on === this.freeSpinsMode) return;
    this.freeSpinsMode = on;
    if (!on) this.clearWildColumns();
    this.buildTheme();
  }

  private buildTheme() {
    for (const p of this.bgParticles) p.g.destroy();
    this.bgParticles.length = 0;
    for (const layer of [this.bgLayer, this.boardLayer, this.frameLayer]) {
      layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    }

    if (this.freeSpinsMode) this.buildFreeSpinsBackground();
    else if (this.profile === "olympus") this.buildOlympusBackground();
    else this.buildHadesBackground();

    this.buildBoard();
    this.buildFrame();
  }

  /** Scales a sprite to cover the canvas, centred. */
  private cover(sprite: Sprite) {
    const s = Math.max(CANVAS_WIDTH / sprite.texture.width, CANVAS_HEIGHT / sprite.texture.height);
    sprite.scale.set(s);
    sprite.x = (CANVAS_WIDTH - sprite.width) / 2;
    sprite.y = (CANVAS_HEIGHT - sprite.height) / 2;
    return sprite;
  }

  private buildOlympusBackground() {
    this.bgLayer.addChild(this.cover(new Sprite(this.art.olympusSky)));
    const temple = new Sprite(this.art.olympusTemple);
    temple.scale.set(CANVAS_WIDTH / temple.texture.width);
    temple.y = CANVAS_HEIGHT - temple.height + 18;
    this.bgLayer.addChild(temple);
  }

  private buildHadesBackground() {
    this.bgLayer.addChild(this.cover(new Sprite(this.art.hadesBg)));
  }

  /** Free spins swap the scenery for a stormy sunset sky (blue/purple top, burning orange edges). */
  private buildFreeSpinsBackground() {
    const hades = this.profile === "hades";
    const sky = this.cover(new Sprite(hades ? this.art.hadesBg : this.art.olympusSky));
    sky.tint = hades ? 0x9a5a7a : 0xd9a0ff;
    this.bgLayer.addChild(sky);
    if (hades) {
      // Hades free spins: darkened lava scene with a hot glow from the sides.
      const edges = new FillGradient({
        type: "linear",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        colorStops: [
          { offset: 0, color: "rgba(255,110,20,0.55)" },
          { offset: 0.25, color: "rgba(60,0,40,0.0)" },
          { offset: 0.75, color: "rgba(60,0,40,0.0)" },
          { offset: 1, color: "rgba(255,110,20,0.55)" },
        ],
        textureSpace: "local",
      });
      const glowH = new Graphics().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(edges);
      glowH.blendMode = "screen";
      this.bgLayer.addChild(glowH);
      return;
    }
    const warm = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      colorStops: [
        { offset: 0, color: "rgba(255,200,80,0.95)" },
        { offset: 0.12, color: "rgba(255,120,30,0.7)" },
        { offset: 0.3, color: "rgba(140,50,170,0.2)" },
        { offset: 0.7, color: "rgba(140,50,170,0.2)" },
        { offset: 0.88, color: "rgba(255,120,30,0.7)" },
        { offset: 1, color: "rgba(255,200,80,0.95)" },
      ],
      textureSpace: "local",
    });
    const glow = new Graphics().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(warm);
    glow.blendMode = "screen";
    this.bgLayer.addChild(glow);
  }

  private buildBoard() {
    const [top, bottom] = THEME[this.profile].board;
    const g = new Graphics();
    const bands = 20;
    for (let i = 0; i < bands; i++) {
      g.rect(BOARD_X, BOARD_Y + (BOARD_H / bands) * i, BOARD_W, BOARD_H / bands + 1).fill(lerpColor(top, bottom, i / (bands - 1)));
    }
    // Lighter centre of each reel and a dark seam between reels, as in the original.
    for (let r = 0; r < REELS; r++) {
      g.rect(cellX(r) + 10, BOARD_Y, CELL_W - 20, BOARD_H).fill({ color: 0xffffff, alpha: 0.035 });
      if (r > 0) g.rect(cellX(r) - 2, BOARD_Y, 4, BOARD_H).fill({ color: 0x000000, alpha: 0.45 });
    }
    this.boardLayer.addChild(g);
  }

  private buildFrame() {
    const spec = REEL_FRAMES[this.profile];
    const frame = new Sprite(this.art.reelFrames[this.profile]);
    const sx = BOARD_W / spec.hole.w;
    const sy = BOARD_H / spec.hole.h;
    frame.scale.set(sx, sy);
    frame.x = BOARD_X - spec.hole.x * sx;
    frame.y = BOARD_Y - spec.hole.y * sy;
    this.frameLayer.addChild(frame);

    if (!this.art.logo) return;
    const logo = new Sprite(this.art.logo);
    logo.anchor.set(0.5);
    logo.scale.set(236 / logo.texture.width);
    logo.x = 1155;
    logo.y = 155;
    this.frameLayer.addChild(logo);
  }

  // ------------------------------------------------------------------------------------
  // Spinning
  // ------------------------------------------------------------------------------------

  async spin(result: SpinResult, opts: SpinOptions): Promise<void> {
    this.clearWins();
    // Wild columns not carried into this spin (base game, or a new round) go away.
    const carried = new Set(result.wildReels.filter((w) => !result.expansions.includes(w)).map((w) => w.reel));
    for (const reel of [...this.wildColumns.keys()]) if (!carried.has(reel)) this.removeWildColumn(reel);

    const speed = opts.turbo ? "turbo" : "normal";
    const strips = REEL_SETS[result.reelSet];
    const scatterOn = (reel: number) => result.landed[reel].includes(SCATTER);
    const anticipate = opts.anticipation && scatterOn(0) && scatterOn(2);

    let anticipationGlow: Container | null = null;
    await Promise.all(
      this.reels.map((reel, r) =>
        reel.spin(
          this.ticker,
          {
            strip: strips[r],
            stop: result.stops[r],
            landed: result.landed[r],
            travelCells: MIN_TRAVEL[speed] + r * STAGGER[speed] + (anticipate && r === 4 ? ANTICIPATION_EXTRA : 0),
            msPerCell: MS_PER_CELL[speed],
          },
          this.isAlive,
          () => {
            opts.onReelStop?.(r, scatterOn(r));
            if (anticipate && r === 3) anticipationGlow = this.showAnticipation(4);
            if (r === 4 && anticipationGlow) {
              anticipationGlow.destroy({ children: true });
              anticipationGlow = null;
            }
          }
        )
      )
    );
    if (!this.alive) return;
    for (const w of result.expansions) await this.expandWild(w, opts.turbo, () => opts.onExpand?.(w.multiplier));
  }

  /** Reel 5 lights up with the win-frame animation while it keeps spinning for a possible scatter. */
  private showAnticipation(reel: number): Container {
    const c = new Container();
    const glow = new Graphics().rect(cellX(reel), BOARD_Y, CELL_W, BOARD_H).fill({ color: THEME[this.profile].accent, alpha: 0.18 });
    const fx = new AnimatedSprite(this.art.columnFx[this.profile].slice(4, 9));
    fx.width = CELL_W;
    fx.height = BOARD_H;
    fx.x = cellX(reel);
    fx.y = BOARD_Y;
    fx.blendMode = "add";
    fx.alpha = 0.55;
    fx.animationSpeed = 0.3;
    fx.play();
    c.addChild(glow, fx);
    this.fxLayer.addChild(c);
    return c;
  }

  // ------------------------------------------------------------------------------------
  // Expanding wilds
  // ------------------------------------------------------------------------------------

  private async expandWild(w: WildReel, turbo: boolean, onStrike: () => void) {
    const row = w.row >= 0 ? w.row : Math.floor(ROWS / 2);
    const cell = this.reels[w.reel].cellSprite(row);
    const base = this.reels[w.reel].baseScale(cell);
    const speed = turbo ? 0.55 : 1;

    // 1. The symbol swells.
    await tween(this.ticker, 280 * speed, (p) => cell.scale.set(base * (1 + 0.3 * Math.sin(p * Math.PI))), easeOutCubic, this.isAlive);
    if (!this.alive) return;
    onStrike();

    const pick = wildVideoFor(w.multiplier, this.profile);
    const videoUrl = this.art.wildVideos[pick.clip];
    if (videoUrl) {
      await this.playVideoWild(w, videoUrl, WILD_VIDEOS[pick.clip], pick.relabel, turbo);
      return;
    }

    // 2. Full-reel lightning (Olympus) / fire (Hades) burst; the column appears behind it.
    const fx = new AnimatedSprite(this.art.columnFx[this.profile]);
    fx.width = CELL_W + 30;
    fx.height = BOARD_H + 40;
    fx.x = cellX(w.reel) - 15;
    fx.y = BOARD_Y - 20;
    fx.blendMode = "add";
    fx.loop = false;
    fx.animationSpeed = 0.42 / speed;
    this.fxLayer.addChild(fx);
    const done = new Promise<void>((resolve) => {
      fx.onComplete = () => {
        fx.destroy();
        resolve();
      };
    });
    fx.play();
    this.flash.tint = THEME[this.profile].flash;
    this.flash.alpha = 0.3;
    void tween(this.ticker, 300 * speed, (p) => (this.flash.alpha = 0.3 * (1 - p)), undefined, this.isAlive);

    await wait(this.ticker, 140 * speed, this.isAlive);
    if (!this.alive) return;
    const col = this.createWildColumn(w.reel, w.multiplier);
    col.container.alpha = 0;
    await tween(this.ticker, 260 * speed, (p) => (col.container.alpha = p), undefined, this.isAlive);
    await done;
    if (!this.alive) return;

    // 3. The multiplier pops in.
    await this.popMultiplier(col, speed);
  }

  /**
   * Provided full-reel animation (e.g. Zeus defeating Hades, ending on "WILD 3x"). The multiplier
   * is part of the artwork, so no label is added. Resolves once "WILD Nx" is showing; the clip
   * then finishes and its last part loops while the wild stays on the reel.
   */
  private async playVideoWild(w: WildReel, url: string, spec: WildVideoSpec, relabel: boolean, turbo: boolean) {
    this.removeWildColumn(w.reel);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.playbackRate = turbo ? 1.8 : 1;
    video.addEventListener("ended", () => {
      video.currentTime = spec.loopFromSec;
      void video.play().catch(() => undefined);
    });
    // The texture only gets its real size once the first frame is decoded; size the sprite after.
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) return resolve();
      const timer = window.setTimeout(resolve, 3000);
      video.addEventListener("loadeddata", () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
      video.load();
    });
    if (!this.alive) return;
    const source = new VideoSource({ resource: video, autoPlay: false, muted: true, playsinline: true, updateFPS: 30 });

    const container = new Container();
    container.x = cellX(w.reel);
    container.y = BOARD_Y;
    const sprite = new Sprite(new Texture({ source }));
    sprite.width = CELL_W;
    sprite.height = BOARD_H;
    // No border here: the clip has its own edge, and the border would cover its "WILD Nx" title.
    const embersLayer = new Container();
    const numberPatches = relabel ? this.buildNumberPatches(spec, w.multiplier) : [];
    container.addChild(sprite, ...numberPatches.map((p) => p.node), embersLayer);
    this.wildLayer.addChild(container);
    this.wildColumns.set(w.reel, {
      reel: w.reel,
      multiplier: w.multiplier,
      container,
      emblem: sprite,
      idleFx: null,
      embers: [],
      embersLayer,
      video,
      numberPatches,
    });

    await video.play().catch(() => undefined);
    // Wait (in video time) until "WILD Nx" is on screen; give up after a generous real-time cap
    // so a stalled video can never freeze the round.
    const startedAt = performance.now();
    const capMs = ((spec.revealSec + 2) * 1000) / video.playbackRate;
    while (this.alive && video.currentTime < spec.revealSec && !video.ended && performance.now() - startedAt < capMs) {
      await wait(this.ticker, 50, this.isAlive);
    }
  }

  /**
   * Covers each number drawn into a reused clip with a soft patch in the surrounding colour and,
   * where the clip shows the multiplier, writes the real one in the game's gold digits. Built in
   * video pixels, then scaled with the clip to the reel.
   */
  private buildNumberPatches(spec: WildVideoSpec, multiplier: number) {
    const sx = CELL_W / spec.width;
    const sy = BOARD_H / spec.height;
    return spec.numberSpots.map((spot) => {
      const node = new Container();
      node.scale.set(sx, sy);
      node.visible = false;
      const { x, y, w, h } = spot.box;

      // The new number, sized to the drawn one's height (wider values may overhang the box).
      const label = new Container();
      if (spot.showValue) {
        let cursor = 0;
        for (const ch of `${multiplier}x`) {
          const glyph = new Sprite(this.art.digits[ch]);
          const scale = (h * RELABEL_TEXT_SCALE * (ch === "x" ? 0.66 : 1)) / 84;
          glyph.scale.set(scale);
          glyph.x = cursor;
          glyph.y = ch === "x" ? h * RELABEL_TEXT_SCALE * 0.3 : 0;
          cursor += glyph.width - 2;
          label.addChild(glyph);
        }
        const maxW = spec.width - 8;
        if (label.width > maxW) label.scale.set(maxW / label.width);
        label.x = x + w / 2 - label.width / 2;
        label.y = y + h / 2 - label.height / 2;
      }

      // The patch must hide the original number and sit behind the (larger) new one.
      const plateW = Math.max(w, label.width) + 14;
      const plateH = Math.max(h, label.height) + 10;
      const plate = new Graphics()
        .roundRect(x + w / 2 - plateW / 2, y + h / 2 - plateH / 2, plateW, plateH, Math.min(plateH, plateW) / 2)
        .fill(spot.plate);
      plate.filters = [new BlurFilter({ strength: 6, quality: 3 })];
      node.addChild(plate, label);
      return { fromSec: spot.fromSec, toSec: spot.toSec, node };
    });
  }

  private createWildColumn(reel: number, multiplier: number): WildColumn {
    this.removeWildColumn(reel);
    const container = new Container();
    container.x = cellX(reel);
    container.y = BOARD_Y;

    // Olympus: the provided cracked blue stone. Hades: a dark crimson column (the stone art is
    // blue and doesn't tint to red cleanly).
    let stone: Container;
    if (this.profile === "olympus") {
      stone = new Sprite(this.art.columnStone);
      stone.width = CELL_W;
      stone.height = BOARD_H;
    } else {
      const fill = new FillGradient({
        type: "linear",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        colorStops: [
          { offset: 0, color: 0x2a0204 },
          { offset: 0.5, color: 0x8a1408 },
          { offset: 1, color: 0x2a0204 },
        ],
        textureSpace: "local",
      });
      stone = new Graphics().roundRect(0, 0, CELL_W, BOARD_H, 8).fill(fill);
    }
    const border = new Sprite(this.art.columnBorder);
    border.width = CELL_W;
    border.height = BOARD_H;
    border.tint = THEME[this.profile].column;

    // Looping, faint version of the expansion burst keeps the column alive.
    const idleFx = new AnimatedSprite(this.art.columnFx[this.profile].slice(3, 9));
    idleFx.width = CELL_W;
    idleFx.height = BOARD_H;
    idleFx.blendMode = "add";
    idleFx.alpha = this.profile === "hades" ? 0.5 : 0.35;
    idleFx.animationSpeed = 0.18;
    idleFx.play();

    const emblem = new Sprite(this.textures.get(EXPANDING_WILD, this.profile));
    emblem.anchor.set(0.5);
    emblem.scale.set((CELL_W * 0.95) / emblem.texture.width);
    emblem.x = CELL_W / 2;
    emblem.y = BOARD_H / 2;

    const embersLayer = new Container();
    container.addChild(stone, idleFx, emblem, border, embersLayer);
    this.wildLayer.addChild(container);
    const col: WildColumn = { reel, multiplier, container, emblem, idleFx, embers: [], embersLayer, video: null, numberPatches: [] };
    this.wildColumns.set(reel, col);
    return col;
  }

  /** "WILD" + multiplier at the top of the column, as in the original. */
  private async popMultiplier(col: WildColumn, speed: number) {
    const label = new Container();
    const wild = new Text({ text: "WILD", style: goldStyle(26) });
    const mult = new Text({ text: `${col.multiplier}x`, style: goldStyle(col.multiplier >= 100 ? 34 : 40) });
    wild.anchor.set(0.5, 0);
    mult.anchor.set(0.5, 0);
    mult.y = 24;
    label.addChild(wild, mult);
    label.x = CELL_W / 2;
    label.y = 4;
    label.scale.set(0);
    col.container.addChild(label);
    await tween(this.ticker, 380 * speed, (p) => label.scale.set(p), easeOutBack, this.isAlive);
  }

  private removeWildColumn(reel: number) {
    const col = this.wildColumns.get(reel);
    if (!col) return;
    if (col.video) {
      // Release the decoder and the video texture (sprites don't own their textures).
      col.video.pause();
      col.video.removeAttribute("src");
      col.video.load();
      col.emblem.texture.destroy(true);
    }
    col.container.destroy({ children: true });
    this.wildColumns.delete(reel);
  }

  clearWildColumns() {
    for (const reel of [...this.wildColumns.keys()]) this.removeWildColumn(reel);
  }

  // ------------------------------------------------------------------------------------
  // Wins
  // ------------------------------------------------------------------------------------

  /** Scatters that triggered free spins pulse with the win frame. */
  async presentScatters(cells: [number, number][]) {
    this.clearWins();
    const token = ++this.winToken;
    for (const [r, row] of cells) this.addWinFrame(r, row);
    await wait(this.ticker, 1800, this.isAlive);
    if (token === this.winToken) this.clearWins();
  }

  /**
   * Winning symbols get the animated win frame and pulse (no paylines are drawn, as in the
   * original). Resolves after the first showing; the animation keeps running until clearWins().
   */
  async presentWins(result: SpinResult, turbo: boolean): Promise<void> {
    this.clearWins();
    if (result.lineWins.length === 0) return;
    this.winToken++;
    const wildReels = new Set(result.wildReels.map((w) => w.reel));
    const cells = new Set<string>();
    for (const w of result.lineWins) for (const [r, row] of w.cells) cells.add(`${r}:${row}`);
    for (const key of cells) {
      const [r, row] = key.split(":").map(Number);
      if (wildReels.has(r)) continue;
      this.addWinFrame(r, row);
    }
    for (const col of this.wildColumns.values()) {
      if (col.video) continue;
      if (result.lineWins.some((w) => w.cells.some(([r]) => r === col.reel))) this.pulsing.push({ sprite: col.emblem, base: col.emblem.scale.x });
    }
    await wait(this.ticker, turbo ? 600 : 1300, this.isAlive);
  }

  private addWinFrame(reel: number, row: number) {
    const s = this.reels[reel].cellSprite(row);
    // Symbols with a provided win animation play it in place of the static art, with no
    // lightning/fire frame around them; the rest pulse inside the frame.
    if (this.playSymbolAnim(reel, row, s)) return;
    if (this.profile === "hades" && this.playTenHades(reel, row, s)) return;
    if (this.profile === "olympus" && this.playOlympusLetter(reel, row, s)) return;
    // Keeps zooming in and out (update()) until the next spin clears the win.
    const sym = this.reels[reel].symbols[row];
    this.pulsing.push({ sprite: s, base: this.reels[reel].baseScale(s), grow: this.profile === "olympus" && BIG_ZOOM_SYMBOLS.has(sym) ? BIG_ZOOM : undefined });
    // Hades: no frame around winning symbols, they just zoom.
    if (this.profile === "hades") return;
    const olympus = this.profile === "olympus";
    if (olympus) {
      // Olympus: small smoky clouds at the symbol's centre, behind it, with a lightning bolt
      // crackling through them (no frame).
      const cc = cellCenter(reel, row);
      const fx = new Container();
      fx.position.set(cc.x, cc.y);
      const { bolts, clouds } = this.art.symbolLightning;
      clouds.forEach((tex, i) => {
        const puff = new Sprite(tex);
        puff.anchor.set(0.5);
        puff.scale.set((CELL_W * 0.42) / tex.width);
        puff.x = (i === 0 ? -1 : 1) * CELL_W * 0.13;
        puff.alpha = 0.9;
        fx.addChild(puff);
      });
      const bolt = new AnimatedSprite(bolts);
      bolt.anchor.set(0.5);
      bolt.scale.set((CELL_W * 0.85) / bolts[0].width);
      if (Math.random() < 0.5) bolt.scale.x *= -1;
      bolt.blendMode = "add";
      bolt.animationSpeed = 16 / 60;
      bolt.gotoAndPlay(Math.floor(Math.random() * bolts.length));
      fx.addChild(bolt);
      this.winUnderLayer.addChild(fx);
      return;
    }
    const spec = WIN_FRAMES[this.profile];
    const textures = this.art.winFrames[this.profile];
    const frame = new AnimatedSprite(textures);
    frame.anchor.set(0.5);
    // Random start (and, for lightning, a random mirror) so neighbouring frames don't flicker in lockstep.
    const flip = olympus && Math.random() < 0.5 ? -1 : 1;
    const fit = () => {
      frame.width = CELL_W * spec.scaleX;
      frame.height = CELL_H * spec.scaleY;
      frame.scale.x *= flip;
    };
    frame.gotoAndPlay(Math.floor(Math.random() * textures.length));
    fit();
    frame.onFrameChange = fit;
    const c = cellCenter(reel, row);
    frame.x = c.x;
    frame.y = c.y - CELL_H * spec.liftY;
    frame.animationSpeed = spec.fps / 60;
    // Additive blend makes the thin lightning strokes glow.
    if (olympus) frame.blendMode = "add";
    this.winLayer.addChild(frame);
  }

  /**
   * Hades "10" win, as in the original: every TEN_HADES.cycleMs the 10 jumps to ~1.3x and flashes
   * bright, flames burst around it (fire flipbook) with a fire-shaped "10" burning behind, then it
   * settles back and rests. Runs until clearWins(). Returns false if the parts didn't load.
   */
  private playTenHades(reel: number, row: number, cell: Sprite): boolean {
    const parts = this.art.letterFire[this.reels[reel].symbols[row]];
    if (!parts) return false;
    const c = cellCenter(reel, row);

    // Shaped glow burning behind: the sheet's fire-letter, or (no shape, e.g. helmet) a blurred
    // orange copy of the symbol itself.
    const fireTen = new Sprite(parts.fireTen ?? cell.texture);
    fireTen.anchor.set(0.5);
    if (parts.fireTen) fireTen.scale.set((CELL_W * 1.15) / parts.fireTen.width);
    else {
      fireTen.scale.set(this.reels[reel].baseScale(cell) * 1.12);
      fireTen.tint = 0xff6a10;
      fireTen.filters = [new BlurFilter({ strength: 8 })];
    }
    fireTen.position.set(c.x, c.y);
    fireTen.blendMode = "add";
    fireTen.alpha = 0;
    this.winUnderLayer.addChild(fireTen);

    // Bright copy of the symbol on top: additive, so the 10 flashes yellow-white.
    const glow = new Sprite(cell.texture);
    glow.anchor.set(0.5);
    glow.position.set(c.x, c.y);
    glow.blendMode = "add";
    glow.alpha = 0;
    this.winAnimLayer.addChild(glow);

    // Flames burning inside the digits: the fire flipbook clipped to the 10's own shape.
    const fireMask = new Sprite(cell.texture);
    fireMask.anchor.set(0.5);
    fireMask.position.set(c.x, c.y);
    this.winAnimLayer.addChild(fireMask);
    const fire = new Sprite(parts.fire[0].tex);
    fire.anchor.set(0.5);
    fire.position.set(c.x, c.y);
    fire.alpha = 0;
    fire.mask = fireMask;
    this.winAnimLayer.addChild(fire);

    this.tenAnims.push({ parts, cell, base: this.reels[reel].baseScale(cell), glow, fireTen, fire, fireMask, start: this.clock, lastFrame: -1 });
    return true;
  }

  /**
   * Olympus letter win (A, K, J, Q, helmet): a coloured glow pulses behind, lightning strands
   * crackle around, and on TEN_HADES's cycle the symbol jumps up and flashes while the white
   * light-sweep outline runs over it. Runs until clearWins(). False if the parts didn't load.
   */
  private playOlympusLetter(reel: number, row: number, cell: Sprite): boolean {
    const parts = this.art.letterLightning[this.reels[reel].symbols[row]];
    if (!parts) return false;
    const c = cellCenter(reel, row);
    // Soft round glow in the letter's colour (the sheet's glow blob is cut off at its crop edge).
    const color = OLYMPUS_LETTER_GLOW[this.reels[reel].symbols[row]] ?? 0x3a7aff;
    const glow = new Graphics().circle(0, 0, CELL_W * 0.6).fill(
      new FillGradient({
        type: "radial",
        center: { x: 0.5, y: 0.5 },
        innerRadius: 0,
        outerCenter: { x: 0.5, y: 0.5 },
        outerRadius: 0.5,
        colorStops: [
          { offset: 0, color: `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},0.75)` },
          { offset: 1, color: `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},0)` },
        ],
        textureSpace: "local",
      })
    );
    const glowBase = 1;
    glow.scale.set(glowBase);
    glow.position.set(c.x, c.y);
    glow.blendMode = "add";
    this.winUnderLayer.addChild(glow);
    // Clean, padded bolts (the letter sheets' own strands are cut off at their crop edges).
    const boltTex = this.art.symbolLightning.bolts;
    const bolts = [0, 1].map((i) => {
      const tex = boltTex[i % 4];
      const b = new Sprite(tex);
      b.anchor.set(0.5);
      b.scale.set((CELL_W * 0.8) / tex.width);
      b.position.set(c.x + (i === 0 ? -1 : 1) * CELL_W * 0.32, c.y);
      b.blendMode = "add";
      b.visible = false;
      this.winUnderLayer.addChild(b);
      return b;
    });
    const flash = new Sprite(cell.texture);
    flash.anchor.set(0.5);
    flash.position.set(c.x, c.y);
    flash.blendMode = "add";
    flash.alpha = 0;
    this.winAnimLayer.addChild(flash);
    let shine: Sprite | null = null;
    if (parts.shine.length) {
      shine = new Sprite(parts.shine[0]);
      shine.anchor.set(0.5);
      shine.position.set(c.x, c.y);
      shine.blendMode = "add";
      shine.alpha = 0;
      this.winAnimLayer.addChild(shine);
    }
    this.olyLetters.push({
      cell,
      base: this.reels[reel].baseScale(cell),
      flash,
      glow,
      glowBase,
      bolts,
      shine,
      shineTex: parts.shine,
      start: this.clock,
      nextFlicker: 0,
    });
    return true;
  }

  private animateOlympusLetters() {
    const { cycleMs, burstMs, burnMs, settleMs, scale } = TEN_HADES;
    for (const t of this.olyLetters) {
      if (t.cell.destroyed) continue;
      const e = (this.clock - t.start) % cycleMs;
      let k: number;
      if (e < burstMs) k = easeOutBack(e / burstMs);
      else if (e < burstMs + burnMs) k = 1;
      else if (e < burstMs + burnMs + settleMs) k = 1 - easeOutCubic((e - burstMs - burnMs) / settleMs);
      else k = 0;
      const sc = t.base * (1 + (scale - 1) * k);
      t.cell.scale.set(sc);
      t.flash.scale.set(sc);
      t.flash.alpha = e < burstMs ? e / burstMs : e < burstMs + burnMs ? 0.8 * (1 - (e - burstMs) / burnMs) : 0;
      t.glow.scale.set(t.glowBase * (1 + 0.25 * k));
      t.glow.alpha = 0.55 + 0.45 * k;
      if (t.shine) {
        // The light sweep runs once per cycle across the burst + burn.
        const sweep = burstMs + burnMs;
        if (e < sweep) {
          const idx = Math.min(t.shineTex.length - 1, Math.floor((e / sweep) * t.shineTex.length));
          t.shine.texture = t.shineTex[idx];
          t.shine.scale.set((t.cell.height * 0.92) / t.shineTex[idx].height);
          t.shine.alpha = Math.sin((e / sweep) * Math.PI);
        } else t.shine.alpha = 0;
      }
      if (this.clock >= t.nextFlicker) {
        t.nextFlicker = this.clock + 80 + Math.random() * 140;
        for (const b of t.bolts) {
          b.visible = Math.random() < (k > 0 ? 0.85 : 0.4);
          b.texture = this.art.symbolLightning.bolts[Math.floor(Math.random() * 4)];
          b.scale.x = Math.abs(b.scale.x) * (Math.random() < 0.5 ? -1 : 1);
          b.rotation = (Math.random() - 0.5) * 1.2 + Math.PI / 2;
        }
      }
    }
  }

  private animateTenHades() {
    const { cycleMs, burstMs, burnMs, settleMs, scale } = TEN_HADES;
    const fireSize = CELL_W * 1.25;
    for (const t of this.tenAnims) {
      if (t.cell.destroyed) continue;
      const parts = t.parts;
      const e = (this.clock - t.start) % cycleMs;
      // Symbol scale: up (burst), hold (burn), back down (settle), rest.
      let k: number;
      if (e < burstMs) k = easeOutBack(e / burstMs);
      else if (e < burstMs + burnMs) k = 1;
      else if (e < burstMs + burnMs + settleMs) k = 1 - easeOutCubic((e - burstMs - burnMs) / settleMs);
      else k = 0;
      const sc = t.base * (1 + (scale - 1) * k);
      t.cell.scale.set(sc);
      t.glow.scale.set(sc);
      t.fireMask.scale.set(sc);

      // Flash: bright at the burst, fading through the burn.
      t.glow.alpha = e < burstMs ? e / burstMs : e < burstMs + burnMs ? 1 - (e - burstMs) / burnMs : 0;

      // Flames: flipbook through the burst + burn, fading out while settling.
      const fireEnd = burstMs + burnMs + settleMs;
      if (e < fireEnd) {
        const idx = Math.min(parts.fire.length - 1, Math.floor((e / fireEnd) * parts.fire.length));
        if (idx !== t.lastFrame) {
          t.lastFrame = idx;
          const fr = parts.fire[idx];
          t.fire.texture = fr.tex;
          t.fire.rotation = fr.rot ? -Math.PI / 2 : 0;
          const w = fr.rot ? fr.tex.height : fr.tex.width;
          t.fire.scale.set(fireSize / w);
        }
        const fade = e < burstMs ? e / burstMs : e > burstMs + burnMs ? 1 - (e - burstMs - burnMs) / settleMs : 1;
        t.fire.alpha = 0.85 * fade;
        t.fireTen.alpha = 0.75 * fade;
      } else {
        t.fire.alpha = 0;
        t.fireTen.alpha = 0;
        t.lastFrame = -1;
      }
    }
  }

  /**
   * Plays the symbol's win animation over its cell, looping until clearWins(). The animation's
   * first frame lines up with the static symbol (same centre and size), so the swap is seamless.
   * Returns false when the symbol has no animation (or it failed to load).
   */
  private playSymbolAnim(reel: number, row: number, cell: Sprite): boolean {
    const name = SYMBOL_ANIMS[this.profile][this.reels[reel].symbols[row]];
    const anim = name ? this.art.symbolAnims[name] : undefined;
    if (!anim) return false;
    const { frames, meta } = anim;
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(meta.anchorX / meta.frameW, meta.anchorY / meta.frameH);
    // The sheet is drawn to match a whole-image fit of the symbol; if the reel fits this symbol
    // by its body instead (SYMBOL_BODY_Y), scale and place the animation to match the reel.
    const tex = cell.texture;
    const wholeFit = Math.min(CELL_W / tex.width, CELL_H / tex.height) * 0.98;
    sprite.scale.set((1 / meta.textureScale) * (this.reels[reel].baseScale(cell) / wholeFit));
    const p = cell.getGlobalPosition();
    sprite.position.set(p.x, p.y);
    sprite.animationSpeed = meta.fps / 60;
    sprite.play();
    this.winAnimLayer.addChild(sprite);
    cell.visible = false;
    this.hiddenForAnim.push(cell);
    return true;
  }

  clearWins() {
    this.winToken++;
    for (const t of this.tenAnims) if (!t.cell.destroyed) t.cell.scale.set(t.base);
    for (const t of this.olyLetters) if (!t.cell.destroyed) t.cell.scale.set(t.base);
    this.olyLetters = [];
    this.tenAnims = [];
    this.winAnimLayer.removeChildren().forEach((c) => c.destroy());
    this.winUnderLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const s of this.hiddenForAnim) if (!s.destroyed) s.visible = true;
    this.hiddenForAnim = [];
    this.winLayer.removeChildren().forEach((c) => c.destroy());
    for (const p of this.pulsing) if (!p.sprite.destroyed) p.sprite.scale.set(p.base);
    this.pulsing = [];
  }

  /**
   * Big-win celebration over the board: the amount counts up from 0 while the word climbs
   * through NICE / MEGA / SUPERB / SENSATIONAL as each threshold is passed. Resolves when done
   * or skipped (skipBigWinCelebration).
   */
  async showBigWin(amount: number, bet: number, format: (n: number) => string, onTier?: (tier: number) => void): Promise<void> {
    const finalTier = BIG_WIN_TIERS.reduce((t, tier, i) => (amount >= bet * tier.x ? i : t), -1);
    if (finalTier < 0) return;

    const layer = new Container();
    const dim = new Graphics().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill({ color: 0x000000, alpha: 0.55 });
    const rays = new Graphics();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      rays.moveTo(0, 0).lineTo(Math.cos(a) * 900, Math.sin(a) * 900).lineTo(Math.cos(a + 0.09) * 900, Math.sin(a + 0.09) * 900).closePath();
    }
    rays.fill({ color: THEME[this.profile].accent, alpha: 0.08 });
    rays.x = CANVAS_WIDTH / 2;
    rays.y = 300;
    const hades = this.profile === "hades";
    const cx = CANVAS_WIDTH / 2;

    // The bolt art is cyan; for Hades rotate its hue to fire orange (tinting would turn it green).
    const fireHue = new ColorMatrixFilter();
    fireHue.hue(-150, false);

    // Lightning bolts flickering around the word.
    const bolts = this.art.bolts.map((tex, i) => {
      const b = new Sprite(tex);
      b.anchor.set(0.5);
      b.scale.set(1.1);
      b.blendMode = "add";
      if (hades) b.filters = [fireHue];
      b.x = cx + (i % 2 === 0 ? -1 : 1) * (150 + i * 25);
      b.y = 200 + i * 45;
      b.rotation = (i % 2 === 0 ? -1 : 1) * 0.5;
      b.visible = false;
      return b;
    });

    const word = new Sprite();
    word.anchor.set(0.5);
    word.x = cx;
    word.y = 175;

    // Temple (the scatter art) above the amount bar.
    const temple = new Sprite(this.textures.get(SCATTER, this.profile));
    temple.anchor.set(0.5, 1);
    temple.scale.set(230 / temple.texture.width);
    temple.x = cx;
    temple.y = 395;
    const bar = new Sprite(this.art.words.bar);
    bar.anchor.set(0.5);
    bar.scale.set(500 / bar.texture.width);
    bar.x = cx;
    bar.y = 440;
    const value = new Text({ text: format(0), style: goldStyle(56) });
    value.anchor.set(0.5);
    value.x = cx;
    value.y = 448;
    // Full-screen stone wall (clouds along its bottom) behind everything; it zooms out into place.
    const wall = this.buildStoneWall();
    wall.scale.set(1.35);
    layer.addChild(dim, wall, rays, ...bolts, temple, word, bar, value);
    layer.alpha = 0;
    void tween(this.ticker, 220, (p) => (layer.alpha = p), undefined, this.isAlive);
    void tween(this.ticker, 650, (p) => wall.scale.set(1.35 - 0.35 * p), easeOutCubic, this.isAlive);
    this.bigWinLayer.addChild(layer);

    let skipped = false;
    this.skipBigWin = () => (skipped = true);
    const totalMs = 1600 + finalTier * 1500;
    let shownTier = -1;
    const setTier = (t: number) => {
      shownTier = t;
      const tex = this.art.words[BIG_WIN_TIERS[t].word];
      word.texture = tex;
      const base = Math.min(760 / tex.width, 190 / tex.height);
      onTier?.(t);
      void tween(this.ticker, 350, (p) => word.scale.set(base * (0.4 + 0.6 * p)), easeOutBack, this.isAlive);
    };

    let elapsed = 0;
    await new Promise<void>((resolve) => {
      const step = (t: Ticker) => {
        if (!this.alive) {
          this.ticker.remove(step);
          resolve();
          return;
        }
        elapsed += t.deltaMS;
        rays.rotation += t.deltaMS * 0.0002;
        if (Math.random() < t.deltaMS / 90) for (const b of bolts) b.visible = Math.random() < 0.45;
        const p = skipped ? 1 : Math.min(1, elapsed / totalMs);
        const current = amount * easeOutCubic(p);
        value.text = format(current);
        const tier = BIG_WIN_TIERS.reduce((acc, tierDef, i) => (current >= bet * tierDef.x ? i : acc), 0);
        if (tier !== shownTier) setTier(Math.min(tier, finalTier));
        if (p >= 1) {
          this.ticker.remove(step);
          resolve();
        }
      };
      this.ticker.add(step);
    });
    if (this.alive) {
      skipped = false;
      // Hold the final value, then fade out (a click skips the hold too).
      for (let held = 0; held < 2200 && !skipped && this.alive; held += 100) await wait(this.ticker, 100, this.isAlive);
      await tween(this.ticker, 300, (p) => (layer.alpha = 1 - p), undefined, this.isAlive);
    }
    this.skipBigWin = null;
    if (!layer.destroyed) layer.destroy({ children: true });
  }

  /**
   * Full-screen stone wall (the cracked-stone art) with a cloud band along the bottom, centred
   * on its pivot so it can be zoomed. Olympus keeps the blue stone; Hades shifts it to fire tones.
   */
  private buildStoneWall(): Container {
    const wall = new Container();
    wall.pivot.set(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    wall.position.set(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

    const stone = new Sprite(this.art.columnStone);
    stone.width = CANVAS_WIDTH;
    stone.height = CANVAS_HEIGHT;
    const shade = new Graphics()
      .rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      .fill(
        new FillGradient({
          type: "radial",
          center: { x: 0.5, y: 0.45 },
          innerRadius: 0,
          outerCenter: { x: 0.5, y: 0.45 },
          outerRadius: 0.75,
          colorStops: [
            { offset: 0, color: "rgba(0,0,0,0)" },
            { offset: 1, color: "rgba(0,0,0,0.6)" },
          ],
          textureSpace: "local",
        })
      );
    wall.addChild(stone, shade);

    const clouds = new Container();
    const band = (x: number, y: number, w: number, h: number, rotation: number) => {
      const c = new Sprite(this.art.clouds);
      c.anchor.set(0.5);
      c.width = w;
      c.height = h;
      c.rotation = rotation;
      c.position.set(x, y);
      clouds.addChild(c);
    };
    band(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40, CANVAS_WIDTH * 1.25, 240, 0); // bottom
    wall.addChild(clouds);

    if (this.profile === "hades") {
      // Grey the blue stone, then wash it fire red (hue-rotating it comes out tan).
      const grey = new ColorMatrixFilter();
      grey.desaturate();
      stone.filters = [grey];
      stone.tint = 0xff6a3c;
      const smoke = new ColorMatrixFilter();
      smoke.sepia(false);
      const tone = new ColorMatrixFilter();
      tone.brightness(0.6, false);
      clouds.filters = [smoke, tone];
    }
    return wall;
  }

  /** Skips the big-win count-up (first call) or its final hold (second call). */
  skipBigWinCelebration() {
    this.skipBigWin?.();
  }

  // ------------------------------------------------------------------------------------
  // Per-frame animation
  // ------------------------------------------------------------------------------------

  private readonly update = (ticker: Ticker) => {
    if (!this.alive) return;
    const dt = ticker.deltaMS;
    this.clock += dt;

    if (this.profile === "olympus" || this.freeSpinsMode) {
      if (this.clock > this.nextSkyFlashAt) {
        this.nextSkyFlashAt = this.clock + 4000 + Math.random() * 6000;
        this.flash.tint = 0xcfefff;
        this.flash.alpha = 0.1;
      }
    }
    // Rising background particles: fire embers in Hades, electric sparks in Olympus.
    if (this.bgParticles.length < 60 && Math.random() < dt / 45) {
      const r = 1.5 + Math.random() * 2.5;
      let g: Graphics;
      if (this.profile === "hades") {
        g = new Graphics().circle(0, 0, r).fill(Math.random() < 0.5 ? 0xff8a3a : 0xffd23f);
      } else {
        // Soft blue halo with a bright core, added on top so it glows against the sky.
        g = new Graphics()
          .circle(0, 0, r * 2.4)
          .fill({ color: 0x5fd0ff, alpha: 0.25 })
          .circle(0, 0, r)
          .fill(Math.random() < 0.5 ? 0xbff4ff : 0xffffff);
        g.blendMode = "add";
      }
      g.x = Math.random() * CANVAS_WIDTH;
      g.y = CANVAS_HEIGHT + 10;
      this.bgLayer.addChild(g);
      this.bgParticles.push({ g, vx: (Math.random() - 0.5) * 0.03, vy: -(0.04 + Math.random() * 0.08), life: 0, maxLife: 9000 });
    }
    if (this.flash.alpha > 0 && this.flash.alpha <= 0.1) this.flash.alpha = Math.max(0, this.flash.alpha - dt / 900);

    stepParticles(this.bgParticles, dt, false);
    stepParticles(this.fxParticles, dt, true);
    this.animateTenHades();
    this.animateOlympusLetters();

    for (const p of this.pulsing) {
      if (p.sprite.destroyed) continue;
      const wave = Math.sin(this.clock / 120);
      p.sprite.scale.set(p.base * (p.grow ? 1 + p.grow * (0.5 + 0.5 * wave) : 1 + 0.06 * wave));
    }

    for (const col of this.wildColumns.values()) {
      if (col.video) {
        const t = col.video.currentTime;
        for (const p of col.numberPatches) p.node.visible = t >= p.fromSec && t < p.toSec;
        continue;
      }
      if (!this.pulsing.some((p) => p.sprite === col.emblem)) col.emblem.scale.y = col.emblem.scale.x * (1 + 0.02 * Math.sin(this.clock / 400));
      if (this.profile === "hades") this.spawnEmbers(col, dt);
    }
  };

  private spawnEmbers(col: WildColumn, dt: number) {
    if (col.embers.length < 22 && Math.random() < dt / 70) {
      const g = new Graphics().circle(0, 0, 1.5 + Math.random() * 2.5).fill(Math.random() < 0.6 ? 0xff7a1a : 0xffe27a);
      g.x = 10 + Math.random() * (CELL_W - 20);
      g.y = BOARD_H - 10;
      col.embersLayer.addChild(g);
      col.embers.push({ g, vx: (Math.random() - 0.5) * 0.02, vy: -(0.07 + Math.random() * 0.1), life: 0, maxLife: 2600 + Math.random() * 1600 });
    }
    stepParticles(col.embers, dt, true);
  }

  destroy() {
    this.alive = false;
    this.clearWildColumns();
    this.skipBigWin = null;
    this.app.ticker.remove(this.update);
    this.root.destroy({ children: true });
  }
}

/** Gold display text with a dark outline, used for WILD/multiplier labels and win amounts. */
function goldStyle(size: number): TextStyle {
  return new TextStyle({
    fontFamily: DISPLAY_FONT,
    fontSize: size,
    fill: new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0xfff6b0 },
        { offset: 0.5, color: 0xffc21a },
        { offset: 1, color: 0xd96a00 },
      ],
      textureSpace: "local",
    }),
    stroke: { color: 0x3a1500, width: Math.max(4, size / 8) },
    dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 3, angle: Math.PI / 2 },
  });
}

function stepParticles(list: Particle[], dt: number, fade: boolean) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life += dt;
    p.g.x += p.vx * dt;
    p.g.y += p.vy * dt;
    if (fade) p.g.alpha = Math.max(0, 1 - p.life / p.maxLife);
    if (p.life >= p.maxLife || p.g.y < -20) {
      p.g.destroy();
      list.splice(i, 1);
    }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

