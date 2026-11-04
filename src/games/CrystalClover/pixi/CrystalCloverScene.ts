import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { Reel, nominalRowCenterY } from "./Reel";
import { loadSymbolTextures, loadFrameTexture } from "./symbols";
import { makeGlowRingTexture } from "../../shared/pixi/softGlow";
import { Grid, CrystalCloverSymbol, LineWin } from "../api";

/** Matches frame.png/bg.png's native resolution exactly — no aspect-ratio distortion between
 * the reference canvas and the pre-rendered frame art. */
export const CANVAS_WIDTH = 2012;
export const CANVAS_HEIGHT = 781;

const REEL_COUNT = 3;
const ROW_COUNT = 3;
/** Fractions of the canvas — estimated against frame.png's gold-bordered window cutouts, hand-
 * tune these against the actual rendered frame if the reels don't line up with the art. */
const REEL_AREA_LEFT = 0.1568;
const REEL_AREA_RIGHT = 0.9228;
const REEL_AREA_TOP = 0.020;
const REEL_AREA_BOTTOM = 0.975;
const REEL_GAP_FRAC = 0.028;

const PAYLINE_COLOR = 0xff2222;
const GLOW_PULSE_PERIOD_MS = 520;
/** Win frame glow: the blurred ring's line width and blur radius, in design px. */
const FRAME_GLOW_WIDTH = 46;
const FRAME_GLOW_BLUR = 26;
/** Vertical inset (px) between the frame border/glow (which stays at the full reel area) and
 * where each reel's own symbol content actually starts/stops — a small buffer band top and
 * bottom so symbols read as scrolling into view from just inside the frame rather than being
 * clipped flush against the border line itself. */
const ROW_PADDING_TOP = 24;
const ROW_PADDING_BOTTOM = 24;

/** Dev/debug aid only — draws 3 red reference lines across the reels at the TOP/MIDDLE/BOTTOM
 * row (see drawDebugPaylines). Flip to true to bring them back. */
const SHOW_DEBUG_PAYLINES = false;

/** MULTIPLIER_2X combo build-up anticipation (see spin()): once reels 1 and 2 both land a 2x,
 * reel 3 spins for this long — instead of its normal ~1.6s — with proportionally more filler so
 * it still reads as fast, not just slow-motion, while its border glows (startFrameGlow([2])). */
const MULTIPLIER_ANTICIPATION_DURATION_MS = 3500;
const MULTIPLIER_ANTICIPATION_FILLER_COUNT = 54;

/** The 9 standard paylines (mirrors backend config.ts's PAYLINES exactly — see that file's
 * comment) — kept as a plain constant here (not fetched from GET /config) since it's small,
 * fixed, and needed purely for the red trace's row-per-reel drawing, never for scoring. */
const PAYLINES: readonly [number, number, number][] = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
  [0, 2, 0],
  [2, 0, 2],
  [1, 0, 1],
  [1, 2, 1],
];

/** Row indices where `column` lands MULTIPLIER_2X — feeds the reel-1/reel-2 combo glow and the
 * reel-3 anticipation trigger in spin(). */
function multiplierRows(column: readonly (CrystalCloverSymbol | null)[]): number[] {
  const rows: number[] = [];
  column.forEach((symbol, row) => {
    if (symbol === "MULTIPLIER_2X") rows.push(row);
  });
  return rows;
}

export class CrystalCloverScene {
  private root: Container;
  private reels: Reel[] = [];
  /** Scene-level connectors bridging the (symbol-free) gaps between reels — the within-reel
   * segments are drawn by each Reel itself, behind its own symbols (see Reel.paylineLayer). */
  private connectorLayer: Container;
  private cellWidth: number;
  private areaLeft: number;
  private areaTop: number;
  private gap: number;
  /** Warm gold glow traced around each reel's *own* border individually (frame.png draws 3
   * separate gold rectangles, one per reel, not one box around the whole group), shown
   * alongside the payline traces on a win (see showWinHighlights) — a soft blurred backdrop
   * plus a crisp pulsing stroke per reel, same two-layer technique Buffalo777's
   * Reel.startWinGlow uses per-symbol. */
  private frameGlowBackdrops: Sprite[] = [];
  /** The one pre-blurred glow ring all 3 reels share (they're the same size). */
  private readonly frameGlowTexture: Texture;
  private frameGlowBorders: Graphics[] = [];
  private frameGlowBounds: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  private frameGlowRafId: number | null = null;

