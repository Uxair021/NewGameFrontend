import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { ReelResult } from "../api";
import { loadSymbolTextures, loadBottomScreenTexture, loadTopScreenTexture, loadGemTexture } from "./symbols";
import { Reel } from "./Reel";

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
const COLUMN_GAP = 30;

// Both screen assets are native 1920x1080 — use that directly as canvas size, same convention
// Buffalo 777 uses for its own background art.
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

// Fractional position of the reel window within bottomScreen.webp (the 3 white glass panes) —
// first-pass estimate from the art; tune by eye as needed.
const WINDOW_LEFT_FRAC = 0.195;
const WINDOW_RIGHT_FRAC = 0.80;
const WINDOW_TOP_FRAC = 0.10;
const WINDOW_BOTTOM_FRAC = 0.46;

const WINDOW_WIDTH = (WINDOW_RIGHT_FRAC - WINDOW_LEFT_FRAC) * CANVAS_WIDTH;
const WINDOW_HEIGHT = (WINDOW_BOTTOM_FRAC - WINDOW_TOP_FRAC) * CANVAS_HEIGHT;
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
export const CELL_HEIGHT = WINDOW_HEIGHT / VISIBLE_ROWS;

const PAYLINE_COLOR_IDLE = 0xFF0000;
const PAYLINE_TRIANGLE_SIZE = 40;
const PAYLINE_GLOW_STEPS = 4;

// The dark gold-bordered readout box baked into bottomScreen.webp, directly below the reel
// window — first-pass estimate from the art; tune by eye as needed. This is where BET/WIN
// render (per user request), not the separate HTML control bar further down.
const READOUT_BOX_LEFT_FRAC = WINDOW_LEFT_FRAC;
const READOUT_BOX_RIGHT_FRAC = WINDOW_RIGHT_FRAC;
const READOUT_BOX_TOP_FRAC = 0.53;
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

/** The 8-gem mystery-pick grid on the bonus board — 4 columns x 2 rows (per user request),
 * centered inside topScreen.webp's plain interior panel (below the "GEMS DELUXE" title banner).
 * All 8 cells use the same gem.webp sprite (per user request — "all identical") until the player
 * taps one; unlike the old note-bundle board, nothing is pre-assigned a value, so there's no
 * board-matching logic needed (see playGemPick). */
const GEM_COLS = 4;
const GEM_ROWS = 2;
const GEM_GRID_LEFT_FRAC = 0.17;
const GEM_GRID_RIGHT_FRAC = 0.83;
const GEM_GRID_TOP_FRAC = 0.33;
const GEM_GRID_BOTTOM_FRAC = 0.82;
/** Fraction of a grid cell's smaller dimension the gem sprite actually fills — leaves a gap
 * between neighboring gems instead of them touching edge-to-edge. */
const GEM_FILL_FRAC = 0.72;

/** How long the vertical scroll between the base game and the bonus board takes. */
const SCROLL_DURATION_MS = 3000;

/** How many pixels of the bottom screen's own top edge peek up into view underneath the top
 * screen at rest — see the constructor's camera.y. Small enough to stay well within
 * bottomScreen.webp's top border art (above WINDOW_TOP_FRAC, i.e. above the reel window itself),
 * so no actual gameplay content shows early. */
const INITIAL_BOTTOM_PEEK = 100;

/** The idle glow is a blurred halo sitting behind each gem sprite (padded out past its edges,
 * heavily blurred) — reads like a CSS box-shadow glow, lit up once a gem is picked (see
 * playGemPick). Same technique the old note-bundle board used for its own selection glow. */
/** How far (px) the picked gem's halo fades out past its edge — stands in for the old blur strength. */
const GEM_GLOW_FEATHER = 20;
const GEM_GLOW_COLOR = 0x6ee7b7;

const REVEAL_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 150,
  fill: 0xfff7c2,
  stroke: { color: 0x14532d, width: 14 },
  align: "center",
});

/** "PICK A GEM!" — sits in the board's own empty strip below the grid, pulsing while the player
 * hasn't tapped one yet (see startGemIdle/stopGemIdle). The idle bob alone was too subtle a cue
 * on its own (confirmed with user), so this pairs with a spoken prompt (see GemsDeluxeGame's
 * runSpin) to make "you need to pick one" obvious both visually and audibly. */
