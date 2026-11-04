import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { SlotSymbol } from "../api";

const FILLER_COUNT = 12;
const SYMBOL_PADDING = 6;
const GLOW_PULSE_PERIOD_MS = 520;
/** Pre-spin anticipation: reel lifts this fraction of one cell's height before the main spin
 * starts — a quick "wind up" in the same direction the reel is about to spin. */
const NUDGE_FRACTION = 0.05;
const NUDGE_DURATION_MS = 130;
/** Symbols stretch vertically with the reel's speed, up to this fraction, for a sense of motion blur. */
const MAX_MOTION_STRETCH = 0.35;
const MOTION_STRETCH_PER_SPEED = 0.05; // per px/ms
/** Scale pop on the symbols as a reel lands. */
const LAND_POP_SCALE = 0.1;
const LAND_POP_MS = 240;

export class Reel {
  public readonly container: Container;
  private textures: Record<SlotSymbol, Texture>;
  private fillerPool: SlotSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  /**
   * y-index (in cellHeight units) the *next* prepended cell will take — always decreases
   * (more negative) with each prepend, so new cells stack above whatever's already there.
   * Reset to 0 by keepOnly()/showStatic() after every spin settles, so this never drifts to
   * an ever-larger magnitude across many spins.
   */
  private nextSlotAbove = 0;
  /** [above, middle, below] cells currently on screen — middle is the scored payline symbol. */
  private visibleCells: Container[] = [];
  private glowGraphics: Container | null = null;
  private glowRafId: number | null = null;
  private popRafId: number | null = null;

  constructor(
    textures: Record<SlotSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as SlotSymbol[];
    this.container = new Container();
  }

