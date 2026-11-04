import { Container, Sprite, Texture } from "pixi.js";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { TheFinerThingSymbol } from "../api";

const FILLER_COUNT = 78;
const CELL_PADDING = 7;

/**
 * A single reel, always showing exactly 3 rows (top/middle/bottom) — a plain classic grid, no
 * 2-state empty-row shape. Mechanics mirror Fruity777's Reel.ts (prepend-above + ease the strip
 * down into place, top-to-bottom scroll), with all of its win-glow/star-sweep effects dropped —
 * this game's win treatment is a simple line + box-border overlay drawn once at the Scene level
 * (see TheFinerThingScene.showWinHighlights), not a per-symbol animation on the reel itself.
 */
export class Reel {
  public readonly container: Container;
  private textures: Record<TheFinerThingSymbol, Texture>;
  private fillerPool: TheFinerThingSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  /** [top, middle, bottom] cells currently on screen. */
  private visibleCells: Container[] = [];
  /** y-index (in cellHeight units) the *next* prepended cell will take — see Fruity777's
   * Reel.ts's identical field for the full explanation of the top-to-bottom scroll trick. */
  private nextSlotAbove = 0;

  constructor(
    textures: Record<TheFinerThingSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as TheFinerThingSymbol[];
    this.container = new Container();
  }

  private randomSymbol(): TheFinerThingSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  /** Symbols are 4:3 photo tiles — fitted inside the cell with a small margin (object-contain),
   * so each one reads as its own inset tile on the cabinet's white reel strip. */
  private buildCell(symbol: TheFinerThingSymbol): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const scale = Math.min((this.cellWidth - CELL_PADDING * 2) / sprite.texture.width, (this.cellHeight - CELL_PADDING * 2) / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  private prependCells(symbols: TheFinerThingSymbol[]): Container[] {
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

  /** Renders the reel showing exactly these 3 symbols (top/middle/bottom), no animation. */
  showStatic(target: [TheFinerThingSymbol, TheFinerThingSymbol, TheFinerThingSymbol]): void {
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

  showRandomIdle(): void {
    this.showStatic([this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
  }

  /** Spins and lands exactly on `target` (server-predetermined). Continues from whatever is
   * currently displayed, scrolling top-to-bottom with an ease-out landing. */
  spinTo(target: [TheFinerThingSymbol, TheFinerThingSymbol, TheFinerThingSymbol], duration: number, delay: number, onLand?: () => void): Promise<void> {
    if (this.visibleCells.length === 0) {
      this.showStatic([this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
    }

    const startY = this.container.y;
    const filler: TheFinerThingSymbol[] = Array.from({ length: FILLER_COUNT }, () => this.randomSymbol());
    this.prependCells(filler);
    const targetCells = this.prependCells([target[2], target[1], target[0]]).reverse(); // -> [top, middle, bottom]

    const finalY = -this.nextSlotAbove * this.cellHeight;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const land = reelLanding(startY, finalY, onLand);
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = 1 - Math.pow(1 - t, 3);
          this.container.y = startY + (finalY - startY) * eased;
          land(this.container.y);
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.container.y = finalY;
            land(finalY);
            this.keepOnly(targetCells);
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
      cell.y = i * this.cellHeight;
    });
    this.container.y = 0;
    this.nextSlotAbove = 0;
    this.visibleCells = keep;
  }

  /** Local y (in `container`'s coordinate space) of row `row`'s top edge. */
  rowY(row: number): number {
    return row * this.cellHeight;
  }

  destroy(): void {
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
