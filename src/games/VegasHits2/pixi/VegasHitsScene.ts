import { Application, Container, Graphics, Texture } from "pixi.js";
import { Reel } from "./Reel";
import { loadSymbolTextures } from "./symbols";
import { Grid, VegasHitsSymbol } from "../api";

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

const REEL_COUNT = 3;
const ROW_COUNT = 3;
const REEL_AREA_LEFT = 0.194;
const REEL_AREA_RIGHT = 0.805;
const REEL_AREA_TOP = 0.215;
const REEL_AREA_BOTTOM = 0.765;
const REEL_GAP_FRAC = 0.048;

const GLOW_COLOR = 0xffb300;
const GLOW_PULSE_PERIOD_MS = 520;

/** Dev/debug aid only — draws 3 red reference lines across the reels at the TOP/MIDDLE/BOTTOM
 * row. Flip to true to bring them back. */
const SHOW_DEBUG_PAYLINES = false;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class VegasHitsScene {
  private root: Container;
  private reels: Reel[] = [];
  /** Warm gold glow traced around the whole reel frame on a win — a soft blurred backdrop plus
   * a crisp pulsing stroke, same two-layer technique 7 Crystal Clover's frame glow uses. */
  private frameGlowBackdrop: Graphics;
  private frameGlowBorder: Graphics;
  private frameGlowBounds: Bounds;
  private frameGlowRafId: number | null = null;

  private constructor(app: Application, textures: Record<VegasHitsSymbol, Texture>, symbolWeights: Partial<Record<VegasHitsSymbol, number>>) {
    this.root = new Container();
    app.stage.addChild(this.root);

    const areaLeft = CANVAS_WIDTH * REEL_AREA_LEFT;
    const areaRight = CANVAS_WIDTH * REEL_AREA_RIGHT;
    const areaTop = CANVAS_HEIGHT * REEL_AREA_TOP;
    const areaBottom = CANVAS_HEIGHT * REEL_AREA_BOTTOM;
    const gap = (areaRight - areaLeft) * REEL_GAP_FRAC;
    const cellWidth = (areaRight - areaLeft - gap * (REEL_COUNT - 1)) / REEL_COUNT;
    const cellHeight = (areaBottom - areaTop) / ROW_COUNT;

    const backdrop = new Graphics();
    backdrop.roundRect(areaLeft - 12, areaTop - 12, areaRight - areaLeft + 24, areaBottom - areaTop + 24, 18);
    backdrop.fill({ color: 0x000000, alpha: 0.35 });
    this.root.addChild(backdrop);

    this.frameGlowBounds = { left: areaLeft - 12, top: areaTop - 12, right: areaRight + 12, bottom: areaBottom + 12 };
    this.frameGlowBackdrop = new Graphics();
    this.frameGlowBackdrop.visible = false;
    this.root.addChild(this.frameGlowBackdrop);
    this.frameGlowBorder = new Graphics();
    this.frameGlowBorder.visible = false;
    this.root.addChild(this.frameGlowBorder);

    for (let i = 0; i < REEL_COUNT; i++) {
      const reel = new Reel(textures, cellWidth, cellHeight, symbolWeights);
      reel.view.x = areaLeft + i * (cellWidth + gap);
      reel.view.y = areaTop;
      reel.showRandomIdle();
      this.root.addChild(reel.view);
      this.reels.push(reel);
    }

    if (SHOW_DEBUG_PAYLINES) this.drawDebugPaylines(areaLeft, areaRight, areaTop, cellHeight);
  }

  private drawDebugPaylines(areaLeft: number, areaRight: number, areaTop: number, cellHeight: number): void {
    const lines = new Graphics();
    for (let row = 0; row < ROW_COUNT; row++) {
      const y = areaTop + (row + 0.5) * cellHeight;
      lines.moveTo(areaLeft, y).lineTo(areaRight, y);
    }
    lines.stroke({ color: 0xff0000, width: 2, alpha: 0.8 });
    this.root.addChild(lines);
  }

  static async create(app: Application, symbolWeights: Partial<Record<VegasHitsSymbol, number>> = {}): Promise<VegasHitsScene> {
    const textures = await loadSymbolTextures();
    return new VegasHitsScene(app, textures, symbolWeights);
  }

  showStaticGrid(grid: Grid): void {
    this.clearWinHighlights();
    grid.forEach((column, i) => this.reels[i].showStatic(column as [VegasHitsSymbol | null, VegasHitsSymbol | null, VegasHitsSymbol | null]));
  }

  /** Spins all reels and lands on the server-predetermined grid (classic auto-stop — see
   * engine.ts's spin()). Resolves once every reel has stopped — staggered per-reel durations so
   * they don't all land in lockstep, same technique 7 Crystal Clover's scene uses. `turbo`
   * compresses every reel's duration by the same factor. */
  async spin(grid: Grid, onReelLand?: (index: number) => void, turbo = false): Promise<void> {
    this.clearWinHighlights();
    const speed = turbo ? 0.4 : 1;

    const spins = this.reels.map((reel, i) =>
      reel.spinTo(grid[i] as [VegasHitsSymbol | null, VegasHitsSymbol | null, VegasHitsSymbol | null], (900 + i * 350) * speed, 0).then(() => onReelLand?.(i))
    );
    await Promise.all(spins);
  }

  /** Lights up the frame border, fades every non-winning symbol into the background (see
   * Reel.dimExcept — the per-sprite equivalent of Sizzling 7s' dim overlay), and pulses every
   * winning cell's symbol in place on top of that — `positions` is exactly
   * SpinEvaluation.winningPositions from the spin response. A losing spin (empty positions)
   * leaves everything untouched (no dimming either — nothing to contrast a loss against). */
  showWinHighlights(positions: [number, number][]): void {
    this.clearWinHighlights();
    if (positions.length === 0) return;

    this.startFrameGlow();

    const winningRowsByReel = new Map<number, Set<number>>();
    for (const [reelIndex, rowIndex] of positions) {
      if (!winningRowsByReel.has(reelIndex)) winningRowsByReel.set(reelIndex, new Set());
      winningRowsByReel.get(reelIndex)!.add(rowIndex);
    }

    this.reels.forEach((reel, reelIndex) => {
      const winningRows = winningRowsByReel.get(reelIndex) ?? new Set<number>();
      reel.dimExcept(winningRows);
      winningRows.forEach((row) => reel.pulseRow(row));
    });
  }

  private startFrameGlow(): void {
    const { left, top, right, bottom } = this.frameGlowBounds;
    this.frameGlowBorder.visible = false;
    this.frameGlowBorder.clear();
    this.frameGlowBorder.roundRect(left, top, right - left, bottom - top, 18);
    this.frameGlowBorder.stroke({ color: 0xfff2b3, width: 6, alpha: 0.9 });

    this.frameGlowBackdrop.visible = false;
    if (this.frameGlowRafId !== null) return;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);
      this.frameGlowBackdrop.clear();
      this.frameGlowBackdrop.roundRect(left, top, right - left, bottom - top, 18);
      this.frameGlowBackdrop.stroke({ color: GLOW_COLOR, width: 30 + pulse * 14, alpha: 0.5 + pulse * 0.25 });
      this.frameGlowRafId = requestAnimationFrame(animate);
    };
    this.frameGlowRafId = requestAnimationFrame(animate);
  }

  private stopFrameGlow(): void {
    this.frameGlowBackdrop.visible = false;
    this.frameGlowBorder.visible = false;
    if (this.frameGlowRafId !== null) {
      cancelAnimationFrame(this.frameGlowRafId);
      this.frameGlowRafId = null;
    }
  }

  clearWinHighlights(): void {
    this.stopFrameGlow();
    this.reels.forEach((r) => r.clearGlow());
  }

  destroy(): void {
    this.clearWinHighlights();
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
  }
}
