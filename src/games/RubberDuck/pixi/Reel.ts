import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { RubberDuckSymbol } from "../api";

/** How many filler cells scroll past on every spin — a flat count, same approach VegasHits'
 * Reel.ts uses (FILLER_COUNT = 72 there), not scaled per-reel duration. Generous on purpose: a
 * spin should visibly show a long continuous run of different symbols crossing the window, not
 * just a couple before landing. */
export const FILLER_COUNT = 40;
/** Kept small on purpose — this is the gap between consecutive symbols on the strip as it
 * scrolls, not just breathing room around the settled icon. A big padding here means a stretch
 * of bare background visibly passes between every symbol while spinning, which reads as
 * "symbols popping in one at a time" instead of one continuous strip. */
const SYMBOL_PADDING = 0;
/** How fast the blue win border pulses (one full fade in/out cycle, ms). */
const BLINK_PERIOD_MS = 850;
const BORDER_COLOR = 0x2196f3;
const BORDER_MIN_ALPHA = 0.35;
const BORDER_MAX_ALPHA = 1;
const BORDER_WIDTH = 8;

/** Dev aid only — flip to `true` to draw a bright outline around every reel's cell boundary at
 * all times (not just on a win), so the exact box each symbol has to fit inside is visible while
 * tuning SYMBOL_PADDING/scale. Flip back to `false` before shipping — this has nothing to do
 * with the real win-highlight border above, it's a static always-on guide. */
const SHOW_DEBUG_CELL_BORDER = false;
const DEBUG_BORDER_COLOR = 0xff00ff;

const WIN_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 34,
  fill: 0x7ee8ff,
  stroke: { color: 0x03284a, width: 6 },
  align: "center",
});

/** Same landing curve VegasHits/7 Crystal Clover/Sizzling 7s' reels all use: fast for almost the
 * whole spin, overshoots slightly past the final resting spot, then eases back to settle exactly
 * on it — the "advances a little past the stop, then snaps back into place" bounce that reads as
 * a real mechanical reel catching, not a smooth glide stopping on a dime. No blur filter, no
 * multi-phase accelerate/cruise/decelerate — this one curve is genuinely all those games use,
 * and the "spin" feel there comes from the continuous strip + this curve, not from anything
 * fancier layered on top. */
/** Fraction (0..1) of the scroll done `elapsed` ms into a suspense spin (see spinTo's `boost`):
 * constant speed v until atMs, a linear ramp up to factor*v over rampMs, then a cubic ease-out
 * from that speed to a stop at `duration` — same profile as 777 Fruity's suspense reel. v is
 * solved so the whole distance is covered exactly. */
function boostedProgress(elapsed: number, duration: number, boost: { atMs: number; rampMs: number; factor: number }): number {
  const T1 = Math.min(boost.atMs, duration);
  const R = Math.min(boost.rampMs, Math.max(0, duration - T1));
  const Td = Math.max(1, duration - T1 - R);
  const k = boost.factor;
  const total = T1 + ((1 + k) / 2) * R + (k * Td) / 3;
  const t = Math.min(Math.max(elapsed, 0), duration);
  let x: number;
  if (t < T1) x = t;
  else if (t < T1 + R) {
    const u = t - T1;
    x = T1 + u + ((k - 1) * u * u) / (2 * R);
  } else {
    const s = (t - T1 - R) / Td;
    x = T1 + ((1 + k) / 2) * R + ((k * Td) / 3) * (1 - Math.pow(1 - s, 3));
  }
  return Math.min(1, x / total);
}

