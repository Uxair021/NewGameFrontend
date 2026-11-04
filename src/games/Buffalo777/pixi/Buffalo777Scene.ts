import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { BuffaloSymbol, PayoutRow } from "../api";
import {
  loadSymbolTextures,
  loadBackgroundImage,
  loadBonusBackgroundImage,
  loadWinGifAnimations,
  loadWinFrameAnimations,
} from "./symbols";
import { Reel } from "./Reel";
import { makeScaledTexture } from "../../shared/pixi/scaledTexture";

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
const COLUMN_GAP = 41;
/** Vertical counterpart to COLUMN_GAP — extra space (px) inserted between each pair of stacked
 * rows within a single reel, on top of CELL_HEIGHT. 0 = rows sit flush with no gap (the default,
 * matching how this reel always behaved before this constant existed). Raise it to spread rows
 * apart; CELL_HEIGHT below is shrunk to make room so VISIBLE_ROWS rows-with-gaps still add up to
 * exactly WINDOW_HEIGHT, same accounting COLUMN_GAP already does for CELL_WIDTH. Threaded into
 * Reel.ts (see its rowGapPx param and `step` getter), which uses it for every row's vertical
 * position/travel distance — never for a symbol's own on-screen size, which stays CELL_HEIGHT. */
const ROW_GAP = 0;
/** How far past its own CELL_WIDTH each reel's clip mask is widened (each side) — purely so the
 * win-glow backdrop/border (see Reel.ts's startWinGlow, which reads this same COLUMN_GAP to size
 * its own horizontal outset) has room to bleed into and fully cover the COLUMN_GAP strip between
 * reels instead of being clipped off flush at CELL_WIDTH, which used to leave a visible sliver of
 * raw background showing between adjacent reels' glow boxes during a win. Safe to widen — no
 * reel content (cells are built exactly CELL_WIDTH wide) ever reaches this extra margin, so
 * nothing new becomes visible except the intentionally-widened glow. */
const MASK_GAP_COVER = COLUMN_GAP / 2 + 4;

// Fractional position of the reel window within bg.png (1672x941 source art) — the three
// white boxes under the "BUFFALO 777" title. First-pass estimate; tune by eye as needed.
const WINDOW_LEFT_FRAC = 0.245;
const WINDOW_RIGHT_FRAC = 0.7560;
const WINDOW_TOP_FRAC = 0.133;
const WINDOW_BOTTOM_FRAC = 0.87;

const BG_ASPECT = 1672 / 941;

export const CANVAS_WIDTH = 1672;
export const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH / BG_ASPECT);

/** GPU-memory knob for the whole game: the canvas renders at this fraction of its on-screen
 * pixel size (see Buffalo777Game's fitResolution use), and the backgrounds are sized to match.
 * 1 = pixel-exact; lower = less GPU memory, slightly softer art. */
export const RENDER_QUALITY = 0.75;

const WINDOW_WIDTH = (WINDOW_RIGHT_FRAC - WINDOW_LEFT_FRAC) * CANVAS_WIDTH;
const WINDOW_HEIGHT = (WINDOW_BOTTOM_FRAC - WINDOW_TOP_FRAC) * CANVAS_HEIGHT;
/** Fills the frame's actual available width — no longer shrunk to match a shared square size
 * across all 3 rows, since the frame's own fixed aspect ratio can't fit 3 full-width squares
 * within WINDOW_HEIGHT too (there just isn't room). Only the MIDDLE (payline) row is forced
 * square instead (see MIDDLE_ROW_HEIGHT) — that's the row that actually matters for this: it's
 * the one that plays the win animation, and the one a square sprite sheet needs to land in
 * cleanly. Top/bottom rows share whatever height is left over (see OUTER_ROW_HEIGHT). */
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
/** Square — exactly CELL_WIDTH tall, so a square sprite sheet fills it edge-to-edge on every
 * side with plain contain-fit (see Reel.ts's buildCell/attachWinAnimation), no cropping needed. */
