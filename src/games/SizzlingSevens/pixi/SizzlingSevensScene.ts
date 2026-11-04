import { Application, Container, Graphics, Texture } from "pixi.js";
import { AnimatedGIF } from "@pixi/gif";
import { Reel } from "./Reel";
import { loadSymbolTextures, loadWinGifAnimations, WinFrameCache } from "./symbols";
import { Cell, Grid, SizzlingSymbol } from "../api";

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

const REEL_COUNT = 3;
const ROW_COUNT = 3;
const REEL_AREA_LEFT = 0.222;
const REEL_AREA_RIGHT = 0.778;
/** Exported so the Free Games status bar (SizzlingSevensGame.tsx) can sit just above the reels. */
export const REEL_AREA_TOP = 0.335;
const REEL_AREA_BOTTOM = 0.875;

/** The Pixi canvas only covers the reel area plus this margin (px) — everything else on screen
 * (background, HUD) is HTML, so a full 1920x1080 canvas was mostly transparent pixels the GPU
 * still had to hold. The margin fits the backdrop's 12px outset and win animations' 40px bleed
 * above/below their row (see Reel.ts's WIN_ANIMATION_EXTRA_HEIGHT). */
const VIEW_MARGIN = 64;
export const VIEW_LEFT = Math.floor(CANVAS_WIDTH * REEL_AREA_LEFT - VIEW_MARGIN);
export const VIEW_TOP = Math.floor(CANVAS_HEIGHT * REEL_AREA_TOP - VIEW_MARGIN);
export const VIEW_WIDTH = Math.ceil(CANVAS_WIDTH * REEL_AREA_RIGHT + VIEW_MARGIN) - VIEW_LEFT;
export const VIEW_HEIGHT = Math.ceil(CANVAS_HEIGHT * REEL_AREA_BOTTOM + VIEW_MARGIN) - VIEW_TOP;

/** GPU-memory knob: the canvas renders at this fraction of its on-screen pixel size (see
 * SizzlingSevensGame's fitResolution use). 1 = pixel-exact; lower = less memory, softer art. */
export const RENDER_QUALITY = 0.75;
const REEL_GAP_FRAC = 0.032;
/** Per-reel resting-position offset (fraction of a row) — all 0 (no offset). A prior version
 * shifted reel 2 by half a row for visual variety, but that broke paylines: a "MMM" line's 3
 * symbols need to actually sit on the same horizontal line for a win to look legitimate, and a
 * scoring row-index match isn't enough if the reels don't visually agree on where "middle" is.
 * See Reel.ts's phaseOffsetSteps doc comment. */
const REEL_PHASE_OFFSETS = [0, 0, 0];

const WIN_OVERLAY_COLOR = 0x000000;
const WIN_OVERLAY_ALPHA = 0.8;

/** Dev/debug aid only — draws 3 red reference lines across the reels at the TOP/MIDDLE/BOTTOM
 * row (see drawDebugPaylines). Flip to true to bring them back. */
const SHOW_DEBUG_PAYLINES = false;

const WILD: SizzlingSymbol = "WILD_2X";
const BONUS: SizzlingSymbol = "BONUS";
/** Every symbol a Wild can substitute for — mirrors backend config.ts's WILD_SUBSTITUTES_FOR.
 * Only used here to decide, purely visually, whether a peeked grid is a winner (see
 * winningSymbols) — the server is still the sole source of truth for what actually gets paid. */
const WILD_SUBSTITUTES_FOR = new Set<Cell>(["RED_7", "BLUE_7", "BAR", "DOUBLE_BAR", "TRIPLE_BAR"]);
/** Mirrors backend config.ts's BAR_FAMILY plus Wild — a line where every symbol is some mix of
 * these (not necessarily identical) still wins via the flat ANY_BAR rule, so winningSymbols needs
 * to recognize it too or a spin that actually wins could cosmetically land as a "near miss". */
