import { Application, BlurFilter, Container, FillGradient, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { ReelResult } from "../api";
import { loadSymbolTextures, loadNoteBundleTexture, preloadBackgrounds } from "./symbols";
import { Reel, SYMBOL_ICON_SCALE, SYMBOL_PADDING, WIN_PULSE_PEAK } from "./Reel";

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
const COLUMN_GAP = 30;

// Both screen assets are native 1920x1080 — use that directly as canvas size, same convention
// Buffalo 777 uses for its own background art.
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

/** A region of the 1920x1080 design screen, in design px. */
export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The canvas only ever covers what Pixi actually draws on the screen being shown — the
 * background art is two plain <img>s behind it (see TopDollarGame), and a smaller canvas means
 * proportionally smaller GPU drawing buffers. The scene keeps laying out in full design
 * coordinates; its root is just shifted by -left/-top (see setView).
 *  - BASE: the reel window, payline and BET/WIN readouts (bottom screen);
 *  - BONUS: the 10 note bundles at their biggest — wobble scale, rotation, glow pad + blur
 *    padding (top screen);
 *  - SCROLL: full height while the camera moves between the two, so nothing gets cut off at the
 *    canvas edge mid-scroll (only for the 2s of each scroll). */
const BASE_VIEW: ViewRect = { left: 354, top: 77, width: 1202, height: 560 };
const BONUS_VIEW: ViewRect = { left: 260, top: 126, width: 1400, height: 838 };
const SCROLL_VIEW: ViewRect = { left: 260, top: 0, width: 1400, height: CANVAS_HEIGHT };
/** The scene starts on the top screen (see the intro in TopDollarGame) — init the app at this. */
export const INITIAL_VIEW = BONUS_VIEW;

// Fractional position of the reel window within bottomScreen.png (the 3 white glass panes) —
// first-pass estimate from the art; tune by eye as needed.
const WINDOW_LEFT_FRAC = 0.195;
const WINDOW_RIGHT_FRAC = 0.80;
const WINDOW_TOP_FRAC = 0.09;
const WINDOW_BOTTOM_FRAC = 0.43;

const WINDOW_WIDTH = (WINDOW_RIGHT_FRAC - WINDOW_LEFT_FRAC) * CANVAS_WIDTH;
const WINDOW_HEIGHT = (WINDOW_BOTTOM_FRAC - WINDOW_TOP_FRAC) * CANVAS_HEIGHT;
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
export const CELL_HEIGHT = WINDOW_HEIGHT / VISIBLE_ROWS;

const PAYLINE_COLOR_IDLE = 0xf5ff2e;
const PAYLINE_TRIANGLE_SIZE = 40;

// The dark gold-bordered readout box baked into bottomScreen.png, directly below the reel
// window — first-pass estimate from the art; tune by eye as needed. This is where BET/WIN
// render (per user request), not the separate HTML control bar further down.
const READOUT_BOX_LEFT_FRAC = WINDOW_LEFT_FRAC;
const READOUT_BOX_RIGHT_FRAC = WINDOW_RIGHT_FRAC;
const READOUT_BOX_TOP_FRAC = 0.48;
const READOUT_BOX_BOTTOM_FRAC = 0.575;

/** "0000000.00" etc — the dim placeholder digits a real value's bright digits render on top
 * of (both right-anchored at the same x, so they always line up character-for-character — see
 * updateReadouts). Same classic LCD-odometer look as Mega 10X Pay's own BET/WIN readouts. */
const BET_GHOST_PATTERN = "00000.00";
const WIN_GHOST_PATTERN = "00000.00";

const READOUT_FONT_SIZE = 70;
const GHOST_STYLE = new TextStyle({ fontFamily: "Digital-7, monospace", fontSize: READOUT_FONT_SIZE, fill: 0x3f3f46 });
const BET_VALUE_STYLE = new TextStyle({ fontFamily: "Digital-7, monospace", fontSize: READOUT_FONT_SIZE, fill: 0xf4f4f5 });
const WIN_VALUE_STYLE = new TextStyle({ fontFamily: "Digital-7, monospace", fontSize: READOUT_FONT_SIZE, fill: 0xef4444 });
const READOUT_LABEL_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 20,
  fill: 0xd4d4d8,
});

