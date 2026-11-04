import { AnimatedSprite, Container, Graphics, Sprite, Texture } from "pixi.js";
import { drawSoftRect } from "../../shared/pixi/softGlow";
import { AnimatedGIF } from "@pixi/gif";
import { BuffaloSymbol } from "../api";
import { FILL_CELL_SYMBOLS, WIN_FRAME_CONTENT_RECT, WIN_FRAME_LOOP_START, WIN_FRAME_NO_GLOW, WIN_FRAME_SPEED } from "./symbols";

/** A win-animation player over a payline cell — either a decoded .gif clone or an AnimatedSprite
 * built from a symbol's own frame-PNG set (see Buffalo777Scene's frameAnimations). Both expose
 * the same surface this file actually uses: anchor/scale/x/y/mask/texture/loop/play/destroy. */
type WinAnimation = AnimatedGIF | AnimatedSprite;

/** Inset (px, all 4 sides) each static symbol's contain-fit scaling leaves inside its cell —
 * smaller means a bigger symbol and less empty margin around it (was 20, which left a lot of
 * unused vertical space above/below shorter, wide symbols like BULL/BAR). */
const SYMBOL_PADDING = 0;
/** Fallback cell count consumed while decelerating, if a caller doesn't specify one — see
 * spinTo(). Must be >= 3 (the 3 target cells alone take up that much travel). */
const DEFAULT_DECEL_CELLS = 3;
const GLOW_PULSE_PERIOD_MS = 520;
/** Yellow glow backdrop + pulsing gold border (and the symbol's pulse) around a winning payline
 * symbol. Off for the whole game — wins still show via the dimmed rows and win animations. */
const SHOW_WIN_GLOW = false;
/** How dim the non-payline (above/below) rows go while the payline is celebrating a win. */
const NON_PAYLINE_DIM_ALPHA = 0.32;
/** Dev/debug aid only — draws a red rectangle around every cell's own cellWidth x cellHeight box
 * (see buildCell) so ROW_GAP/CELL_HEIGHT/SYMBOL_PADDING tuning has a visible reference. Flip to
 * false when done. */
const SHOW_DEBUG_ROW_BORDERS = false;

export class Reel {
  public readonly container: Container;
  private textures: Record<BuffaloSymbol, Texture>;
  private gifTemplates: Partial<Record<BuffaloSymbol, AnimatedGIF>>;
  private frameAnimations: Partial<Record<BuffaloSymbol, Texture[]>>;
  private fillerPool: BuffaloSymbol[];
  private pendingFrames: Array<() => void> = [];
  /**
   * y-index (in cellHeight units) the *next* prepended cell will take — always decreases
   * (more negative) with each prepend, so new cells stack above whatever's already there.
   * Reset to 0 by keepOnly()/showStatic() after every spin settles, so this never drifts to
   * an ever-larger magnitude across many spins.
   */
  private nextSlotAbove = 0;
  /** [above, middle, below] cells currently on screen — middle is the scored payline symbol. */
  private visibleCells: Container[] = [];
  private glowGraphics: Container | null = null;
  private glowRafId: number | null = null;
  /** The bonus win animation currently playing on the payline symbol, if any. */
  private activeWinAnimation: WinAnimation | null = null;
  /** Clips activeWinAnimation to exactly the cell bounds so its cover-fit scale (fills both
   * axes, no letterboxing) can't bleed into the dimmed rows above/below. */
  private activeWinAnimationMask: Graphics | null = null;