const ANY_BAR_SET = new Set<Cell>(["BAR", "DOUBLE_BAR", "TRIPLE_BAR", "WILD_2X"]);
const BONUS_TRIGGER_COUNT = 3;

interface ActiveWinVisual {
  view: Container;
  destroy: () => void;
}

export class SizzlingSevensScene {
  private root: Container;
  private reels: Reel[] = [];
  private gifTemplates: Partial<Record<SizzlingSymbol, AnimatedGIF>>;
  private winFrames = new WinFrameCache();
  /** Bumped on every show/clear, so a frame load that finishes after its win was cleared (or
   * replaced by a newer one) doesn't draw anything. */
  private winGeneration = 0;
  /** Live from GET /config (see api.ts) — used only to decide, purely visually, whether a
   * peeked grid is a winner (see winningSymbols/freezeSpin), never to compute a payout. */
  private paylines: [number, number, number][];
  /** ONE overlay spanning the whole reel background (not per-symbol boxes) — hidden until a
   * win, then dims everything under it while each winning symbol's own highlight (see
   * winHighlightLayer) renders on top of it, unaffected. */
  private winOverlay: Graphics;
  /** Sits above winOverlay in the display list — holds a fresh (non-dimmed) copy of every
   * winning symbol, positioned to exactly line up with its real cell underneath. */
  private winHighlightLayer: Container;
  private activeWinVisuals: ActiveWinVisual[] = [];
  /** Rows whose own static sprite got hidden to make room for a highlight visual (see
   * showWinHighlights) — tracked so clearWinAnimations can restore exactly these, and nothing
   * more, without needing every Reel to remember its own hidden-row state. */
  private hiddenSpriteRows: Array<{ reel: Reel; row: number }> = [];

  private constructor(
    app: Application,
    textures: Record<SizzlingSymbol, Texture>,
    gifTemplates: Partial<Record<SizzlingSymbol, AnimatedGIF>>,
    symbolWeights: Partial<Record<SizzlingSymbol, number>>,
    paylines: [number, number, number][]
  ) {
    this.gifTemplates = gifTemplates;
    this.paylines = paylines;
    this.root = new Container();
    // Layout below stays in full 1920x1080 design coordinates; shift it into the cropped canvas.
    this.root.position.set(-VIEW_LEFT, -VIEW_TOP);
    app.stage.addChild(this.root);

    const areaLeft = CANVAS_WIDTH * REEL_AREA_LEFT;
    const areaRight = CANVAS_WIDTH * REEL_AREA_RIGHT;
    const areaTop = CANVAS_HEIGHT * REEL_AREA_TOP;
    const areaBottom = CANVAS_HEIGHT * REEL_AREA_BOTTOM;
    const gap = (areaRight - areaLeft) * REEL_GAP_FRAC;
    const cellWidth = (areaRight - areaLeft - gap * (REEL_COUNT - 1)) / REEL_COUNT;
    const cellHeight = (areaBottom - areaTop) / ROW_COUNT;

    const backdrop = new Graphics();
    backdrop.roundRect(
      areaLeft - 12,
      areaTop - 12,
      areaRight - areaLeft + 24,
      areaBottom - areaTop + 24,
      18
    );
    backdrop.fill({ color: 0x000000, alpha: 0.35 });
    this.root.addChild(backdrop);

    for (let i = 0; i < REEL_COUNT; i++) {
      const reel = new Reel(
        textures,
        gifTemplates,
        this.winFrames.frames,
        cellWidth,
        cellHeight,
        symbolWeights,
        REEL_PHASE_OFFSETS[i] ?? 0
      );
      reel.view.x = areaLeft + i * (cellWidth + gap);
      reel.view.y = areaTop;
      reel.showRandomIdle();
      this.root.addChild(reel.view);
      this.reels.push(reel);
    }

    // Added after every reel view, so it renders on top of all 3 at once when shown.
    this.winOverlay = new Graphics();
    this.winOverlay.roundRect(
      areaLeft - 12,
      areaTop - 12,
      areaRight - areaLeft + 24,
      areaBottom - areaTop + 24,
      18
    );
    this.winOverlay.fill({ color: WIN_OVERLAY_COLOR, alpha: WIN_OVERLAY_ALPHA });
    this.winOverlay.visible = false;
    this.root.addChild(this.winOverlay);

    this.winHighlightLayer = new Container();
    this.root.addChild(this.winHighlightLayer);

    // Debug guide only — draws the 3 straight paylines (TTT/MMM/BBB). Flip SHOW_DEBUG_PAYLINES
    // above to true to show them again (can't just comment out this call — tsc's noUnusedLocals
    // would then flag drawDebugPaylines itself as dead code and fail the build).
    if (SHOW_DEBUG_PAYLINES) this.drawDebugPaylines(areaLeft, areaRight, areaTop, cellHeight);
  }

