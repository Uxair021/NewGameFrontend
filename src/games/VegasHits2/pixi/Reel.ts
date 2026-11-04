import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { VegasHitsSymbol } from "../api";

const ROW_COUNT = 3;
const FILLER_COUNT = 32;
const SYMBOL_PADDING = 0;
const GLOW_PULSE_PERIOD_MS = 1000;
/** Non-winning symbols fade to this alpha/tint on a win — the "everything but the winner fades
 * into the background" treatment Sizzling 7s achieves with a dedicated dim overlay layer, done
 * here per-sprite instead since this reel's winners already pulse in place (see pulseRow)
 * rather than through a separate highlight layer a shared overlay could sit behind. */
const DIM_ALPHA = 0.28;
const DIM_TINT = 0x555555;
/** Symbols render slightly larger than a strict "fit inside the cell" scale would give — the
 * clipping mask makes a bit of intentional overflow safe. */
const SYMBOL_SCALE_BOOST = 1.5;
/** Fixed px of empty space always left between a symbol's top/bottom edge and the row pitch
 * above/below it (see buildCell's maxH) — this is the actual "gap between symbols" (distinct
 * from ROW_PITCH_SCALE, which only moves row *centers* closer together but says nothing about
 * how much of that space the symbol art itself fills). Baked into buildCell's own size
 * calculation — the one function every cell goes through, both scrolling filler mid-spin and
 * the 3 final resting rows — so this gap is identical before, during, and after a spin; nothing
 * animates or recomputes it separately. Raising SYMBOL_SCALE_BOOST eats back into this gap (a
 * big enough boost can overflow it entirely into the neighboring row), so tune the two together. */
const ROW_GAP = 8;
/** Chance a filler slot is real (vs. left `null`/empty) *given the previous slot was empty* —
 * see buildFiller. Mirrors 7 Crystal Clover's Reel.ts exactly: two real filler symbols are never
 * placed back-to-back (matching the landed grid's own invariant — a reel's 2 real cells, in its
 * top+bottom state, always have the empty middle row between them), so the scroll-in visually
 * previews the same sparse 2-state shape the reel will actually land in. */
const FILLER_REAL_CHANCE = 1;
/** Fraction of cellHeight actually used as the vertical distance between consecutive row
 * centers (the payline pitch) — < 1 pulls row 0 (top) and row 2 (bottom) in toward the fixed
 * row 1 (middle, always anchored at the window's true vertical center — see cellY), tightening
 * the gap between rows without touching cellHeight/windowHeight (the frame/mask/border) at all.
 * Applied uniformly to every index cellY ever receives, including the negative filler indices
 * mid-scroll (see prependCells), so the whole strip — not just the 3 resting rows — scrolls at
 * this same tighter pitch and nothing jumps when it lands. Mirrors 7 Crystal Clover's Reel.ts
 * ROW_PITCH_SCALE exactly; 1 = original even spacing (idx * cellHeight, unchanged). */
const ROW_PITCH_SCALE = 0.8;

/** Overshoots slightly past 1 then eases back — "advances a little past the stop, then settles"
 * bounce, same curve 7 Crystal Clover's/Sizzling 7s' reels use for their landing. */
function easeOutBack(t: number): number {
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Builds one reel's worth of scrolling filler: never 2 real symbols back-to-back (see
 * FILLER_REAL_CHANCE), and the very last slot is always forced empty regardless — that slot
 * ends up sitting immediately adjacent to the freshly-landed bottom row once the spin lands, and
 * keepOnly destroys every filler cell the instant the reel stops with no fade-out, so a real
 * symbol left there would visibly pop out of existence right next to the symbol that stays.
 * Mirrors 7 Crystal Clover's Reel.ts buildFiller exactly. */
function buildFiller(count: number, randomSymbol: () => VegasHitsSymbol): (VegasHitsSymbol | null)[] {
  const result: (VegasHitsSymbol | null)[] = [];
  let prevReal = false;
  for (let i = 0; i < count; i++) {
    const isReal: boolean = !prevReal && Math.random() < FILLER_REAL_CHANCE;
    result.push(isReal ? randomSymbol() : null);
    prevReal = isReal;
  }
  if (result.length > 0) result[result.length - 1] = null;
  return result;
}