const PICK_PROMPT_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 46,
  fill: 0xfde68a,
  stroke: { color: 0x14532d, width: 6 },
  align: "center",
});
const PICK_PROMPT_Y_FRAC = 0.865;

export class GemsDeluxeScene {
  private reels: Reel[] = [];
  /** Scrolls between showing the bottom screen (y = -CANVAS_HEIGHT) and the top screen
   * (y = 0) — both screens are full canvas-height containers stacked vertically inside this,
   * and the app's own canvas (fixed at CANVAS_WIDTH x CANVAS_HEIGHT) naturally clips whichever
   * one isn't currently in view, no mask needed. */
  private camera: Container;
  /** The 8 gem containers (sprite + glow), in grid order (row-major, see buildGemGrid). */
  private gemContainers: Container[] = [];
  private gemGlows: Graphics[] = [];
  /** Idle "tap me" bob loop over all 8 gems — runs while waiting for a pick, stopped the instant
   * one is tapped (see startGemIdle/stopGemIdle). */
  private gemIdleCancel: (() => void) | null = null;
  /** "PICK A GEM!" prompt, alpha 0 at rest — pulsed visible by startGemIdle, hidden by
   * stopGemIdle (see PICK_PROMPT_TEXT_STYLE). */
  private pickPromptText!: Text;
  /** The offer amount text popped out of whichever gem the player picked — stays on screen
   * (see playGemPick) until playTakeItPayout animates it away. */
  private revealedAmountText: Text | null = null;
  private scrollFrameCancel: (() => void) | null = null;
  /** Cancel functions for in-flight rAF tweens (shake/blast/reveal/payout) — see animateTween.
   * Let's destroy() cut them short if the component unmounts mid-animation. */
  private pendingSelectionFrames: Array<() => void> = [];
  private betValueText!: Text;
  private winValueText!: Text;

  private constructor(
    app: Application,
    bottomBg: Sprite,
    topBg: Sprite,
    textures: Awaited<ReturnType<typeof loadSymbolTextures>>,
    gemTexture: Texture
  ) {
    this.camera = new Container();
    app.stage.addChild(this.camera);

    const bottomScreen = new Container();
    bottomScreen.y = CANVAS_HEIGHT;
    bottomScreen.addChild(bottomBg);

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
    topScreen.addChild(topBg);

    this.buildGemGrid(topScreen, gemTexture);

    this.pickPromptText = new Text({ text: "PICK A GEM!", style: PICK_PROMPT_TEXT_STYLE });
    this.pickPromptText.anchor.set(0.5);
    this.pickPromptText.x = CANVAS_WIDTH / 2;
    this.pickPromptText.y = PICK_PROMPT_Y_FRAC * CANVAS_HEIGHT;
    this.pickPromptText.alpha = 0;
    topScreen.addChild(this.pickPromptText);

    this.camera.addChild(topScreen, bottomScreen);
    // Start showing the top screen, nudged up just enough to peek the very top edge of the
    // bottom screen's cabinet art in underneath — a visual hint that there's a whole machine
    // below, not a separate unrelated screen (confirmed with user: "give user a thinking like
    // this is the whole game"). GemsDeluxeGame plays a brief intro (hold here, then scroll the
    // rest of the way down via scrollToBase) before enabling the base game's controls.
    this.camera.y = -INITIAL_BOTTOM_PEEK;
  }