export const MIDDLE_ROW_HEIGHT = CELL_WIDTH;
/** Top/bottom rows' shared height — whatever's left of WINDOW_HEIGHT once the (square) middle
 * row and both ROW_GAPs are subtracted, split evenly between the two of them. By construction
 * OUTER_ROW_HEIGHT*2 + MIDDLE_ROW_HEIGHT + 2*ROW_GAP === WINDOW_HEIGHT exactly, so the reel
 * block always fills the window's full height with no leftover margin to center. Also doubles
 * as the size every *filler* symbol scrolls past at while spinning (see Reel.ts's `step`
 * getter) — only the middle row gets resized to MIDDLE_ROW_HEIGHT, and only once it actually
 * lands on the payline (see Reel.ts's keepOnly). */
export const OUTER_ROW_HEIGHT =
  (WINDOW_HEIGHT - MIDDLE_ROW_HEIGHT - (VISIBLE_ROWS - 1) * ROW_GAP) / (VISIBLE_ROWS - 1);
export const CELL_HEIGHT = OUTER_ROW_HEIGHT;

/** How many ms it takes one row-step (CELL_HEIGHT + ROW_GAP — see Reel.ts's `step` getter, the
 * actual vertical distance between consecutive rows) of scroll to pass at the shared spin speed
 * — lower is faster. Timing is expressed in cells (not ms) throughout this file so every reel's
 * filler count and travel distance line up exactly, with no rounding slack between them. */
const MS_PER_CELL = 85;
/** Constant scroll speed (px/ms) shared by every reel while spinning — this is what keeps
 * all 3 reels visually in lockstep for the whole spin, not just at the start. */
const SCROLL_SPEED = (CELL_HEIGHT + ROW_GAP) / MS_PER_CELL;
/** How many cells reel 0 scrolls through before it starts decelerating into its landing. */
const MIN_SPIN_CELLS = 10;
/** Extra cells each subsequent reel scrolls through before it starts decelerating — this is
 * what creates the cascading reel-1-then-2-then-3 stop, independent of spin speed. */
const STOP_STAGGER_CELLS = 4;
/** Cells consumed while decelerating into the landing (>= 3 — the target itself is 3
 * cells); raise it for a longer, more gradual stop. */
const DECEL_CELLS = 3;
/** Turbo just scrolls faster at the same cell counts, so the spin keeps the same "shape" —
 * same number of symbols passing, same stagger — just compressed in time. */
const TURBO_SPEED_MULTIPLIER = 2.5;

/** Fractional (x, y) center of the empty wooden sign under each payout row baked into
 * bg.png — left ladder highest-to-lowest, then right ladder highest-to-lowest. First-pass
 * estimate; tune by eye as needed. */
const LADDER_POSITIONS: Record<PayoutRow["symbol"], { xFrac: number; yFrac: number }> = {
  COIN: { xFrac: 0.0768, yFrac: 0.1230 },
  MONEY_BAG: { xFrac: 0.0748, yFrac: 0.255 },
  TRIPLE_BAR: { xFrac: 0.0748, yFrac: 0.3990 },
  DOUBLE_BAR: { xFrac: 0.0748, yFrac: 0.5382 },
  SINGLE_BAR: { xFrac: 0.0748, yFrac: 0.6718 },
  ANY_BAR: { xFrac: 0.0748, yFrac: 0.8115 },
  BULL: { xFrac: 0.9272, yFrac: 0.1176 },
  ACE: { xFrac: 0.9272, yFrac: 0.2540 },
  KING: { xFrac: 0.9272, yFrac: 0.3910 },
  QUEEN: { xFrac: 0.9272, yFrac: 0.5330 },
  JACK: { xFrac: 0.9272, yFrac: 0.6690 },
  TEN: { xFrac: 0.9272, yFrac: 0.8100 },
};

const LADDER_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 22,
  fill: 0xffe37a,
  stroke: { color: 0x3a1e08, width: 4 },
  align: "center",
});

/** How many coin sprites spill out per win-line payout. */
const COIN_FALL_COUNT = 56;
/** Native-pixel size range each falling coin is scaled to. */
const COIN_MIN_SIZE = 34;
const COIN_MAX_SIZE = 54;
/** Each coin's fall takes COIN_FALL_MIN_DURATION_MS to (COIN_FALL_MIN_DURATION_MS +
 * COIN_FALL_DURATION_VARIANCE_MS) ms — raise these to make the fall itself last longer. */