  private constructor(app: Application, textures: Record<CrystalCloverSymbol, Texture>, frameTexture: Texture) {
    this.root = new Container();
    app.stage.addChild(this.root);

    const areaLeft = CANVAS_WIDTH * REEL_AREA_LEFT;
    const areaRight = CANVAS_WIDTH * REEL_AREA_RIGHT;
    const areaTop = CANVAS_HEIGHT * REEL_AREA_TOP;
    const areaBottom = CANVAS_HEIGHT * REEL_AREA_BOTTOM;
    const gap = (areaRight - areaLeft) * REEL_GAP_FRAC;
    const cellWidth = (areaRight - areaLeft - gap * (REEL_COUNT - 1)) / REEL_COUNT;
    // The frame/glow border stays at the full areaTop..areaBottom span (that's "the frame");
    // the reels themselves sit inset by ROW_PADDING_TOP/BOTTOM within it, so there's a visible
    // gap between the border and where a symbol's artwork actually starts/ends — new symbols
    // read as scrolling up into view from just past that padding, not clipped flush at the
    // border line.
    const reelTop = areaTop + ROW_PADDING_TOP;
    const reelBottom = areaBottom - ROW_PADDING_BOTTOM;
    const cellHeight = (reelBottom - reelTop) / ROW_COUNT;
    this.cellWidth = cellWidth;
    this.areaLeft = areaLeft;
    this.areaTop = reelTop;
    this.gap = gap;

    // frame.png already supplies the full backdrop (gold border + reel-window gradient) as one
    // flat image — the live reels below draw only their scrolling symbols on top of it.
    const backdrop = new Sprite(frameTexture);
    backdrop.width = CANVAS_WIDTH;
    backdrop.height = CANVAS_HEIGHT;
    this.root.addChild(backdrop);

    // Frame glow — hidden until a win (see showWinHighlights), traced around each reel's own
    // border individually (matching frame.png's actual art: 3 separate gold rectangles, not
    // one box around the whole group) so it reads as those exact borders lighting up. Added
    // right after the backdrop (before the payline connectors and the reels) so it renders
    // *behind* the payline trace and the symbols, never on top of them.
    // A real blur, baked once into a small texture (see makeGlowRingTexture) and only faded in and
    // out — the same soft look the old BlurFilter gave, with no filter render targets in GPU memory.
    const ring = makeGlowRingTexture(cellWidth, areaBottom - areaTop, FRAME_GLOW_WIDTH, FRAME_GLOW_BLUR, "#ffb300");
    this.frameGlowTexture = ring.texture;
    for (let i = 0; i < REEL_COUNT; i++) {
      const left = areaLeft + i * (cellWidth + gap);
      this.frameGlowBounds.push({ left, top: areaTop, right: left + cellWidth, bottom: areaBottom });

      const glowBackdrop = new Sprite(ring.texture);
      glowBackdrop.position.set(left - ring.pad, areaTop - ring.pad);
      glowBackdrop.visible = false;
      this.root.addChild(glowBackdrop);
      this.frameGlowBackdrops.push(glowBackdrop);

      const glowBorder = new Graphics();
      glowBorder.visible = false;
      this.root.addChild(glowBorder);
      this.frameGlowBorders.push(glowBorder);
    }

    this.connectorLayer = new Container();
    this.root.addChild(this.connectorLayer);

    for (let i = 0; i < REEL_COUNT; i++) {
      const reel = new Reel(textures, cellWidth, cellHeight);
      reel.container.x = areaLeft + i * (cellWidth + gap);
      reel.container.y = reelTop;
      reel.showRandomIdle();
      this.root.addChild(reel.container);
      this.reels.push(reel);
    }

    // Debug guide only — draws the 3 straight paylines (row 0/1/2). Flip SHOW_DEBUG_PAYLINES
    // above to true to show them again (can't just comment out this call — tsc's noUnusedLocals
    // would then flag drawDebugPaylines itself as dead code and fail the build).
    if (SHOW_DEBUG_PAYLINES) this.drawDebugPaylines(areaLeft, areaRight, reelTop, cellHeight);
  }

  /** Draws 3 straight horizontal reference lines across the whole reel width, at the vertical
   * center of the TOP/MIDDLE/BOTTOM row — payline 2 (TTT), 1 (MMM), 3 (BBB) in PAYLINES. Purely
   * a dev/debug aid, not part of actual gameplay; drawn at each row's nominal design center
   * (ignores each reel's own random settle nudge — see Reel.restOffset — since this is a fixed
   * reference grid, not a trace of any one spin's actual landing). */
  private drawDebugPaylines(areaLeft: number, areaRight: number, reelTop: number, cellHeight: number): void {
    const lines = new Graphics();
    for (let row = 0; row < ROW_COUNT; row++) {
      const y = reelTop + nominalRowCenterY(cellHeight, row);
      lines.moveTo(areaLeft, y).lineTo(areaRight, y);
    }
    lines.stroke({ color: 0x00ff00, width: 2, alpha: 0.8 });
    this.root.addChild(lines);
  }

  static async create(app: Application): Promise<CrystalCloverScene> {
    const [textures, frameTexture] = await Promise.all([loadSymbolTextures(), loadFrameTexture()]);
    return new CrystalCloverScene(app, textures, frameTexture);
  }