/** One entry per note bundle on topScreen.png's bonus board — first-pass estimate from the
 * art; tune by eye as needed. `jackpot: true` marks the single fixed $1000 position (the
 * isolated top-middle red bundle — confirmed with user: always the same position).
 * colorLight/colorDark tint that position's own note-bundle prop (see buildBonusBundles) so
 * the ladder still reads as color-coded at a glance, now that topScreen.png's background is a
 * plain frame with no baked-in colored blocks of its own. `value` is that bundle's permanently
 * displayed dollar amount — confirmed with user: the board must never reshuffle or have its
 * numbers rewritten. Two of each of $5/$10/$20/$50 plus one $100 across the 9 non-jackpot spots
 * (see findBoardSubsetForOffer) give exact-sum coverage for the large majority of real offers. */
interface BundleSpot {
  xFrac: number;
  yFrac: number;
  jackpot?: boolean;
  colorLight: number;
  colorDark: number;
  value: number;
}

const BUNDLE_SPOTS: BundleSpot[] = [
  // Middle column, top to bottom (4) — topmost is the fixed $1000 jackpot spot (gold-to-red).
  { xFrac: 0.489, yFrac: 0.278, jackpot: true, colorLight: 0xfde68a, colorDark: 0x7f1d1d, value: 1000 },
  { xFrac: 0.489, yFrac: 0.426, colorLight: 0xfde68a, colorDark: 0xb45309, value: 50 },
  { xFrac: 0.489, yFrac: 0.574, colorLight: 0xc4b5fd, colorDark: 0x5b21b6, value: 20 },
  { xFrac: 0.489, yFrac: 0.731, colorLight: 0x6ee7b7, colorDark: 0x065f46, value: 100 },
  // Left column, top to bottom (3).
  { xFrac: 0.294, yFrac: 0.398, colorLight: 0x93c5fd, colorDark: 0x1e3a8a, value: 5 },
  { xFrac: 0.294, yFrac: 0.556, colorLight: 0x86efac, colorDark: 0x14532d, value: 20 },
  { xFrac: 0.294, yFrac: 0.713, colorLight: 0xfef08a, colorDark: 0xa16207, value: 50 },
  // Right column, top to bottom (3).
  { xFrac: 0.703, yFrac: 0.398, colorLight: 0xf9a8d4, colorDark: 0x9d174d, value: 10 },
  { xFrac: 0.703, yFrac: 0.556, colorLight: 0x93c5fd, colorDark: 0x1e40af, value: 5 },
  { xFrac: 0.703, yFrac: 0.713, colorLight: 0xfdba74, colorDark: 0xc2410c, value: 10 },
];

const BUNDLE_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 50,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 8 },
  align: "center",
});

// notes.png sized to a fraction of the canvas — wide enough to read clearly without adjacent
// columns' props overlapping (see BUNDLE_SPOTS' column x-spacing). First-pass estimate; tune
// by eye as needed.
const NOTE_WIDTH_FRAC = 0.185;
const NOTE_ASPECT = 1754 / 592; // notes.png's own native width/height
const NOTE_WIDTH = NOTE_WIDTH_FRAC * CANVAS_WIDTH;
const NOTE_HEIGHT = NOTE_WIDTH / NOTE_ASPECT;

/** Covers almost the entire note sprite (as fractions of its own rendered width/height) with a
 * per-position gradient, blended with 'multiply' so the bill's own photographic shading still
 * shows through underneath — reads as "the whole bundle is colored" rather than a small
 * isolated ribbon, per user request. */
const FULL_TINT_LEFT_FRAC = 0.26;
const FULL_TINT_RIGHT_FRAC = 0.7;
const FULL_TINT_TOP_FRAC = 0.12;
const FULL_TINT_BOTTOM_FRAC = 0.98;
const FULL_TINT_ALPHA = 0.62;

/** The wrapper-band region within notes.png (as fractions of the note's own rendered width/
 * height) — this is where the source art's baked-in placeholder digits sit. buildBonusBundles
 * paints a second, fully OPAQUE gradient patch over exactly this (smaller) region on top of the
 * full-bundle tint above — this is what actually hides the placeholder digits and gives the
 * real value text a clean, high-contrast background to sit on. First-pass estimate from the
 * art; tune by eye as needed. */
const BAND_LEFT_FRAC = 0.26;
const BAND_RIGHT_FRAC = 0.7;
const BAND_TOP_FRAC = 0.12;
const BAND_BOTTOM_FRAC = 0.98;

/** How long the vertical scroll between the base game and the bonus board takes. */
const SCROLL_DURATION_MS = 2000;

/** The selection glow is a blurred halo sitting behind the note sprite (padded out past its
 * edges, heavily blurred) rather than a brightness flash over it — reads like a CSS box-shadow
 * glow around the bundle, per user request, instead of a screen-blend flare on top of it. */
const GLOW_PAD = 26;
const GLOW_BLUR_STRENGTH = 20;