  /** Draws 3 straight horizontal reference lines across the whole reel width, at the vertical
   * center of the TOP/MIDDLE/BOTTOM row — payline 1 (MMM), 2 (TTT), 3 (BBB) in PAYLINES. Purely
   * a dev/debug aid, not part of actual gameplay; ignores reel 2's own phaseOffsetSteps (it's a
   * rough guide, not meant to trace exactly through reel 2's shifted symbols). */
  private drawDebugPaylines(areaLeft: number, areaRight: number, areaTop: number, cellHeight: number): void {
    const lines = new Graphics();
    for (let row = 0; row < ROW_COUNT; row++) {
      // Follows the reels' own (tightened) row pitch — see Reel.ts's ROW_PITCH_SCALE.
      const y = areaTop + this.reels[0].getRowY(row) + cellHeight / 2;
      lines.moveTo(areaLeft, y).lineTo(areaRight, y);
    }
    lines.stroke({ color: 0xff0000, width: 2, alpha: 0.8 });
    this.root.addChild(lines);
  }

  static async create(
    app: Application,
    symbolWeights: Partial<Record<SizzlingSymbol, number>> = {},
    paylines: [number, number, number][] = []
  ): Promise<SizzlingSevensScene> {
    // Win-animation frames are not preloaded — see WinFrameCache.
    const [textures, gifTemplates] = await Promise.all([loadSymbolTextures(), loadWinGifAnimations()]);
    return new SizzlingSevensScene(app, textures, gifTemplates, symbolWeights, paylines);
  }

  showStaticGrid(grid: Grid): void {
    this.clearWinAnimations();
    grid.forEach((column, i) => this.reels[i].showStatic(column as [Cell, Cell, Cell]));
  }

  /** Starts every reel spinning indefinitely — call once when the player presses Spin. */
  startSpin(): void {
    this.clearWinAnimations();
    this.reels.forEach((r) => r.startContinuousSpin());
  }

  /** Structural-only win check (does ANY line/scatter win at all — not how much) against a
   * grid that hasn't been visually committed to yet. Mirrors winCalc.ts's matching rules just
   * closely enough to answer that yes/no; it never computes a payout and never feeds into
   * scoring — the server (see SizzlingSevensGame.tsx's spinRequest) remains the only source of
   * truth for what actually pays. Used solely to pick the *cosmetic* landing style for a spin
   * that's already fully decided (see freezeSpin) — RTP is entirely unaffected by this check,
   * since it never changes which symbols get reported.
   *
   * Returns the symbols sitting on winning lines (plus BONUS on a scatter trigger) — empty for a
   * loss. A small superset of the cells that will actually animate, so freezeSpin can also
   * pre-decode just their win frames instead of every landed symbol's. */
  private winningSymbols(grid: Grid): Set<SizzlingSymbol> {
    const winners = new Set<SizzlingSymbol>();
    for (const line of this.paylines) {
      const symbols = line.map((row, reel) => grid[reel][row]);
      if (this.lineWins(symbols)) symbols.forEach((s) => s && winners.add(s));
    }

    let bonusCount = 0;
    for (const column of grid) for (const symbol of column) if (symbol === BONUS) bonusCount++;
    if (bonusCount >= BONUS_TRIGGER_COUNT) winners.add(BONUS);
    return winners;
  }

