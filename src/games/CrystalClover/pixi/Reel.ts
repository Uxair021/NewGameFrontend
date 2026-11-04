import { getGlowDotTexture } from "../../shared/pixi/softGlow";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { CrystalCloverSymbol } from "../api";

const ROW_COUNT = 3;
const FILLER_COUNT = 18;
const SYMBOL_PADDING = 0;
/** How far (design px) the 2X glow's soft edge reaches past its circle. */
const MULTIPLIER_GLOW_SOFTNESS = 34;
const GLOW_PULSE_PERIOD_MS = 980;
/** Full rainbow hue cycle + a separate faster pulse for the MULTIPLIER_2X build-up glow (see
 * startMultiplierGlow) — the "multicolor glow circle" teasing a 2x-symbol combo in progress. */
const MULTIPLIER_GLOW_HUE_PERIOD_MS = 1400;
const MULTIPLIER_GLOW_PULSE_PERIOD_MS = 700;
/** Symbols render taller than the row-to-row spacing (cellHeight stays the true payline pitch —
 * getRowCenterY, cell.y, the mask, etc. are all untouched) so the window reads as if it only
 * fits ~2 symbol-heights instead of 3: adjacent rows' artwork visually overlaps/straddles the
 * gap between their payline centers rather than sitting boxed cleanly inside its own row. */
const SYMBOL_OVERLAP_FACTOR = 1.5;
/** Extra vertical breathing room (px) carved out of each symbol's max render height, on top of
 * whatever SYMBOL_OVERLAP_FACTOR/SYMBOL_PADDING already leave — a clearer visible gap between
 * *symbols*, while the payline grid itself (cellHeight, getRowCenterY, the mask, cell.y) stays
 * completely untouched. Per user request: bigger gap between the artwork, not the paylines,
 * and no hiding/removing symbols — see REST_OFFSET_MAX_FRAC below for how a reel actually uses
 * this space to rest "between" two paylines. */
const ROW_GAP = 20;
/** Fraction of cellHeight actually used as the vertical distance between consecutive row
 * centers (payline pitch) — < 1 pulls row 0 (top) and row 2 (bottom) in toward the fixed row 1
 * (middle, always anchored at the window's true vertical center, see Reel.cellY/nominalRowCenterY),
 * giving each outer row more breathing room from the mask's top/bottom edge instead of sitting
 * right up against it. The mask/window height itself (cellHeight * ROW_COUNT) is untouched —
 * this only tightens where within that fixed window the 3 rows actually sit. */
const ROW_PITCH_SCALE = 0.78;
/** Chance a filler slot is real (vs. left `null`/empty) *given the previous slot was empty* —
 * see buildFiller. Two real filler symbols are never placed back-to-back (mirrors the real
 * grid's own invariant: a reel's 2 real cells, in its "top+bottom" state, always have the empty
 * middle row between them — real cells are never index-adjacent within a reel), so independent
 * per-slot randomness would occasionally place 2 reals in a row with no gap ("attached", no
 * proper distance) purely by chance. This is the chance of *starting* a new real symbol once a
 * gap has opened up; combined with the forced empty-after-real rule this settles to roughly 40%
 * of slots being real, close to the landed grid's own ~50% average fill rate. */
const FILLER_REAL_CHANCE = 0.7;

/** Builds one reel's worth of scrolling filler: never 2 real symbols back-to-back (see
 * FILLER_REAL_CHANCE), and the very last slot is always forced empty regardless — that slot
 * ends up sitting immediately adjacent to the freshly-landed bottom row once the spin lands,
 * and keepOnly destroys every filler cell the instant the reel stops with no fade-out, so a real
 * symbol left there would visibly pop out of existence right next to the symbol that stays. */
function buildFiller(count: number, randomSymbol: () => CrystalCloverSymbol): (CrystalCloverSymbol | null)[] {
  const result: (CrystalCloverSymbol | null)[] = [];
  let prevReal = false;
  for (let i = 0; i < count; i++) {
    const isReal: boolean = !prevReal && Math.random() < FILLER_REAL_CHANCE;
    result.push(isReal ? randomSymbol() : null);
    prevReal = isReal;
  }
  if (result.length > 0) result[result.length - 1] = null;
  return result;
}