  /** Draws the neon payline: a glowing horizontal line from `left` to `right` at `y`, with an
   * outlined (not filled) triangle at each end pointing inward — same look as Crazy 777's. */
  private drawPayline(parent: Container, left: number, right: number, y: number): void {
    // Soft glow from stacked translucent strokes, widest/faintest first — filter-free, so no
    // BlurFilter render targets held in GPU memory or extra pass every frame.
    const glow = new Graphics();
    for (let i = 0; i < PAYLINE_GLOW_STEPS; i++) {
      const width = 16 + 12 * (1 - i / (PAYLINE_GLOW_STEPS - 1));
      glow.moveTo(left, y).lineTo(right, y);
      glow.stroke({ color: PAYLINE_COLOR_IDLE, width, alpha: 0.55 / PAYLINE_GLOW_STEPS + 0.03, cap: "round" });
    }
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

  /** BET/WIN readout box baked into bottomScreen.webp, directly below the reel window — each
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
    // bottomScreen.webp's own busy dark-navy art — drawn first so everything else sits on top.
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

  /** Builds the 8-gem grid (4 cols x 2 rows) on the bonus board — every cell uses the same
   * gem.webp sprite (per user request), in paint order: a blurred box-shadow-style glow halo
   * (alpha 0 at rest, lit up by playGemPick once that gem is chosen) sitting behind the gem
   * sprite itself. Each cell starts fully interactive (tappable) — see showGemPicker, which
   * resets that state at the start of every bonus round. */
  private buildGemGrid(parent: Container, gemTexture: Texture): void {
    const gridWidth = (GEM_GRID_RIGHT_FRAC - GEM_GRID_LEFT_FRAC) * CANVAS_WIDTH;
    const gridHeight = (GEM_GRID_BOTTOM_FRAC - GEM_GRID_TOP_FRAC) * CANVAS_HEIGHT;
    const cellWidth = gridWidth / GEM_COLS;
    const cellHeight = gridHeight / GEM_ROWS;
    const gemSize = Math.min(cellWidth, cellHeight) * GEM_FILL_FRAC;

    for (let row = 0; row < GEM_ROWS; row++) {
      for (let col = 0; col < GEM_COLS; col++) {
        const container = new Container();
        container.x = GEM_GRID_LEFT_FRAC * CANVAS_WIDTH + cellWidth * (col + 0.5);
        container.y = GEM_GRID_TOP_FRAC * CANVAS_HEIGHT + cellHeight * (row + 0.5);
        container.hitArea = new Rectangle(-gemSize / 2, -gemSize / 2, gemSize, gemSize);

        // Filter-free soft halo: stacked translucent circles shrinking inward, so the core is
        // solid and the edge fades over GEM_GLOW_FEATHER px (in place of a BlurFilter).
        const glow = new Graphics();
        const glowRadius = gemSize * 0.62;
        const steps = 8;
        const stepAlpha = 1 - Math.pow(0.15, 1 / steps);
        for (let i = 0; i < steps; i++) {
          const grow = GEM_GLOW_FEATHER - (i * GEM_GLOW_FEATHER * 2) / steps;
          glow.circle(0, 0, glowRadius + grow).fill({ color: GEM_GLOW_COLOR, alpha: stepAlpha });
        }
        glow.alpha = 0;
        container.addChild(glow);
        this.gemGlows.push(glow);

        const sprite = new Sprite(gemTexture);
        sprite.anchor.set(0.5);
        sprite.width = gemSize;
        sprite.height = gemSize;
        container.addChild(sprite);

        parent.addChild(container);
        this.gemContainers.push(container);
      }
    }
  }

  /** Runs `onTick(t)` every frame for `durationMs`, `t` going 0→1 — the one tween primitive
   * every gem animation (idle bob aside) below is built from. Tracks its own cancel fn in
   * pendingSelectionFrames so destroy() can cut it short if the component unmounts mid-play. */
  private animateTween(durationMs: number, onTick: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      let rafId = 0;
      const cancel = () => cancelAnimationFrame(rafId);
      this.pendingSelectionFrames.push(cancel);
      const tick = (now: number) => {
        const t = Math.min((now - start) / durationMs, 1);
        onTick(t);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          const idx = this.pendingSelectionFrames.indexOf(cancel);
          if (idx >= 0) this.pendingSelectionFrames.splice(idx, 1);
          resolve();
        }
      };
      rafId = requestAnimationFrame(tick);
    });
  }

  /** Gentle "tap me" bob over all 8 gems, running while the player hasn't picked one yet — see
   * showGemPicker. Stopped the instant a gem is tapped. */
  private startGemIdle(): void {
    this.stopGemIdle();
    const start = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      this.gemContainers.forEach((container, i) => {
        container.scale.set(1 + Math.sin(t * 5.0 + i * 0.6) * 0.045);
      });
      // "PICK A GEM!" pulses alpha between 0.5 and 1 the whole time the grid is waiting for a
      // tap — paired with a spoken prompt (see GemsDeluxeGame's runSpin) since the gem bob alone
      // wasn't an obvious enough cue on its own (confirmed with user).
      this.pickPromptText.alpha = 0.75 + Math.sin(t * 3.2) * 0.25;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    this.gemIdleCancel = () => cancelAnimationFrame(rafId);
  }

  private stopGemIdle(): void {
    this.gemIdleCancel?.();
    this.gemIdleCancel = null;
    this.pickPromptText.alpha = 0;
  }

  /** Resolves with the index of whichever gem the player taps first — every gem is listening,
   * and the rest stop listening the moment one wins the race. */
  private waitForGemPick(): Promise<number> {
    return new Promise((resolve) => {
      const offs: Array<() => void> = [];
      this.gemContainers.forEach((container, i) => {
        const onTap = () => {
          offs.forEach((off) => off());
          resolve(i);
        };
        container.on("pointertap", onTap);
        offs.push(() => container.off("pointertap", onTap));
      });
    });
  }

  /** Puts the whole grid back to its pre-pick state: every gem interactive, full opacity/scale,
   * no revealed amount text left over from a previous bonus round. Call at the start of every
   * fresh bonus round (there's no "Try Again" — one bonus round is exactly one pick). */
  private resetGemGrid(): void {
    this.stopGemIdle();
    if (this.revealedAmountText) {
      this.revealedAmountText.destroy();
      this.revealedAmountText = null;
    }
    this.gemContainers.forEach((container, i) => {
      container.alpha = 1;
      container.scale.set(1);
      container.rotation = 0;
      container.eventMode = "static";
      container.cursor = "pointer";
      this.gemGlows[i].alpha = 0;
    });
  }

  /** Quick side-to-side/rotational rattle, decaying to rest — "the gem is shaking". */
  private async playShake(container: Container): Promise<void> {
    const baseX = container.x;
    await this.animateTween(500, (t) => {
      const decay = 1 - t;
      container.x = baseX + Math.sin(t * 40) * 10 * decay;
      container.rotation = Math.sin(t * 50) * 0.25 * decay;
    });
    container.x = baseX;
    container.rotation = 0;
  }

  /** A quick scale punch on the gem itself plus a ring of small chips flying outward and fading
   * — "the gem cracks open". */
  private async playBlast(container: Container): Promise<void> {
    await this.animateTween(260, (t) => {
      const s = t < 0.4 ? 1 + (t / 0.4) * 0.55 : 1.55 - ((t - 0.4) / 0.6) * 0.55;
      container.scale.set(s);
    });
    container.scale.set(1);

    const parent = container.parent;
    if (!parent) return;
    const chipCount = 10;
    const chips: Graphics[] = [];
    for (let i = 0; i < chipCount; i++) {
      const chip = new Graphics();
      chip.circle(0, 0, 5 + Math.random() * 5).fill({ color: GEM_GLOW_COLOR });
      chip.x = container.x;
      chip.y = container.y;
      parent.addChild(chip);
      chips.push(chip);
    }
    const angleStep = (Math.PI * 2) / chipCount;
    await this.animateTween(420, (t) => {
      chips.forEach((chip, i) => {
        const angle = angleStep * i;
        const dist = t * 150;
        chip.x = container.x + Math.cos(angle) * dist;
        chip.y = container.y + Math.sin(angle) * dist;
        chip.alpha = 1 - t;
        chip.scale.set(1 - t * 0.5);
      });
    });
    chips.forEach((chip) => chip.destroy());
  }

  /** Zoom-in / zoom-out reveal pop: scales up past its resting size, bounces back down past it,
   * then settles — reads as a clear "zoom in, zoom out" pulse rather than a single soft
   * overshoot. Stays centered on the gem's own position the whole time (per user request — the
   * amount sits directly over the gem, not drifting away from it). */
  private async popInAmountText(text: Text): Promise<void> {
    await this.animateTween(220, (t) => {
      text.scale.set(t * 1.7);
      text.alpha = Math.min(1, t / 0.4);
    });
    await this.animateTween(200, (t) => {
      text.scale.set(1.7 - t * 0.85);
    });
    await this.animateTween(180, (t) => {
      text.scale.set(0.85 + t * 0.15);
    });
    text.scale.set(1);
    text.alpha = 1;
  }

  /** Shows the 8-gem grid and waits for the player to tap one, then plays that gem's reveal:
   * shake → blast → the offer amount pops out and stays on screen (see playTakeItPayout for how
   * it eventually leaves). Optional hooks let the caller (GemsDeluxeGame) fire sound/voice at
   * the exact right animation beat without this class reaching into the sound module itself.
   * Call once per bonus round, right after the bonus board has scrolled into view — there's no
   * "Try Again" here, one round is exactly one pick. */
  async showGemPicker(
    offerAmount: number,
    hooks?: { onShake?: () => void; onBlast?: () => void; onReveal?: (amount: number) => void }
  ): Promise<void> {
    this.resetGemGrid();
    this.startGemIdle();

    const index = await this.waitForGemPick();
    this.stopGemIdle();

    this.gemContainers.forEach((container, i) => {
      container.eventMode = "none";
      container.cursor = "default";
      if (i !== index) {
        container.alpha = 0.28;
        container.scale.set(0.92);
      }
    });

    const picked = this.gemContainers[index];
    const glow = this.gemGlows[index];

    hooks?.onShake?.();
    await this.playShake(picked);

    hooks?.onBlast?.();
    glow.alpha = 1;
    await this.playBlast(picked);

    const text = new Text({ text: `$${offerAmount.toFixed(0)}`, style: REVEAL_TEXT_STYLE });
    text.anchor.set(0.5);
    text.x = picked.x;
    text.y = picked.y;
    text.scale.set(0.001);
    text.alpha = 0;
    picked.parent?.addChild(text);
    this.revealedAmountText = text;

    hooks?.onReveal?.(offerAmount);
    await this.popInAmountText(text);
  }

  /** Plays the "Take It" payout flourish on the amount revealed by showGemPicker: a couple of
   * quick spins while it accelerates downward and fades — reads as the win dropping away toward
   * the credit meter. Call right when the player presses TAKE IT, before resolving the bonus
   * with the server / scrolling back to the base screen. No-op if nothing has been revealed. */
  async playTakeItPayout(hooks?: { onStart?: () => void }): Promise<void> {
    const text = this.revealedAmountText;
    if (!text) return;
    hooks?.onStart?.();
    const startY = text.y;
    await this.animateTween(750, (t) => {
      text.rotation = t * Math.PI * 4;
      text.y = startY + t * t * 260;
      text.alpha = 1 - Math.max(0, t - 0.5) * 2;
      text.scale.set(1 - t * 0.4);
    });
    text.destroy();
    this.revealedAmountText = null;
  }

  static async create(app: Application): Promise<GemsDeluxeScene> {
    const [bottomTex, topTex, textures, gemTexture] = await Promise.all([
      loadBottomScreenTexture(),
      loadTopScreenTexture(),
      loadSymbolTextures(),
      loadGemTexture(),
      // Make sure Digital-7 is actually loaded before the BET/WIN Text objects are created —
      // otherwise the first paint can briefly fall back to the default font.
      document.fonts.load(`${READOUT_FONT_SIZE}px Digital-7`),
    ]);
    const bottomBg = new Sprite(bottomTex);
    bottomBg.width = CANVAS_WIDTH;
    bottomBg.height = CANVAS_HEIGHT;
    const topBg = new Sprite(topTex);
    topBg.width = CANVAS_WIDTH;
    topBg.height = CANVAS_HEIGHT;
    return new GemsDeluxeScene(app, bottomBg, topBg, textures, gemTexture);
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
      reel.spinTo(reelsResult[i].symbols, 900 + i * 350, i === emptyReelIndex).then(() => onReelLand?.(i))
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

  private animateCameraTo(targetY: number, duration: number): Promise<void> {
    this.scrollFrameCancel?.();
    const startY = this.camera.y;
    return new Promise((resolve) => {
      const start = performance.now();
      let rafId = 0;
      const tick = (now: number) => {
        const t = Math.min(Math.max((now - start) / duration, 0), 1);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.camera.y = startY + (targetY - startY) * eased;
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          this.camera.y = targetY;
          this.scrollFrameCancel = null;
          resolve();
        }
      };
      rafId = requestAnimationFrame(tick);
      this.scrollFrameCancel = () => cancelAnimationFrame(rafId);
    });
  }

  /** Scrolls up from the base game into the bonus board. */
  scrollToBonus(): Promise<void> {
    return this.animateCameraTo(0, SCROLL_DURATION_MS);
  }

  /** Scrolls back down from the bonus board into the base game. */
  scrollToBase(): Promise<void> {
    this.resetGemGrid();
    return this.animateCameraTo(-CANVAS_HEIGHT, SCROLL_DURATION_MS);
  }

  destroy(): void {
    this.scrollFrameCancel?.();
    this.stopGemIdle();
    this.pendingSelectionFrames.forEach((cancel) => cancel());
    this.reels.forEach((r) => r.destroy());
    this.camera.destroy({ children: true });
  }
}