  showStaticGrid(grid: Grid): void {
    this.clearWinHighlights();
    grid.forEach((column, i) => this.reels[i].showStatic(column as [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null]));
  }

  /** Spins all reels and lands on the server-predetermined grid (nulls included — see
   * Reel.buildCell). Resolves once every reel has stopped — same staggered-duration technique
   * as Buffalo777Scene.spin (all reels start together, each just takes progressively longer to
   * land).
   *
   * MULTIPLIER_2X combo build-up (cosmetic only — the grid is already server-decided, this just
   * paces revealing it): reel 1 landing a 2x starts a glow on it; reel 2 landing without one
   * clears reel 1's glow (combo broken), landing with one glows reel 2 too and sends reel 3 into
   * an extended, faster anticipation spin with its border lit up (see startFrameGlow), win or
   * miss on reel 3 — the suspense is the point, not a guarantee. */
  async spin(grid: Grid, onReelLand?: (index: number) => void, turbo = false): Promise<void> {
    this.clearWinHighlights();
    this.reels.forEach((reel) => reel.clearMultiplierGlow());
    const speed = turbo ? 0.4 : 1;

    const reel1Multiplier = multiplierRows(grid[0]);
    const reel2Multiplier = multiplierRows(grid[1]);
    const anticipateReel3 = reel1Multiplier.length > 0 && reel2Multiplier.length > 0;

    const spins = this.reels.map((reel, i) => {
      const anticipating = i === 2 && anticipateReel3;
      return reel
        .spinTo(
          grid[i] as [CrystalCloverSymbol | null, CrystalCloverSymbol | null, CrystalCloverSymbol | null],
          anticipating ? MULTIPLIER_ANTICIPATION_DURATION_MS : (900 + i * 350) * speed,
          0,
          anticipating ? MULTIPLIER_ANTICIPATION_FILLER_COUNT : undefined
        )
        .then(() => {
          onReelLand?.(i);
          if (i === 0 && reel1Multiplier.length > 0) {
            this.reels[0].startMultiplierGlow(reel1Multiplier);
          } else if (i === 1 && reel1Multiplier.length > 0) {
            if (reel2Multiplier.length > 0) {
              this.reels[1].startMultiplierGlow(reel2Multiplier);
              this.startFrameGlow([2]);
            } else {
              this.reels[0].clearMultiplierGlow();
            }
          } else if (i === 2 && anticipateReel3) {
            this.stopFrameGlow([2]);
          }
        });
    });
    await Promise.all(spins);
  }

  /** Draws the red trace for every winning line (behind the symbols — see Reel.paylineLayer),
   * pulses every winning cell's symbol, and lights up the frame border with a warm gold glow.
   * `lineWins` is exactly SpinEvaluation.lineWins from the spin response. */
  showWinHighlights(lineWins: LineWin[]): void {
    this.clearWinHighlights();
    if (lineWins.length === 0) return;

    this.startFrameGlow();

    const seenLines = new Set<number>();
    for (const win of lineWins) {
      if (seenLines.has(win.lineNumber)) continue;
      seenLines.add(win.lineNumber);
      this.drawPaylineTrace(PAYLINES[win.lineNumber - 1]);
    }

    const seenCells = new Set<string>();
    for (const win of lineWins) {
      for (const [reelIndex, rowIndex] of win.positions) {
        const key = `${reelIndex},${rowIndex}`;
        if (seenCells.has(key)) continue;
        seenCells.add(key);
        this.reels[reelIndex]?.pulseRow(rowIndex);
      }
    }
  }

