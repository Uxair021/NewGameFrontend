import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { drawSoftRect } from "../../shared/pixi/softGlow";

export const FILLER_COUNT = 18;
export const SYMBOL_PADDING = 1;
const GLOW_PULSE_PERIOD_MS = 520;
/** Skew applied to the above/below rows (radians) so they read as curving away around a
 * cylindrical wheel — the middle/payline row stays perfectly flat/front-facing. */
const ROW_TILT_SKEW = 0.01;
const ROW_TILT_SCALE_Y = 1;
/** Extra spacing between consecutive symbol positions on the strip, on top of cellHeight —
 * symbols themselves stay full-size (see buildCell); this just spaces them further apart, the
 * same way a real reel strip can have wider-pitched stops. Applied uniformly everywhere a cell
 * gets positioned (scrolling AND at rest) via `step` below, so it's there from the first frame
 * of the scroll through to rest. The payline (middle) symbol always stays exactly centered
 * regardless of this value; the above/below symbols sit further from it and — at a large gap
 * like this — partially peek out past the window's top/bottom edge, same as a real cabinet.
 * Tune freely. */
const ROW_GAP_PX = 140;

function easeOutBack(t: number): number {
  // Overshoots past 1 then eases back — "spins a little past the stop, then settles".
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Generic scrolling reel — used for both the 3 normal reels and the special reel (reel 4),
 * just parameterized over each reel's own symbol alphabet. */
export class Reel<S extends string> {
  public readonly container: Container;
  private textures: Record<S, Texture>;
  private symbolPool: S[];
  private scaleOverrides: Partial<Record<S, number>>;
  private baseScale: number;
  private pendingTimeouts: number[] = [];
  /** False = the win glow never draws its per-symbol backdrop square / gold border (reel 4, whose
   * whole box has its own background glow instead) — the symbol's own pulse still plays. */
  public cellGlowFrame = true;
  private pendingFrames: Array<() => void> = [];
  /** [above, middle, below] cells currently on screen — middle is the scored payline symbol. */
  private visibleCells: Container[] = [];
  private glowGraphics: Container | null = null;
  private glowRafId: number | null = null;

  constructor(
    textures: Record<S, Texture>,
    private cellWidth: number,
    private cellHeight: number,
    /** Extra per-symbol scale multiplier (default 1, relative to `baseScaleMultiplier` below)
     * — for source art whose content fills its own canvas more than its siblings, so it'd
     * otherwise look oversized/undersized once fitted. */
    scaleOverrides: Partial<Record<S, number>> = {},
    /** This whole reel's own icon-size multiplier, applied to every symbol on it before any
     * per-symbol `scaleOverrides` entry is layered on top — lets one reel instance (e.g. the
     * special reel) render visibly bigger/smaller than the others without touching every
     * individual symbol's own override. */
    baseScaleMultiplier = 1.3
  ) {
    this.textures = textures;
    this.symbolPool = Object.keys(textures) as S[];
    this.scaleOverrides = scaleOverrides;
    this.baseScale = baseScaleMultiplier;
    this.container = new Container();
  }

  /** Center-to-center distance between consecutive symbol positions on the strip. */
  private get step(): number {
    return this.cellHeight + ROW_GAP_PX;
  }

  /** Resting/local y for position index i (0=above, 1=middle/payline, 2=below), keeping the
   * payline symbol (i=1) exactly where it always sat (cellHeight, i.e. sprite-center at
   * 1.5×cellHeight) regardless of the gap — only the above/below symbols move further away. */
  private restY(i: number): number {
    return i * this.step - ROW_GAP_PX;
  }

  private randomSymbol(): S {
    return this.symbolPool[Math.floor(Math.random() * this.symbolPool.length)];
  }

  private buildCell(symbol: S): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const fitScale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height);
    const scale = fitScale * (this.scaleOverrides[symbol] ?? this.baseScale);
    sprite.scale.set(scale);
    (sprite as Sprite & { baseScale: number }).baseScale = scale;
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Above (index 0) and below (index 2) get a slight skew/squash so they read as curving
   * away around a cylindrical wheel; the middle/payline row (index 1) always stays flat. */
  private applyRowTilt(cells: Container[]): void {
    const tilt = [-ROW_TILT_SKEW, 0, ROW_TILT_SKEW];
    cells.forEach((cell, i) => {
      cell.skew.x = tilt[i] ?? 0;
      cell.scale.y = i === 1 ? 1 : ROW_TILT_SCALE_Y;
    });
  }

  /** Renders the reel showing exactly these 3 symbols (above/middle/below), no animation. */
  showStatic(target: [S, S, S]): void {
    this.stopWinGlow();
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
   * Spins and lands exactly on `target` (above/middle/below on the payline) — scrolls
   * top-to-bottom (new symbols enter above the visible window and travel down, old ones
   * exit at the bottom), continuing from whatever's currently displayed so there's no jump
   * at the start.
   *
   * `halfStop`: lands the reel physically BETWEEN two symbols instead of squarely on one —
   * how a loss is represented (no separate "EMPTY" symbol/texture). The whole window ends up
   * showing a half-step-shifted view of the strip; `target` still supplies the 3 symbols
   * nearest the payline, but none of them lands cleanly on any row.
   */
  /** `extraFiller` adds that many more symbols to scroll past — pair it with a proportionally
   * longer `duration` so the reel genuinely spins longer instead of just slowing down. */
  spinTo(target: [S, S, S], duration: number, delay: number, halfStop = false, extraFiller = 0, onLand?: () => void): Promise<void> {
    this.stopWinGlow();

    const startY = this.container.y;
    const filler: S[] = Array.from({ length: FILLER_COUNT + extraFiller }, () => this.randomSymbol());
    const combined = [...filler, ...target];
    const total = combined.length;

    // Filler cells fill the slots closest to y=0 (arrive soonest, in array order); the 3
    // target cells take the topmost (most negative) slots, in above/middle/below order, so
    // they're the last to arrive and land exactly in view when the container finishes moving.
    // Positioned on the same step+restY grid as showStatic/keepOnly, so landing never jumps.
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

    // Landing half a cell short leaves the whole window one half-step off the clean grid —
    // every visible row ends up straddling two symbols instead of showing one squarely.
    const finalY = startY + (halfStop ? total - 0.5 : total) * step;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const land = reelLanding(startY, finalY, onLand);
        const tick = (now: number) => {
          // Clamped to >=0 — see WinCelebration.tsx for why requestAnimationFrame's
          // timestamp can otherwise come in marginally before `start`.
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
      }, delay);

      this.pendingTimeouts.push(timeoutId);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Destroys every cell except `keep` (by direct reference) and recoordinates `keep` to y=0, so the child list never grows unbounded across spins. Purely internal bookkeeping — no visible change since `keep` is already what's on screen. */
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

  /** Same pruning job as keepOnly, but for a half-stop landing: skips the tilt (that assumes a
   * clean above/middle/below layout a half-stopped reel doesn't have), and keeps the 3 target
   * cells plus the one filler cell still partially visible just above them — all left exactly
   * off the clean grid, which is the whole point of a half-stop.
   *
   * It still rebases container.y back to 0 afterward (adjusting the kept cells' own y by the
   * same amount so nothing visually moves) — without this, repeated half-stops on the same
   * reel would keep compounding container.y further and further from 0 every time (losses are
   * common, so this reel could half-stop again on the very next spin), eventually pushing
   * everything clean off the visible window. Bug seen in practice, not hypothetical. */
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

  /** Jitters container.x back and forth for `durationMs`, ending back at exactly 0. */
  private shake(durationMs: number): Promise<void> {
    const amplitude = 8;
    const speed = 0.03; // radians per ms — a fast, visible jitter
    return new Promise((resolve) => {
      const start = performance.now();
      let rafId = 0;
      const tick = (now: number) => {
        const elapsed = Math.min(now - start, durationMs);
        this.container.x = Math.sin(elapsed * speed) * amplitude;
        if (elapsed < durationMs) {
          rafId = requestAnimationFrame(tick);
        } else {
          this.container.x = 0;
          resolve();
        }
      };
      rafId = requestAnimationFrame(tick);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Eases container.y from wherever it is to `targetY` over `durationMs`. */
  private slideYTo(targetY: number, durationMs: number): Promise<void> {
    const startY = this.container.y;
    return new Promise((resolve) => {
      const start = performance.now();
      let rafId = 0;
      const tick = (now: number) => {
        const t = Math.min(Math.max((now - start) / durationMs, 0), 1);
        const eased = 1 - Math.pow(1 - t, 3);
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

  /** Resolves an already-half-stopped landing (see spinTo's `halfStop`) into a clean, complete
   * landing on the payline — call only when reels 1-3 have already won and THIS reel's own
   * result was a half-stop (nothing clean was on the payline), so the pattern doesn't get left
   * visibly ambiguous. Shakes in place for ~2s, then continues the same downward motion by the
   * remaining half-step and settles onto the normal resting grid (no bonus revealed here —
   * specialEmpty still has no effect, this is purely completing the visual). If the reel did
   * NOT half-stop (it already landed cleanly on a real bonus), no reveal is needed at all —
   * just show the glow directly. */
  async resolveHalfStopReveal(): Promise<void> {
    await this.shake(2000);
    await this.slideYTo(this.container.y + 0.5 * this.step, 400);
    this.keepOnly(this.visibleCells);
  }

  /** Gold glow + border pulse on the payline (middle) symbol — loops until stopWinGlow() is
   * called. `withBackdrop` controls BOTH the diffuse color-wash rectangle AND the pulsing
   * border outline around the symbol — set false for a plain win (just the symbol's own
   * scale/tint pulse, no background box at all), true (default) for a BIG/MEGA/JACKPOT win. */
  startWinGlow(withBackdrop = true): void {
    this.stopWinGlow();
    const middle = this.visibleCells[1];
    const sprite = middle?.children[0] as (Sprite & { baseScale: number }) | undefined;
    if (!middle || !sprite) return;

    const glow = new Container();

    // Soft blurred backdrop + crisp pulsing border — both omitted for a plain win, leaving
    // only the sprite's own scale/tint pulse below.
    let backdrop: Graphics | null = null;
    let border: Graphics | null = null;
    if (withBackdrop && this.cellGlowFrame) {
      backdrop = drawSoftRect(new Graphics(), -6, -6, this.cellWidth + 12, this.cellHeight + 12, 0xffb300, 18);
      glow.addChild(backdrop);

      border = new Graphics();
      glow.addChild(border);
    }
    middle.addChildAt(glow, 0);
    this.glowGraphics = glow;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      if (backdrop) backdrop.alpha = 0.5 + pulse * 0.5;
      if (border) {
        border.clear();
        border.roundRect(-4, -4, this.cellWidth + 8, this.cellHeight + 8, 10);
        border.stroke({ color: 0xffd700, width: 3 + pulse * 3, alpha: 0.7 + pulse * 0.3 });
      }

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