/** Largest scale a bundle container reaches (chase highlight 1.14, wobble peak 1.17). */
const BUNDLE_MAX_SCALE = 1.17;
/** Symbol art's own size — every file in symbols.ts's SYMBOL_FILES is 500x500. */
const SYMBOL_ART_SIZE = 500;
/** notes.png's own native width. */
const NOTE_ART_WIDTH = 1754;

/** Texture scale (≤ 1 of the art's own size) for art drawn at most `drawnPx` wide in design
 * px — sized for a backing resolution of at least 1, so it's never softer than the full art was
 * at the default resolution, and matches it exactly on higher-DPI backings. */
function artScale(drawnPx: number, artPx: number, resolution: number): number {
  return Math.min(1, (drawnPx * Math.max(1, resolution)) / artPx);
}

export class TopDollarScene {
  private reels: Reel[] = [];
  /** Scrolls between showing the bottom screen (y = -CANVAS_HEIGHT) and the top screen
   * (y = 0) — both screens are full canvas-height containers stacked vertically inside this,
   * and the canvas (never taller than the 1080 design screen — see setView) naturally clips
   * whichever one isn't currently in view, no mask needed. */
  private camera: Container;
  private bundleTexts: Text[] = [];
  /** The whole note+patch+text group per bundle spot, in BUNDLE_SPOTS order — animated as one
   * unit (scale/rotation) by playBundleSelection. */
  private bundleContainers: Container[] = [];
  /** A bright overlay per bundle, alpha 0 at rest — flashed during playBundleSelection to make
   * the "picked" bundle pop, separate from the container's own scale/rotation. */
  private bundleGlows: Graphics[] = [];
  private scrollFrameCancel: (() => void) | null = null;
  private pendingSelectionTimeouts: number[] = [];
  private pendingSelectionFrames: Array<() => void> = [];
  /** Bundles currently "locked in" as picked, each running its own infinite scale/wobble/glow
   * rAF loop (see startPersistentWobble) — keyed by BUNDLE_SPOTS index, cleared by
   * stopAllWobbles. These persist across the offer reveal itself; only a fresh
   * playBundleSelection call or a return to the base game resets them. */
  private activeWobbleCancels: Map<number, () => void> = new Map();
  private betValueText!: Text;
  private winValueText!: Text;
  /** Holds the camera, shifted by -view.left/-view.top so design coordinates land in the
   * cropped canvas (see setView). */
  private root: Container;
  private view: ViewRect = INITIAL_VIEW;
  /** Called with camera.y on every scroll frame, so TopDollarGame can move the HTML background
   * art with it (in the same frame as the canvas render — the scroll runs on app.ticker). */
  onCameraMove: ((y: number) => void) | null = null;

