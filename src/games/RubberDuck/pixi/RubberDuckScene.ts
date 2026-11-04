import { Application, Container, Graphics, Texture } from "pixi.js";
import { RubberDuckSymbol, PositionWin } from "../api";
import { loadSymbolTextures, loadFrameTexture } from "./symbols";
import { Reel, FILLER_COUNT } from "./Reel";

const REEL_COUNT = 5;

/** Reel landing times without suspense: the first at BASE_SPIN_MS, then one every REEL_STAGGER_MS. */
const BASE_SPIN_MS = 700;
const REEL_STAGGER_MS = 260;

/** BONUS suspense: once 2 BONUS have landed (the 3rd triggers free spins), each later reel — one
 * at a time, left to right — spins on for this much longer than the reel before it lands. */
const SUSPENSE_EXTRA_MS = 2200;
/** The suspense reel's speed-up when the reel before it lands (same feel as 777 Fruity's). */
const SUSPENSE_RAMP_MS = 300;
const SUSPENSE_SPEED_UP = 1.8;
/** Reels visibly settle a little before their spin officially ends (the overshoot-and-settle
 * curve) — the speed-up, frame and drum roll start this much early so they line up with it. */
const SUSPENSE_LEAD_MS = 120;

/** Suspense frame around a reel — design px (every number). Rubber Duck's own blues: the bright
 * sky blue of its win numbers for the border, its win-border blue for the glow — wide and strong
 * so the reel under suspense clearly stands out. */
const SUSPENSE_FRAME = {
  radius: 16,
  borderColor: 0x7ee8ff,
  borderWidth: 7,
  borderPulse: 5,
  outerGlowColor: 0x2196f3,
  /** Outer glow: how many rings, how wide each, and how strong (alpha at full pulse). */
  outerGlowRings: 5,
  outerGlowStep: 6,
  outerGlowStrength: 0.75,
  /** Blue wash over the reel itself (0 = none), pulsing with the border. */
  washColor: 0x2196f3,
  washAlpha: 0.18,
  innerShadowColor: 0x03284a,
  innerShadowSize: 34,
  innerShadowAlpha: 0.5,
};
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

// Reel window bounds, measured directly from bg.png's own 5 white cell frames (pixel-scanned
// against the raw PNG, not eyeballed — cells sit at x=[285,508]/[569,789]/[850,1071]/
// [1131,1352]/[1413,1636], y=[365,572] on the 1920x1080 art).
const WINDOW_LEFT = 278;
const WINDOW_RIGHT = 1645;
const WINDOW_TOP = 340;
const WINDOW_BOTTOM = 585;
const COLUMN_GAP = 45;

const WINDOW_WIDTH = WINDOW_RIGHT - WINDOW_LEFT;
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
export const CELL_HEIGHT = WINDOW_BOTTOM - WINDOW_TOP;

/** The canvas only covers the reel strip plus room for the BONUS frame (drawn 1.5x a cell, so it
 * reaches ~60px past each cell) — not the whole 1920x1080 design. The background art is a plain
 * <img> behind it (see RubberDuckGame), and a smaller canvas means proportionally smaller GPU
 * drawing buffers. The scene keeps laying out in full design coordinates; its root is just shifted
 * by -VIEW_*. */
const VIEW_MARGIN = 70;
export const VIEW_LEFT = WINDOW_LEFT - VIEW_MARGIN;
export const VIEW_TOP = WINDOW_TOP - VIEW_MARGIN;
export const VIEW_WIDTH = WINDOW_RIGHT + VIEW_MARGIN - VIEW_LEFT;
export const VIEW_HEIGHT = WINDOW_BOTTOM + VIEW_MARGIN - VIEW_TOP;

const IDLE_SYMBOLS: RubberDuckSymbol[] = ["GRAPES", "LEMON", "AVOCADO", "COCONUT", "BANANA"];

