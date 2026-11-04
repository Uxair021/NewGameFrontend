import { Application, BlurFilter, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { Mega10xSymbol } from "../api";
import { loadSymbolTextures, loadBackgroundImage } from "./symbols";
import { makeScaledTexture } from "../../shared/pixi/scaledTexture";
import { Reel } from "./Reel";
import { CoinShower, MultiplierStamp } from "./WinEffects";

/** Slow "breathing" glow pulse (per user request) — same period as Reel.ts's own symbol
 * backdrop glow, so the two read as one coordinated effect rather than two clashing speeds. */
const FRAME_GLOW_PULSE_PERIOD_MS = 1200;
/** Corner radius of the glowing border traced around each reel window (startFrameGlow) — the
 * one knob to turn to make the glow's corners rounder/sharper. */
const FRAME_GLOW_RADIUS = 0;

/** GPU-memory knob for the whole game: the canvas renders at this fraction of its on-screen
 * pixel size (see Mega10XPayGame's fitResolution use), and every texture — background and
 * symbols — is sized to match. 1 = pixel-exact; lower = less GPU memory, slightly softer art. */
export const RENDER_QUALITY = 0.85;
/** Longest side of each symbol texture: Reel draws the payline symbol at 210px and its win
 * pulse grows it by up to 9%, times RENDER_QUALITY. */
const SYMBOL_TEXTURE_SIZE = Math.round(210 * 1.09 * RENDER_QUALITY);

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;

// Matches bg.webp's native resolution exactly — no aspect-ratio distortion.
export const CANVAS_WIDTH = 1322;
export const CANVAS_HEIGHT = 605;

// Reel window + payline bounds, measured directly from bg.webp's own orange-bordered reel
// windows and the black payline baked into the art (not eyeballed) — see plan/scratch working
// this session. First-pass estimate; tune by eye against the rendered art if needed.
const WINDOW_LEFT_FRAC = 258 / CANVAS_WIDTH;
const WINDOW_RIGHT_FRAC = 1089 / CANVAS_WIDTH;
const COLUMN_GAP = 30;
const PAYLINE_FRAC = 273 / CANVAS_HEIGHT;

const WINDOW_WIDTH = (WINDOW_RIGHT_FRAC - WINDOW_LEFT_FRAC) * CANVAS_WIDTH;
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
// The pitch between reel stops — deliberately much smaller than the symbol's own rendered
// size (see Reel.ts's SYMBOL_DISPLAY_SIZE/ROW_GAP_PX): only the payline symbol renders at
// full size, its neighbors are pushed mostly out of frame, matching the reference art's one
// oversized dominant symbol per reel.
export const CELL_HEIGHT = (480 - 95) / VISIBLE_ROWS;

// The dark rounded readout box baked into bg.webp, directly below the reels — measured off
// its own bright metallic border highlight (not eyeballed). This is where BET/WIN render,
// not the separate HTML control bar underneath (per user request).
const READOUT_BOX_LEFT_FRAC = 187 / CANVAS_WIDTH;
const READOUT_BOX_RIGHT_FRAC = 1169 / CANVAS_WIDTH;
const READOUT_BOX_TOP_FRAC = 468 / CANVAS_HEIGHT;
const READOUT_BOX_BOTTOM_FRAC = 524 / CANVAS_HEIGHT;

/** "0000000.00" etc — the dim placeholder digits a real value's bright digits render on top
 * of (both right-anchored at the same x, so they always line up character-for-character —
 * see updateReadouts). Same classic LCD-odometer look as every other game's ladder readouts,
 * just applied to a live bet/win pair instead of a static paytable. */
const BET_GHOST_PATTERN = "0000000.00";
const WIN_GHOST_PATTERN = "000000000000.00";

const GHOST_STYLE = new TextStyle({ fontFamily: "Digital-7, monospace", fontSize: 30, fill: 0x3f3f46 });
const BET_VALUE_STYLE = new TextStyle({ fontFamily: "Digital-7, monospace", fontSize: 30, fill: 0xf4f4f5 });
const WIN_VALUE_STYLE = new TextStyle({ fontFamily: "Digital-7, monospace", fontSize: 30, fill: 0xef4444 });
const LABEL_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 15,
  fill: 0xd4d4d8,
});