  private randomSymbol(): SlotSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  private buildCell(symbol: SlotSymbol): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height);
    sprite.scale.set(scale);
    (sprite as Sprite & { baseScale: number }).baseScale = scale;
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Prepends cells *above* whatever's currently on screen — each successive symbol in
   * `symbols` gets placed one slot higher (more negative y) than the last, continuing on from
   * `nextSlotAbove`. As `container.y` eases downward (more positive) toward its resting value,
   * this newly-placed stack (and the old stack sitting below it) both slide downward on
   * screen — new symbols enter from the top, old ones exit at the bottom. Returns direct
   * references — never rely on container.children order afterwards (see keepOnly). */
  private prependCells(symbols: SlotSymbol[]): Container[] {
    const cells: Container[] = [];
    symbols.forEach((sym) => {
      this.nextSlotAbove -= 1;
      const cell = this.buildCell(sym);
      cell.y = this.nextSlotAbove * this.cellHeight;
      this.container.addChild(cell);
      cells.push(cell);
    });
    return cells;
  }

  /** Renders the reel showing exactly these 3 symbols (above/middle/below), no animation. */
  showStatic(target: [SlotSymbol, SlotSymbol, SlotSymbol]): void {
    this.stopWinGlow();
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.container.y = 0;
    this.nextSlotAbove = 0;
    const cells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = i * this.cellHeight;
      this.container.addChild(cell);
      return cell;
    });
    this.visibleCells = cells;
  }

  /**
   * Quick pre-spin lift — nudges the reel up by NUDGE_FRACTION of one cell height. Meant to be
   * called on all reels together (via Promise.all) right before spinTo, so every reel visibly
   * "winds up" in sync before the spin itself starts.
   */
  nudgeUp(): Promise<void> {
    const startY = this.container.y;
    const targetY = startY - this.cellHeight * NUDGE_FRACTION;

    return new Promise((resolve) => {
      let rafId = 0;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(Math.max((now - start) / NUDGE_DURATION_MS, 0), 1);
        const eased = 1 - Math.pow(1 - t, 2);
        this.container.y = startY + (targetY - startY) * eased;
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          this.container.y = targetY;
          resolve();
        }
      };
      rafId = requestAnimationFrame(tick);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /**
   * Spins and lands exactly on `target` (above/middle/below on the payline). Continues from
   * whatever's currently displayed — filler + target are prepended *above* the existing
   * cells, then `container.y` eases downward toward the offset that brings the newly-
   * prepended target into the window — see prependCells' doc comment for why this reads as a
   * top-to-bottom fall, new symbols entering from the top and old ones exiting at the bottom.
   *
   * One smooth ease-out run straight to the resting position — no overshoot, no bounce-back,
   * no movement of any kind once it reaches `finalY`. It stops exactly where it lands (the
   * symbols then pop in scale, in place — see popVisibleCells).
   */
  spinTo(target: [SlotSymbol, SlotSymbol, SlotSymbol], duration: number, delay: number, onLand?: () => void): Promise<void> {
    this.stopWinGlow();
    if (this.visibleCells.length === 0) {
      // Nothing on screen yet (first render) — seed with a static frame to continue from.
      this.showStatic([this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
    }

    const startY = this.container.y;
    const filler: SlotSymbol[] = Array.from({ length: FILLER_COUNT }, () => this.randomSymbol());
    // Prepend order matters: filler first (ends up *below* the target, closer to the old
    // stack — passes through the window first), then target BELOW->MIDDLE->ABOVE last, so
    // "above" ends up the most-negative (topmost) of the three, per prependCells' contract.
    this.prependCells(filler);
    const targetCells = this.prependCells([target[2], target[1], target[0]]).reverse(); // -> [above, middle, below]

    // After both prepend calls above, `nextSlotAbove` is exactly the "above" target cell's
    // slot index (it was the very last decrement applied) — landing it at window-local y=0
    // means the container must shift by the negation of that.
    const finalY = -this.nextSlotAbove * this.cellHeight;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const land = reelLanding(startY, finalY, onLand);
        const tick = (now: number) => {
          // Clamped to >=0 — see WinCelebration.tsx for why requestAnimationFrame's
          // timestamp can otherwise come in marginally before `start`.
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = 1 - Math.pow(1 - t, 3);
          this.container.y = startY + (finalY - startY) * eased;
          land(this.container.y);
          if (t < 1) {
            // Derivative of the ease-out above, in px/ms.
            this.stretchCells((3 * Math.pow(1 - t, 2) * (finalY - startY)) / duration);
            rafId = requestAnimationFrame(tick);
          } else {
            this.container.y = finalY;
            land(finalY);
            this.stretchCells(0);
            this.keepOnly(targetCells);
            this.popVisibleCells();
            resolve();
          }
        };
        rafId = requestAnimationFrame(tick);
      }, delay);

      this.pendingTimeouts.push(timeoutId);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  private stretchCells(speed: number): void {
    const stretch = 1 + Math.min(MAX_MOTION_STRETCH, speed * MOTION_STRETCH_PER_SPEED);
    this.container.children.forEach((cell) => {
      const sprite = cell.children[0] as Sprite & { baseScale: number };
      sprite.scale.y = sprite.baseScale * stretch;
    });
  }

  private popVisibleCells(): void {
    const start = performance.now();
    const sprites = this.visibleCells.map((cell) => cell.children[0] as Sprite & { baseScale: number });
    const animate = (now: number) => {
      const t = Math.min(Math.max((now - start) / LAND_POP_MS, 0), 1);
      const scale = 1 + LAND_POP_SCALE * Math.sin(t * Math.PI);
      sprites.forEach((sprite) => sprite.scale.set(sprite.baseScale * scale));
      this.popRafId = t < 1 ? requestAnimationFrame(animate) : null;
    };
    this.popRafId = requestAnimationFrame(animate);
  }

  /** Destroys every cell except `keep` (by direct reference) and recoordinates `keep` to y=0, so the child list never grows unbounded across spins. Purely internal bookkeeping — no visible change since `keep` is already what's on screen. */
  private keepOnly(keep: Container[]): void {
    const toRemove = this.container.children.filter((c) => !keep.includes(c));
    toRemove.forEach((c) => {
      this.container.removeChild(c);
      c.destroy({ children: true });
    });
    keep.forEach((cell, i) => {
      cell.y = i * this.cellHeight;
    });
    this.container.y = 0;
    this.nextSlotAbove = 0;
    this.visibleCells = keep;
  }

  /** Gold glow + border pulse on the payline (middle) symbol — loops until stopWinGlow() is called. */
  startWinGlow(): void {
    this.stopWinGlow();
    const middle = this.visibleCells[1];
    const sprite = middle?.children[0] as (Sprite & { baseScale: number }) | undefined;
    if (!middle || !sprite) return;

    // Diffuse multi-layer gold glow without allocating WebGL BlurFilter renderbuffers
    const backdrop = new Graphics();
    backdrop.roundRect(-10, -10, this.cellWidth + 20, this.cellHeight + 20, 16);
    backdrop.fill({ color: 0xffb300, alpha: 0.18 });
    backdrop.roundRect(-6, -6, this.cellWidth + 12, this.cellHeight + 12, 12);
    backdrop.fill({ color: 0xffc107, alpha: 0.3 });
    backdrop.roundRect(-2, -2, this.cellWidth + 4, this.cellHeight + 4, 8);
    backdrop.fill({ color: 0xffd54f, alpha: 0.45 });

    // Crisp pulsing border on top
    const border = new Graphics();
    border.roundRect(-4, -4, this.cellWidth + 8, this.cellHeight + 8, 10);
    border.stroke({ color: 0xffd700, width: 4, alpha: 0.85 });

    const glow = new Container();
    glow.addChild(backdrop, border);
    middle.addChildAt(glow, 0);
    this.glowGraphics = glow;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      backdrop.alpha = 0.5 + pulse * 0.5;
      border.alpha = 0.6 + pulse * 0.4;

      sprite.scale.set(sprite.baseScale * (1 + pulse * 0.09));
      sprite.tint = pulse > 0.5 ? 0xfff2c0 : 0xffffff;
      this.glowRafId = requestAnimationFrame(animate);
    };
    this.glowRafId = requestAnimationFrame(animate);
  }

  stopWinGlow(): void {
    if (this.popRafId !== null) {
      cancelAnimationFrame(this.popRafId);
      this.popRafId = null;
    }
    if (this.glowRafId !== null) {
      cancelAnimationFrame(this.glowRafId);
      this.glowRafId = null;
    }
    if (this.glowGraphics) {
      this.glowGraphics.destroy();
      this.glowGraphics = null;
    }
    this.visibleCells.forEach((cell) => {
      const sprite = cell.children[0] as (Sprite & { baseScale: number }) | undefined;
      if (sprite) {
        sprite.scale.set(sprite.baseScale);
        sprite.tint = 0xffffff;
      }
    });
  }

  destroy(): void {
    this.stopWinGlow();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
