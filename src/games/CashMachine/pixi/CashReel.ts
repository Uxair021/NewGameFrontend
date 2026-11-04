import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { CashSymbol } from "../api";

const FILLER_COUNT = 14;
const SYMBOL_PADDING = 40;
const GLOW_PULSE_PERIOD_MS = 520;

function lerpColor(from: number, to: number, t: number): number {
  const r1 = (from >> 16) & 0xff;
  const g1 = (from >> 8) & 0xff;
  const b1 = from & 0xff;
  const r2 = (to >> 16) & 0xff;
  const g2 = (to >> 8) & 0xff;
  const b2 = to & 0xff;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * A single-symbol-per-window reel (Cash Machine shows one value per reel, not a 3-row
 * grid like ShamrockSpin) with the same direct-object-reference landing-cell pattern as
 * ShamrockSpin's Reel.ts (Container.removeChildren() doesn't preserve insertion order in
 * this Pixi version — see that file's history), plus a reverse-direction spin for the
 * bonus respin (0 + null trigger), and a red (not amber) win-glow pulse.
 */
export class CashReel {
  public readonly container: Container;
  private textures: Record<CashSymbol, Texture>;
  private fillerPool: CashSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  private cellCount = 0;
  private visibleCell: Container | null = null;
  private glowGraphics: Container | null = null;
  private glowRafId: number | null = null;

  constructor(
    textures: Record<CashSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as CashSymbol[];
    this.container = new Container();
  }

  private randomSymbol(): CashSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  private buildCell(symbol: CashSymbol): Container {
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

  /** Appends cells (downward) and returns direct references — never rely on container.children order afterwards. */
  private appendCells(symbols: CashSymbol[]): Container[] {
    const cells: Container[] = [];
    symbols.forEach((sym) => {
      const cell = this.buildCell(sym);
      cell.y = this.cellCount * this.cellHeight;
      this.container.addChild(cell);
      this.cellCount++;
      cells.push(cell);
    });
    return cells;
  }

  showStatic(target: CashSymbol): void {
    this.stopWinGlow();
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.cellCount = 0;
    this.container.y = 0;
    [this.visibleCell] = this.appendCells([target]);
  }

  /** Darkens the reel to read as "not in play" for this bet tier — no spin animation plays while dimmed. */
  setDimmed(dimmed: boolean): void {
    this.container.alpha = dimmed ? 0.3 : 1;
  }

  /**
   * Spins and lands on `target`. Continues scrolling from whatever is currently
   * displayed (no jump/flash at the start). Symbols normally fall from the top of the
   * window: the filler/target cells are prepended *above* the existing content and the
   * whole strip scrolls downward. When `reverse` is true (the bonus-respin path) it
   * scrolls upward instead, as a distinct visual cue.
   */
  spinTo(target: CashSymbol, duration: number, delay: number, reverse = false): Promise<void> {
    this.stopWinGlow();
    if (this.cellCount === 0) {
      this.appendCells([this.randomSymbol()]);
    }

    const filler: CashSymbol[] = Array.from({ length: FILLER_COUNT }, () => this.randomSymbol());
    let targetCell: Container;
    let finalY: number;
    const startY = this.container.y;

    if (reverse) {
      const appended = this.appendCells([...filler, target]);
      targetCell = appended[appended.length - 1];
      finalY = startY - (filler.length + 1) * this.cellHeight;
    } else {
      // Prepend [target, ...filler] ABOVE the existing content (negative y, target furthest
      // away) and scroll the container *down* (finalY > startY), so content slides in from
      // above, landing on `target` last since it's the furthest cell.
      const block = [target, ...filler];
      const total = block.length;
      const prepended = block.map((sym, i) => {
        const cell = this.buildCell(sym);
        cell.y = (i - total) * this.cellHeight;
        this.container.addChildAt(cell, 0);
        return cell;
      });
      this.cellCount += prepended.length;
      targetCell = prepended[0];
      finalY = startY + total * this.cellHeight;
    }

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = 1 - Math.pow(1 - t, 3);
          this.container.y = startY + (finalY - startY) * eased;
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.container.y = finalY;
            this.keepOnly(targetCell);
            resolve();
          }
        };
        rafId = requestAnimationFrame(tick);
      }, delay);

      this.pendingTimeouts.push(timeoutId);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Destroys every cell except `keep`, recoordinates it to y=0, resets container.y=0. */
  private keepOnly(keep: Container): void {
    const toRemove = this.container.children.filter((c) => c !== keep);
    toRemove.forEach((c) => {
      this.container.removeChild(c);
      c.destroy({ children: true });
    });
    keep.y = 0;
    this.cellCount = 1;
    this.container.y = 0;
    this.visibleCell = keep;
  }

  /**
   * Background-only color pulse — the number itself never moves or scales, only the
   * fill behind it cycles between dark and bright red. Drawn as a plain full-cell
   * rect: bg2.webp's opaque frame art sits above this in the scene's z-order and crops
   * it to the window's true oval/shield shape, so it doesn't need to be hand-shaped.
   */
  startWinGlow(): void {
    this.stopWinGlow();
    const cell = this.visibleCell;
    if (!cell) return;

    // Built once as a white rect; each frame only its tint and alpha change (same colours as
    // redrawing a filled rect, without rebuilding the geometry every frame).
    const backdrop = new Graphics();
    backdrop.rect(0, 0, this.cellWidth, this.cellHeight);
    backdrop.fill({ color: 0xffffff });
    cell.addChildAt(backdrop, 0);
    this.glowGraphics = backdrop;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      backdrop.tint = lerpColor(0x2e0005, 0xa30f1c, pulse); // deep, as the numbers are red too
      backdrop.alpha = 0.55 + pulse * 0.45;

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
  }

  destroy(): void {
    this.stopWinGlow();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