export class Mega10XPayScene {
  private reels: Reel[] = [];
  private root: Container;
  private background: Sprite;
  private backgroundImage: HTMLImageElement;
  /** Scale (of the art's own size) the background texture was last built at. */
  private backgroundResolution = 0;
  private betGhostText!: Text;
  private betValueText!: Text;
  private winGhostText!: Text;
  private winValueText!: Text;
  /** Glowing border traced around each reel's own window individually (not a border on the
   * symbol itself — see Reel.ts) — a soft blurred backdrop plus a crisp pulsing stroke per
   * reel, same two-layer technique Crystal Clover's frame glow uses. */
  private frameGlowBackdrops: Graphics[] = [];
  private frameGlowBorders: Graphics[] = [];
  private frameGlowBounds: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  private frameGlowRafId: number | null = null;
  /** Which reels the frame glow lights (only those whose payline symbol is part of the win). */
  private frameGlowReels: boolean[] = [];
  private stamp: MultiplierStamp;
  private coinShower: CoinShower;

  private constructor(app: Application, backgroundImage: HTMLImageElement, textures: Record<Mega10xSymbol, Texture>) {
    this.root = new Container();
    app.stage.addChild(this.root);
    this.backgroundImage = backgroundImage;
    this.background = new Sprite(Texture.EMPTY);
    this.root.addChild(this.background);
    this.setBackgroundResolution(app.renderer.resolution);

    const windowLeft = WINDOW_LEFT_FRAC * app.screen.width;
    const paylineY = PAYLINE_FRAC * app.screen.height;
    const windowTop = paylineY - 1.5 * CELL_HEIGHT;

    for (let i = 0; i < REEL_COUNT; i++) {
      const reelLeft = windowLeft + i * (CELL_WIDTH + COLUMN_GAP);
      const reelWindow = new Container();
      reelWindow.x = reelLeft;
      reelWindow.y = windowTop;

      const mask = new Graphics();
      mask.rect(0, 0, CELL_WIDTH, VISIBLE_ROWS * CELL_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel(textures, CELL_WIDTH, CELL_HEIGHT);
      reelWindow.addChild(reel.container);

      const idleTarget: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol] = ["SEVEN", "SINGLE_BAR", "DOUBLE_BAR"];
      reel.showStatic(idleTarget);

      this.root.addChild(reelWindow);
      this.reels.push(reel);
      this.frameGlowBounds.push({
        left: reelLeft,
        top: windowTop,
        right: reelLeft + CELL_WIDTH,
        bottom: windowTop + VISIBLE_ROWS * CELL_HEIGHT,
      });
    }

    // Frame glow — hidden until a win (see setWinGlow), one per reel, added last so it renders
    // on top of the reel art and reads as that reel's own border lighting up.
    for (let i = 0; i < REEL_COUNT; i++) {
      const glowBackdrop = new Graphics();
      glowBackdrop.filters = [new BlurFilter({ strength: 20 })];
      glowBackdrop.visible = false;
      this.root.addChild(glowBackdrop);
      this.frameGlowBackdrops.push(glowBackdrop);

      const glowBorder = new Graphics();
      glowBorder.visible = false;
      this.root.addChild(glowBorder);
      this.frameGlowBorders.push(glowBorder);
    }

    // A thin black payline, guaranteed to line up with the payline math above regardless of
    // exactly how well the reel windows land on bg.webp's own baked-in line — per user request
    // ("draw a center black line so every user can see the pattern line").
    const payline = new Graphics();
    payline.moveTo(windowLeft, paylineY).lineTo(windowLeft + WINDOW_WIDTH, paylineY);
    payline.stroke({ color: 0x000000, width: 5, alpha: 0.85 });
    this.root.addChild(payline);

    this.buildReadouts(app);

    // Win celebrations, on top of everything.
    this.stamp = new MultiplierStamp(windowLeft + WINDOW_WIDTH / 2, paylineY);
    this.root.addChild(this.stamp.view);
    this.coinShower = new CoinShower(app, CANVAS_WIDTH, READOUT_BOX_TOP_FRAC * CANVAS_HEIGHT);
    this.root.addChild(this.coinShower.view);
  }

