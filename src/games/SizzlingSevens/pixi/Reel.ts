import { AnimatedSprite, Container, Graphics, Sprite, Texture } from "pixi.js";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { AnimatedGIF } from "@pixi/gif";
import { Cell, SizzlingSymbol } from "../api";
import { getWinFrameAnimationSpeed } from "./symbols";

const ROW_COUNT = 3;
const SYMBOL_PADDING = 1;
/** Extra spacing between consecutive symbol positions on the strip, on top of cellHeight.
 * Kept at 0 (unlike Crazy777's Reel, which uses this for a "peek past the window edge"
 * cylindrical-wheel look) — this game is a flat 3x3 grid, and Scene.ts's win-highlight boxes
 * assume plain `rowIndex * cellHeight` spacing with no gap, so any nonzero value here would
 * make the rendered symbols drift out of alignment with their own highlight boxes and frame. */
const ROW_GAP_PX = 0;
/** Distance between consecutive row centers as a fraction of cellHeight (1 = the original even
 * spacing). < 1 pulls TOP/BOTTOM in toward MIDDLE, which stays anchored at the window's true
 * center (see stripHolder) — that tightens the gap between a TOP+BOTTOM pair, and lets the
 * symbols just outside the window (the strip's next symbol above/below) peek in at the edges
 * when only the MIDDLE row has a symbol. Applies to the whole strip, so nothing jumps on land. */
const ROW_PITCH_SCALE = 0.85;
/** Constant-speed scroll rate during the unbounded idle spin, px/ms. */
const IDLE_SPEED = 3.35;
/** How many strip steps ahead of the current scroll position get pre-populated with filler,
 * recycled as the reel scrolls — keeps memory/child-count bounded during an indefinitely long
 * idle spin (the player can hold it spinning as long as they like before clicking Stop). */
const BUFFER_STEPS = 20;
/** Symbols render slightly larger than a strict "fit inside the cell" scale would give — the
 * clipping mask (see the Reel doc comment below) makes a bit of intentional overflow safe. */
const SYMBOL_SCALE_BOOST = 1.7;
/** Divides SYMBOL_SCALE_BOOST for the resting/scrolling sprite (see buildCell). Lower = bigger
 * symbols — there's room for it now that every symbol's strip neighbours are blank slots (see
 * isBlankIndex), so the art can bleed past its own cell without touching another symbol. */
const STATIC_SCALE_DIVISOR = 1.25;
/** Same idea for the win-celebration visual (see buildWinVisual). */
const WIN_SCALE_DIVISOR = 1.5;
/** Extra vertical room (px, split evenly above/below) a win animation's display area gets beyond
 * the single payline cell's own height — without this, buildWinVisual's SYMBOL_SCALE_BOOST
 * overflow (deliberately larger than the cell) gets hard-cropped flat at the cell's top/bottom
 * edge by its own mask, which reads as an obvious cut on rounder art (e.g. WILD_2X's circular
 * badge) even though it's barely noticeable on rectangular BAR-text art. The win overlay behind
 * it already dims the whole reel area, so bleeding into the row above/below reads as "this
 * symbol is celebrating bigger," not as a layout bug — same technique as Buffalo777's Reel.ts. */
const WIN_ANIMATION_EXTRA_HEIGHT = 80;
/** Breathing room (px, all 4 sides) between a win animation's own edges and its (now taller than
 * the cell) display area's bounds — keeps it from reading edge-to-edge even with the boosted
 * scale. */
const WIN_ANIMATION_PADDING = 4;
const PULSE_PERIOD_MS = 520;
/** How many whole rows Stop advances past wherever the reel was when clicked, before settling
 * — e.g. with 2, whatever symbol was on the top row ends up on the bottom row. This is what
 * makes the result unpredictable from what's on screen at click time: those extra 1-2 rows are
 * already-generated filler (see BUFFER_STEPS) that simply hasn't scrolled into view yet, so
 * nothing about it could have been seen or targeted before clicking Stop. */
const ADVANCE_STEPS = 2;
const ADVANCE_DURATION_MS = 340;
/** On a losing spin, the strip settles this many row-heights off its clean center — a classic
 * "near miss" look (real reel-strip machines do this too). Purely cosmetic: see stopAndSettle's
 * landClean param doc comment for why this can never affect which symbols get reported/scored. */