function easeOutBack(t: number): number {
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export class Reel {
  /** What RubberDuckScene positions/adds to the stage — unmasked, so the win-amount text (which
   * floats just below the cell) never gets clipped. Holds two children: `windowContainer` (the
   * fixed one-cell viewport — never moves, never animated) and `overlayContainer` (unmasked, the
   * border+text sit here so they can extend past the cell). */
  public readonly container: Container;
  /** The fixed viewport: holds the mask (which stays put) and `stripContainer` (which scrolls).
   * Critically, the mask must live in a container that never moves — putting it inside
   * `stripContainer` itself (an earlier bug here) meant the mask moved in lockstep with the
   * content it was supposed to be clipping, so their *relative* position never changed and no
   * scrolling was ever visible through it at all — the strip silently sat frozen for the whole
   * animation, then keepOnly() swapped the final symbol in instantly, which is exactly the
   * "symbols just hide and a different one shows" popping this fixes. */
  private readonly windowContainer: Container;
  private readonly stripContainer: Container;
  private readonly overlayContainer: Container;
  private textures: Record<RubberDuckSymbol, Texture>;
  private fillerPool: RubberDuckSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  private visibleCell: Container | null = null;
  private nextSlotAbove = 0;

  private borderGraphics: Graphics | null = null;
  private winScrim: Graphics | null = null;
  private winText: Text | null = null;
  private blinkRafId: number | null = null;
  private bonusFrameSprite: Sprite | null = null;

  constructor(
    textures: Record<RubberDuckSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number,
    private frameTexture: Texture
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as RubberDuckSymbol[];

    this.container = new Container();

    this.windowContainer = new Container();
    const mask = new Graphics();
    mask.rect(0, 0, cellWidth, cellHeight).fill({ color: 0xffffff });
    this.windowContainer.addChild(mask);

    this.stripContainer = new Container();
    this.windowContainer.addChild(this.stripContainer);
    this.windowContainer.mask = mask;

    this.container.addChild(this.windowContainer);

    this.overlayContainer = new Container();
    this.container.addChild(this.overlayContainer);

    if (SHOW_DEBUG_CELL_BORDER) {
      const debugBorder = new Graphics();
      debugBorder.rect(0, 0, cellWidth, cellHeight).stroke({ color: DEBUG_BORDER_COLOR, width: 2, alignment: 0.5 });
      this.overlayContainer.addChild(debugBorder);
    }
  }

  private randomSymbol(): RubberDuckSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  private buildCell(symbol: RubberDuckSymbol): Container {
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

  showStatic(symbol: RubberDuckSymbol): void {
    this.setWin(false);
    this.stripContainer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.stripContainer.y = 0;
    this.nextSlotAbove = 0;
    const cell = this.buildCell(symbol);
    this.stripContainer.addChild(cell);
    this.visibleCell = cell;
    this.updateBonusFrame(symbol);
  }

  /** Shows frame.png wrapped around the settled symbol whenever it's BONUS — even a single one,
   * independent of the 3+ free-spin trigger and independent of setWin (BONUS never pays cash
   * directly, see winCalc.ts, so it would never otherwise get any visual treatment). Cleared for
   * every other symbol. */
  private clearBonusFrame(): void {
    if (this.bonusFrameSprite) {
      this.bonusFrameSprite.destroy();
      this.bonusFrameSprite = null;
    }
  }

  private updateBonusFrame(symbol: RubberDuckSymbol): void {
    this.clearBonusFrame();
    if (symbol !== "BONUS") return;

    const sprite = new Sprite(this.frameTexture);
    sprite.anchor.set(0.5);
    const scale = Math.min(this.cellWidth / sprite.texture.width, this.cellHeight / sprite.texture.height);
    sprite.scale.set(scale * 1.5);
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    this.overlayContainer.addChild(sprite);
    this.bonusFrameSprite = sprite;
  }

  private prependCells(symbols: RubberDuckSymbol[]): Container[] {
    const cells: Container[] = [];
    symbols.forEach((sym) => {
      this.nextSlotAbove -= 1;
      const cell = this.buildCell(sym);
      cell.y = this.nextSlotAbove * this.cellHeight;
      this.stripContainer.addChild(cell);
      cells.push(cell);
    });
    return cells;
  }

  private keepOnly(keep: Container): void {
    const toRemove = this.stripContainer.children.filter((c) => c !== keep);
    toRemove.forEach((c) => {
      this.stripContainer.removeChild(c);
      c.destroy({ children: true });
    });
    keep.y = 0;
    this.stripContainer.y = 0;
    this.nextSlotAbove = 0;
    this.visibleCell = keep;
    this.updateBonusFrame(keep.label as RubberDuckSymbol);
  }

  /** Spins and lands exactly on `symbol` — continues from whatever's on screen now, one
   * continuous top-to-bottom scroll (same technique VegasHits' Reel.ts uses: a generous run of
   * filler + easeOutBack's fast-then-overshoot-then-settle curve, nothing fancier). Unlike
   * VegasHits — which can land with its payline row empty (a symbol pair straddling above/below
   * it instead) — this reel has only the one payline and always lands its real symbol exactly
   * centered in the box, every time; there's no "between the line" state to land in here.
   * Everything scrolling happens inside `stripContainer`, which is masked to exactly one cell —
   * filler symbols above/below the landing spot never spill outside this reel's own box. */
  spinTo(
    symbol: RubberDuckSymbol,
    duration: number,
    delay: number,
    /** More symbols to scroll past — pair with a proportionally longer `duration` so the reel
     * genuinely spins longer (suspense) instead of just slowing down. */
    extraFiller = 0,
    /** Suspense: steady speed until `atMs`, then a speed-up, then an ease-out to land. */
    boost?: { atMs: number; rampMs: number; factor: number },
    /** Called the moment the reel visually lands (for the reel-stop sound) — see reelLanding. */
    onLand?: () => void
  ): Promise<void> {
    this.setWin(false);
    this.clearBonusFrame();
    if (!this.visibleCell) this.showStatic(this.randomSymbol());

    const startY = this.stripContainer.y;
    const filler: RubberDuckSymbol[] = Array.from({ length: FILLER_COUNT + extraFiller }, () => this.randomSymbol());
    this.prependCells(filler);
    const [targetCell] = this.prependCells([symbol]);
    const finalY = -this.nextSlotAbove * this.cellHeight;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const land = reelLanding(startY, finalY, onLand);
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = boost ? boostedProgress(now - start, duration, boost) : easeOutBack(t);
          this.stripContainer.y = startY + (finalY - startY) * eased;
          land(this.stripContainer.y);

          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.stripContainer.y = finalY;
            land(finalY);
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

  /** Blinking blue shadow border around this reel's current symbol, plus the amount it won
   * overlaid directly on top of it (a darkened scrim behind the number so it stays readable over
   * whatever's underneath) — drawn on the unmasked overlay layer (not inside the clipped
   * scrolling strip), sitting above the symbol rather than off to the side. Call with
   * `active: false` (amount omitted) to clear. */
  setWin(active: boolean, amount?: number): void {
    if (this.blinkRafId !== null) {
      cancelAnimationFrame(this.blinkRafId);
      this.blinkRafId = null;
    }
    if (this.borderGraphics) {
      this.borderGraphics.destroy();
      this.borderGraphics = null;
    }
    if (this.winScrim) {
      this.winScrim.destroy();
      this.winScrim = null;
    }
    if (this.winText) {
      this.winText.destroy();
      this.winText = null;
    }
    if (!active || !this.visibleCell) return;

    const border = new Graphics();
    const inset = BORDER_WIDTH / 2;
    border
      .roundRect(inset, inset, this.cellWidth - BORDER_WIDTH, this.cellHeight - BORDER_WIDTH, 14)
      .stroke({ color: BORDER_COLOR, width: BORDER_WIDTH, alignment: 0.5 });
    this.overlayContainer.addChild(border);
    this.borderGraphics = border;

    if (amount !== undefined) {
      const scrim = new Graphics();
      scrim.roundRect(inset, inset, this.cellWidth - BORDER_WIDTH, this.cellHeight - BORDER_WIDTH, 14).fill({
        color: 0x000000,
        alpha: 0.55,
      });
      this.overlayContainer.addChild(scrim);
      this.winScrim = scrim;

      const text = new Text({ text: amount.toFixed(2), style: WIN_TEXT_STYLE });
      text.anchor.set(0.5);
      text.x = this.cellWidth / 2;
      text.y = this.cellHeight / 2;
      this.overlayContainer.addChild(text);
      this.winText = text;
    }

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const phase = 0.5 + 0.5 * Math.sin((elapsed / BLINK_PERIOD_MS) * Math.PI * 2);
      border.alpha = BORDER_MIN_ALPHA + (BORDER_MAX_ALPHA - BORDER_MIN_ALPHA) * phase;
      this.blinkRafId = requestAnimationFrame(animate);
    };
    this.blinkRafId = requestAnimationFrame(animate);
  }

  /** The symbol currently showing on this reel, if any. */
  get currentSymbol(): RubberDuckSymbol | null {
    return (this.visibleCell?.label as RubberDuckSymbol | undefined) ?? null;
  }

  destroy(): void {
    this.setWin(false);
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