  /** Slams the 10X / 3X wild multiplier over the reels — see MultiplierStamp.play. */
  playMultiplierStamp(multiplier: number): { landed: Promise<void>; done: Promise<void> } {
    return this.stamp.play(multiplier);
  }

  /** Big-win coin shower; resolves when the last coin is gone. */
  playCoinShower(count: number): Promise<void> {
    return this.coinShower.play(count);
  }

  /** BET/WIN — rendered directly into the baked-in dark box below the reels, not the separate
   * HTML control bar underneath it (per user request). Each is a label + a ghost/value text
   * pair right-anchored at the same x, so the bright value always lands exactly over the
   * matching rightmost digits of the dim ghost pattern regardless of how many integer digits
   * the real value has (both always end in ".XX" — see BET_GHOST_PATTERN's doc comment). */
  private buildReadouts(app: Application): void {
    const boxLeft = READOUT_BOX_LEFT_FRAC * app.screen.width;
    const boxRight = READOUT_BOX_RIGHT_FRAC * app.screen.width;
    const boxWidth = boxRight - boxLeft;
    const centerY = ((READOUT_BOX_TOP_FRAC + READOUT_BOX_BOTTOM_FRAC) / 2) * app.screen.height;

    const betLabel = new Text({ text: "BET", style: LABEL_STYLE });
    betLabel.anchor.set(0, 0.5);
    betLabel.x = boxLeft + boxWidth * 0.06;
    betLabel.y = centerY;
    this.root.addChild(betLabel);

    const betRightEdge = boxLeft + boxWidth * 0.47;
    this.betGhostText = new Text({ text: BET_GHOST_PATTERN, style: GHOST_STYLE });
    this.betGhostText.anchor.set(1, 0.5);
    this.betGhostText.x = betRightEdge;
    this.betGhostText.y = centerY;
    this.root.addChild(this.betGhostText);

    this.betValueText = new Text({ text: "0.00", style: BET_VALUE_STYLE });
    this.betValueText.anchor.set(1, 0.5);
    this.betValueText.x = betRightEdge;
    this.betValueText.y = centerY;
    this.root.addChild(this.betValueText);

    const winLabel = new Text({ text: "WIN", style: LABEL_STYLE });
    winLabel.anchor.set(0, 0.5);
    winLabel.x = boxLeft + boxWidth * 0.53;
    winLabel.y = centerY;
    this.root.addChild(winLabel);

    const winRightEdge = boxLeft + boxWidth * 0.97;
    this.winGhostText = new Text({ text: WIN_GHOST_PATTERN, style: GHOST_STYLE });
    this.winGhostText.anchor.set(1, 0.5);
    this.winGhostText.x = winRightEdge;
    this.winGhostText.y = centerY;
    this.root.addChild(this.winGhostText);

    this.winValueText = new Text({ text: "0.00", style: WIN_VALUE_STYLE });
    this.winValueText.anchor.set(1, 0.5);
    this.winValueText.x = winRightEdge;
    this.winValueText.y = centerY;
    this.root.addChild(this.winValueText);
  }

  /** Updates the BET/WIN readouts baked into the scene — call whenever the bet changes or a
   * spin resolves. */
  updateReadouts(betAmount: number, winAmount: number): void {
    this.betValueText.text = betAmount.toFixed(2);
    this.winValueText.text = winAmount.toFixed(2);
  }

  /** (Re)builds the background texture at the canvas's backing resolution — at a backing
   * resolution below the art's own size, a full-size texture is mostly wasted GPU memory.
   * Call after changing the renderer's resolution. */
  setBackgroundResolution(resolution: number): void {
    const image = this.backgroundImage;
    const scale = Math.min(1, (resolution * CANVAS_WIDTH) / image.naturalWidth);
    if (Math.abs(scale - this.backgroundResolution) < 0.01) return;
    this.backgroundResolution = scale;
    const old = this.background.texture;
    this.background.texture = makeScaledTexture(image, scale);
    this.background.width = CANVAS_WIDTH;
    this.background.height = CANVAS_HEIGHT;
    if (old && old !== Texture.EMPTY) old.destroy(true);
  }