/** Pure version of Reel.cellY + the sprite's own cellHeight/2 in-box offset, for callers with no
 * live Reel instance (CrystalCloverScene's fixed debug-payline reference lines) that need the
 * exact same row-center formula without a restOffset baked in. Kept in sync automatically since
 * both read the same ROW_PITCH_SCALE constant. */
export function nominalRowCenterY(cellHeight: number, row: number): number {
  return cellHeight + (row - 1) * cellHeight * ROW_PITCH_SCALE + cellHeight / 2;
}
/** Max size (as a fraction of cellHeight) of the random vertical nudge applied to the *idle*
 * pre-spin display only (see showStatic) — purely a "doesn't look robotically perfect before
 * the first spin" flourish, unrelated to how a real spin lands (see keepOnly, which always
 * resets this to a clean 0 offset). */
const REST_OFFSET_MAX_FRAC = 0.58;

/** Overshoots slightly past 1 then eases back — "advances a little past the stop, then
 * settles" bounce, same curve Sizzling 7s's reel uses for its landing. */
function easeOutBack(t: number): number {
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Full-saturation rainbow color at hue fraction `h` (0-1) — used for the multiplier build-up
 * glow's color cycling, no external color-conversion lib needed for one hue sweep. */
function hueToHex(h: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = 1;
      g = f;
      b = 0;
      break;
    case 1:
      r = q;
      g = 1;
      b = 0;
      break;
    case 2:
      r = 0;
      g = 1;
      b = f;
      break;
    case 3:
      r = 0;
      g = q;
      b = 1;
      break;
    case 4:
      r = f;
      g = 0;
      b = 1;
      break;
    default:
      r = 1;
      g = 0;
      b = q;
      break;
  }
  return (Math.round(r * 255) << 16) + (Math.round(g * 255) << 8) + Math.round(b * 255);
}

/**
 * A single reel, 3 rows tall, classic auto-stop (server predetermines the result — see
 * engine.ts's spin() — the client only ever plays a fixed-duration animation landing on it,
 * mirroring Buffalo777's Reel.spinTo exactly). Unlike Buffalo777 (only the middle row is ever
 * scored — top/bottom are cosmetic filler), *every* row here can be part of a winning payline,
 * so win highlighting (see pulseRow) works on any row index, not just the middle.
 *
 * This reel draws none of its own background/border — frame.png (see CrystalCloverScene.ts)
 * already supplies the gold-bordered window art as a backdrop; this reel only owns the
 * scrolling symbol strip, clipped to its window via a mask so filler doesn't render outside it
 * during the spin animation.
 */
export class Reel {
  public readonly container: Container;
  private readonly strip: Container;
  /** Sits behind `strip` (added first) so a red payline segment drawn here (see
   * drawPaylineSegment) shows through the transparent margins of the symbol art in front of
   * it, matching the classic "line traced across the reels behind the symbols" look. */
  public readonly paylineLayer: Container;
  /** Sits between paylineLayer and strip — in front of the payline trace, behind the symbol
   * art — so the multicolor MULTIPLIER_2X build-up glow (see startMultiplierGlow) reads as a
   * halo peeking out from around the symbol rather than a flat circle drawn over it. */
  private readonly multiplierGlowLayer: Container;
  private multiplierGlowRafId: number | null = null;
  private multiplierGlowRows = new Set<number>();
  private multiplierGlowGraphics = new Map<number, Sprite>();
  private textures: Record<CrystalCloverSymbol, Texture>;
  private fillerPool: CrystalCloverSymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  /** Index (in cellHeight units) the *next* prepended cell gets placed at — decreases (goes
   * more negative, i.e. further above the current resting window) with every cell prepended,
   * so newly-generated content always sits above whatever's already on the strip. Reset to 0
   * whenever the strip settles (showStatic/keepOnly), matching the resting cells' own
   * 0/1/2*cellHeight positions. */
  private nextIndex = 0;
  private visibleCells: Container[] = [];
  private glowRafId: number | null = null;
  private glowRows = new Set<number>();
  /** This reel's current settle nudge (see REST_OFFSET_MAX_FRAC) — always 0 after a real spin
   * (keepOnly resets it), only ever nonzero during the idle pre-spin flourish (showStatic).
   * Added to strip.y at rest and accounted for in getRowCenterY so a payline trace still lines
   * up with wherever the symbols actually ended up on screen. */
  private restOffset = 0;