  private constructor(
    private app: Application,
    textures: Awaited<ReturnType<typeof loadSymbolTextures>>,
    noteTexture: Texture
  ) {
    this.root = new Container();
    app.stage.addChild(this.root);
    this.camera = new Container();
    this.root.addChild(this.camera);
    this.setView(INITIAL_VIEW);

    const bottomScreen = new Container();
    bottomScreen.y = CANVAS_HEIGHT;

    const windowLeft = WINDOW_LEFT_FRAC * CANVAS_WIDTH;
    const windowTop = WINDOW_TOP_FRAC * CANVAS_HEIGHT;
    for (let i = 0; i < REEL_COUNT; i++) {
      const reelWindow = new Container();
      reelWindow.x = windowLeft + i * (CELL_WIDTH + COLUMN_GAP);
      reelWindow.y = windowTop;

      const mask = new Graphics();
      mask.rect(0, 0, CELL_WIDTH, VISIBLE_ROWS * CELL_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel(textures, CELL_WIDTH, CELL_HEIGHT);
      reel.showStatic(["SEVEN", "SINGLE_BAR", "DOUBLE_BAR"]);
      reelWindow.addChild(reel.container);

      bottomScreen.addChild(reelWindow);
      this.reels.push(reel);
    }

    // Neon payline indicator, drawn from the same coordinates the reels themselves use, so it
    // always lines up with the true scoring row even as those fractions get tuned.
    const paylineY = windowTop + 1.5 * CELL_HEIGHT;
    this.drawPayline(bottomScreen, windowLeft, windowLeft + WINDOW_WIDTH, paylineY);

    this.buildReadouts(bottomScreen);

    const topScreen = new Container();
    topScreen.y = 0;

    this.buildBonusBundles(topScreen, noteTexture);

    this.camera.addChild(topScreen, bottomScreen);
    // Start showing the top screen — TopDollarGame plays a brief intro (hold, then scroll down
    // via scrollToBase) before enabling the base game's controls, so the player sees the
    // branded bonus board once before dropping into gameplay (confirmed with user — same intro
    // GemsDeluxe already has).
    this.camera.y = 0;
  }

  /** Draws the neon payline: a glowing horizontal line from `left` to `right` at `y`, with an
   * outlined (not filled) triangle at each end pointing inward — same look as Crazy 777's. */
  private drawPayline(parent: Container, left: number, right: number, y: number): void {
    const glow = new Graphics();
    glow.moveTo(left, y).lineTo(right, y);
    glow.stroke({ color: PAYLINE_COLOR_IDLE, width: 16, alpha: 0.55 });
    glow.filters = [new BlurFilter({ strength: 6 })];
    parent.addChild(glow);

    const line = new Graphics();
    line.moveTo(left, y).lineTo(right, y);
    line.stroke({ color: PAYLINE_COLOR_IDLE, width: 3, alpha: 0.95 });
    parent.addChild(line);

    const leftTriangle = new Graphics();
    leftTriangle
      .poly([left, y - PAYLINE_TRIANGLE_SIZE / 2, left, y + PAYLINE_TRIANGLE_SIZE / 2, left + PAYLINE_TRIANGLE_SIZE, y])
      .stroke({ color: PAYLINE_COLOR_IDLE, width: 3 });
    parent.addChild(leftTriangle);

    const rightTriangle = new Graphics();
    rightTriangle
      .poly([right, y - PAYLINE_TRIANGLE_SIZE / 2, right, y + PAYLINE_TRIANGLE_SIZE / 2, right - PAYLINE_TRIANGLE_SIZE, y])
      .stroke({ color: PAYLINE_COLOR_IDLE, width: 3 });
    parent.addChild(rightTriangle);
  }

  /** BET/WIN readout box baked into bottomScreen.png, directly below the reel window — each
   * is a label + a ghost/value text pair right-anchored at the same x, so the bright value
   * always lands exactly over the matching rightmost digits of the dim ghost pattern
   * regardless of how many integer digits the real value has (both always end in ".XX" — see
   * BET_GHOST_PATTERN's doc comment). Same layout Mega 10X Pay's own readouts use. */
  private buildReadouts(parent: Container): void {
    const boxLeft = READOUT_BOX_LEFT_FRAC * CANVAS_WIDTH;
    const boxRight = READOUT_BOX_RIGHT_FRAC * CANVAS_WIDTH;
    const boxWidth = boxRight - boxLeft;
    const centerY = ((READOUT_BOX_TOP_FRAC + READOUT_BOX_BOTTOM_FRAC) / 2) * CANVAS_HEIGHT;

    // Solid black backing plates behind each label+digits group, for legibility against
    // bottomScreen.png's own busy dark-navy art — drawn first so everything else sits on top.
    const plateHeight = READOUT_FONT_SIZE + 24;
    const betPlate = new Graphics();
    betPlate.roundRect(boxLeft + boxWidth * 0.04, centerY - plateHeight / 2, boxWidth * 0.46, plateHeight, 8);
    betPlate.fill({ color: 0x000000, alpha: 0.85 });
    parent.addChild(betPlate);

    const winPlate = new Graphics();
    winPlate.roundRect(boxLeft + boxWidth * 0.51, centerY - plateHeight / 2, boxWidth * 0.48, plateHeight, 8);
    winPlate.fill({ color: 0x000000, alpha: 0.85 });
    parent.addChild(winPlate);

    const betLabel = new Text({ text: "BET", style: READOUT_LABEL_STYLE });
    betLabel.anchor.set(0, 0.5);
    betLabel.x = boxLeft + boxWidth * 0.06;
    betLabel.y = centerY;
    parent.addChild(betLabel);

    const betRightEdge = boxLeft + boxWidth * 0.47;
    const betGhostText = new Text({ text: BET_GHOST_PATTERN, style: GHOST_STYLE });
    betGhostText.anchor.set(1, 0.5);
    betGhostText.x = betRightEdge;
    betGhostText.y = centerY;
    parent.addChild(betGhostText);

    this.betValueText = new Text({ text: "0.00", style: BET_VALUE_STYLE });
    this.betValueText.anchor.set(1, 0.5);
    this.betValueText.x = betRightEdge;
    this.betValueText.y = centerY;
    parent.addChild(this.betValueText);

    const winLabel = new Text({ text: "WIN", style: READOUT_LABEL_STYLE });
    winLabel.anchor.set(0, 0.5);
    winLabel.x = boxLeft + boxWidth * 0.53;
    winLabel.y = centerY;
    parent.addChild(winLabel);

    const winRightEdge = boxLeft + boxWidth * 0.97;
    const winGhostText = new Text({ text: WIN_GHOST_PATTERN, style: GHOST_STYLE });
    winGhostText.anchor.set(1, 0.5);
    winGhostText.x = winRightEdge;
    winGhostText.y = centerY;
    parent.addChild(winGhostText);

    this.winValueText = new Text({ text: "0.00", style: WIN_VALUE_STYLE });
    this.winValueText.anchor.set(1, 0.5);
    this.winValueText.x = winRightEdge;
    this.winValueText.y = centerY;
    parent.addChild(this.winValueText);
  }

  /** Updates the BET/WIN readouts baked into the scene — call whenever the bet changes or a
   * spin resolves. */
  updateReadouts(betAmount: number, winAmount: number): void {
    this.betValueText.text = betAmount.toFixed(2);
    this.winValueText.text = winAmount.toFixed(2);
  }

  /** Builds the 10 note-bundle props on the bonus board — a real notes.png stack of bills per
   * spot (now that topScreen.png's own background is a plain frame with no baked-in colored
   * blocks). Each is a small container, in paint order: a blurred box-shadow-style glow halo
   * (alpha 0 at rest, sitting behind everything else — see GLOW_PAD/GLOW_BLUR_STRENGTH) that
   * playBundleSelection lights up in this spot's own color when it gets "picked"; the note
   * sprite; a full-bundle 'multiply'-blended gradient tint (so it reads as "the whole bundle is
   * colored" while the bill's own photographic shading still shows through); a second, fully
   * OPAQUE gradient patch over just the wrapper band (this is what actually hides the source
   * art's baked-in placeholder digits and gives the value text a clean background); and finally
   * the value text. */
  private buildBonusBundles(parent: Container, noteTexture: Texture): void {
    const tintLeft = FULL_TINT_LEFT_FRAC * NOTE_WIDTH;
    const tintTop = FULL_TINT_TOP_FRAC * NOTE_HEIGHT;
    const tintWidth = (FULL_TINT_RIGHT_FRAC - FULL_TINT_LEFT_FRAC) * NOTE_WIDTH;
    const tintHeight = (FULL_TINT_BOTTOM_FRAC - FULL_TINT_TOP_FRAC) * NOTE_HEIGHT;

    const bandLeft = BAND_LEFT_FRAC * NOTE_WIDTH;
    const bandTop = BAND_TOP_FRAC * NOTE_HEIGHT;
    const bandWidth = (BAND_RIGHT_FRAC - BAND_LEFT_FRAC) * NOTE_WIDTH;
    const bandHeight = (BAND_BOTTOM_FRAC - BAND_TOP_FRAC) * NOTE_HEIGHT;

    for (const spot of BUNDLE_SPOTS) {
      const container = new Container();
      container.x = spot.xFrac * CANVAS_WIDTH;
      container.y = spot.yFrac * CANVAS_HEIGHT;
      container.pivot.set(NOTE_WIDTH / 2, NOTE_HEIGHT / 2);

      const glow = new Graphics();
      glow
        .roundRect(-GLOW_PAD, -GLOW_PAD, NOTE_WIDTH + GLOW_PAD * 2, NOTE_HEIGHT + GLOW_PAD * 2, 24)
        .fill({ color: spot.colorLight });
      glow.filters = [new BlurFilter({ strength: GLOW_BLUR_STRENGTH })];
      // Hidden while unlit, so its blur filter isn't run (or its render targets held) for all
      // 10 bundles every frame — see setGlowAlpha.
      this.setGlowAlpha(glow, 0);
      container.addChild(glow);
      this.bundleGlows.push(glow);

      const note = new Sprite(noteTexture);
      note.width = NOTE_WIDTH;
      note.height = NOTE_HEIGHT;
      container.addChild(note);

      const makeGradient = () =>
        new FillGradient({
          type: "linear",
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          colorStops: [
            { offset: 0, color: spot.colorLight },
            { offset: 1, color: spot.colorDark },
          ],
          textureSpace: "local",
        });

      const fullTint = new Graphics();
      fullTint.roundRect(tintLeft, tintTop, tintWidth, tintHeight, 10).fill(makeGradient());
      fullTint.blendMode = "multiply";
      fullTint.alpha = FULL_TINT_ALPHA;
      container.addChild(fullTint);

      const bandPatch = new Graphics();
      bandPatch.roundRect(bandLeft, bandTop, bandWidth, bandHeight, 6).fill(makeGradient());
      container.addChild(bandPatch);

      const text = new Text({ text: `$${spot.value}`, style: BUNDLE_TEXT_STYLE });
      text.anchor.set(0.5);
      text.x = bandLeft + bandWidth / 2;
      text.y = bandTop + bandHeight / 2;
      container.addChild(text);
      this.bundleTexts.push(text);

      parent.addChild(container);
      this.bundleContainers.push(container);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = window.setTimeout(resolve, ms);
      this.pendingSelectionTimeouts.push(id);
    });
  }