const LOSE_LANDING_OFFSET_FRAC = 0.24;

function easeOutBack(t: number): number {
  // Overshoots past 1 then eases back — "advances a little past the stop, then settles" bounce.
  const c1 = 0.25;
  const c3 = c1 + 0.8;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Frees each frame's GPU copy as soon as the next one shows, so a playing win animation keeps
 * only its current frame uploaded instead of the whole set. Re-uploading one small frame per tick
 * is cheap; another cell still showing a freed frame just re-uploads it. */
function streamFrames(anim: AnimatedSprite): AnimatedSprite {
  const frames = anim.textures as Texture[];
  let shown = frames[0];
  anim.onFrameChange = (index) => {
    if (frames[index] !== shown) shown.source.unload();
    shown = frames[index];
  };
  return anim;
}

type Mode = "idle" | "spinning";
type Column = [Cell, Cell, Cell];
const EMPTY_LABEL = "EMPTY";

function cellSymbol(cell: Container): Cell {
  return cell.label === EMPTY_LABEL ? null : (cell.label as SizzlingSymbol);
}

/**
 * A single reel with a 3-row visible window (top/middle/bottom), matching Crazy777's
 * reel look. The strip strictly alternates symbol / blank (see isBlankIndex), like a classic
 * mechanical reel — so wherever it lands, the window shows either 1 symbol on the MIDDLE row
 * (TOP/BOTTOM blank) or 2 symbols on TOP+BOTTOM (MIDDLE blank), never 3. Unlike every other game's `spinTo(target, duration)` (fixed-duration, plays to a
 * predetermined stop automatically), this reel supports an *unbounded* idle spin —
 * `startContinuousSpin()` scrolls indefinitely with random filler until `stopAndSettle()` is
 * called (whenever the player clicks Stop), which advances a couple more rows past wherever
 * the scroll was at that moment (content already generated but not yet shown — see
 * ADVANCE_STEPS) and bounces to a stop there. No predetermined target, no symbol substitution,
 * and nothing about the result could have been seen or targeted before clicking Stop. The grid
 * reported to the server for scoring is derived from whichever symbol ends up nearest each
 * row's center once it settles. The server only scores that grid (see SizzlingSevensGame.tsx)
 * — it no longer decides the outcome.
 *
 * `view` (fixed, what Scene.ts positions) holds a clipping mask plus `strip` (the scrolling
 * inner container) — without that mask, filler symbols scrolling above/below the 3-row window
 * during an idle spin render fully visible instead of being cut off at the frame's edges.
 *
 * This reel doesn't own any win-celebration visuals itself — Scene.ts draws one overlay across
 * *all* 3 reels at once (not per-symbol boxes) and asks each reel only to build a detached,
 * self-contained visual for a winning row via buildWinVisual(), which it then positions above
 * that shared overlay. See SizzlingSevensScene.ts's showWinHighlights.
 */
export class Reel {
  public readonly view: Container;
  private readonly strip: Container;
  /** Fixed parent of `strip`, shifted down by (cellHeight - step) so that with the tighter
   * ROW_PITCH_SCALE pitch, row 1 (MIDDLE) still sits at the window's exact vertical center. */
  private readonly stripHolder: Container;
  private textures: Record<SizzlingSymbol, Texture>;
  private gifTemplates: Partial<Record<SizzlingSymbol, AnimatedGIF>>;
  private frameAnimations: Partial<Record<SizzlingSymbol, Texture[]>>;
  private symbolPool: SizzlingSymbol[];
  private weights: number[];
  private phaseOffsetSteps: number;
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  private visibleCells: Container[] = [];

  private mode: Mode = "idle";
  private stripCells: Array<{ cell: Container; index: number }> = [];
  private nextStripIndex = 0;
  private spinStartTime = 0;
  private spinStartY = 0;
  /** Strip index parity that holds a blank (see isBlankIndex) — chosen by showStatic so the first
   * filler cell above the static rows continues the alternation instead of doubling up. */
  private blankParity = 0;

  constructor(
    textures: Record<SizzlingSymbol, Texture>,
    gifTemplates: Partial<Record<SizzlingSymbol, AnimatedGIF>>,
    frameAnimations: Partial<Record<SizzlingSymbol, Texture[]>>,
    private cellWidth: number,
    private cellHeight: number,
    /** Reel-strip weights (admin-configured, see GET /config's symbolWeights) — the client
     * draws its own scrolling content from this same distribution now that the server no
     * longer picks the result, so the admin's relative symbol rarity is still respected even
     * though the exact landed grid is determined by where the player clicks Stop. */
    symbolWeights: Partial<Record<SizzlingSymbol, number>> = {},
    /** A fixed fraction-of-a-row this reel's resting position is permanently shifted by (e.g.
     * 0.5 = starts/settles half a row off clean alignment) — baked into restY() once and never
     * un-done (strip.y is never reset back to a "clean" state between spins), so it's a
     * standing visual trait of this specific reel, not a one-off. Purely cosmetic variety
     * between reels; the real unpredictability comes from ADVANCE_STEPS in stopAndSettle. */
    phaseOffsetSteps = 0
  ) {
    this.textures = textures;
    this.gifTemplates = gifTemplates;
    this.frameAnimations = frameAnimations;
    this.symbolPool = Object.keys(textures) as SizzlingSymbol[];
    this.weights = this.symbolPool.map((s) => symbolWeights[s] ?? 1);
    this.phaseOffsetSteps = phaseOffsetSteps;

    this.view = new Container();
    this.strip = new Container();
    this.stripHolder = new Container();
    this.stripHolder.addChild(this.strip);

    const windowHeight = cellHeight * ROW_COUNT;

    // Background — light gray/white vertical gradient, same "1px-wide, height-tall canvas
    // gradient stretched over the shape's bounds" technique used elsewhere in this codebase
    // (e.g. FiveXRewind's Reel) since Pixi's own Graphics.fill() doesn't support gradients
    // directly.
    const background = new Graphics();
    background.rect(0, 0, cellWidth, windowHeight);
    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = 1;
    gradCanvas.height = Math.max(1, Math.round(windowHeight));
    const gradCtx = gradCanvas.getContext("2d")!;
    const grad = gradCtx.createLinearGradient(0, 0, 0, gradCanvas.height);
    grad.addColorStop(0, "#c7c7c7");
    grad.addColorStop(0.5, "#ffffff");
    grad.addColorStop(1, "#c7c7c7");
    gradCtx.fillStyle = grad;
    gradCtx.fillRect(0, 0, 1, gradCanvas.height);
    background.fill({ texture: Texture.from(gradCanvas) });
    this.view.addChild(background);

    const windowMask = new Graphics();
    windowMask.rect(0, 0, cellWidth, windowHeight);
    windowMask.fill({ color: 0xffffff });
    this.view.addChild(windowMask);
    this.stripHolder.y = cellHeight - this.step;
    this.view.addChild(this.stripHolder);
    this.strip.mask = windowMask;

    // Dark gray border lines along the top and bottom edges only.
    const borders = new Graphics();
    borders.moveTo(0, 0).lineTo(cellWidth, 0);
    borders.moveTo(0, windowHeight).lineTo(cellWidth, windowHeight);
    borders.stroke({ color: 0x4a4a4a, width: 4 });
    this.view.addChild(borders);
  }

  private get step(): number {
    return this.cellHeight * ROW_PITCH_SCALE + ROW_GAP_PX;
  }

  private restY(i: number): number {
    return (i + this.phaseOffsetSteps) * this.step - ROW_GAP_PX;
  }

  private randomSymbol(): SizzlingSymbol {
    const total = this.weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < this.symbolPool.length; i++) {
      roll -= this.weights[i];
      if (roll < 0) return this.symbolPool[i];
    }
    return this.symbolPool[this.symbolPool.length - 1];
  }

  private isBlankIndex(idx: number): boolean {
    return Math.abs(idx % 2) === this.blankParity;
  }

  /** Random content for strip index `idx` — a blank on blank-parity indexes, a weighted
   * random symbol otherwise. */
  private randomCellFor(idx: number): Cell {
    return this.isBlankIndex(idx) ? null : this.randomSymbol();
  }

  /** `null` builds an empty slot (no sprite). */
  private buildCell(symbol: Cell): Container {
    const cell = new Container();
    cell.label = symbol ?? EMPTY_LABEL;
    if (symbol === null) return cell;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height) * SYMBOL_SCALE_BOOST;
    sprite.scale.set(scale / STATIC_SCALE_DIVISOR);
    (sprite as Sprite & { baseScale: number }).baseScale = scale;
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Renders exactly these 3 slots (top/middle/bottom, `null` = blank), no animation. Expects
   * one of the two shapes a real landing produces: [null, X, null] or [X, null, Y]. */
  showStatic(target: Column): void {
    this.stopAllAnimation();
    this.strip.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.strip.y = 0;
    this.stripCells = [];
    this.nextStripIndex = 0;
    // Strip index 0 sits directly above the top row — make it the opposite of the top row.
    this.blankParity = target[0] === null ? 1 : 0;
    this.visibleCells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = this.restY(i);
      this.strip.addChild(cell);
      return cell;
    });
    // The strip's next slot above and below the window, continuing the symbol/blank alternation
    // — with the tighter ROW_PITCH_SCALE pitch these peek in at the window edges when only the
    // MIDDLE row has a symbol, same as they do after a real spin lands.
    this.ensureFilledTo(0);
    const below = this.buildCell(target[2] === null ? this.randomSymbol() : null);
    below.y = this.restY(ROW_COUNT);
    this.strip.addChild(below);
  }

  /** Pre-first-spin display — a random one of the two real landing shapes (see showStatic). */
  showRandomIdle(): void {
    this.showStatic(
      Math.random() < 0.5 ? [null, this.randomSymbol(), null] : [this.randomSymbol(), null, this.randomSymbol()]
    );
  }

  private stopAllAnimation(): void {
    this.pendingFrames.forEach((cancel) => cancel());
    this.pendingFrames = [];
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingTimeouts = [];
    this.mode = "idle";
  }

  /** Fills strip cells (random filler) up to `throughIndex` (inclusive), skipping any index
   * that already has a cell (used to punch the 3 target cells into the strip before landing). */
  private ensureFilledTo(throughIndex: number): void {
    while (this.nextStripIndex <= throughIndex) {
      const idx = this.nextStripIndex;
      const cell = this.buildCell(this.randomCellFor(idx));
      cell.y = -(idx + 1) * this.step;
      this.strip.addChild(cell);
      this.stripCells.push({ cell, index: idx });
      this.nextStripIndex++;
    }
  }

  /** Removes strip cells that have scrolled well past the visible window (below it, given
   * this reel scrolls top-to-bottom) — keeps the child list bounded during an indefinitely
   * long idle spin. A cell's screen position is strip.y - (index+1)*step; once that's
   * comfortably past the 3-row window it can never re-enter (this reel only scrolls one way),
   * so it's safe to drop. */
  private pruneBehind(): void {
    const windowIndex = this.strip.y / this.step;
    this.stripCells = this.stripCells.filter(({ cell, index }) => {
      if (index < windowIndex - 6) {
        this.strip.removeChild(cell);
        cell.destroy({ children: true });
        return false;
      }
      return true;
    });
  }

  /** Starts an unbounded idle scroll — keeps going until stopAndSettle() is called. Continues
   * from whatever's currently displayed (and whatever cells already exist from a previous
   * freeze — stripCells/nextStripIndex are deliberately *not* reset here, since stopAndSettle
   * leaves them alone too; resetting either here would orphan still-visible cells the strip
   * would no longer be tracking) so there's no jump at the start. */
  startContinuousSpin(): void {
    this.stopAllAnimation();
    this.mode = "spinning";

    const startY = this.strip.y;
    this.ensureFilledTo(Math.ceil(startY / this.step) + BUFFER_STEPS);

    this.spinStartTime = performance.now();
    this.spinStartY = startY;

    let rafId = 0;
    const tick = () => {
      if (this.mode !== "spinning") return;
      const elapsed = performance.now() - this.spinStartTime;
      this.strip.y = this.spinStartY + IDLE_SPEED * elapsed;
      const neededIndex = Math.ceil(this.strip.y / this.step) + BUFFER_STEPS;
      if (neededIndex > this.nextStripIndex) this.ensureFilledTo(neededIndex);
      this.pruneBehind();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    this.pendingFrames.push(() => cancelAnimationFrame(rafId));
  }

  /** The strip index (see stopAndSettle/ensureFilledTo) that ADVANCE_STEPS-past-`this.strip.y`
   * would cleanly settle on — the single source of truth both peekStopSymbols() and
   * stopAndSettle() derive their symbol read from, so calling one right before the other (no
   * animation frame in between, i.e. `this.strip.y` unchanged) is guaranteed to agree. */
  private computeSettleK(): number {
    const rawTargetY = this.strip.y + ADVANCE_STEPS * this.step;
    // Clean positions for this reel are strip.y = (k + phaseOffsetSteps) * step - ROW_GAP_PX
    // for integer k (see restY) — solve for the k nearest rawTargetY.
    return Math.round((rawTargetY + ROW_GAP_PX) / this.step - this.phaseOffsetSteps);
  }

  private symbolsAtK(k: number): Column {
    const cleanTargetY = (k + this.phaseOffsetSteps) * this.step - ROW_GAP_PX;
    this.ensureFilledTo(Math.ceil(cleanTargetY / this.step) + 3);
    const cellsByIndex = new Map(this.stripCells.map((s) => [s.index, s.cell]));
    return [0, 1, 2].map((row) => {
      const idx = k - row - 1;
      const cell = cellsByIndex.get(idx);
      return cell ? cellSymbol(cell) : this.randomCellFor(idx);
    }) as Column;
  }

  /** Testing aid (see SizzlingSevensGame.tsx's FORCE_FREE_GAMES) — swaps the first non-blank
   * slot this reel is about to land on for `symbol`. Must be called right before
   * peekStopSymbols()/stopAndSettle() (no animation frame between) so all three agree on k. */
  forceLandingSymbol(symbol: SizzlingSymbol): void {
    if (this.mode !== "spinning") return;
    const k = this.computeSettleK();
    this.symbolsAtK(k); // makes sure the landing cells exist
    const row = [0, 1, 2].find((r) => !this.isBlankIndex(k - r - 1));
    if (row === undefined) return;
    const entry = this.stripCells.find((s) => s.index === k - row - 1);
    if (!entry) return;
    const cell = this.buildCell(symbol);
    cell.y = entry.cell.y;
    this.strip.addChildAt(cell, this.strip.getChildIndex(entry.cell));
    this.strip.removeChild(entry.cell);
    entry.cell.destroy({ children: true });
    entry.cell = cell;
  }

  /** A weighted-random symbol from this reel's strip weights (for re-drawing a landing). */
  drawSymbol(): SizzlingSymbol {
    return this.randomSymbol();
  }

  /** Replaces the symbols this reel is about to land on — `column` gives the 3 rows, using null
   * exactly where the landing already has a blank (only real symbols are swapped, so the reel's
   * 1-or-2-symbol shape never changes). Same timing rule as forceLandingSymbol: call right before
   * peekStopSymbols()/stopAndSettle() with no animation frame between. */
  setLandingSymbols(column: readonly (SizzlingSymbol | null)[]): void {
    if (this.mode !== "spinning") return;
    const k = this.computeSettleK();
    this.symbolsAtK(k); // makes sure the landing cells exist
    for (let row = 0; row < 3; row++) {
      const symbol = column[row];
      if (symbol === null || this.isBlankIndex(k - row - 1)) continue;
      const entry = this.stripCells.find((s) => s.index === k - row - 1);
      if (!entry) continue;
      const cell = this.buildCell(symbol);
      cell.y = entry.cell.y;
      this.strip.addChildAt(cell, this.strip.getChildIndex(entry.cell));
      this.strip.removeChild(entry.cell);
      entry.cell.destroy({ children: true });
      entry.cell = cell;
    }
  }

  /** Read-only preview of exactly what stopAndSettle() would report right now, without
   * animating or changing mode — lets a caller (Scene.ts) decide *how* to land (see
   * stopAndSettle's landClean param) before committing to the real stop. Must be followed by
   * stopAndSettle() with no animation frame in between to guarantee the same symbols; it's safe
   * to call more than once (ensureFilledTo is idempotent past what's already generated). */
  peekStopSymbols(): Column {
    if (this.mode !== "spinning") return this.visibleCells.map(cellSymbol) as Column;
    return this.symbolsAtK(this.computeSettleK());
  }

  /** Stops the idle scroll — but not immediately at the click: advances roughly ADVANCE_STEPS
   * further rows first (with an overshoot-and-settle bounce), landing on content that was
   * already generated ahead of the visible window (see BUFFER_STEPS) but never actually shown
   * before this call. That's what makes the result unguessable from what was on screen at
   * click time, without needing a server-predetermined target or a jump to unrelated content —
   * it's simply the next couple of rows the player hadn't scrolled to yet.
   *
   * `landClean` (default true) controls the *visual* rest position only: true snaps the strip
   * to this reel's exact clean center-aligned position (respecting phaseOffsetSteps), same as
   * always. false — used for a losing spin, decided by Scene.ts via peekStopSymbols() before
   * this is called — settles the strip a bit off that clean position instead (a "near miss"
   * look), by shifting the whole strip uniformly. This can NEVER change which symbols are
   * reported: the settle index `k` (and therefore every cell that ends up in visibleCells) is
   * computed once, before the clean-vs-offset choice is applied to anything, and the offset
   * only nudges strip.y — it never touches k or which cell object each row reads. No-ops
   * (resolves with whatever was last reported) if this reel isn't currently mid-spin. */
  stopAndSettle(landClean = true, /** fires the moment the reel visually lands — see reelLanding */ onLand?: () => void): Promise<Column> {
    const readSymbols = () => this.visibleCells.map(cellSymbol) as Column;
    if (this.mode !== "spinning") return Promise.resolve(readSymbols());

    this.pendingFrames.forEach((cancel) => cancel());
    this.pendingFrames = [];
    this.mode = "idle";

    const startY = this.strip.y;
    const k = this.computeSettleK();
    const cleanTargetY = (k + this.phaseOffsetSteps) * this.step - ROW_GAP_PX;
    const finalY = landClean
      ? cleanTargetY
      : cleanTargetY + (Math.random() < 0.5 ? 1 : -1) * LOSE_LANDING_OFFSET_FRAC * this.step * (0.6 + Math.random() * 0.4);
    this.ensureFilledTo(Math.ceil(cleanTargetY / this.step) + 3);

    return new Promise((resolve) => {
      const start = performance.now();
      let rafId = 0;
      const land = reelLanding(startY, finalY, onLand);
      const tick = (now: number) => {
        const t = Math.min(Math.max((now - start) / ADVANCE_DURATION_MS, 0), 1);
        const eased = easeOutBack(t);
        this.strip.y = startY + (finalY - startY) * eased;
        land(this.strip.y);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
          return;
        }

        this.strip.y = finalY;
        land(finalY);
        this.pruneBehind();

        const cellsByIndex = new Map(this.stripCells.map((s) => [s.index, s.cell]));
        this.visibleCells = [0, 1, 2].map((row) => {
          const idx = k - row - 1;
          return (
            cellsByIndex.get(idx) ??
            // Shouldn't normally happen (BUFFER_STEPS/the ensureFilledTo call above keep well
            // ahead of this range) — safe fallback so this never crashes at an edge case.
            this.buildCell(this.randomCellFor(idx))
          );
        });
        resolve(readSymbols());
      };
      rafId = requestAnimationFrame(tick);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Local y (in `view`'s coordinate space) where row `row` currently sits — lets Scene.ts
   * position a scene-level element (the win overlay's highlight, see buildWinVisual) to line
   * up with a real row without needing to know this reel's own phaseOffsetSteps math. */
  getRowY(row: number): number {
    return this.stripHolder.y + this.restY(row);
  }

  /** The symbol row `row` currently shows, or null for a blank slot / nothing there. */
  getRowSymbol(row: number): Cell {
    const cell = this.visibleCells[row];
    return cell ? cellSymbol(cell) : null;
  }

  /** Hides (or restores) row `row`'s own static sprite. The win overlay is only ~50% opaque,
   * so without this the original PNG still shows through it, dimmed, around/behind the
   * detached gif highlight Scene.ts draws on top (see buildWinVisual) — this is what actually
   * removes it from view entirely for the rows currently celebrating a win. */
  setRowSpriteVisible(row: number, visible: boolean): void {
    const sprite = this.visibleCells[row]?.children[0] as Sprite | undefined;
    if (sprite) sprite.visible = visible;
  }

  /** Builds a detached, self-contained visual for row `row`'s matching symbol — a fresh
   * AnimatedSprite for RED_7 (see frameAnimations/WIN_FRAME_SETS), else its .gif clone if one
   * exists, else a pulsing static clone (BONUS has neither) — for Scene.ts to position above its
   * own shared win overlay. Doesn't touch this reel's own display tree at all — pair this with
   * setRowSpriteVisible(row, false) to actually hide the original underneath it. Returns null
   * if `row` isn't currently showing anything (shouldn't happen once settled, but is possible
   * mid-spin) or is a blank slot. */
  buildWinVisual(row: number): { view: Container; play: () => void; destroy: () => void } | null {
    const cell = this.visibleCells[row];
    const symbol = cell ? cellSymbol(cell) : null;
    if (symbol === null) return null; // nothing to celebrate on a blank slot

    const frames = this.frameAnimations[symbol];
    const template = this.gifTemplates[symbol];
    // Fresh player around already-decoded assets either way (cheap) — never re-fetch/re-parse
    // the raw frame files or .gif on every win.
    const winAnim: AnimatedGIF | AnimatedSprite | undefined = frames
      ? streamFrames(Object.assign(new AnimatedSprite(frames), { loop: true, animationSpeed: getWinFrameAnimationSpeed(symbol) }))
      : template
        ? Object.assign(template.clone(), { loop: true })
        : undefined;

    if (winAnim) {
      const container = new Container();
      winAnim.anchor.set(0.5);
      // Taller-than-the-cell display area (see WIN_ANIMATION_EXTRA_HEIGHT doc comment) so the
      // SYMBOL_SCALE_BOOST overflow below has somewhere to go instead of getting cropped flat
      // at the cell's own top/bottom edge.
      const maxW = this.cellWidth - WIN_ANIMATION_PADDING * 2;
      const maxH = this.cellHeight + WIN_ANIMATION_EXTRA_HEIGHT - WIN_ANIMATION_PADDING * 2;
      winAnim.scale.set(Math.min(maxW / winAnim.texture.width, maxH / winAnim.texture.height) * SYMBOL_SCALE_BOOST / WIN_SCALE_DIVISOR);
      winAnim.x = this.cellWidth / 2;
      winAnim.y = this.cellHeight / 2;

      const mask = new Graphics();
      mask.rect(
        WIN_ANIMATION_PADDING,
        -WIN_ANIMATION_EXTRA_HEIGHT / 2 + WIN_ANIMATION_PADDING,
        this.cellWidth - WIN_ANIMATION_PADDING * 2,
        this.cellHeight + WIN_ANIMATION_EXTRA_HEIGHT - WIN_ANIMATION_PADDING * 2
      );
      mask.fill({ color: 0xffffff });
      container.addChild(mask);
      winAnim.mask = mask;
      container.addChild(winAnim);

      return {
        view: container,
        play: () => winAnim.play(),
        destroy: () => {
          winAnim.mask = null;
          winAnim.destroy();
          mask.destroy();
          container.destroy();
        },
      };
    }

    // Neither a frame set nor a .gif for this symbol (BONUS) — a fresh pulsing sprite clone instead.
    const container = new Container();
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const baseScale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height) * SYMBOL_SCALE_BOOST;
    sprite.scale.set(baseScale);
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    container.addChild(sprite);

    let rafId = 0;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / PULSE_PERIOD_MS) * Math.PI * 2);
      sprite.scale.set(baseScale * (1 + pulse * 0.12));
      rafId = requestAnimationFrame(animate);
    };
    return {
      view: container,
      play: () => {
        rafId = requestAnimationFrame(animate);
      },
      destroy: () => {
        cancelAnimationFrame(rafId);
        container.destroy({ children: true });
      },
    };
  }

  destroy(): void {
    this.stopAllAnimation();
    this.view.destroy({ children: true });
  }
}
