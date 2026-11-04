import { Application, Container, Graphics, Texture } from "pixi.js";
import { Reel } from "./Reel";
import { loadSymbolTextures } from "./symbols";
import { LifeOfLuxurySymbol } from "../api";

export const REEL_COUNT = 5;
export const ROW_COUNT = 3;
export const CELL_WIDTH = 250;
export const CELL_HEIGHT = 250;
export const COLUMN_GAP = 12;

export const GRID_WIDTH = REEL_COUNT * CELL_WIDTH + (REEL_COUNT - 1) * COLUMN_GAP;
export const GRID_HEIGHT = ROW_COUNT * CELL_HEIGHT;

/** How long each reel spins for, in ms, before the turbo/FAST multiplier (see spin() below) —
 * this is the number to raise for a slower spin, lower for a faster one. Applies equally to
 * every reel (each spins for exactly this long); the left-to-right stagger below is what then
 * makes them start, and finish, in sequence. */
const SPIN_DURATION_MS = 2000;
/** How long after one reel starts spinning before the next one begins, in ms, before the turbo
 * multiplier — 0.1s by default. Since every reel runs for the identical SPIN_DURATION_MS above,
 * this same stagger also carries through to when each one stops (reel 0 first, reel 4 last). */
const REEL_START_STAGGER_MS = 100;

/** Per-reel border is a single ring, but split diagonally (top-left corner to bottom-right
 * corner) into two colors — not two concentric rings. The top+right edges are one color, the
 * left+bottom edges the other, each drawn as its own polyline sharing the two corners that sit
 * on the diagonal. */
const REEL_BORDER_TOP_RIGHT_COLOR = 0x3c12e1;
const REEL_BORDER_BOTTOM_LEFT_COLOR = 0x1da1e4;
const REEL_BORDER_WIDTH = 8;
/** Fallback border color for a winning cell with no line color of its own (a scatter hit that
 * isn't also part of a line win). */
const SCATTER_BOX_COLOR = 0xffd700;
/** Border width and connecting-bridge width are equal on purpose — a winning cell's border and
 * the bridge to its neighbor must read as one unbroken colored shape, not a thin line cutting
 * across the symbol art plus a separately-sized box. */
const WIN_BORDER_WIDTH = 11;
/** Thinner/more transparent than a win border — this is a reference overlay ("here's where
 * line N runs"), not a "you won" indicator, so it should read as quieter. */
const ALL_LINES_WIDTH = 8;
const ALL_LINES_ALPHA = 0.6;
/** Overlay alpha for symbols that didn't take part in any win, dimmed simultaneously with the
 * winning cells' border/bridge highlight so the eye is drawn straight to the pattern. */
const DIM_OVERLAY_ALPHA = 0.6;

export interface LineWinPositions {
  lineNumber: number;
  positions: [number, number][]; // [reel, row]
}

/** One line win (or the scatter) worth of border+bridge to draw — `lineNumber: null` marks the
 * scatter group (no sidebar dot to sync blink with, no bridges since scatter cells aren't a
 * connected run). Built once per spin by buildWinGroups; LifeOfLuxuryGame.tsx then owns the
 * blink/cycle timing and calls drawActiveGroup on every tick — Pixi just renders whatever it's
 * told, so the canvas and the sidebar ticks blink off one shared clock. */
export interface WinHighlightGroup {
  lineNumber: number | null;
  color: number;
  positions: [number, number][];
  /** The line's full 5-reel row pattern (null for the scatter group, which has no line to
   * complete) — lets drawActiveGroup trace the *rest* of the payline past wherever the match
   * itself stopped (e.g. a 3-of-5 win still shows the line running on through reels 4/5, unboxed)
   * out to the canvas edge, so it reads as one continuous line into the sidebar's payline dot
   * (see LifeOfLuxuryGame.tsx's PaylineDot, whose tick already blinks in sync). */
  fullPath: [number, number][] | null;
}

/** One row index (0=top/1=mid/2=bottom) per reel — a payline's full path across all 5 reels. */
export type PaylinePattern = readonly [number, number, number, number, number];

export class LifeOfLuxuryScene {
  private root: Container;
  private reels: Reel[] = [];
  private allLinesGraphics: Graphics;
  private dimOverlayGraphics: Graphics;
  private winLinesGraphics: Graphics;
  private winBoxesGraphics: Graphics;
  private allLinesVisible = false;
  private lastPaylines: readonly PaylinePattern[] = [];
  private lastLineColors: string[] = [];