export class RubberDuckScene {
  private reels: Reel[] = [];
  private root: Container;
  /** One suspense frame per reel (hidden until that reel builds suspense), above the reels. */
  private suspenseFrames: Graphics[] = [];
  private suspenseRafIds = new Map<number, number>();
  private suspenseTimers: number[] = [];

  private constructor(app: Application, textures: Record<RubberDuckSymbol, Texture>, frameTexture: Texture) {
    this.root = new Container();
    // Layout below stays in full design coordinates; shift it into the cropped canvas.
    this.root.position.set(-VIEW_LEFT, -VIEW_TOP);
    app.stage.addChild(this.root);

    for (let i = 0; i < REEL_COUNT; i++) {
      const reelWindow = new Container();
      reelWindow.x = WINDOW_LEFT + i * (CELL_WIDTH + COLUMN_GAP);
      reelWindow.y = WINDOW_TOP;

      const reel = new Reel(textures, CELL_WIDTH, CELL_HEIGHT, frameTexture);
      reelWindow.addChild(reel.container);
      reel.showStatic(IDLE_SYMBOLS[i]);

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    for (let i = 0; i < REEL_COUNT; i++) {
      const frame = new Graphics();
      frame.x = WINDOW_LEFT + i * (CELL_WIDTH + COLUMN_GAP);
      frame.y = WINDOW_TOP;
      frame.visible = false;
      this.root.addChild(frame);
      this.suspenseFrames.push(frame);
    }
  }

  static async create(app: Application): Promise<RubberDuckScene> {
    // Textures sized to what the canvas actually renders at (see loadSymbolTextures).
    const resolution = app.renderer.resolution;
    const [textures, frameTexture] = await Promise.all([
      loadSymbolTextures(Math.max(CELL_WIDTH, CELL_HEIGHT) * resolution),
      loadFrameTexture(Math.max(CELL_WIDTH, CELL_HEIGHT) * 1.5 * resolution),
    ]);
    return new RubberDuckScene(app, textures, frameTexture);
  }

  /** Spins all 5 reels and lands on the given result — resolves once every reel has stopped,
   * each landing a little later than the last (left to right). */
  /** Spins all 5 reels and lands on the given result — left to right. If 2 BONUS have landed
   * and the free-spins trigger is still open, each remaining reel builds suspense one at a time:
   * it spins on, speeds up as the reel before it lands, glows in a pulsing gold frame and plays a
   * drum roll (`startSuspenseSound`, which returns its stop function) until it lands. */
  async spin(
    reels: RubberDuckSymbol[],
    onReelLand?: (index: number) => void,
    startSuspenseSound?: (durationMs: number) => () => void
  ): Promise<void> {
    this.clearSuspense();
    // Which reels build suspense: those that land while exactly 2 BONUS are already showing.
    const suspense: boolean[] = [];
    let bonusSoFar = 0;
    for (let i = 0; i < REEL_COUNT; i++) {
      suspense.push(bonusSoFar === 2);
      if (reels[i] === "BONUS") bonusSoFar++;
    }
    // Landing times: normal staggering until the first suspense reel; from there each reel lands
    // after the one before it — SUSPENSE_EXTRA_MS later if it's a suspense reel.
    const landAt: number[] = [];
    let delayed = false;
    for (let i = 0; i < REEL_COUNT; i++) {
      const base = BASE_SPIN_MS + i * REEL_STAGGER_MS;
      if (suspense[i]) delayed = true;
      if (!delayed || i === 0) landAt.push(base);
      else landAt.push(landAt[i - 1] + (suspense[i] ? SUSPENSE_EXTRA_MS : REEL_STAGGER_MS));
    }

    const stopSounds = new Map<number, () => void>();
    const spins = this.reels.map((reel, i) => {
      const base = BASE_SPIN_MS + i * REEL_STAGGER_MS;
      const duration = landAt[i];
      // Same scroll speed for the extra time: proportionally more symbols to scroll past.
      const extraFiller = duration > base ? Math.round((FILLER_COUNT * (duration - base)) / base) : 0;
      let boost: { atMs: number; rampMs: number; factor: number } | undefined;
      if (suspense[i] && i > 0) {
        const startAt = Math.max(0, landAt[i - 1] - SUSPENSE_LEAD_MS);
        boost = { atMs: startAt, rampMs: SUSPENSE_RAMP_MS, factor: SUSPENSE_SPEED_UP };
        this.suspenseTimers.push(
          window.setTimeout(() => {
            this.startSuspenseFrame(i);
            const stop = startSuspenseSound?.(duration - startAt);
            if (stop) stopSounds.set(i, stop);
          }, startAt)
        );
      }
      return reel.spinTo(reels[i], duration, 0, extraFiller, boost, () => onReelLand?.(i)).then(() => {
        if (suspense[i]) {
          this.stopSuspenseFrame(i);
          stopSounds.get(i)?.();
        }
      });
    });
    await Promise.all(spins);
  }

  private startSuspenseFrame(i: number): void {
    this.stopSuspenseFrame(i);
    const frame = this.suspenseFrames[i];
    frame.visible = true;
    const f = SUSPENSE_FRAME;
    const w = CELL_WIDTH;
    const h = CELL_HEIGHT;
    const start = performance.now();
    const animate = () => {
      const pulse = 0.5 + 0.5 * Math.sin(((performance.now() - start) / 260) * Math.PI * 2);
      frame.clear();
      // Inner shadow: thin rings stepping inward from the border, each fainter than the last.
      const steps = 10;
      const ring = f.innerShadowSize / steps;
      for (let k = 0; k < steps; k++) {
        const inset = k * ring + ring / 2;
        frame.roundRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(0, f.radius - inset));
        frame.stroke({ color: f.innerShadowColor, width: ring + 0.5, alpha: f.innerShadowAlpha * Math.pow(1 - k / steps, 2) });
      }
      // Pulsing blue wash over the whole reel, so the suspense reel reads at a glance.
      if (f.washAlpha > 0) {
        frame.roundRect(0, 0, w, h, f.radius);
        frame.fill({ color: f.washColor, alpha: f.washAlpha * (0.5 + pulse * 0.5) });
      }
      // Wide, strong outer glow, then the crisp pulsing border.
      for (let k = f.outerGlowRings; k >= 1; k--) {
        const o = f.outerGlowStep * k;
        frame.roundRect(-o, -o, w + o * 2, h + o * 2, f.radius + 2 + o);
        frame.stroke({ color: f.outerGlowColor, width: f.outerGlowStep * 2, alpha: (f.outerGlowStrength * (0.45 + pulse * 0.55)) / k });
      }
      frame.roundRect(-3, -3, w + 6, h + 6, f.radius);
      frame.stroke({ color: f.borderColor, width: f.borderWidth + pulse * f.borderPulse, alpha: 0.75 + pulse * 0.25 });
      this.suspenseRafIds.set(i, requestAnimationFrame(animate));
    };
    this.suspenseRafIds.set(i, requestAnimationFrame(animate));
  }

  private stopSuspenseFrame(i: number): void {
    const id = this.suspenseRafIds.get(i);
    if (id !== undefined) cancelAnimationFrame(id);
    this.suspenseRafIds.delete(i);
    this.suspenseFrames[i].clear();
    this.suspenseFrames[i].visible = false;
  }

  private clearSuspense(): void {
    this.suspenseTimers.forEach((t) => window.clearTimeout(t));
    this.suspenseTimers = [];
    for (let i = 0; i < REEL_COUNT; i++) this.stopSuspenseFrame(i);
  }

  /** Draws the blinking blue border + floating win amount on every reel that won, clears
   * everywhere else. Call with an empty array to clear all. */
  setWinPositions(positionWins: PositionWin[]): void {
    const byReel = new Map(positionWins.map((w) => [w.reelIndex, w.win]));
    this.reels.forEach((reel, i) => {
      const amount = byReel.get(i);
      reel.setWin(amount !== undefined, amount);
    });
  }

  destroy(): void {
    this.clearSuspense();
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
  }
}