  /** A quick, transient highlight as the chase light passes over a spot — instant on/off, no
   * easing, since each step is already only tens of milliseconds long (the deceleration comes
   * from the growing gaps between steps, see buildChaseDelays). Skipped for a spot that's
   * already locked in (see startPersistentWobble) so the chase passing back over an earlier
   * winner can't stomp its wobble loop. */
  private setChaseHighlight(index: number, active: boolean): void {
    if (this.activeWobbleCancels.has(index)) return;
    const container = this.bundleContainers[index];
    const glow = this.bundleGlows[index];
    if (!container || !glow) return;
    container.scale.set(active ? 1.14 : 1);
    container.rotation = 0;
    this.setGlowAlpha(glow, active ? 0.6 : 0);
  }

  /** Sets a bundle glow's alpha, hiding it entirely at 0 (see buildBonusBundles). */
  private setGlowAlpha(glow: Graphics, alpha: number): void {
    glow.alpha = alpha;
    glow.visible = alpha > 0;
  }

  /** Locks a bundle in as "picked": an infinite scale/rotation/glow wobble loop that keeps
   * running — through the rest of the chase, through the offer reveal, until stopAllWobbles
   * clears it (a fresh playBundleSelection call, or scrollToBase on returning to the base
   * game). */
  private startPersistentWobble(index: number): void {
    const container = this.bundleContainers[index];
    const glow = this.bundleGlows[index];
    if (!container || !glow) return;
    glow.visible = true;
    const start = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const t = (now - start) / 500;
      // Floors kept well above rest (scale 1, glow 0) so a locked-in pick never dips back to
      // looking like an ordinary unselected bundle mid-wobble.
      container.scale.set(1.11 + Math.sin(t * 4.2) * 0.06);
      container.rotation = Math.sin(t * 3.1) * 0.06;
      glow.alpha = 0.55 + Math.sin(t * 4.2) * 0.2;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    this.activeWobbleCancels.set(index, () => cancelAnimationFrame(rafId));
  }