  /** Draws one line's full path as a single continuous polyline through each reel's target-row
   * center — a straight "/" or "\" for a genuine diagonal (top-mid-bottom etc, where the
   * middle reel's row is exactly the midpoint), a clean "V"/"Λ" kink at the middle reel for
   * the non-monotonic patterns (e.g. top-bottom-top), and a flat line for the 3 straight rows.
   * Each reel draws the portion crossing its own width (behind its own symbols — see
   * Reel.paylineLayer); this scene draws only the connectors bridging the gaps between reels,
   * continuing the exact same slope so nothing stair-steps at a reel boundary. */
  private drawPaylineTrace(line: readonly [number, number, number]): void {
    const step = this.cellWidth + this.gap;
    const half = this.cellWidth / 2;
    // Local (reel-relative, no areaTop) row-center y — what each reel's own
    // drawPaylineSegment expects, since it draws inside that reel's own coordinate space.
    const ly = [0, 1, 2].map((i) => this.reels[i].getRowCenterY(line[i]));
    // Scene-space center point (x, y) of each reel's target row — what the scene-level
    // connectors below need, since connectorLayer has no per-reel offset applied to it.
    const cx = [0, 1, 2].map((i) => this.areaLeft + i * step + half);
    const cy = ly.map((y) => this.areaTop + y);
    const slopeLeft = (cy[1] - cy[0]) / (cx[1] - cx[0]);
    const slopeRight = (cy[2] - cy[1]) / (cx[2] - cx[1]);

    // Reel 0 and reel 2 each draw one segment across their own full width, extending the
    // slope of the segment they belong to out from their own row-center. Local coordinates —
    // areaTop must NOT be added here, or the segment lands offset from where the scene-level
    // connectors (below) expect to meet it, breaking the line right at the reel boundary.
    this.reels[0].drawPaylineSegment(ly[0] - slopeLeft * half, ly[0] + slopeLeft * half, PAYLINE_COLOR);
    this.reels[2].drawPaylineSegment(ly[2] - slopeRight * half, ly[2] + slopeRight * half, PAYLINE_COLOR);
    // Reel 1 draws two half-width segments meeting exactly at its own row-center — identical
    // slopes (a true diagonal) draw as one visually seamless line; different slopes draw the
    // V/Λ kink right where the reel's own symbol sits, which is exactly where it should be.
    this.reels[1].drawPaylineSegment(ly[1] - slopeLeft * half, ly[1], PAYLINE_COLOR, 0, half);
    this.reels[1].drawPaylineSegment(ly[1], ly[1] + slopeRight * half, PAYLINE_COLOR, half, this.cellWidth);

    // Connectors across the (symbol-free) gaps — scene-space coordinates (cy, not ly), same
    // slope as the segment on each side, so the line is fully continuous from reel 0's left
    // edge to reel 2's right edge.
    const connectors = new Graphics();
    connectors.moveTo(this.areaLeft + this.cellWidth, cy[0] + slopeLeft * half);
    connectors.lineTo(this.areaLeft + step, cy[1] - slopeLeft * half);
    connectors.moveTo(this.areaLeft + step + this.cellWidth, cy[1] + slopeRight * half);
    connectors.lineTo(this.areaLeft + 2 * step, cy[2] - slopeRight * half);
    connectors.stroke({ color: PAYLINE_COLOR, width: 10, alpha: 0.85 });
    this.connectorLayer.addChild(connectors);
  }

  /** `reelIndices` defaults to all 3 (a win); pass a subset (e.g. [2]) to light up only that
   * reel's border — used for the reel-3 multiplier-combo anticipation hold (see spin()). The
   * animate loop always iterates all 3 reels but skips any that aren't currently visible, so a
   * subset call layers safely on top of (or independently of) a full-width glow. */
  private startFrameGlow(reelIndices: number[] = [0, 1, 2]): void {
    // The crisp border itself is static — drawn once here, square corners (no radius, matching
    // frame.png's own sharp-cornered rectangles), never touched again by the pulse loop below.
    // Only the blurred backdrop ("the glow"/"the shadow") animates.
    for (const i of reelIndices) {
      this.frameGlowBackdrops[i].visible = true;
      this.frameGlowBorders[i].visible = true;
      const { left, top, right, bottom } = this.frameGlowBounds[i];
      const border = this.frameGlowBorders[i];
      border.clear();
      border.rect(left, top, right - left, bottom - top);
      border.stroke({ color: 0xfff2b3, width: 10, alpha: 0.9 });
    }

    if (this.frameGlowRafId !== null) return;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      for (let i = 0; i < REEL_COUNT; i++) {
        const backdrop = this.frameGlowBackdrops[i];
        if (!backdrop.visible) continue;
        // The glow is centred on frame.webp's own gold border line, so it reads as that exact
        // border lighting up; it just breathes in brightness with the pulse.
        backdrop.alpha = 0.6 + pulse * 0.4;
      }

      this.frameGlowRafId = requestAnimationFrame(animate);
    };
    this.frameGlowRafId = requestAnimationFrame(animate);
  }

  /** `reelIndices` defaults to all 3 — see startFrameGlow's doc comment. */
  private stopFrameGlow(reelIndices: number[] = [0, 1, 2]): void {
    for (const i of reelIndices) {
      this.frameGlowBackdrops[i].visible = false;
      this.frameGlowBorders[i].visible = false;
    }
    if (this.frameGlowRafId !== null && this.frameGlowBackdrops.every((g) => !g.visible)) {
      cancelAnimationFrame(this.frameGlowRafId);
      this.frameGlowRafId = null;
    }
  }

  clearWinHighlights(): void {
    this.stopFrameGlow();
    this.connectorLayer.removeChildren().forEach((c) => c.destroy());
    this.reels.forEach((r) => {
      r.clearPaylineSegments();
      r.clearGlow();
    });
  }

  destroy(): void {
    this.clearWinHighlights();
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
    this.frameGlowTexture.destroy(true);
  }
}
