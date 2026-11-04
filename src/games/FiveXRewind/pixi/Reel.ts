import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { FiveXSymbol } from "../api";

const FILLER_COUNT = 20;
const SYMBOL_PADDING = 50;
const GLOW_PULSE_PERIOD_MS = 520;
const BORDER_RADIUS = 30;
const IDLE_BORDER_WIDTH = 9;
const WIN_BORDER_COLOR = 0xff2020;
/** Layers in the win glow's soft edge (see the constructor). */
const GLOW_STEPS = 5;

/** Vertical hue-shift stops matching the reference frame art: magenta at the top, through
 * red/maroon in the middle, down to orange/yellow/green at the bottom. */
const IDLE_BORDER_GRADIENT_STOPS: Array<[number, string]> = [
  [0, "#ff2fa0"],
  [0.18, "#e6396f"],
  [0.38, "#8a2a3a"],
  [0.5, "#6b3a2a"],
  [0.65, "#d9701f"],
  [0.82, "#f2c11f"],
  [1, "#3fbf5f"],
];

function easeOutBack(t: number): number {
  // Overshoots past 1 then eases back — "spins a little past the stop, then settles" — same
  // landing feel as Crazy777's Reel.
  const c1 = 0.15;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/**
 * A single, self-contained reel: its own gradient-filled frame, rainbow-pink border, a
 * single-row window of scrolling symbols, and a black payline through the middle — matches
 * the reference art (one row per reel, not 3 like the other games). On a win, only the
 * frame border shifts to red and pulses/glows — no symbol scale/tint change, no background
 * wash (explicitly requested), unlike every other game's per-symbol win glow.
 */
export class Reel {
  /** Root display object — what the Scene positions/adds to the stage. */
  public readonly view: Container;
  /** Scrolling single-column strip of symbol cells. */
  private readonly strip: Container;
  private textures: Record<FiveXSymbol, Texture>;
  private fillerPool: FiveXSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  private border: Graphics;
  private glowBackdrop: Graphics;
  private glowRafId: number | null = null;
  private idleBorderTexture: Texture;

  constructor(
    textures: Record<FiveXSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as FiveXSymbol[];

    this.view = new Container();

    const background = new Graphics();
    background.roundRect(0, 0, cellWidth, cellHeight, BORDER_RADIUS);
    // Vertical black -> white -> black gradient fill, matching the reference frame art.
    // Built as a texture sized exactly to cellHeight (not tiled) and filled in a single
    // .fill() call — Graphics.fill() consumes the current path, so a second .fill() call on
    // the same roundRect() would just no-op instead of layering on top of the first.
    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = 1;
    gradCanvas.height = Math.max(1, Math.round(cellHeight));
    const ctx = gradCanvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 0, gradCanvas.height);
    grad.addColorStop(0, "#000000");
    grad.addColorStop(0.12, "#b6b6b6");
    grad.addColorStop(0.5, "#ffffff");
    grad.addColorStop(0.2, "#ffffff");
    grad.addColorStop(1, "#000000");
    ctx.fillStyle = grad;
    ctx.fillRect(0,  1, 1, gradCanvas.height);
    background.fill({ texture: Texture.from(gradCanvas) });
    this.view.addChild(background);

    const windowMask = new Graphics();
    windowMask.roundRect(0, 0, cellWidth, cellHeight, BORDER_RADIUS);
    windowMask.fill({ color: 0xffffff });

    const symbolWindow = new Container();
    symbolWindow.addChild(windowMask);
    symbolWindow.mask = windowMask;
    this.strip = new Container();
    symbolWindow.addChild(this.strip);
    this.view.addChild(symbolWindow);

    // Stroke-only (not filled) so it reads as a glow hugging the border, not a wash across the
    // whole reel. The soft edge comes from stacked translucent strokes, widest/faintest first,
    // instead of a BlurFilter — whose render targets would stay in GPU memory and cost an extra
    // pass every frame on all 3 reels.
    this.glowBackdrop = new Graphics();
    for (let i = 0; i < GLOW_STEPS; i++) {
      const width = 22 + 20 * (1 - i / (GLOW_STEPS - 1));
      this.glowBackdrop.roundRect(-8, -8, cellWidth + 16, cellHeight + 16, BORDER_RADIUS + 6);
      this.glowBackdrop.stroke({ color: WIN_BORDER_COLOR, width, alpha: 1 / GLOW_STEPS + 0.05 });
    }
    this.glowBackdrop.alpha = 0;
    this.view.addChild(this.glowBackdrop);

    // Payline — thin black line through the vertical center.
    const payline = new Graphics();
    payline.moveTo(0, cellHeight / 2);
    payline.lineTo(cellWidth - 0, cellHeight / 2);
    payline.stroke({ color: 0x000000, width: 4, alpha: 0.9 });
    this.view.addChild(payline);

    // Idle border gradient — same "1px-wide, cellHeight-tall canvas gradient stretched over
    // the shape's local bounds" technique as the background fill above, applied to a stroke
    // instead of a fill so it maps top-to-bottom along the border ring.
    const borderGradCanvas = document.createElement("canvas");
    borderGradCanvas.width = 1;
    borderGradCanvas.height = Math.max(1, Math.round(cellHeight));
    const bctx = borderGradCanvas.getContext("2d")!;
    const bgrad = bctx.createLinearGradient(0, 0, 0, borderGradCanvas.height);
    IDLE_BORDER_GRADIENT_STOPS.forEach(([offset, color]) => bgrad.addColorStop(offset, color));
    bctx.fillStyle = bgrad;
    bctx.fillRect(0, 0, 1, borderGradCanvas.height);
    this.idleBorderTexture = Texture.from(borderGradCanvas);

    this.border = new Graphics();
    this.drawIdleBorder();
    this.view.addChild(this.border);
  }

  private drawIdleBorder(): void {
    this.border.clear();
    this.border.roundRect(0, 0, this.cellWidth, this.cellHeight, BORDER_RADIUS);
    this.border.stroke({ texture: this.idleBorderTexture, width: IDLE_BORDER_WIDTH, alpha: 1 });
  }

  private drawBorder(color: number, width: number, alpha: number): void {
    this.border.clear();
    this.border.roundRect(0, 0, this.cellWidth, this.cellHeight, BORDER_RADIUS);
    this.border.stroke({ color, width, alpha });
  }

  private randomSymbol(): FiveXSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  private buildCell(symbol: FiveXSymbol): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  private buildCellAt(symbol: FiveXSymbol, y: number): Container {
    const cell = this.buildCell(symbol);
    cell.y = y;
    this.strip.addChild(cell);
    return cell;
  }

  showStatic(target: FiveXSymbol): void {
    this.stopWinGlow();
    this.strip.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.strip.y = 0;
    this.buildCellAt(target, 0);
  }

  /** Spins and lands exactly on `target` — scrolls top-to-bottom (new symbols enter above
   * the visible window and travel down, old ones exit at the bottom), matching Crazy777's
   * Reel. Continues from whatever's currently displayed so there's no jump at the start.
   *
   * `halfStop`: lands half a symbol short, so `target`'s lower half peeks in at the top of the
   * window, the next symbol's upper half at the bottom, and the payline runs through the empty
   * gap between them — how Mega 10X Pay shows a loss. Only ever passed on a losing spin. */
  spinTo(target: FiveXSymbol, duration: number, delay: number, halfStop = false): Promise<void> {
    this.stopWinGlow();
    if (this.strip.children.length === 0) {
      this.buildCellAt(this.randomSymbol(), 0);
    }

    const startY = this.strip.y;
    // Top edge of what's on screen now: 0 after a normal landing, -cellHeight/2 after a
    // half-stop. New cells stack above it, so they never overlap the cells already showing.
    const top = Math.min(...this.strip.children.map((c) => c.y));
    const filler: FiveXSymbol[] = Array.from({ length: FILLER_COUNT }, () => this.randomSymbol());
    const total = filler.length + 1;

    // Filler cells fill the slots closest to the top (arrive soonest); the target cell takes
    // the topmost (most negative) slot, so it's the last to arrive and lands exactly in view.
    const fillerCells = filler.map((sym, i) => this.buildCellAt(sym, top - (i + 1) * this.cellHeight));
    const targetCell = this.buildCellAt(target, top - total * this.cellHeight);
    // The symbol right below the target — its top half shows under the payline on a half-stop.
    const belowTargetCell = fillerCells[fillerCells.length - 1];

    const finalY = startY - top + (halfStop ? total - 0.5 : total) * this.cellHeight;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = easeOutBack(t);
          this.strip.y = startY + (finalY - startY) * eased;
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.strip.y = finalY;
            if (halfStop) {
              this.keepOnlyHalfStop(targetCell, belowTargetCell);
            } else {
              this.keepOnly(targetCell);
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

  private keepOnly(keep: Container): void {
    const toRemove = this.strip.children.filter((c) => c !== keep);
    toRemove.forEach((c) => {
      this.strip.removeChild(c);
      c.destroy({ children: true });
    });
    keep.y = 0;
    this.strip.y = 0;
  }

  /** keepOnly for a half-stop landing: keeps the two half-visible cells (target above the
   * payline, the next symbol below it) and rebases the strip to y=0 without moving them. */
  private keepOnlyHalfStop(target: Container, below: Container): void {
    const toRemove = this.strip.children.filter((c) => c !== target && c !== below);
    toRemove.forEach((c) => {
      this.strip.removeChild(c);
      c.destroy({ children: true });
    });
    const offset = this.strip.y;
    target.y += offset;
    below.y += offset;
    this.strip.y = 0;
  }

  /** Only the frame border shifts to red and pulses/glows — no symbol or background change. */
  startWinGlow(): void {
    this.stopWinGlow();
    this.glowBackdrop.alpha = 0.001; // marks "active" for stopWinGlow's early-out check below

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);
      this.glowBackdrop.alpha = 0.55 + pulse * 0.45;
      this.drawBorder(WIN_BORDER_COLOR, 4 + pulse * 3, 0.85 + pulse * 0.15);
      this.glowRafId = requestAnimationFrame(animate);
    };
    this.glowRafId = requestAnimationFrame(animate);
  }

  stopWinGlow(): void {
    if (this.glowRafId !== null) {
      cancelAnimationFrame(this.glowRafId);
      this.glowRafId = null;
    }
    this.glowBackdrop.alpha = 0;
    this.drawIdleBorder();
  }

  destroy(): void {
    this.stopWinGlow();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.view.destroy({ children: true });
  }
}