  /** Cancels every active persistent wobble loop and resets those bundles back to rest — called
   * before a fresh chase (Try Again re-selects from scratch) and when leaving the bonus board. */
  private stopAllWobbles(): void {
    for (const [index, cancel] of this.activeWobbleCancels) {
      cancel();
      const container = this.bundleContainers[index];
      const glow = this.bundleGlows[index];
      if (container) {
        container.scale.set(1);
        container.rotation = 0;
      }
      if (glow) this.setGlowAlpha(glow, 0);
    }
    this.activeWobbleCancels.clear();
  }

  /** Builds the sequence of spot indices a chase visits on its way from `start` to `winner`,
   * always stepping forward (+1, wrapping through all 10 spots — the jackpot spot included, so
   * the light visibly passes over it like any other, it just never becomes `winner`). Runs at
   * least 2 full laps so the sweep reads clearly before it settles, with the exact lap count
   * padded so the final step always lands exactly on `winner`. */
  private buildChaseIndices(start: number, winner: number): number[] {
    const slots = BUNDLE_SPOTS.length;
    const minLoopSteps = 2 * slots;
    const extra = ((winner - start - minLoopSteps) % slots + slots) % slots;
    const totalSteps = minLoopSteps + extra;
    const indices: number[] = [];
    for (let s = 1; s <= totalSteps; s++) {
      indices.push((start + s) % slots);
    }
    return indices;
  }