  constructor(
    textures: Record<BuffaloSymbol, Texture>,
    gifTemplates: Partial<Record<BuffaloSymbol, AnimatedGIF>>,
    frameAnimations: Partial<Record<BuffaloSymbol, Texture[]>>,
    /** Buffalo777Scene's CELL_WIDTH — shared by every row (top/middle/bottom alike). */
    private cellWidth: number,
    /** Buffalo777Scene's OUTER_ROW_HEIGHT — the top/bottom rows' own resting size, and also the
     * uniform size every *filler* symbol scrolls past at while spinning (see the `step` getter
     * below). Deliberately NOT what the middle/payline row ends up at — see middleRowHeight. */
    private cellHeight: number,
    /** Buffalo777Scene's MIDDLE_ROW_HEIGHT — forced square (equals cellWidth), used only for the
     * payline row's *final resting* size (see keepOnly/showStatic) and everything drawn on top of
     * it (attachWinAnimation, startWinGlow's mask/backdrop/border). Kept apart from cellHeight
     * on purpose: rows generally can't all be full-width squares and still fit the frame's fixed
     * aspect ratio, so only the row that actually matters for this (the one a win animation and a
     * square sprite sheet land on) gets resized — the top/bottom rows, and every filler symbol
     * scrolling past mid-spin, stay at the uniform cellHeight throughout. */
    private middleRowHeight: number,
    /** Buffalo777Scene's COLUMN_GAP — the horizontal gap (px) between this reel's own window and
     * its neighbors'. Used only to widen the win-glow's horizontal outset (see startWinGlow) far
     * enough to bleed across that gap and fully cover it, instead of stopping flush at this
     * reel's own edge and leaving a visible sliver of background between adjacent glow boxes.
     * Scene.ts widens each reel's own clip mask by a matching amount, so this outset has
     * somewhere to actually render instead of being clipped off. */
    private columnGapPx = 0,
    /** Buffalo777Scene's ROW_GAP — extra vertical space (px) between each pair of stacked rows,
     * on top of cellHeight. Used for every row's vertical *position/travel distance* (see the
     * `step` getter below) — never for a symbol's own on-screen size, which always stays
     * cellHeight regardless of this value. */
    private rowGapPx = 0
  ) {
    this.textures = textures;
    this.gifTemplates = gifTemplates;
    this.frameAnimations = frameAnimations;
    this.fillerPool = Object.keys(textures) as BuffaloSymbol[];
    this.container = new Container();
  }

  /** Which of the 3 repeating row heights a given "slot index" corresponds to — 0 and 2 are the
   * plain cellHeight-sized rows, 1 is the taller square middleRowHeight row. slot 0 is always the
   * currently-settled top row (nextSlotAbove resets to exactly 0 after every spin, in keepOnly),
   * so this cycle stays in phase across every future spin, not just the current one. */
  private roleForSlot(slotIndex: number): 0 | 1 | 2 {
    return (((slotIndex % 3) + 3) % 3) as 0 | 1 | 2;
  }

  private heightForSlot(slotIndex: number): number {
    return this.roleForSlot(slotIndex) === 1 ? this.middleRowHeight : this.cellHeight;
  }

  /** Absolute y-position of slot `slotIndex`'s own top edge (any integer, not just 0/1/2) — the
   * whole scrolling strip, not just the 3 currently-settled rows, follows this same repeating
   * [cellHeight, middleRowHeight, cellHeight] pattern (see roleForSlot), each full 3-slot cycle
   * spanning exactly one window's worth of height (cycleSpan, below). This matters for the *whole
   * spin*, not just the landing instant: the reel's clip mask is a fixed WINDOW_HEIGHT tall, but
   * a uniform-height strip (every filler cell scrolling past at plain cellHeight, the old
   * approach) only fills 3*cellHeight of that per window, which is shorter than WINDOW_HEIGHT
   * whenever middleRowHeight > cellHeight — so the visible row spacing reads as inconsistent
   * (too loose/uneven) for the entire time the reel is actively scrolling, not only right when it
   * stops. Keeping every cell — filler included — on this cyclical pattern instead means any 3
   * consecutive on-screen rows always exactly fill the mask, at every point along the scroll. */
  private slotY(slotIndex: number): number {
    const cycleSpan = this.cellHeight + this.rowGapPx + this.middleRowHeight + this.rowGapPx + this.cellHeight;
    const cycleIndex = Math.floor(slotIndex / 3);
    const withinCycle = slotIndex - cycleIndex * 3; // 0, 1, or 2
    const rowStart =
      withinCycle === 0 ? 0 : withinCycle === 1 ? this.cellHeight + this.rowGapPx : cycleSpan - this.cellHeight;
    return cycleIndex * cycleSpan + rowStart;
  }