const COIN_FALL_MIN_DURATION_MS = 900;
const COIN_FALL_DURATION_VARIANCE_MS = 900;
/** Coins start falling at a random delay between 0 and this many ms, so they don't all drop
 * in a single synchronized line — raise it to spread the cascade out over more time. */
const COIN_FALL_MAX_STAGGER_MS = 850;

export class Buffalo777Scene {
  private reels: Reel[] = [];
  private root: Container;
  private ladderTexts: Partial<Record<PayoutRow["symbol"], Text>> = {};
  // Start empty and fill in once loadWinAnimationsInBackground() resolves — every Reel holds
  // this exact object (not a copy), so later Object.assign()ing new entries into it is enough
  // for their next win lookup to see them, with no extra plumbing needed. This is what lets
  // create() return as soon as the reels themselves are playable, instead of blocking on
  // ~85MB of win-celebration .gifs/frame-PNGs that are only needed once a win actually happens.
  private gifTemplates: Awaited<ReturnType<typeof loadWinGifAnimations>> = {};
  private frameAnimations: Awaited<ReturnType<typeof loadWinFrameAnimations>> = {};
  private destroyed = false;
  private coinTexture: Texture;
  private coinLayer: Container;
  private coinTimeouts: number[] = [];
  private coinFrameCancels: Array<() => void> = [];
  private background: Sprite;
  private normalBgImage: HTMLImageElement;
  private bonusBgImage: Promise<HTMLImageElement> | null = null;
  /** Which art the background shows right now, and the backing resolution its texture was
   * built for — only one background texture is ever on the GPU, rebuilt from its image on
   * a bonus switch or a resolution change. */
  private currentBgImage: HTMLImageElement;
  private bgResolution: number;