  constructor(
    textures: Record<CrystalCloverSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as CrystalCloverSymbol[];

    this.container = new Container();
    this.paylineLayer = new Container();
    this.multiplierGlowLayer = new Container();
    this.strip = new Container();

    const mask = new Graphics();
    mask.rect(0, 0, cellWidth, cellHeight * ROW_COUNT);
    mask.fill({ color: 0xffffff });
    this.container.addChild(mask);
    this.container.addChild(this.paylineLayer);
    this.container.addChild(this.multiplierGlowLayer);
    this.container.addChild(this.strip);
    this.strip.mask = mask;
    this.paylineLayer.mask = mask;
    this.multiplierGlowLayer.mask = mask;
  }

  private randomSymbol(): CrystalCloverSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  private randomRestOffset(): number {
    return (Math.random() * 2 - 1) * this.cellHeight * REST_OFFSET_MAX_FRAC;
  }

  /** Top-left y (in strip-local space) of the box for row-index `idx` — accepts any integer,
   * not just 0/1/2, so filler cells scrolling in from above (negative idx) use the exact same
   * pitch as the 3 resting rows and there's no visible snap when they land. idx=1 (the middle
   * row) always lands at `cellHeight` — i.e. exactly where it always has — so only rows 0 and 2
   * actually move (see ROW_PITCH_SCALE). */
  private cellY(idx: number): number {
    return this.cellHeight + (idx - 1) * this.cellHeight * ROW_PITCH_SCALE;
  }