  static async create(app: Application): Promise<Mega10XPayScene> {
    const [backgroundImage, textures] = await Promise.all([
      loadBackgroundImage(),
      loadSymbolTextures(SYMBOL_TEXTURE_SIZE),
      // Make sure Digital-7 is actually loaded before the BET/WIN Text objects are created —
      // otherwise the first paint can briefly fall back to the default font.
      document.fonts.load("30px Digital-7"),
    ]);
    return new Mega10XPayScene(app, backgroundImage, textures);
  }

  /** Spins all reels and lands on the given result. Reels flagged in `halfStopReels` stop
   * between two symbols, leaving their payline spot empty (only ever on a loss — see the api's
   * buildLoss); every other reel lands its symbol squarely on the payline. */
  async spin(
    reelsResult: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol][],
    halfStopReels: readonly boolean[],
    onReelLand?: (index: number) => void
  ): Promise<void> {
    const spins = this.reels.map((reel, i) =>
      reel.spinTo(reelsResult[i], 900 + i * 350, 0, halfStopReels[i]).then(() => onReelLand?.(i))
    );
    await Promise.all(spins);
  }

  /** Glow + pulse on the winning payline symbols only (`winningReels`, default all), and their
   * reels' frames. Turning it off also clears a multiplier stamp still showing. */
  setWinGlow(active: boolean, winningReels: readonly boolean[] = [true, true, true]): void {
    this.reels.forEach((reel, i) => (active && winningReels[i] ? reel.startWinGlow() : reel.stopWinGlow()));
    if (active) {
      this.frameGlowReels = [...winningReels];
      this.startFrameGlow();
    } else {
      this.stopFrameGlow();
      this.stamp.clear();
    }
  }

  /** Lights up the winning reels' own borders individually (not a border around the symbol — see
   * Reel.ts) with a soft blurred backdrop plus a crisp pulsing stroke, looping until
   * stopFrameGlow() is called. */
  private startFrameGlow(): void {
    for (let i = 0; i < REEL_COUNT; i++) {
      const lit = this.frameGlowReels[i] ?? true;
      this.frameGlowBackdrops[i].visible = lit;
      this.frameGlowBorders[i].visible = lit;
      if (!lit) continue;
      const { left, top, right, bottom } = this.frameGlowBounds[i];
      const border = this.frameGlowBorders[i];
      border.clear();
      border.roundRect(left, top, right - left, bottom - top, FRAME_GLOW_RADIUS);
      border.stroke({ color: 0xffd700, width: 8, alpha: 0.9 });
    }

    if (this.frameGlowRafId !== null) return;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / FRAME_GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      for (let i = 0; i < REEL_COUNT; i++) {
        const backdrop = this.frameGlowBackdrops[i];
        if (!backdrop.visible) continue;
        const { left, top, right, bottom } = this.frameGlowBounds[i];
        backdrop.clear();
        backdrop.roundRect(left, top, right - left, bottom - top, FRAME_GLOW_RADIUS);
        backdrop.stroke({ color: 0xffb300, width: 14 + pulse * 8, alpha: 0.5 + pulse * 0.4 });
      }
      this.frameGlowRafId = requestAnimationFrame(animate);
    };
    this.frameGlowRafId = requestAnimationFrame(animate);
  }

  private stopFrameGlow(): void {
    if (this.frameGlowRafId !== null) {
      cancelAnimationFrame(this.frameGlowRafId);
      this.frameGlowRafId = null;
    }
    this.frameGlowBackdrops.forEach((g) => (g.visible = false));
    this.frameGlowBorders.forEach((g) => (g.visible = false));
  }

  destroy(): void {
    this.stopFrameGlow();
    this.stamp.destroy();
    this.coinShower.destroy();
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
  }
}