  private constructor(app: Application, textures: Record<LifeOfLuxurySymbol, Texture>) {
    this.root = new Container();
    app.stage.addChild(this.root);

    for (let i = 0; i < REEL_COUNT; i++) {
      const reelWindow = new Container();
      reelWindow.x = i * (CELL_WIDTH + COLUMN_GAP);
      reelWindow.y = 0;

      const mask = new Graphics();
      mask.rect(0, 0, CELL_WIDTH, GRID_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel(textures, CELL_WIDTH, CELL_HEIGHT);
      reelWindow.addChild(reel.container);
      reel.showRandomIdle();

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    // Each reel gets its own full border frame (not just a center line between reels, and not
    // the outer canvas bezel — see LifeOfLuxuryGame.tsx's border-sky-500 wrapper for that) — one
    // ring, split diagonally (top-left corner to bottom-right corner) into two colors: top+right
    // edges one color, left+bottom edges the other.
    const reelBorderTopRight = new Graphics();
    const reelBorderBottomLeft = new Graphics();
    for (let i = 0; i < REEL_COUNT; i++) {
      const x0 = i * (CELL_WIDTH + COLUMN_GAP);
      const y0 = 0;
      const x1 = x0 + CELL_WIDTH;
      const y1 = GRID_HEIGHT;
      reelBorderTopRight.moveTo(x0, y0).lineTo(x0, y1).lineTo(x1, y1);
      reelBorderBottomLeft.moveTo(x1, y1).lineTo(x1, y0).lineTo(x0, y0);
    }
    reelBorderTopRight.stroke({ color: REEL_BORDER_TOP_RIGHT_COLOR, width: REEL_BORDER_WIDTH });
    reelBorderBottomLeft.stroke({ color: REEL_BORDER_BOTTOM_LEFT_COLOR, width: REEL_BORDER_WIDTH });
    this.root.addChild(reelBorderTopRight);
    this.root.addChild(reelBorderBottomLeft);

    this.allLinesGraphics = new Graphics();
    this.root.addChild(this.allLinesGraphics);
    this.dimOverlayGraphics = new Graphics();
    this.root.addChild(this.dimOverlayGraphics);
    this.winLinesGraphics = new Graphics();
    this.root.addChild(this.winLinesGraphics);
    this.winBoxesGraphics = new Graphics();
    this.root.addChild(this.winBoxesGraphics);
  }

  static async create(app: Application): Promise<LifeOfLuxuryScene> {
    const textures = await loadSymbolTextures();
    return new LifeOfLuxuryScene(app, textures);
  }

  /** Spins all reels and lands on the server-predetermined grid. `grid[reel][row]`. `turbo`
   * compresses every reel's duration/stagger by the same factor (see LifeOfLuxuryGame.tsx's FAST
   * toggle). Every reel spins for the same SPIN_DURATION_MS, started REEL_START_STAGGER_MS apart
   * (reel 0 first, then reel 1, ... reel 4 last) — since they all run the same length of time,
   * that same left-to-right order also determines the stop order (reel 0 lands first, reel 4
   * last), matching a classic mechanical slot machine's start/stop sequence. */
  async spin(grid: LifeOfLuxurySymbol[][], turbo = false, onReelLand?: (index: number) => void): Promise<void> {
    this.clearWinHighlights();
    this.setAllPaylinesVisible(false);
    const speed = turbo ? 0.4 : 1;
    const spins = this.reels.map((reel, i) =>
      reel
        .spinTo(
          grid[i] as [LifeOfLuxurySymbol, LifeOfLuxurySymbol, LifeOfLuxurySymbol],
          SPIN_DURATION_MS * speed,
          i * REEL_START_STAGGER_MS * speed,
          () => onReelLand?.(i)
        )
    );
    await Promise.all(spins);
  }

  private cellCenter(reel: number, row: number): { x: number; y: number } {
    return {
      x: reel * (CELL_WIDTH + COLUMN_GAP) + CELL_WIDTH / 2,
      y: row * CELL_HEIGHT + CELL_HEIGHT / 2,
    };
  }

  /**
   * Bridge endpoint height between two consecutive winning cells. Flat (same row on both
   * reels): the cells' shared center height, same as ever. Diagonal (row steps by one — every
   * payline in this game only ever steps by exactly one row between adjacent reels, never two):
   * *not* each cell's own center — instead the row boundary the two cells share (bottom edge of
   * whichever cell is higher on screen = top edge of whichever is lower), so the bridge sits
   * flush against both borders instead of slicing diagonally across the symbol art.
   */
  private bridgeY(rowA: number, rowB: number): number {
    return rowA === rowB ? rowA * CELL_HEIGHT + CELL_HEIGHT / 2 : Math.max(rowA, rowB) * CELL_HEIGHT;
  }

  /**
   * Builds one WinHighlightGroup per line win (its own color, matching that line's sidebar
   * payline dot — see LifeOfLuxuryGame.tsx's LINE_DOT_COLORS) plus one more for the scatter, if
   * any — and dims every cell that isn't part of *any* of them, once, for the whole cycle (only
   * the active group's border/bridge blinks and cycles; every winning symbol just stays lit
   * throughout). Returns the groups so the caller can drive the blink/cycle timing and call
   * drawActiveGroup — this method only ever runs once per spin.
   */
  buildWinGroups(lineWins: LineWinPositions[], scatterPositions: [number, number][], lineColors: string[]): WinHighlightGroup[] {
    const groups: WinHighlightGroup[] = lineWins.map((win) => {
      const pattern = this.lastPaylines[win.lineNumber - 1];
      return {
        lineNumber: win.lineNumber,
        color: Number.parseInt(lineColors[(win.lineNumber - 1) % lineColors.length].replace("#", ""), 16),
        positions: win.positions,
        fullPath: pattern ? pattern.map((row, reel): [number, number] => [reel, row]) : null,
      };
    });
    if (scatterPositions.length > 0) {
      groups.push({ lineNumber: null, color: SCATTER_BOX_COLOR, positions: scatterPositions, fullPath: null });
    }

    const winning = new Set<string>();
    groups.forEach((g) => g.positions.forEach(([reel, row]) => winning.add(`${reel},${row}`)));

    this.dimOverlayGraphics.clear();
    if (winning.size > 0) {
      for (let reel = 0; reel < REEL_COUNT; reel++) {
        for (let row = 0; row < ROW_COUNT; row++) {
          if (winning.has(`${reel},${row}`)) continue;
          this.dimOverlayGraphics.rect(reel * (CELL_WIDTH + COLUMN_GAP), row * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
        }
      }
      this.dimOverlayGraphics.fill({ color: 0x000000, alpha: DIM_OVERLAY_ALPHA });
    }

    return groups;
  }

  /** Draws exactly one highlight group — border around each of its cells, plus border-to-border
   * bridges between consecutive reels for a line (never for the scatter group, whose positions
   * aren't a connected run) — in either its real color (`blinkOn: true`) or solid black
   * (`blinkOn: false`). Called every blink/cycle tick from LifeOfLuxuryGame.tsx; `group: null`
   * just clears (used once the cycle stops). */
  drawActiveGroup(group: WinHighlightGroup | null, blinkOn: boolean): void {
    this.winLinesGraphics.clear();
    this.winBoxesGraphics.clear();
    if (!group) return;
    const colorNum = blinkOn ? group.color : 0x000000;

    if (group.lineNumber !== null) {
      for (let i = 0; i < group.positions.length - 1; i++) {
        const [reelA, rowA] = group.positions[i];
        const [reelB, rowB] = group.positions[i + 1];
        const y = this.bridgeY(rowA, rowB);
        const fromX = reelA * (CELL_WIDTH + COLUMN_GAP) + CELL_WIDTH;
        const toX = reelB * (CELL_WIDTH + COLUMN_GAP);
        this.winLinesGraphics.moveTo(fromX, y).lineTo(toX, y);
        this.winLinesGraphics.stroke({ color: colorNum, width: WIN_BORDER_WIDTH, alpha: 1 });
      }

      // The match stopped short of reel 5 (a 3- or 4-of-a-kind) — keep tracing the SAME payline
      // on through the remaining reels and out to the canvas's right edge, so it reads as
      // continuous into the sidebar's blinking tick+dot rather than stopping dead where the win
      // did. Leaves the matched box from its own top/bottom/center edge (via bridgeY, exactly
      // like the matched-to-matched bridges above — not the box's dead center), then for each
      // unboxed reel it crosses, angles from that entry edge to the edge the *next* step needs
      // (or its own row center, for the final reel) — a boxed cell's border alone reads as "the
      // line" for the gap-only bridges above; an unboxed reel has no border to lean on, so the
      // line has to actually cross its full width to stay visible at all.
      if (group.fullPath && group.positions.length < group.fullPath.length) {
        const matchedCount = group.positions.length;
        const [matchedReel, matchedRow] = group.fullPath[matchedCount - 1];
        let currentX = matchedReel * (CELL_WIDTH + COLUMN_GAP) + CELL_WIDTH;
        let currentY = this.bridgeY(matchedRow, group.fullPath[matchedCount][1]);

        for (let r = matchedCount; r < group.fullPath.length; r++) {
          const [reel, row] = group.fullPath[r];
          const leftX = reel * (CELL_WIDTH + COLUMN_GAP);
          const rightX = leftX + CELL_WIDTH;

          this.winLinesGraphics.moveTo(currentX, currentY).lineTo(leftX, currentY);
          this.winLinesGraphics.stroke({ color: colorNum, width: WIN_BORDER_WIDTH, alpha: 1 });

          const nextRow = r + 1 < group.fullPath.length ? group.fullPath[r + 1][1] : row;
          const exitY = this.bridgeY(row, nextRow);
          this.winLinesGraphics.moveTo(leftX, currentY).lineTo(rightX, exitY);
          this.winLinesGraphics.stroke({ color: colorNum, width: WIN_BORDER_WIDTH, alpha: 1 });

          currentX = rightX;
          currentY = exitY;
        }

        this.winLinesGraphics.moveTo(currentX, currentY).lineTo(GRID_WIDTH, currentY);
        this.winLinesGraphics.stroke({ color: colorNum, width: WIN_BORDER_WIDTH, alpha: 1 });
      }
    }

    for (const [reel, row] of group.positions) {
      const x = reel * (CELL_WIDTH + COLUMN_GAP);
      const y = row * CELL_HEIGHT;
      this.winBoxesGraphics.rect(
        x + WIN_BORDER_WIDTH / 2,
        y + WIN_BORDER_WIDTH / 2,
        CELL_WIDTH - WIN_BORDER_WIDTH,
        CELL_HEIGHT - WIN_BORDER_WIDTH
      );
      this.winBoxesGraphics.stroke({ color: colorNum, width: WIN_BORDER_WIDTH });
    }
  }

  clearWinHighlights(): void {
    this.winLinesGraphics.clear();
    this.winBoxesGraphics.clear();
    this.dimOverlayGraphics.clear();
  }

  /** Draws (or clears) all 15 fixed payline patterns at once, each in its own color (matching
   * the HTML sidebar dots — see LifeOfLuxuryGame.tsx's LINE_DOT_COLORS) — a quiet reference
   * overlay of "where every line runs", independent of any win. Re-calling with `visible: true`
   * after the last-used paylines/colors changed isn't needed here (this game's line patterns
   * are fixed), but the params are threaded through each call to keep this method stateless
   * about anything except the on/off flag. */
  setAllPaylinesVisible(visible: boolean, paylines: readonly PaylinePattern[] = this.lastPaylines, lineColors: string[] = this.lastLineColors): void {
    this.allLinesVisible = visible;
    this.lastPaylines = paylines;
    this.lastLineColors = lineColors;
    this.allLinesGraphics.clear();
    if (!visible) return;

    paylines.forEach((line, i) => {
      const color = lineColors[i % lineColors.length];
      const colorNum = Number.parseInt(color.replace("#", ""), 16);
      line.forEach((row, reel) => {
        const { x, y } = this.cellCenter(reel, row);
        if (reel === 0) this.allLinesGraphics.moveTo(x, y);
        else this.allLinesGraphics.lineTo(x, y);
      });
      this.allLinesGraphics.stroke({ color: colorNum, width: ALL_LINES_WIDTH, alpha: ALL_LINES_ALPHA });
    });
  }

  get paylinesVisible(): boolean {
    return this.allLinesVisible;
  }

  destroy(): void {
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
  }
}
