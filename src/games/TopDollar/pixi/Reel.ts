import { BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { TopDollarSymbol } from "../api";

const FILLER_COUNT = 28;
export const SYMBOL_PADDING = 5;
/** Symbol size relative to fitting inside its cell (see buildCell). */
export const SYMBOL_ICON_SCALE = 2.5;
/** Peak of playWinHighlight's scale pulse (1.16 + 0.08) — TopDollarScene sizes symbol textures
 * for this, so the pulse never stretches a symbol past its texture's own pixels. */
export const WIN_PULSE_PEAK = 1.24;
/** The win-highlight glow is a blurred box-shadow-style halo behind a winning symbol (same
 * technique as the bonus board's selected-bundle glow — see TopDollarScene's GLOW_PAD/
 * GLOW_BLUR_STRENGTH), plus a scale pulse on the symbol sprite itself. */
const WIN_GLOW_PAD = 16;
const WIN_GLOW_BLUR_STRENGTH = 10;
const WIN_GLOW_COLOR = 0xff9500;
/** Skew applied to the above/below rows (radians) so they read as curving away around a
 * cylindrical wheel — the middle/payline row stays perfectly flat/front-facing. Same technique
 * as Crazy 777's Reel. */
const ROW_TILT_SKEW = 0.01;
const ROW_TILT_SCALE_Y = 1;
/** Extra spacing between consecutive symbol positions on the strip, on top of cellHeight — the
 * payline (middle) symbol always stays exactly centered regardless of this value; the above/
 * below symbols sit further from it and partially peek out past the window's top/bottom edge,
 * same as a real cabinet. */
const ROW_GAP_PX = 150;

function easeOutBack(t: number): number {
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/**
 * A 3-row reel — shows above/middle/below symbols per column with a payline crossing the
 * middle row (see TopDollarScene's drawPayline), matching the classic mechanical-cabinet look.
 * A loss is represented by landing physically between two symbols (`halfStop`) rather than a
 * blank/filler symbol — see spinTo's doc comment.
 */
export class Reel {
  public readonly container: Container;
  private textures: Record<TopDollarSymbol, Texture>;
  private symbolPool: TopDollarSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  private visibleCells: Container[] = [];
  /** Cancels for any active win-highlight loops (see playWinHighlight) — cleared at the start
   * of every new spin/showStatic, since those are about to destroy and rebuild the very cells
   * the loops reference. */
  private winHighlightCancels: Array<() => void> = [];

  constructor(
    textures: Record<TopDollarSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.symbolPool = Object.keys(textures) as TopDollarSymbol[];
    this.container = new Container();
  }

  private get step(): number {
    return this.cellHeight + ROW_GAP_PX;
  }

  /** Resting/local y for position index i (0=above, 1=middle/payline, 2=below) — payline stays
   * put regardless of the gap; only above/below move further away. */
  private restY(i: number): number {
    return i * this.step - ROW_GAP_PX;
  }

  private randomSymbol(): TopDollarSymbol {
    return this.symbolPool[Math.floor(Math.random() * this.symbolPool.length)];
  }

  private buildCell(symbol: TopDollarSymbol): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height) * SYMBOL_ICON_SCALE;
    sprite.scale.set(scale);
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  private applyRowTilt(cells: Container[]): void {
    const tilt = [-ROW_TILT_SKEW, 0, ROW_TILT_SKEW];
    cells.forEach((cell, i) => {
      cell.skew.x = tilt[i] ?? 0;
      cell.scale.y = i === 1 ? 1 : ROW_TILT_SCALE_Y;
    });
  }

  /** Cancels any active win-highlight loops and resets those symbols' scale back to normal —
   * called automatically at the start of every new spin/showStatic (before the old cells those
   * loops reference get destroyed), and callable directly to end a highlight early (e.g. the
   * DOLLAR bonus-trigger highlight, which only plays for a fixed 1-2s window before the screen
   * scrolls up, rather than running until the next spin like a normal line-win highlight). */
  stopWinHighlight(): void {
    this.winHighlightCancels.forEach((cancel) => cancel());
    this.winHighlightCancels = [];
  }

  /** Highlights the given row indices (0=above, 1=middle/payline, 2=below) of the currently
   * landed symbols with a pulsing box-shadow-style glow halo behind the sprite plus a scale
   * wobble on the sprite itself — how a winning symbol gets called out. Runs continuously until
   * the next spin (showStatic/spinTo both clear it automatically). */
  playWinHighlight(rows: number[]): void {
    for (const row of rows) {
      const cell = this.visibleCells[row];
      const sprite = cell?.children.find((c): c is Sprite => c instanceof Sprite);
      if (!cell || !sprite) continue;
      const baseScale = sprite.scale.x;

      const glow = new Graphics();
      glow
        .roundRect(-WIN_GLOW_PAD, -WIN_GLOW_PAD, this.cellWidth + WIN_GLOW_PAD * 2, this.cellHeight + WIN_GLOW_PAD * 2, 18)
        .fill({ color: WIN_GLOW_COLOR });
      glow.filters = [new BlurFilter({ strength: WIN_GLOW_BLUR_STRENGTH })];
      cell.addChildAt(glow, 0);

      const start = performance.now();
      let rafId = 0;
      const tick = (now: number) => {
        const t = (now - start) / 500;
        // Floors kept well above rest (scale 1, glow 0) so the highlight never dips back to
        // looking like an ordinary unhighlighted symbol mid-pulse.
        const pulse = 1.16 + Math.sin(t * 4.2) * 0.08;
        sprite.scale.set(baseScale * pulse);
        glow.alpha = 0.75 + Math.sin(t * 4.2) * 0.2;
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      this.winHighlightCancels.push(() => {
        cancelAnimationFrame(rafId);
        sprite.scale.set(baseScale);
      });
    }
  }

  /** Renders the reel showing exactly these 3 symbols (above/middle/below), no animation. */
  showStatic(target: [TopDollarSymbol, TopDollarSymbol, TopDollarSymbol]): void {
    this.stopWinHighlight();
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.container.y = 0;
    this.visibleCells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = this.restY(i);
      this.container.addChild(cell);
      return cell;
    });
    this.applyRowTilt(this.visibleCells);
  }

  /**
   * Spins and lands exactly on `target` (above/middle/below on the payline) — scrolls top to
   * bottom, continuing from whatever's currently displayed so there's no jump at the start.
   *
   * `halfStop`: lands the reel physically BETWEEN two symbols instead of squarely on one — how
   * a loss is represented (no separate blank symbol/texture). The whole window ends up showing
   * a half-step-shifted view of the strip; `target` still supplies the 3 symbols nearest the
   * payline, but none of them lands cleanly on any row.
   */
  spinTo(
    target: [TopDollarSymbol, TopDollarSymbol, TopDollarSymbol],
    duration: number,
    halfStop = false,
    /** Called the moment the reel visually lands (for the reel-stop sound) — see reelLanding. */
    onLand?: () => void
  ): Promise<void> {
    this.stopWinHighlight();
    const startY = this.container.y;
    const filler: TopDollarSymbol[] = Array.from({ length: FILLER_COUNT }, () => this.randomSymbol());
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
      const start = performance.now();
      const land = reelLanding(startY, finalY, onLand);
      const tick = (now: number) => {
        const t = Math.min(Math.max((now - start) / duration, 0), 1);
        const eased = easeOutBack(t);
        this.container.y = startY + (finalY - startY) * eased;
        land(this.container.y);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          this.container.y = finalY;
          land(finalY);
          if (halfStop) {
            this.keepOnlyHalfStop(targetCells, lastFillerCell);
          } else {
            this.keepOnly(targetCells);
          }
          resolve();
        }
      };
      rafId = requestAnimationFrame(tick);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Destroys every cell except `keep`, recoordinates it to y=0 — same bookkeeping purpose as
   * Buffalo 777's Reel.keepOnly. */
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
    this.applyRowTilt(this.visibleCells);
  }

  /** Same pruning job as keepOnly, but for a half-stop landing — keeps the 3 target cells plus
   * the filler cell still partially visible just above them, all left exactly off the clean
   * grid (the whole point of a half-stop), and skips the tilt (which assumes a clean above/
   * middle/below layout a half-stopped reel doesn't have). See Crazy 777's Reel.ts for why
   * container.y gets rebased to 0 here too — without it, repeated half-stops (losses are
   * common) would keep compounding container.y further from 0 every time. */
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

  destroy(): void {
    this.stopWinHighlight();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