  private randomSymbol(): BuffaloSymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  /** Every symbol — filler, top, middle, bottom alike — is always SIZED at the same plain
   * cellHeight (never stretched to fill the middle row's taller reserved slot — see slotY; only
   * the win animation does that, see attachWinAnimation/startWinGlow), so nothing ever visibly
   * resizes when a spin lands.
   *
   * `slotHeight` (defaults to cellHeight) is separate from that sizing — it only controls where
   * the sprite is *vertically centered*. Top/bottom rows and every scrolling filler symbol sit in
   * a slotHeight-tall space that exactly matches their own cellHeight-sized image, so centering
   * is a no-op there either way. The middle row is the one exception: its slot is reserved taller
   * (middleRowHeight) than the symbol drawn inside it, so without passing that taller slotHeight
   * explicitly, the (correctly-sized) symbol would center itself as if its box were only
   * cellHeight tall — sitting flush against the slot's top edge with all the reserved extra space
   * dumped below it as a lopsided gap, instead of reading as a symbol with even padding above and
   * below within its taller row. */
  private buildCell(symbol: BuffaloSymbol, slotHeight: number = this.cellHeight): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    let scaleX: number;
    let scaleY: number;
    if (FILL_CELL_SYMBOLS[symbol]) {
      // Stretch to fill the whole cell edge to edge.
      scaleX = maxW / sprite.texture.width;
      scaleY = maxH / sprite.texture.height;
    } else {
      scaleX = scaleY = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height);
    }
    sprite.scale.set(scaleX, scaleY);
    Object.assign(sprite, { baseScaleX: scaleX, baseScaleY: scaleY });
    sprite.x = this.cellWidth / 2;
    sprite.y = slotHeight / 2;
    cell.addChild(sprite);

    // Dev/debug aid only — draws a red rectangle around this cell's own cellWidth x slotHeight
    // box (its actual reserved boundary, not just the symbol's own tight bounding box) so
    // ROW_GAP/CELL_HEIGHT/MIDDLE_ROW_HEIGHT/SYMBOL_PADDING tuning has a visible reference instead
    // of guessing from where each symbol's own art happens to end. Flip SHOW_DEBUG_ROW_BORDERS
    // off once you're done tuning — can't just comment this block out because tsc's
    // noUnusedLocals would then flag it as dead code and fail the build.
    if (SHOW_DEBUG_ROW_BORDERS) {
      const debugBorder = new Graphics();
      debugBorder.rect(0, 0, this.cellWidth, slotHeight);
      debugBorder.stroke({ color: 0xff0000, width: 2, alpha: 0.9 });
      cell.addChild(debugBorder);
    }

    return cell;
  }

  /** Appends cells *above* whatever's currently on screen — each successive symbol in
   * `symbols` gets placed one slot higher (more negative y) than the last, continuing on
   * from `nextSlotAbove`. As `container.y` eases downward (more positive) toward its
   * resting value, this newly-placed stack (and the old stack sitting below it, at
   * less-negative/positive y) both slide downward on screen — new symbols enter from the
   * top, old ones exit at the bottom. Returns direct references — never rely on
   * container.children order afterwards (see keepOnly).
   *
   * Every cell — generic filler and (when this is called for the final 3 target cells, see
   * runDecelPhase) the payline row alike — gets its height/position from heightForSlot/slotY, so
   * the whole strip follows the same repeating cycle throughout the entire scroll, not just once
   * it lands (see slotY's own doc comment for why that's required, not just a nicety). */
  private prependCells(symbols: BuffaloSymbol[]): Container[] {
    const cells: Container[] = [];
    symbols.forEach((sym) => {
      this.nextSlotAbove -= 1;
      const cell = this.buildCell(sym, this.heightForSlot(this.nextSlotAbove));
      cell.y = this.slotY(this.nextSlotAbove);
      this.container.addChild(cell);
      cells.push(cell);
    });
    return cells;
  }

  /** Renders the reel showing exactly these 3 symbols (above/middle/below), no animation. */
  showStatic(target: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol]): void {
    this.stopWinGlow();
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.container.y = 0;
    this.nextSlotAbove = 0;
    const cells = target.map((sym, i) => {
      // The symbol itself is always sized at plain cellHeight (buildCell never stretches it to
      // fill the taller middle "box" — only the win animation does, see attachWinAnimation), but
      // the middle row's own slotHeight is passed explicitly so that correctly-sized symbol still
      // centers itself evenly within its taller reserved row instead of sitting flush at the top
      // with a lopsided gap dumped below it.
      const cell = this.buildCell(sym, this.heightForSlot(i));
      cell.y = this.slotY(i);
      this.container.addChild(cell);
      return cell;
    });
    this.visibleCells = cells;
  }

  /**
   * Spins and lands exactly on `target` (above/middle/below on the payline), scrolling
   * top-to-bottom — new symbols fall into place from above the visible window, existing
   * ones continue down and out the bottom. Continues from whatever's currently displayed
   * (filler + target prepended above the existing cells, never a jump/flash at the start).
   *
   * Two phases, timed in *cells* rather than milliseconds so there's zero rounding slack
   * between "how many filler symbols were queued up" and "how far the container actually
   * travels" — that mismatch used to make deceleration overshoot its intended duration by a
   * cell or more, inconsistently per reel. Multiple reels called with the same `speed` and
   * `startTime` stay perfectly in lockstep for as long as they're all spinning, and only
   * diverge once each starts landing:
   *  1. Constant-speed phase — exactly `spinCells` cells scroll past at `speed` px/ms.
   *     Callers stagger stops by passing a larger `spinCells` to later reels; the speed
   *     itself never changes here, so reels given the same `speed` move identically.
   *  2. Deceleration phase — eases from `speed` down to a stop, covering exactly
   *     `decelCells` cells (the last 3 of which are the target itself). Its duration is
   *     derived from that exact distance and `speed` so the ease-out's *initial* velocity
   *     is exactly `speed` too — i.e. no jump/snap at the handoff from phase 1.
   */
  spinTo(
    target: [BuffaloSymbol, BuffaloSymbol, BuffaloSymbol],
    spinCells: number,
    speed: number,
    decelCells: number = DEFAULT_DECEL_CELLS,
    startTime: number = performance.now()
  ): Promise<void> {
    this.stopWinGlow();
    if (this.visibleCells.length === 0) {
      // Nothing on screen yet (first render) — seed with a static frame to continue from.
      this.showStatic([this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
    }

    const startY = this.container.y;
    // Exactly `spinCells` cells' worth of travel time — no ceiling/buffer, so the topmost
    // filler cell lands precisely at the window's top edge (never short, never spare) the
    // instant phase 1 ends, keeping phase 2's distance calculation exact.
    const spinMs = -this.slotY(-spinCells) / speed;
    this.prependCells(Array.from({ length: spinCells }, () => this.randomSymbol()));

    return new Promise((resolve) => {
      let rafId = 0;

      const runDecelPhase = (decelStartY: number) => {
        // Captured before extraFillerCount cells are prepended below — distance must be measured
        // from the slot the reel was actually at when phase 2 began, not from wherever
        // nextSlotAbove ends up after the extra filler shifts it further up.
        const s0 = this.nextSlotAbove;
        const cellsToLand = Math.max(decelCells, 3);
        const extraFillerCount = cellsToLand - 3;
        this.prependCells(Array.from({ length: extraFillerCount }, () => this.randomSymbol()));
        // Built explicitly rather than via prependCells — unlike generic filler, the landing
        // trio's own sizes are NOT derived from heightForSlot(creation slot). Each reel spins a
        // different number of cells before landing (see STOP_STAGGER_CELLS in Buffalo777Scene.ts),
        // so nextSlotAbove's cyclical phase at this point varies per reel — only landing exactly
        // on a multiple of 3 total prepended cells would make a slot-derived height happen to
        // match the trio's true final role (top/middle/bottom). Forcing the correct fixed roles
        // here instead — cellHeight/middleRowHeight/cellHeight, always, regardless of that phase —
        // is what keepOnly already assumes when it repositions these exact cells to rows 0/1/2
        // without resizing them (see its own doc comment).
        //
        // Position still continues seamlessly from wherever the cyclical filler left off: any 3
        // consecutive slots span exactly one cycleSpan (== WINDOW_HEIGHT) regardless of starting
        // phase (see slotY's doc comment), so anchoring topY on slotY(nextSlotAbove - 3) — the
        // exact spot the generic cyclical system would have placed the next slot 3 above the last
        // filler — keeps this handoff pixel-exact with no seam, even though the trio's own heights
        // are fixed rather than slot-derived.
        const topY = this.slotY(this.nextSlotAbove - 3);
        const middleY = topY + this.cellHeight + this.rowGapPx;
        const bottomY = middleY + this.middleRowHeight + this.rowGapPx;
        this.nextSlotAbove -= 3;

        const topCell = this.buildCell(target[0], this.cellHeight);
        topCell.y = topY;
        this.container.addChild(topCell);

        const middleCell = this.buildCell(target[1], this.middleRowHeight);
        middleCell.y = middleY;
        this.container.addChild(middleCell);

        const bottomCell = this.buildCell(target[2], this.cellHeight);
        bottomCell.y = bottomY;
        this.container.addChild(bottomCell);

        const targetCells = [topCell, middleCell, bottomCell]; // -> [above, middle, below]

        const distance = this.slotY(s0) - this.slotY(s0 - cellsToLand);
        const finalY = decelStartY + distance;
        // Duration a `v(t) = speed * (1 - t/decelMs)^2` deceleration takes to cover
        // `distance` — integrating that gives the same shape as the eased position curve
        // below, so this exact decelMs makes the ease-out's starting speed land exactly on
        // `speed` (see the doc comment above) with no rounding error, since `distance` here
        // is exact (unlike the old ms-based version).
        const decelMs = (3 * distance) / speed;

        const phase2Start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - phase2Start) / decelMs, 0), 1);
          const eased = 1 - Math.pow(1 - t, 3);
          this.container.y = decelStartY + distance * eased;
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.container.y = finalY;
            this.keepOnly(targetCells);
            resolve();
          }
        };
        rafId = requestAnimationFrame(tick);
      };

      const tickPhase1 = (now: number) => {
        // Clamped to >=0 — see WinCelebration.tsx for why requestAnimationFrame's
        // timestamp can otherwise come in marginally before `startTime`.
        const elapsed = Math.max(now - startTime, 0);
        if (elapsed < spinMs) {
          this.container.y = startY + speed * elapsed;
          rafId = requestAnimationFrame(tickPhase1);
        } else {
          // Land exactly on the phase-1/phase-2 boundary within this same frame — otherwise
          // the container would hold last frame's position for one extra frame (a visible
          // stall) before phase 2's first tick catches it up.
          const decelStartY = startY + speed * spinMs;
          this.container.y = decelStartY;
          runDecelPhase(decelStartY);
        }
      };
      rafId = requestAnimationFrame(tickPhase1);

      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Destroys every cell except `keep` (by direct reference) and recoordinates `keep` to its
   * final slotY position, so the child list never grows unbounded across spins. No resizing —
   * every cell (including the one landing on the payline) already has its permanent size from
   * buildCell (always plain cellHeight; see showStatic's doc comment for why the middle row's
   * own symbol never grows to fill its taller slot). The middle row's non-uniform spacing (see
   * slotY) is already baked in from the moment its cell was created (see runDecelPhase), so this
   * is purely a reposition, no resizing/recentering needed here at all. */
  private keepOnly(keep: Container[]): void {
    const toRemove = this.container.children.filter((c) => !keep.includes(c));
    toRemove.forEach((c) => {
      this.container.removeChild(c);
      c.destroy({ children: true });
    });
    keep.forEach((cell, i) => {
      cell.y = this.slotY(i);
    });
    this.nextSlotAbove = 0;
    this.container.y = 0;
    this.visibleCells = keep;
  }

  /** Sizes, positions, and starts playing `winAnim` on the payline cell, masked to exactly the
   * middle row's reserved (taller, generally square) box — middleRowHeight, not the plain
   * cellHeight the static symbol underneath it uses — and tracked as the active animation,
   * shared by both the gif and frame-sprite win-animation paths in startWinGlow. This is the
   * *only* place that reserved extra space ever actually gets filled: the win animation is
   * meant to read as a deliberately bigger celebration on top of the payline, unlike the plain
   * resting symbol (see buildCell), which always stays the same size everywhere. */
  private attachWinAnimation(middle: Container, winAnim: WinAnimation): void {
    const content = WIN_FRAME_CONTENT_RECT[middle.label as BuffaloSymbol];
    if (content) {
      // Fit the card itself (not the padded frame) to the column and center it in the payline
      // row; anything outside the card (the horns) overflows the row unmasked.
      const tex = winAnim.texture;
      winAnim.anchor.set(content.x + content.w / 2, content.y + content.h / 2);
      const scale = Math.min(this.cellWidth / (content.w * tex.width), this.middleRowHeight / (content.h * tex.height));
      winAnim.scale.set(scale);
      winAnim.x = this.cellWidth / 2;
      winAnim.y = this.middleRowHeight / 2;
      middle.addChild(winAnim);
      // Keep the payline row above the top row so the overflowing horns aren't covered by it.
      middle.parent?.setChildIndex(middle, middle.parent.children.length - 1);
      winAnim.play();
      this.activeWinAnimation = winAnim;
      return;
    }

    winAnim.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.middleRowHeight - SYMBOL_PADDING * 2;
    const scale = Math.min(maxW / winAnim.texture.width, maxH / winAnim.texture.height);
    winAnim.scale.set(scale);
    winAnim.x = this.cellWidth / 2;
    winAnim.y = this.middleRowHeight / 2;
    winAnim.mask = this.activeWinAnimationMask;

    middle.addChild(winAnim);
    winAnim.play();
    this.activeWinAnimation = winAnim;
  }

  /** Gold glow + border pulse on the payline (middle) symbol — loops until stopWinGlow() is
   * called. Also dims the above/below rows so the win reads clearly, and swaps in a bonus
   * .gif animation over the payline symbol if one exists for it. */
  startWinGlow(): void {
    this.stopWinGlow();
    const middle = this.visibleCells[1];
    const sprite = middle?.children[0] as (Sprite & { baseScaleX: number; baseScaleY: number }) | undefined;
    if (!middle || !sprite) return;

    if (this.visibleCells[0]) this.visibleCells[0].alpha = NON_PAYLINE_DIM_ALPHA;
    if (this.visibleCells[2]) this.visibleCells[2].alpha = NON_PAYLINE_DIM_ALPHA;

    const symbol = middle.label as BuffaloSymbol;
    const frames = this.frameAnimations[symbol];
    const template = this.gifTemplates[symbol];

    let winAnim: WinAnimation | undefined;
    if (frames) {
      // A fresh player around the already-decoded frame textures (cheap — no per-frame
      // decode, unlike parsing a raw .gif) instead of re-loading the PNG sequence.
      const frameAnim = new AnimatedSprite(frames);
      frameAnim.animationSpeed = WIN_FRAME_SPEED[symbol] ?? 0.2;
      // Stream the frames: free each one's GPU copy as soon as the next is shown, so only the
      // current frame is uploaded instead of the whole 20-130 frame set (tens of MB). Re-uploading
      // one small frame per tick is cheap; a reel still showing a freed frame re-uploads it.
      let shownFrame = frames[0];
      frameAnim.onFrameChange = (index) => {
        if (frames[index] !== shownFrame) shownFrame.source.unload();
        shownFrame = frames[index];
      };
      const loopStart = WIN_FRAME_LOOP_START[symbol];
      if (loopStart !== undefined && loopStart < frames.length - 1) {
        // Play the full set once from frame 0 as an intro, then keep looping only
        // loopStart..last until stopWinGlow() (next spin) swaps the static symbol back in.
        frameAnim.loop = false;
        frameAnim.onComplete = () => frameAnim.gotoAndPlay(loopStart);
      } else {
        frameAnim.loop = true;
      }
      winAnim = frameAnim;
    } else if (template) {
      // Clone reuses the template's already-decoded frames (cheap) instead of re-parsing
      // the raw GIF file (expensive — this art is ~9MB/161 frames, would otherwise freeze
      // the main thread for seconds on every single win).
      winAnim = template.clone();
      winAnim.loop = true;
    }

    const noGlow = !!winAnim && !!WIN_FRAME_NO_GLOW[symbol];
    const unmasked = !!winAnim && !!WIN_FRAME_CONTENT_RECT[symbol];

    if (winAnim && unmasked) {
      sprite.visible = false;
      this.attachWinAnimation(middle, winAnim);
    } else if (winAnim) {
      // Exactly the cell's own bounds — matches attachWinAnimation's contain-fit sizing, which
      // never overflows this rect in the first place (unlike the old cover-fit approach, this
      // mask is no longer doing any real cropping — it's just a safety backstop).
      const mask = new Graphics();
      mask.rect(0, 0, this.cellWidth, this.middleRowHeight);
      mask.fill({ color: 0xffffff });
      middle.addChild(mask);
      this.activeWinAnimationMask = mask;

      sprite.visible = false;
      this.attachWinAnimation(middle, winAnim);
    }

    if (noGlow || !SHOW_WIN_GLOW) return;

    // Widened past the plain vertical outset whenever this reel has neighbors (columnGapPx > 0)
    // so the backdrop/border bleed across the COLUMN_GAP strip between reels and fully cover it,
    // instead of stopping flush at this reel's own edge and leaving a visible sliver of raw
    // background between adjacent glow boxes during a win — see the columnGapPx doc comment and
    // Scene.ts's matching MASK_GAP_COVER (which widens this reel's own clip mask so this outset
    // isn't just clipped away). The "+ 3" is a small deliberate overlap so neighboring reels'
    // blurred edges meet with margin, not just a hairline touch.
    const glowHorizontalOutset = this.columnGapPx > 0 ? this.columnGapPx / 2 + 3 : 6;

    // Soft feathered backdrop for a diffuse glow (stacked translucent rects, not a BlurFilter —
    // no filter render targets held in GPU memory, no extra pass every frame)...
    const backdrop = drawSoftRect(
      new Graphics(),
      -glowHorizontalOutset,
      -6,
      this.cellWidth + glowHorizontalOutset * 2,
      this.middleRowHeight + 12,
      0xffb300,
      18
    );

    // ...plus a crisp pulsing border on top, so it reads clearly even against the light reel background.
    const border = new Graphics();

    const glow = new Container();
    glow.addChild(backdrop, border);
    middle.addChildAt(glow, 0);
    this.glowGraphics = glow;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      backdrop.alpha = 0.5 + pulse * 0.5;
      border.clear();
      border.roundRect(
        -glowHorizontalOutset,
        -4,
        this.cellWidth + glowHorizontalOutset * 2,
        this.middleRowHeight + 8,
        10
      );
      border.stroke({ color: 0xffd700, width: 3 + pulse * 3, alpha: 0.7 + pulse * 0.3 });

      sprite.scale.set(sprite.baseScaleX * (1 + pulse * 0.09), sprite.baseScaleY * (1 + pulse * 0.09));
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
    if (this.activeWinAnimation) {
      const anim = this.activeWinAnimation;
      const frames = anim instanceof AnimatedSprite ? (anim.textures as Texture[]) : null;
      anim.mask = null;
      anim.parent?.removeChild(anim);
      anim.destroy();
      this.activeWinAnimation = null;
      // Free the frames' GPU copies — a win animation is ~20-130 frames, and once played they'd
      // otherwise all stay uploaded. The decoded images stay in memory, so the next win with
      // this symbol just re-uploads them (any reel still playing them re-uploads on its next
      // frame too).
      frames?.forEach((t) => t.source.unload());
    }
    if (this.activeWinAnimationMask) {
      this.activeWinAnimationMask.parent?.removeChild(this.activeWinAnimationMask);
      this.activeWinAnimationMask.destroy();
      this.activeWinAnimationMask = null;
    }
    this.visibleCells.forEach((cell) => {
      cell.alpha = 1;
      const sprite = cell.children[0] as (Sprite & { baseScaleX: number; baseScaleY: number }) | undefined;
      if (sprite) {
        sprite.visible = true;
        sprite.scale.set(sprite.baseScaleX, sprite.baseScaleY);
        sprite.tint = 0xffffff;
      }
    });
  }

  destroy(): void {
    this.stopWinGlow();
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
  }
}