/**
 * A single reel, 3 rows tall — classic auto-stop (the server predetermines the whole grid, see
 * engine.ts's spin()); the client only ever plays a fixed-duration animation landing on it,
 * mirroring 7 Crystal Clover's Reel.spinTo exactly. No idle continuous scroll, no player-driven
 * Stop click — `spinTo()` always starts and lands entirely on its own schedule.
 */
export class Reel {
  public readonly view: Container;
  private readonly strip: Container;
  private textures: Record<VegasHitsSymbol, Texture>;
  private fillerPool: VegasHitsSymbol[];
  private fillerWeights: number[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  /** Index (in cellHeight units) the *next* prepended cell gets placed at — decreases with
   * every cell prepended, so newly-generated content always sits above whatever's already on
   * the strip. Reset to 0 whenever the strip settles (showStatic/keepOnly). */
  private nextIndex = 0;
  private visibleCells: Container[] = [];
  private glowRafId: number | null = null;
  private glowRows = new Set<number>();
  /** Sprites currently faded by dimExcept — tracked as the sprites themselves (not row indexes)
   * since this also covers the 2 decorative edge-peek cells, which have no row index of their
   * own (see peekCells' doc comment). */
  private dimmedSprites = new Set<Sprite>();
  /** The 2 decorative edge-peek cells (see addEdgePeekCells), if this reel currently has any —
   * tracked separately from visibleCells (which is strictly rows 0/1/2) so dimExcept/clearGlow
   * can fade them along with every other non-winning symbol on a win, and so a fresh
   * showStatic/keepOnly call knows to stop tracking whichever ones it just replaced. */
  private peekCells: Container[] = [];

  constructor(
    textures: Record<VegasHitsSymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number,
    /** Reel-strip weights (admin-configured, see GET /config's symbolWeights) — purely cosmetic
     * here (the landed grid always comes from the server), used only so the scrolling filler
     * visually matches the same rarity distribution instead of a flat uniform pick. */
    symbolWeights: Partial<Record<VegasHitsSymbol, number>> = {}
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as VegasHitsSymbol[];
    this.fillerWeights = this.fillerPool.map((s) => symbolWeights[s] ?? 1);

    this.view = new Container();
    this.strip = new Container();

    const windowHeight = cellHeight * ROW_COUNT;

    const background = new Graphics();
    background.rect(0, 0, cellWidth, windowHeight);
    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = 1;
    gradCanvas.height = Math.max(1, Math.round(windowHeight));
    const gradCtx = gradCanvas.getContext("2d")!;
    const grad = gradCtx.createLinearGradient(0, 0, 0, gradCanvas.height);
    grad.addColorStop(0, "#444444");
    grad.addColorStop(0.5, "#ffffff");
    grad.addColorStop(1, "#191919");
    gradCtx.fillStyle = grad;
    gradCtx.fillRect(0, 0, 1, gradCanvas.height);
    background.fill({ texture: Texture.from(gradCanvas) });
    this.view.addChild(background);

    const mask = new Graphics();
    mask.rect(0, 0, cellWidth, windowHeight);
    mask.fill({ color: 0xffffff });
    this.view.addChild(mask);
    this.view.addChild(this.strip);
    this.strip.mask = mask;

    const borders = new Graphics();
    borders.moveTo(0, 0).lineTo(cellWidth, 0);
    borders.moveTo(0, windowHeight).lineTo(cellWidth, windowHeight);
    borders.stroke({ color: 0xffcc33, width: 0 });
    this.view.addChild(borders);
  }

  private randomFillerSymbol(): VegasHitsSymbol {
    const total = this.fillerWeights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < this.fillerPool.length; i++) {
      roll -= this.fillerWeights[i];
      if (roll < 0) return this.fillerPool[i];
    }
    return this.fillerPool[this.fillerPool.length - 1];
  }

  private cellY(idx: number): number {
    return this.cellHeight + (idx - 1) * this.cellHeight * ROW_PITCH_SCALE;
  }