  private constructor(app: Application, normalBgImage: HTMLImageElement, textures: Awaited<ReturnType<typeof loadSymbolTextures>>) {
    this.coinTexture = textures.COIN;
    this.normalBgImage = normalBgImage;
    this.currentBgImage = normalBgImage;
    this.bgResolution = app.renderer.resolution;
    this.background = new Sprite();
    this.root = new Container();
    app.stage.addChild(this.root);
    this.root.addChild(this.background);
    this.showBackground(normalBgImage);

    const windowLeft = WINDOW_LEFT_FRAC * app.screen.width;
    const windowTop = WINDOW_TOP_FRAC * app.screen.height;

    for (let i = 0; i < REEL_COUNT; i++) {
      const reelWindow = new Container();
      reelWindow.x = windowLeft + i * (CELL_WIDTH + COLUMN_GAP);
      reelWindow.y = windowTop;

      const mask = new Graphics();
      // WINDOW_HEIGHT, not VISIBLE_ROWS * CELL_HEIGHT — CELL_HEIGHT was shrunk to make room for
      // ROW_GAP between rows (see its own definition above), so VISIBLE_ROWS * CELL_HEIGHT alone
      // would now fall short of the full 3-rows-with-gaps span and clip the bottom row.
      // WINDOW_HEIGHT already accounts for the gaps and is exactly that full span.
      mask.rect(-MASK_GAP_COVER, 0, CELL_WIDTH + MASK_GAP_COVER * 2, WINDOW_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel(
        textures,
        this.gifTemplates,
        this.frameAnimations,
        CELL_WIDTH,
        CELL_HEIGHT,
        MIDDLE_ROW_HEIGHT,
        COLUMN_GAP,
        ROW_GAP
      );
      reelWindow.addChild(reel.container);

      const idleTarget: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol] = ["TEN", "BULL", "SINGLE_BAR"];
      reel.showStatic(idleTarget);

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    // Win-value readouts on the wooden signs baked into bg.png's side ladders.
    for (const [symbol, pos] of Object.entries(LADDER_POSITIONS) as [PayoutRow["symbol"], { xFrac: number; yFrac: number }][]) {
      const text = new Text({ text: "", style: LADDER_TEXT_STYLE });
      text.anchor.set(0.5);
      text.x = pos.xFrac * app.screen.width;
      text.y = pos.yFrac * app.screen.height;
      this.root.addChild(text);
      this.ladderTexts[symbol] = text;
    }

    // On top of everything (reels + ladder text) so falling coins read clearly over both.
    this.coinLayer = new Container();
    this.root.addChild(this.coinLayer);
  }

  static async create(app: Application): Promise<Buffalo777Scene> {
    // Only the reel-critical assets (background + symbol art, a couple MB) gate readiness —
    // the ~85MB of win-celebration .gifs/frame-PNGs load in the background afterwards (see
    // loadWinAnimationsInBackground) since they're not needed until a win actually happens.
    const [background, textures] = await Promise.all([loadBackgroundImage(), loadSymbolTextures()]);
    const scene = new Buffalo777Scene(app, background, textures);
    scene.loadWinAnimationsInBackground();
    return scene;
  }

  /** Fires off the win-celebration .gif/frame-PNG loads without blocking create() on them, then
   * merges the results into the same gifTemplates/frameAnimations objects every Reel already
   * holds a reference to — see the field comments above for why a plain Object.assign is enough.
   * If the scene was torn down before this resolves, destroys the now-orphaned assets instead
   * of merging them in. */
  private loadWinAnimationsInBackground(): void {
    // Bonus assets — small, but only needed once a Gold Coin bonus triggers. Failures surface
    // when they're actually awaited (setBonusMode), which degrade gracefully.
    this.bonusBgImage = loadBonusBackgroundImage();
    this.bonusBgImage.catch((err) => console.error("Buffalo777: bonus background failed to load", err));

    Promise.all([loadWinGifAnimations(), loadWinFrameAnimations()])
      .then(([gifTemplates, frameAnimations]) => {
        if (this.destroyed) {
          Object.values(gifTemplates).forEach((template) => template?.destroy());
          Object.values(frameAnimations).forEach((frames) => frames?.forEach((t) => t.destroy(true)));
          return;
        }
        Object.assign(this.gifTemplates, gifTemplates);
        Object.assign(this.frameAnimations, frameAnimations);
      })
      // Both loaders already catch per-symbol so a single bad asset can't reach here — this is
      // just a last-resort net so a genuinely unexpected failure logs instead of vanishing.
      .catch((err) => console.error("Buffalo777: win-celebration animations failed to load", err));
  }

  /** Fills in each ladder sign with the dollar amount that payout is actually worth at the
   * current bet (payout multiplier × bet) — recompute whenever the bet changes. */
  updatePayoutValues(paytable: PayoutRow[], betAmount: number): void {
    for (const row of paytable) {
      const text = this.ladderTexts[row.symbol];
      if (text) text.text = (row.payout * betAmount).toFixed(2);
    }
  }

  /** Spins all reels and lands on the given result. Resolves once every reel has stopped.
   * All 3 reels scroll at the exact same constant speed starting from the exact same shared
   * timestamp, so they stay visually in lockstep for the entire spin — the only thing that
   * differs per reel is *when* it breaks out of that constant-speed phase to decelerate into
   * its landing (reel 0 first, then reel 1, then reel 2), which is what produces the
   * cascading stop. onReelLand fires as each individual reel stops (for a per-reel landing
   * sound). `turbo` scrolls faster (same cell counts, so the same spin "shape" compressed
   * into less time) for a much snappier round. */
  async spin(
    reelsResult: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol][],
    onReelLand?: (index: number) => void,
    turbo = false
  ): Promise<void> {
    const speed = SCROLL_SPEED * (turbo ? TURBO_SPEED_MULTIPLIER : 1);
    const startTime = performance.now();
    const spins = this.reels.map((reel, i) => {
      const spinCells = MIN_SPIN_CELLS + i * STOP_STAGGER_CELLS;
      return reel.spinTo(reelsResult[i], spinCells, speed, DECEL_CELLS, startTime).then(() => onReelLand?.(i));
    });
    await Promise.all(spins);
  }

  /** Glow + pulse on the payline symbols (any win) — call with false to stop, e.g. when the next spin starts. */
  setWinGlow(active: boolean): void {
    this.reels.forEach((reel) => (active ? reel.startWinGlow() : reel.stopWinGlow()));
  }

