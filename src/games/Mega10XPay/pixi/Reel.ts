import { BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Mega10xSymbol } from "../api";

const FILLER_COUNT = 75;
// Slower than a typical win-glow pulse (per user request: "slowing bg effect") — reads as a
// calmer breathing glow instead of a fast flicker.
const GLOW_PULSE_PERIOD_MS = 1200;
/** The payline symbol renders at this fixed size regardless of the (much smaller) pitch
 * between reel stops — matching the reference art's single oversized dominant symbol per
 * reel, with its neighbors pushed mostly out of frame (see ROW_GAP_PX) rather than 3 equally
 * small symbols stacked evenly. */
const SYMBOL_DISPLAY_SIZE = 210;
/** Extra spacing between consecutive symbol positions on the strip, on top of cellHeight —
 * same technique as Crazy 777's Reel.ts: the payline symbol always stays exactly centered;
 * the above/below symbols sit this much further away, mostly (or fully) peeking out past the
 * window's top/bottom edge. */
const ROW_GAP_PX = 130;

function easeOutBack(t: number): number {
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export class Reel {
  public readonly container: Container;
  private textures: Record<Mega10xSymbol, Texture>;
  private symbolPool: Mega10xSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  /** [above, middle, below] cells currently on screen — middle is the scored payline symbol. */
  private visibleCells: Container[] = [];
  private glowGraphics: Container | null = null;
  private glowRafId: number | null = null;

  constructor(
    textures: Record<Mega10xSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.symbolPool = Object.keys(textures) as Mega10xSymbol[];
    this.container = new Container();
  }

  /** Center-to-center distance between consecutive symbol positions on the strip. */
  private get step(): number {
    return this.cellHeight + ROW_GAP_PX;
  }

  /** Resting/local y for position index i (0=above, 1=middle/payline, 2=below), keeping the
   * payline symbol (i=1) exactly where it always sat regardless of the gap. */
  private restY(i: number): number {
    return i * this.step - ROW_GAP_PX;
  }

  private randomSymbol(): Mega10xSymbol {
    return this.symbolPool[Math.floor(Math.random() * this.symbolPool.length)];
  }

  private buildCell(symbol: Mega10xSymbol): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const scale = Math.min(SYMBOL_DISPLAY_SIZE / sprite.texture.width, SYMBOL_DISPLAY_SIZE / sprite.texture.height);
    sprite.scale.set(scale);
    (sprite as Sprite & { baseScale: number }).baseScale = scale;
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Renders the reel showing exactly these 3 symbols (above/middle/below), no animation. */
  showStatic(target: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol]): void {
    this.stopWinGlow();
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.container.y = 0;
    this.visibleCells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = this.restY(i);
      this.container.addChild(cell);
      return cell;
    });
  }

  /**
   * Spins and lands exactly on `target` (above/middle/below on the payline) — scrolls
   * top-to-bottom, continuing from whatever's currently displayed so there's no jump.
   *
   * `halfStop`: lands the reel physically BETWEEN two symbols instead of squarely on one —
   * how a loss is represented (no separate "EMPTY" symbol/texture, same technique Crazy 777
   * uses) — only ever passed for a reel whose line isn't a win, so the payline never looks
   * ambiguous on an actual win.
   */
  spinTo(target: [Mega10xSymbol, Mega10xSymbol, Mega10xSymbol], duration: number, delay: number, halfStop = false): Promise<void> {
    this.stopWinGlow();

    const startY = this.container.y;
    const filler: Mega10xSymbol[] = Array.from({ length: FILLER_COUNT }, () => this.randomSymbol());
    const combined = [...filler, ...target];
    const total = combined.length;

    const step = this.step;
    let lastFillerCell: Container | null = null;
    filler.forEach((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = -(i + 1) * step - ROW_GAP_PX;
      this.container.addChild(cell);
      if (i === filler.length - 1) lastFillerCell = cell;
    });
    const targetCells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = -(total - i) * step - ROW_GAP_PX;
      this.container.addChild(cell);
      return cell;
    });

    const finalY = startY + (halfStop ? total - 0.5 : total) * step;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = easeOutBack(t);
          this.container.y = startY + (finalY - startY) * eased;
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.container.y = finalY;
            if (halfStop) {
              this.keepOnlyHalfStop(targetCells, lastFillerCell);
            } else {
              this.keepOnly(targetCells);
            }
            resolve();
          }
        };
        rafId = requestAnimationFrame(tick);
      }, delay);

      this.pendingTimeouts.push(timeoutId);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  private keepOnly(keep: Container[]): void {
    const toRemove = this.container.children.filter((c) => !keep.includes(c));
    toRemove.forEach((c) => {
      this.container.removeChild(c);
      c.destroy({ children: true });
    });
    keep.forEach((cell, i) => {
      cell.y = this.restY(i);
    });
    this.container.y = 0;
    this.visibleCells = keep;
  }

  /** Same pruning job as keepOnly, but for a half-stop landing — see Crazy 777's Reel.ts (this
   * is a direct port of its keepOnlyHalfStop) for why the extra filler cell is kept and why
   * container.y is rebased to 0 afterward. */
  private keepOnlyHalfStop(targetCells: Container[], lastFillerCell: Container | null): void {
    const keep = lastFillerCell ? [lastFillerCell, ...targetCells] : targetCells;
    const toRemove = this.container.children.filter((c) => !keep.includes(c));
    toRemove.forEach((c) => {
      this.container.removeChild(c);
      c.destroy({ children: true });
    });
    const offset = this.container.y;
    keep.forEach((cell) => {
      cell.y += offset;
    });
    this.container.y = 0;
    this.visibleCells = targetCells;
  }

  /** Gold backdrop glow + pulse on the payline (middle) symbol — loops until stopWinGlow() is
   * called. No border around the symbol itself (per user request) — the per-reel frame
   * border glow lives in Mega10XPayScene.ts instead. */
  startWinGlow(): void {
    this.stopWinGlow();
    const middle = this.visibleCells[1];
    const sprite = middle?.children[0] as (Sprite & { baseScale: number }) | undefined;
    if (!middle || !sprite) return;

    const backdrop = new Graphics();
    backdrop.roundRect(-6, -6, this.cellWidth + 12, this.cellHeight + 12, 12);
    backdrop.fill({ color: 0xffb300 });
    backdrop.filters = [new BlurFilter({ strength: 18 })];
    middle.addChildAt(backdrop, 0);
    this.glowGraphics = backdrop;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      backdrop.alpha = 0.5 + pulse * 0.5;
      sprite.scale.set(sprite.baseScale * (1 + pulse * 0.09));
      sprite.tint = pulse > 0.5 ? 0xfff2c0 : 0xffffff;
      this.glowRafId = requestAnimationFrame(animate);
    };
    this.glowRafId = requestAnimationFrame(animate);
  }

  stopWinGlow(): void {
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