  private lineWins(symbols: Cell[]): boolean {
    let leadingWilds = 0;
    while (leadingWilds < 3 && symbols[leadingWilds] === WILD) leadingWilds++;
    if (leadingWilds >= 1) return true; // any pure-Wild run pays something, however small
    const anchor = symbols[0];
    if (anchor === BONUS || !WILD_SUBSTITUTES_FOR.has(anchor)) return false;
    let matchCount = 0;
    for (let i = 0; i < 3; i++) {
      if (symbols[i] === anchor || symbols[i] === WILD) matchCount++;
      else break;
    }
    if (matchCount >= 3) return true;
    return symbols.every((s) => ANY_BAR_SET.has(s));
  }

  /** Stops every reel (advance-and-bounce, no predetermined target, no symbol swap — see
   * Reel.stopAndSettle) simultaneously and returns the resulting grid for the caller to send
   * off for scoring. First peeks what every reel would land on (without animating), decides
   * once whether that grid wins anything, then tells every reel to land clean (a win) or with a
   * cosmetic "near miss" offset (a loss) — see stopAndSettle's landClean param. The peek and the
   * real settle happen back-to-back with no animation frame between them, so the symbols
   * reported here are guaranteed identical to what was peeked; only the landing's visual
   * cleanliness differs. */
  async freezeSpin(
    forceBonus = false,
    forceLoss?: { isLosing: (grid: Grid) => boolean },
    /** A Free Games round's guaranteed last spin (see api.ts's pickCoveringGrid): given what the
     * reels would land on and a way to draw fresh landings (same blank layout, same reel
     * weights), returns the board to land instead. */
    forceWin?: { pick: (natural: Grid, draw: () => Grid) => Grid },
    /** Fires once, the moment the reels visually land (they all stop together) — for the stop sound. */
    onLanded?: () => void
  ): Promise<Grid> {
    // Testing aid: one BONUS per reel = 3 scatters = guaranteed Free Games trigger.
    if (forceBonus) this.reels.forEach((reel) => reel.forceLandingSymbol(BONUS));
    let peeked = this.reels.map((reel) => reel.peekStopSymbols());
    if (!forceBonus && forceWin) {
      const natural = peeked;
      const draw = () => natural.map((column, i) => column.map((c) => (c === null ? null : this.reels[i].drawSymbol())));
      const chosen = forceWin.pick(natural, draw);
      if (chosen !== natural) {
        this.reels.forEach((reel, i) => reel.setLandingSymbols(chosen[i]));
        peeked = this.reels.map((reel) => reel.peekStopSymbols());
      }
    }
    // Admin "Loss %" (see api.ts's getForcedLossChance): this spin must lose, so a would-be win
    // has its landing symbols re-drawn (same blank layout, same reel weights) until the game's
    // real scoring says it pays nothing — the player just sees an ordinary losing stop.
    if (!forceBonus && forceLoss && !forceLoss.isLosing(peeked)) {
      for (let attempt = 0; attempt < 500; attempt++) {
        const candidate = peeked.map((column, i) => column.map((c) => (c === null ? null : this.reels[i].drawSymbol())));
        if (forceLoss.isLosing(candidate)) {
          this.reels.forEach((reel, i) => reel.setLandingSymbols(candidate[i]));
          peeked = this.reels.map((reel) => reel.peekStopSymbols());
          break;
        }
      }
    }
    const winners = this.winningSymbols(peeked);
    const landClean = forceLoss ? !forceLoss.isLosing(peeked) : winners.size > 0;
    // A win: start fetching/decoding the winning lines' frames now, while the reels settle, so
    // showWinHighlights can play them the moment the reels stop (decoding is async — see
    // symbols.ts's loadImage — so this doesn't stall the landing animation).
    if (landClean) this.winFrames.ensure(winners).catch(() => {});
    let landed = false;
    const onReelLand = () => {
      if (landed) return;
      landed = true;
      onLanded?.();
    };
    return Promise.all(this.reels.map((reel) => reel.stopAndSettle(landClean, onReelLand)));
  }