  /** Builds a correctly-scaled sprite for `symbol` — caller positions it. */
  private buildSymbolSprite(symbol: CrystalCloverSymbol): Sprite & { baseScale: number } {
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 3;
    const maxH = this.cellHeight * SYMBOL_OVERLAP_FACTOR - SYMBOL_PADDING * 3 - ROW_GAP;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height);
    sprite.scale.set(scale);
    return Object.assign(sprite, { baseScale: scale });
  }

  /** `null` renders as a genuinely empty slot (no sprite) — every reel always shows either 1
   * symbol on the middle row or 2 on the top+bottom rows, never all 3 (see engine.ts's
   * buildGrid on the backend), so the empty row(s) are real server data, not a client cosmetic
   * decision. */
  private buildCell(symbol: CrystalCloverSymbol | null): Container {
    const cell = new Container();
    cell.label = symbol ?? "EMPTY";
    if (symbol === null) return cell;
    const sprite = this.buildSymbolSprite(symbol);
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Places `symbols` above whatever's already on the strip (each one gets a more-negative
   * index than the last — see `nextIndex`'s doc comment) — the arrangement that makes the
   * strip scroll top-to-bottom: content already on the strip sits below (positive/near-zero
   * y), so as strip.y increases toward its new resting value, these newly-prepended cells
   * fall down into view from above while whatever was showing before continues down and out
   * the bottom. */
  private prependCells(symbols: (CrystalCloverSymbol | null)[]): Container[] {
    const cells: Container[] = [];
    symbols.forEach((sym) => {
      this.nextIndex--;
      const cell = this.buildCell(sym);
      cell.y = this.cellY(this.nextIndex);
      this.strip.addChild(cell);
      cells.push(cell);
    });
    return cells;
  }

  /** Idle pre-spin display (game just loaded, before the first real spin resolves) — rolls the
   * same "1 real symbol on the center row, or 2 real symbols on top+bottom" shape every landed
   * spin always follows (see engine.ts's buildGrid), with random real symbols in whichever
   * slot(s) end up filled, instead of a fixed literal like 3x "BAR". Purely cosmetic; the first
   * real spin's server-decided grid replaces this immediately. */
  showRandomIdle(): void {
    const target: [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null] =
      Math.random() < 0.5 ? [null, this.randomSymbol(), null] : [this.randomSymbol(), null, this.randomSymbol()];
    this.showStatic(target);
  }

  /** Renders exactly these 3 slots (top/middle/bottom, `null` = empty), no animation. */
  showStatic(target: [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null]): void {
    this.clearGlow();
    this.clearPaylineSegments();
    this.clearMultiplierGlow();
    this.strip.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.restOffset = this.randomRestOffset();
    this.strip.y = this.restOffset;
    this.nextIndex = 0;
    this.visibleCells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = this.cellY(i);
      this.strip.addChild(cell);
      return cell;
    });
  }

  /** Spins and lands exactly on `target` (server-predetermined — see engine.ts), scrolling
   * top-to-bottom (symbols fall into place from above, matching a classic mechanical reel —
   * see prependCells) with an overshoot-and-settle bounce on landing (see easeOutBack).
   * Continues from whatever is currently displayed (filler + target prepended above the
   * existing cells, never a jump/flash). `target` may contain `null` slots (see buildCell) —
   * whichever row(s) the server's grid left empty just render as empty once landed. */
  spinTo(
    target: [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null],
    duration: number,
    delay: number,
    fillerCount = FILLER_COUNT
  ): Promise<void> {
    this.clearGlow();
    this.clearPaylineSegments();
    this.clearMultiplierGlow();
    if (this.strip.children.length === 0) {
      this.showRandomIdle();
    }

    const startY = this.strip.y;
    const filler = buildFiller(fillerCount, () => this.randomSymbol());
    // prependCells assigns a *more negative* index to each successive symbol it's given — so
    // to end up with target[0] (top row) furthest above target[2] (bottom row) once landed
    // (top must sit above middle must sit above bottom), bottom needs to be prepended first
    // and top last. Reverse target going in, then un-reverse the returned cells so
    // targetCells stays in the natural [top, middle, bottom] order everything else expects.
    const prepended = this.prependCells([...filler, ...[...target].reverse()]);
    const targetCells = prepended.slice(-target.length).reverse();
    // Aligns targetCells[0] (top — the most-negative/furthest-above cell just prepended) to its
    // true resting position (cellY(0) — NOT 0; ROW_PITCH_SCALE means row 0 no longer rests at
    // the very top of the strip's local origin) once the strip finishes scrolling down, so
    // keepOnly's own cellY(i) re-normalization afterward lands on the exact same spot the
    // animation already stopped at — otherwise the reel visibly snaps to a different position
    // the instant it "lands".
    const finalY = this.cellY(0) - targetCells[0].y;

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
    const toRemove = this.strip.children.filter((c) => !keep.includes(c));
    toRemove.forEach((c) => {
      this.strip.removeChild(c);
      c.destroy({ children: true });
    });
    keep.forEach((cell, i) => {
      cell.y = this.cellY(i);
    });
    this.nextIndex = 0;
    this.restOffset = 0;
    this.strip.y = 0;
    this.visibleCells = keep;
  }

  /** Local y (in `container`'s coordinate space) of row `row`'s *actual* rendered symbol
   * center — lets the scene line up a payline trace segment with this reel's actual rows
   * without needing to know its internal cellHeight math. cell.y (row * cellHeight) is relative
   * to the strip, which itself sits at this.restOffset — paylineLayer has no offset of its own,
   * so restOffset must be folded in here. restOffset is always 0 after a real spin (keepOnly
   * resets it), so this always lands exactly on the symbol being scored. */
  getRowCenterY(row: number): number {
    return this.cellY(row) + this.cellHeight / 2 + this.restOffset;
  }

  /** Starts (or extends) the multicolor "MULTIPLIER_2X combo building" glow on the given rows —
   * a soft, blurred, rainbow-cycling circle centered on each row's symbol (see
   * multiplierGlowLayer's doc comment for why it renders behind the art but in front of the
   * payline). Safe to call again with more rows while already running (e.g. reel 2 joining
   * reel 1's glow) — existing rows keep animating, new ones are added to the same loop. */
  startMultiplierGlow(rows: number[]): void {
    rows.forEach((row) => {
      this.multiplierGlowRows.add(row);
      if (!this.multiplierGlowGraphics.has(row)) {
        // A pre-blurred soft dot (shared texture), tinted and sized each frame — the old blurred
        // circle's look without a BlurFilter.
        const circle = new Sprite(getGlowDotTexture());
        circle.anchor.set(0.5);
        circle.alpha = 0.6;
        this.multiplierGlowLayer.addChild(circle);
        this.multiplierGlowGraphics.set(row, circle);
      }
    });
    if (this.multiplierGlowRafId !== null) return;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const hue = (elapsed % MULTIPLIER_GLOW_HUE_PERIOD_MS) / MULTIPLIER_GLOW_HUE_PERIOD_MS;
      const pulse = 0.7 + 0.3 * Math.sin((elapsed / MULTIPLIER_GLOW_PULSE_PERIOD_MS) * Math.PI * 2);
      const color = hueToHex(hue);
      const radius = Math.min(this.cellWidth, this.cellHeight) * 0.42 * pulse;

      for (const row of this.multiplierGlowRows) {
        const circle = this.multiplierGlowGraphics.get(row);
        if (!circle) continue;
        circle.tint = color;
        circle.position.set(this.cellWidth / 2, this.cellY(row) + this.cellHeight / 2 + this.restOffset);
        // The dot fades out at its rim, so make it larger than the circle it stands in for.
        circle.width = circle.height = (radius + MULTIPLIER_GLOW_SOFTNESS) * 2;
      }
      this.multiplierGlowRafId = requestAnimationFrame(animate);
    };
    this.multiplierGlowRafId = requestAnimationFrame(animate);
  }

  clearMultiplierGlow(): void {
    if (this.multiplierGlowRafId !== null) {
      cancelAnimationFrame(this.multiplierGlowRafId);
      this.multiplierGlowRafId = null;
    }
    this.multiplierGlowRows.clear();
    this.multiplierGlowGraphics.forEach((g) => g.destroy());
    this.multiplierGlowGraphics.clear();
  }

  /** Draws a straight red segment from local (fromX, fromY) to (toX, toY) into `paylineLayer`
   * (behind the symbol strip — see that field's doc comment). A flat row (fromY === toY) is
   * just the straight-line special case — CrystalCloverScene.ts always passes the true
   * entry/exit y for whatever line this reel's row sits on (sloped for a diagonal, so the
   * trace reads as one continuous "/" or "\" across the whole board instead of stair-stepping
   * flat-then-diagonal at each reel boundary), defaulting to this reel's own full width. */
  drawPaylineSegment(fromY: number, toY: number, color: number, fromX = 0, toX = this.cellWidth): void {
    const line = new Graphics();
    line.moveTo(fromX, fromY).lineTo(toX, toY);
    line.stroke({ color, width: 10, alpha: 0.85 });
    this.paylineLayer.addChild(line);
  }

  clearPaylineSegments(): void {
    this.paylineLayer.removeChildren().forEach((c) => c.destroy());
  }

  /** Starts a scale+tint pulse on row `row`'s symbol (part of a winning line) — loops until
   * clearGlow() is called. Multiple rows can pulse at once (unlike Buffalo777, where only the
   * middle row is ever scored). No dim/backdrop treatment here — the red payline trace (see
   * CrystalCloverScene.ts) is this game's primary win indicator; this is just a secondary
   * "these exact symbols" cue on top of it. */
  pulseRow(row: number): void {
    this.glowRows.add(row);
    if (this.glowRafId !== null) return;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.05 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);
      for (const r of this.glowRows) {
        const cell = this.visibleCells[r];
        const sprite = cell?.children[0] as (Sprite & { baseScale: number }) | undefined;
        if (!sprite) continue;
        sprite.scale.set(sprite.baseScale * (1 + pulse * 0.1));
        sprite.tint = pulse > 0.5 ? 0xfff2c0 : 0xffffff;
      }
      this.glowRafId = requestAnimationFrame(animate);
    };
    this.glowRafId = requestAnimationFrame(animate);
  }

  clearGlow(): void {
    if (this.glowRafId !== null) {
      cancelAnimationFrame(this.glowRafId);
      this.glowRafId = null;
    }
    for (const r of this.glowRows) {
      const cell = this.visibleCells[r];
      const sprite = cell?.children[0] as (Sprite & { baseScale: number }) | undefined;
      if (sprite) {
        sprite.scale.set(sprite.baseScale);
        sprite.tint = 0xffffff;
      }
    }
    this.glowRows.clear();
  }

  destroy(): void {
    this.clearGlow();
    this.clearMultiplierGlow();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