  /** Swaps the background between the normal art and BonusSpinBg.webp for the free spins bonus. */
  async setBonusMode(active: boolean): Promise<void> {
    if (!active) {
      this.showBackground(this.normalBgImage);
      return;
    }
    try {
      const img = await (this.bonusBgImage ?? loadBonusBackgroundImage());
      if (!this.destroyed) this.showBackground(img);
    } catch {
      /* keep the normal background if the bonus art couldn't load */
    }
  }

  /** Rebuilds the background texture for a new backing resolution — call after changing the
   * renderer's resolution. */
  setBackgroundResolution(resolution: number): void {
    if (Math.abs(resolution - this.bgResolution) < 0.01) return;
    this.bgResolution = resolution;
    this.showBackground(this.currentBgImage, true);
  }

  /** Shows `img` as the background, uploaded only as large as the canvas's backing resolution
   * actually draws it (relative to the file's own size), and frees the previous texture. */
  private showBackground(img: HTMLImageElement, force = false): void {
    if (!force && img === this.currentBgImage && this.background.texture !== Texture.EMPTY) return;
    this.currentBgImage = img;
    const scale = Math.min(1, (this.bgResolution * CANVAS_WIDTH) / img.naturalWidth);
    const old = this.background.texture;
    this.background.texture = makeScaledTexture(img, scale);
    this.background.width = CANVAS_WIDTH;
    this.background.height = CANVAS_HEIGHT;
    if (old !== Texture.EMPTY) old.destroy(true);
  }

  /** Spills a handful of coins out of the ladder sign for whichever payout line just won,
   * falling past the bottom of the screen — e.g. `symbol="COIN"` pours coins out of the
   * left ladder's Gold Coin entry. Purely cosmetic; call once per winning spin. */
  playCoinFall(symbol: PayoutRow["symbol"]): void {
    const pos = LADDER_POSITIONS[symbol];
    if (!pos) return;
    const originX = pos.xFrac * CANVAS_WIDTH;
    const originY = pos.yFrac * CANVAS_HEIGHT;
    const floorY = CANVAS_HEIGHT + 60;

    for (let i = 0; i < COIN_FALL_COUNT; i++) {
      const coin = new Sprite(this.coinTexture);
      coin.anchor.set(0.5);
      const size = COIN_MIN_SIZE + Math.random() * (COIN_MAX_SIZE - COIN_MIN_SIZE);
      coin.scale.set(size / this.coinTexture.width);
      coin.rotation = Math.random() * Math.PI * 2;
      coin.alpha = 0;

      // Coins pop out clustered around the number, then drift a bit wider as they fall.
      const popX = (Math.random() - 0.5) * 30;
      const driftX = (Math.random() - 0.5) * 90;
      coin.x = originX + popX;
      coin.y = originY;
      this.coinLayer.addChild(coin);

      const delay = Math.random() * COIN_FALL_MAX_STAGGER_MS;
      const duration = COIN_FALL_MIN_DURATION_MS + Math.random() * COIN_FALL_DURATION_VARIANCE_MS;
      const spinSpeed = (Math.random() - 0.5) * 8;
      const startY = originY;

      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        let rafId = 0;
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          // Ease-in fall (accelerating, like gravity) from a slower emerging pop.
          const eased = t * t;
          coin.y = startY + (floorY - startY) * eased;
          coin.x = originX + popX + driftX * t;
          coin.rotation += spinSpeed * 0.05;
          coin.alpha = t < 0.12 ? t / 0.12 : t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.coinLayer.removeChild(coin);
            coin.destroy();
          }
        };
        rafId = requestAnimationFrame(tick);
        this.coinFrameCancels.push(() => cancelAnimationFrame(rafId));
      }, delay);

      this.coinTimeouts.push(timeoutId);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.coinTimeouts.forEach((id) => window.clearTimeout(id));
    this.coinFrameCancels.forEach((cancel) => cancel());
    this.reels.forEach((r) => r.destroy());
    Object.values(this.gifTemplates).forEach((template) => template?.destroy());
    Object.values(this.frameAnimations).forEach((frames) => frames?.forEach((t) => t.destroy(true)));
    const bgTexture = this.background.texture;
    this.root.destroy({ children: true });
    if (bgTexture !== Texture.EMPTY) bgTexture.destroy(true);
  }
}