  /** Dims the *whole* reel area under one shared overlay, then lifts each winning symbol's own
   * .gif (or pulse, for BONUS) above it so only the winners read as "still important" —
   * `positions` is [reelIndex, rowIndex] pairs, exactly SpinEvaluation.winningPositions from
   * the spin response. A losing spin (empty positions) leaves everything untouched rather than
   * graying out a grid with nothing to celebrate. Resolves once the highlight is on screen (or
   * straight away for a loss), so the game can show the WIN amount after the symbols. */
  showWinHighlights(positions: [number, number][]): Promise<void> {
    // Keep the frames freezeSpin already started decoding for this win — only clear the visuals.
    this.clearWinAnimations(false);
    if (positions.length === 0) return Promise.resolve();

    // Decode just the winning symbols' frame sets, then draw the highlight in one go (overlay
    // and animations together, same as before — just after the decode instead of at startup).
    const generation = this.winGeneration;
    const symbols = positions
      .map(([reelIndex, rowIndex]) => this.reels[reelIndex]?.getRowSymbol(rowIndex))
      .filter((symbol): symbol is SizzlingSymbol => !!symbol);
    return this.winFrames
      .ensure(symbols)
      .catch((err) => console.warn("[sizzling7s] win animation frames failed to load", err))
      .then(() => {
        // The game closed mid-load — free what just finished decoding.
        if (this.root.destroyed) this.winFrames.releaseAll();
        else if (generation === this.winGeneration) this.drawWinHighlights(positions);
      });
  }

  private drawWinHighlights(positions: [number, number][]): void {
    this.winOverlay.visible = true;

    const seen = new Set<string>();
    for (const [reelIndex, rowIndex] of positions) {
      const key = `${reelIndex},${rowIndex}`;
      if (seen.has(key)) continue; // multiple winning lines can share the same cell
      seen.add(key);

      const reel = this.reels[reelIndex];
      if (!reel) continue;
      const built = reel.buildWinVisual(rowIndex);
      if (!built) continue;

      // Without this, the original PNG still shows through the (only ~50% opaque) overlay,
      // dimmed, around/behind the gif — hide it entirely so only the highlight is visible.
      reel.setRowSpriteVisible(rowIndex, false);
      this.hiddenSpriteRows.push({ reel, row: rowIndex });

      built.view.x = reel.view.x;
      built.view.y = reel.view.y + reel.getRowY(rowIndex);
      this.winHighlightLayer.addChild(built.view);
      built.play();
      this.activeWinVisuals.push(built);
    }
  }

  clearWinAnimations(releaseFrames = true): void {
    this.winGeneration++;
    this.winOverlay.visible = false;
    this.activeWinVisuals.forEach((v) => v.destroy());
    this.activeWinVisuals = [];
    this.hiddenSpriteRows.forEach(({ reel, row }) => reel.setRowSpriteVisible(row, true));
    this.hiddenSpriteRows = [];
    // Nothing uses the frames once the visuals above are destroyed — free them until the next win.
    if (releaseFrames) this.winFrames.releaseAll();
  }

  destroy(): void {
    this.clearWinAnimations();
    this.reels.forEach((r) => r.destroy());
    Object.values(this.gifTemplates).forEach((template) => template?.destroy());
    this.root.destroy({ children: true });
  }
}