  /** Per-step delays for a chase of `count` steps that together sum to `totalDurationMs` — an
   * eased ramp from fast to slow so the light visibly decelerates into its landing spot,
   * roulette-wheel style, rather than stopping abruptly. */
  private buildChaseDelays(count: number, totalDurationMs: number): number[] {
    const weights: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 1 : i / (count - 1);
      weights.push(0.4 + t * t * 1.6);
    }
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => (w / sum) * totalDurationMs);
  }

  /** Finds which 1-3 of the board's own fixed, never-changing bundle values (see BUNDLE_SPOTS'
   * doc comment — the jackpot spot is excluded, it can never be a real pick) sum to exactly
   * `offerAmount`, so the chase-light can land on bundles that already display the right numbers
   * without ever rewriting any text. Brute-forces every combination of 1-3 of the 9 non-jackpot
   * spots (at most 129 — trivial) and returns the first exact match. Real offers are always a
   * sum of 1-3 draws from the same denominations this board uses, so an exact match exists for
   * the large majority of offers; the rare one that doesn't (e.g. an offer built from two or
   * three $100 draws, when the board only has one $100 bundle) falls back to whichever
   * combination gets closest — cosmetic only, never affects the amount actually credited. */
  private findBoardSubsetForOffer(offerAmount: number): number[] {
    const nonJackpot = BUNDLE_SPOTS.map((_, i) => i).filter((i) => !BUNDLE_SPOTS[i].jackpot);
    let best: number[] = [nonJackpot[0]];
    let bestDiff = Math.abs(BUNDLE_SPOTS[nonJackpot[0]].value - offerAmount);

    const consider = (idxs: number[]): boolean => {
      const sum = idxs.reduce((s, i) => s + BUNDLE_SPOTS[i].value, 0);
      const diff = Math.abs(sum - offerAmount);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = idxs;
      }
      return bestDiff === 0;
    };

    for (let a = 0; a < nonJackpot.length; a++) {
      if (consider([nonJackpot[a]])) return best;
      for (let b = a + 1; b < nonJackpot.length; b++) {
        if (consider([nonJackpot[a], nonJackpot[b]])) return best;
        for (let c = b + 1; c < nonJackpot.length; c++) {
          if (consider([nonJackpot[a], nonJackpot[b], nonJackpot[c]])) return best;
        }
      }
    }
    return best;
  }

  /** Runs one decelerating chase from `start` to `winner` over `durationMs`, then locks it into
   * its persistent wobble once the light lands (the bundle's number never changes — it's already
   * showing its fixed value, see BUNDLE_SPOTS). Resolves with `winner`, so the caller can chain
   * the next chase starting from where this one left off. */
  private async runChaseToWinner(start: number, winner: number, durationMs: number): Promise<number> {
    const indices = this.buildChaseIndices(start, winner);
    const delays = this.buildChaseDelays(indices.length, durationMs);
    let previous: number | null = null;
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (previous !== null) this.setChaseHighlight(previous, false);
      this.setChaseHighlight(index, true);
      previous = index;
      await this.wait(delays[i]);
    }
    this.startPersistentWobble(winner);
    return winner;
  }

  /** Plays a decelerating "chase light" sweeping across all 10 bundles (including the $1000
   * jackpot spot, which the light can pass over but can never land on and win — flashing it on
   * an ordinary offer would be a promise this game doesn't keep), landing on whichever 1-3 of
   * the board's fixed bundle values (see findBoardSubsetForOffer) sum to exactly `offerAmount` —
   * so "the system selected these bundles" and "here's your offer" always tell one consistent
   * story, without ever rewriting a bundle's displayed number (confirmed with user: the board's
   * numbers must stay fixed). Each pick it lands on stays scaled/wobbling/glowing continuously
   * (see startPersistentWobble) even after this resolves and the offer amount is revealed — only
   * the next playBundleSelection call (Try Again) or a return to the base game clears them. Call
   * once per offer, before revealing that offer's amount. */
  async playBundleSelection(offerAmount: number): Promise<void> {
    this.stopAllWobbles();
    const winners = this.findBoardSubsetForOffer(offerAmount);

    const totalBudgetMs = 2600; // "2 or 3 sec" total, split across however many picks land
    const perPickMs = totalBudgetMs / winners.length;

    let cursor = Math.floor(Math.random() * BUNDLE_SPOTS.length);
    for (const winner of winners) {
      cursor = await this.runChaseToWinner(cursor, winner, perPickMs);
      await this.wait(140);
    }
  }

  /** Crops the canvas to `rect` of the design screen: resizes its drawing buffers, pins it there
   * (CSS, inside TopDollarGame's 1920x1080 host) and shifts the scene to match. Renders at once,
   * so the freshly cleared buffer is never shown blank. */
  private setView(rect: ViewRect): void {
    this.view = rect;
    const renderer = this.app.renderer;
    if (renderer.width !== rect.width || renderer.height !== rect.height) {
      renderer.resize(rect.width, rect.height, renderer.resolution);
    }
    this.root.position.set(-rect.left, -rect.top);
    Object.assign(this.app.canvas.style, { position: "absolute", left: `${rect.left}px`, top: `${rect.top}px` });
    this.app.render();
  }

  /** Changes the canvas's backing resolution (keeping its current view). */
  setResolution(resolution: number): void {
    this.app.renderer.resize(this.view.width, this.view.height, resolution);
    this.app.render();
  }

  static async create(app: Application): Promise<TopDollarScene> {
    const resolution = app.renderer.resolution;
    // Largest a symbol is ever drawn: fit inside its cell, times Reel's icon scale and its
    // win-highlight pulse peak.
    const symbolFit = Math.min(CELL_WIDTH - SYMBOL_PADDING * 2, CELL_HEIGHT - SYMBOL_PADDING * 2);
    const symbolDrawnPx = symbolFit * SYMBOL_ICON_SCALE * WIN_PULSE_PEAK;
    const [, textures, noteTexture] = await Promise.all([
      preloadBackgrounds(),
      loadSymbolTextures(artScale(symbolDrawnPx, SYMBOL_ART_SIZE, resolution)),
      loadNoteBundleTexture(artScale(NOTE_WIDTH * BUNDLE_MAX_SCALE, NOTE_ART_WIDTH, resolution)),
      // Make sure Digital-7 is actually loaded before the BET/WIN Text objects are created —
      // otherwise the first paint can briefly fall back to the default font.
      document.fonts.load(`${READOUT_FONT_SIZE}px Digital-7`),
    ]);
    return new TopDollarScene(app, textures, noteTexture);
  }

  /** Spins all 3 reels and lands on the given result. Resolves once every reel has stopped.
   * `emptyReelIndex` (0-2, or null) lands that one reel half-stopped instead of cleanly on a
   * symbol — how a loss is represented, no blank symbol needed (see pixi/Reel.ts's spinTo). */
  async spin(
    reelsResult: [ReelResult, ReelResult, ReelResult],
    emptyReelIndex: number | null,
    onReelLand?: (index: number) => void
  ): Promise<void> {
    const spins = this.reels.map((reel, i) =>
      reel.spinTo(reelsResult[i].symbols, 900 + i * 350, i === emptyReelIndex, () => onReelLand?.(i))
    );
    await Promise.all(spins);
  }

  /** Highlights the winning symbols after a line win lands — `rowsPerReel[i]` lists which row
   * indices (0=above, 1=middle/payline, 2=below) to glow/pulse on reel `i` (see Reel's
   * playWinHighlight). Call once per winning spin, after spin() resolves. */
  playWinHighlights(rowsPerReel: [number[], number[], number[]]): void {
    this.reels.forEach((reel, i) => reel.playWinHighlight(rowsPerReel[i] ?? []));
  }

  /** Ends any active win highlights early — used for the DOLLAR bonus-trigger highlight, which
   * plays for a fixed window before the screen scrolls up rather than running until the next
   * spin like a normal line-win highlight (see Reel's stopWinHighlight). */
  clearWinHighlights(): void {
    this.reels.forEach((reel) => reel.stopWinHighlight());
  }

  private setCameraY(y: number): void {
    this.camera.y = y;
    this.onCameraMove?.(y);
  }

  /** Runs on app.ticker (not a separate rAF) so each frame's camera move, the HTML background's
   * matching move (onCameraMove) and the canvas render all land in the same frame — otherwise
   * the reels/bundles could lag the background art by a frame mid-scroll. */
  private animateCameraTo(targetY: number, duration: number): Promise<void> {
    this.scrollFrameCancel?.();
    const startY = this.camera.y;
    this.setView(SCROLL_VIEW);
    return new Promise((resolve) => {
      const start = performance.now();
      const ticker = this.app.ticker;
      const stop = () => {
        ticker.remove(tick);
        this.scrollFrameCancel = null;
      };
      const tick = () => {
        const t = Math.min(Math.max((performance.now() - start) / duration, 0), 1);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.setCameraY(startY + (targetY - startY) * eased);
        if (t >= 1) {
          stop();
          this.setCameraY(targetY);
          this.setView(targetY === 0 ? BONUS_VIEW : BASE_VIEW);
          resolve();
        }
      };
      ticker.add(tick);
      this.scrollFrameCancel = stop;
    });
  }

  /** Scrolls up from the base game into the bonus board. */
  scrollToBonus(): Promise<void> {
    return this.animateCameraTo(0, SCROLL_DURATION_MS);
  }

  /** Scrolls back down from the bonus board into the base game. */
  scrollToBase(): Promise<void> {
    this.stopAllWobbles();
    return this.animateCameraTo(-CANVAS_HEIGHT, SCROLL_DURATION_MS);
  }

  destroy(): void {
    this.scrollFrameCancel?.();
    this.stopAllWobbles();
    this.pendingSelectionTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingSelectionFrames.forEach((cancel) => cancel());
    this.reels.forEach((r) => r.destroy());
    this.camera.destroy({ children: true });
  }
}