  /** `null` renders as a genuinely empty slot (no sprite) — every reel always shows either 1
   * symbol on the middle row or 2 on the top+bottom rows, never all 3 (see engine.ts's
   * drawGrid), so the empty row(s) are real server data, not a client cosmetic decision. */
  private buildCell(symbol: VegasHitsSymbol | null): Container {
    const cell = new Container();
    cell.label = symbol ?? "EMPTY";
    if (symbol === null) return cell;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2 - ROW_GAP;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height) * SYMBOL_SCALE_BOOST;
    sprite.scale.set(scale);
    (sprite as Sprite & { baseScale: number }).baseScale = scale;
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Places `symbols` above whatever's already on the strip — see `nextIndex`'s doc comment.
   * Content already on the strip sits below (near-zero y), so as strip.y increases toward its
   * new resting value, these newly-prepended cells fall down into view from above while
   * whatever was showing before continues down and out the bottom. */
  private prependCells(symbols: (VegasHitsSymbol | null)[]): Container[] {
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

  /** Purely decorative — a filler symbol placed one pitch above row 0 (idx -1) and one below
   * row 2 (idx ROW_COUNT), using the exact same cellY spacing every real row uses, so the
   * visible sliver of each (the rest falls outside the window's mask) sits at the same gap real
   * neighboring symbols would. Only called when this reel lands in the CENTER state (row 0/2
   * empty, see the Grid type doc comment) — a TOP_BOTTOM landing already has real symbols
   * bleeding into those same edges on its own, so adding more there would look cluttered, not
   * "more populated". Used only by showStatic (an immediate snapshot, no animation to keep in
   * sync with) — spinTo builds its own peeks as part of the same continuous scroll instead, so
   * they fall into place naturally rather than popping in the instant the reel stops. */
  private addEdgePeekCells(): void {
    const above = this.buildCell(this.randomFillerSymbol());
    above.y = this.cellY(-1);
    this.strip.addChild(above);
    const below = this.buildCell(this.randomFillerSymbol());
    below.y = this.cellY(ROW_COUNT);
    this.strip.addChild(below);
    this.peekCells = [above, below];
  }

  /** Renders exactly these 3 slots (top/middle/bottom, `null` = empty), no animation. */
  showStatic(target: [VegasHitsSymbol | null, VegasHitsSymbol | null, VegasHitsSymbol | null]): void {
    this.clearGlow();
    this.strip.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.strip.y = 0;
    this.nextIndex = 0;
    this.visibleCells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = this.cellY(i);
      this.strip.addChild(cell);
      return cell;
    });
    this.peekCells = [];
    if (target[0] === null) this.addEdgePeekCells();
  }

  /** Idle pre-spin display (game just loaded, before the first real spin resolves) — rolls the
   * same CENTER-or-TOP_BOTTOM shape a real landed spin always follows (see engine.ts's
   * drawGrid), with random real symbol(s) in whichever slot(s) end up filled, instead of a
   * fixed 3-symbol literal that could never actually occur on a real spin. Reads as "just
   * landed" rather than an obviously staged placeholder. Purely cosmetic — the first real
   * spin's server-decided grid replaces this immediately. */
  showRandomIdle(): void {
    const target: [VegasHitsSymbol | null, VegasHitsSymbol | null, VegasHitsSymbol | null] =
      Math.random() < 0.5 ? [null, this.randomFillerSymbol(), null] : [this.randomFillerSymbol(), null, this.randomFillerSymbol()];
    this.showStatic(target);
  }

  /** Spins and lands exactly on `target` (server-predetermined — see engine.ts's spin()),
   * scrolling top-to-bottom (symbols fall into place from above, matching a classic mechanical
   * reel) with an overshoot-and-settle bounce on landing. Continues from whatever is currently
   * displayed (filler + target prepended above the existing cells, never a jump/flash).
   *
   * When this reel lands in the CENTER state (row 0/2 empty — see addEdgePeekCells' doc
   * comment), 2 decorative edge-peek symbols are prepended into the *same* symbol list as the
   * real target and every filler cell — so they fall into place as part of the one continuous
   * scroll/bounce like everything else, instead of popping in fresh right as the reel stops. */
  spinTo(target: [VegasHitsSymbol | null, VegasHitsSymbol | null, VegasHitsSymbol | null], duration: number, delay: number): Promise<void> {
    this.clearGlow();
    if (this.strip.children.length === 0) this.showStatic(target);

    const startY = this.strip.y;
    const filler = buildFiller(FILLER_COUNT, () => this.randomFillerSymbol());
    const showPeeks = target[0] === null;

    // prependCells assigns a more-negative index to each successive symbol, so later-pushed
    // symbols land higher up — this tail list is built bottom-to-top: below-peek (if any), then
    // target[2..0] (bottom to top), then above-peek (if any).
    const tail: (VegasHitsSymbol | null)[] = [];
    if (showPeeks) tail.push(this.randomFillerSymbol());
    tail.push(target[2], target[1], target[0]);
    if (showPeeks) tail.push(this.randomFillerSymbol());

    const prepended = this.prependCells([...filler, ...tail]);
    const tailCells = prepended.slice(-tail.length);
    let i = 0;
    const belowPeekCell = showPeeks ? tailCells[i++] : null;
    const target2Cell = tailCells[i++];
    const target1Cell = tailCells[i++];
    const target0Cell = tailCells[i++];
    const abovePeekCell = showPeeks ? tailCells[i++] : null;
    const targetCells = [target0Cell, target1Cell, target2Cell];
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
            const peeks = showPeeks ? [{ cell: abovePeekCell!, idx: -1 }, { cell: belowPeekCell!, idx: ROW_COUNT }] : [];
            this.keepOnly(targetCells, peeks);
            resolve();
          }
        };
        rafId = requestAnimationFrame(tick);
      }, delay);
      this.pendingTimeouts.push(timeoutId);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** `keep` becomes the new visibleCells (rows 0/1/2, repositioned to their clean resting
   * cellY). `extra` preserves additional cells (the edge peeks, if this landing shows any — see
   * spinTo) that aren't part of visibleCells, repositioning each to its own idx. Everything else
   * still on the strip (filler) is destroyed. */
  private keepOnly(keep: Container[], extra: Array<{ cell: Container; idx: number }> = []): void {
    const preserve = new Set<Container>([...keep, ...extra.map((e) => e.cell)]);
    const toRemove = this.strip.children.filter((c) => !preserve.has(c));
    toRemove.forEach((c) => {
      this.strip.removeChild(c);
      c.destroy({ children: true });
    });
    keep.forEach((cell, i) => (cell.y = this.cellY(i)));
    extra.forEach(({ cell, idx }) => (cell.y = this.cellY(idx)));
    this.nextIndex = 0;
    this.strip.y = 0;
    this.visibleCells = keep;
    this.peekCells = extra.map((e) => e.cell);
  }

  /** Local y (in `view`'s coordinate space) of row `row`'s center. */
  getRowCenterY(row: number): number {
    return this.cellY(row) + this.cellHeight / 2;
  }

  /** Starts a scale+tint pulse on row `row`'s symbol (part of a winning line), in place — loops
   * until clearGlow() is called. Multiple rows can pulse at once. */
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
        sprite.scale.set(sprite.baseScale * (1 + pulse * 0.30));
        sprite.tint = pulse > 0.5 ? 0xffd27a : 0xffffff;
      }
      this.glowRafId = requestAnimationFrame(animate);
    };
    this.glowRafId = requestAnimationFrame(animate);
  }

  /** Fades every currently-visible row *except* `keepBrightRows` down to DIM_ALPHA/DIM_TINT,
   * plus both decorative edge-peek cells (if this reel has any — see peekCells' doc comment;
   * they're never a winner, so always fade with the rest) — pair with pulseRow(row) for each
   * row in `keepBrightRows` so the winner(s) still read as "the important one(s)" against the
   * now-faded rest. A reel with no winning row on it at all (an empty `keepBrightRows`) dims
   * completely. */
  dimExcept(keepBrightRows: ReadonlySet<number>): void {
    for (let row = 0; row < ROW_COUNT; row++) {
      if (keepBrightRows.has(row)) continue;
      const cell = this.visibleCells[row];
      const sprite = cell?.children[0] as Sprite | undefined;
      if (!sprite) continue;
      this.dimmedSprites.add(sprite);
      sprite.alpha = DIM_ALPHA;
      sprite.tint = DIM_TINT;
    }
    for (const cell of this.peekCells) {
      const sprite = cell.children[0] as Sprite | undefined;
      if (!sprite) continue;
      this.dimmedSprites.add(sprite);
      sprite.alpha = DIM_ALPHA;
      sprite.tint = DIM_TINT;
    }
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

    for (const sprite of this.dimmedSprites) {
      sprite.alpha = 1;
      sprite.tint = 0xffffff;
    }
    this.dimmedSprites.clear();
  }

  destroy(): void {
    this.clearGlow();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.view.destroy({ children: true });
  }
}
