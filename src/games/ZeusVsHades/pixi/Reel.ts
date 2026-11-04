import { Container, Sprite, Ticker } from "pixi.js";
import { ROWS, type Profile } from "../engine";
import type { SymbolTextures } from "./symbols";
import { symbolFit } from "../art";

export interface ReelGeometry {
  cellWidth: number;
  cellHeight: number;
  /** Symbol art is scaled to fit this fraction of the cell. */
  symbolFit: number;
}

export interface ReelSpinPlan {
  strip: number[];
  stop: number;
  /** The 5 symbols that must be visible once the reel lands (the engine may have replaced a
   * cell, e.g. a forced expanding wild, so this can differ from the raw strip). */
  landed: number[];
  /** How many filler cells scroll past before the landing. */
  travelCells: number;
  msPerCell: number;
}

/**
 * One vertical reel. While spinning it renders a "tape": the target window at the top, a run of
 * strip symbols, and the currently visible window at the bottom; the tape scrolls down until the
 * target sits in the window, then settles with a small overshoot bounce.
 */
export class Reel {
  readonly container = new Container();
  private readonly tape = new Container();
  private readonly pool: Sprite[] = [];
  private visible: number[] = [];
  /** Symbol shown by each tape sprite, so the tape can switch between sharp and blurred art. */
  private tapeSymbols: number[] = [];
  private blurred = false;
  private profile: Profile = "olympus";
  private readonly baseScales = new Map<Sprite, number>();

  constructor(
    private readonly textures: SymbolTextures,
    private readonly geo: ReelGeometry,
    initial: number[]
  ) {
    this.container.addChild(this.tape);
    this.setSymbols(initial);
  }

  setProfile(profile: Profile) {
    this.profile = profile;
    this.setSymbols(this.visible);
  }

  get symbols(): number[] {
    return this.visible;
  }

  /** Visible cell sprite for a row (valid while the reel is at rest). */
  cellSprite(row: number): Sprite {
    return this.pool[row + 1];
  }

  /** The resting scale of a cell sprite, for win pulses to scale around. */
  baseScale(sprite: Sprite): number {
    return this.baseScales.get(sprite) ?? 1;
  }

  private sprite(i: number): Sprite {
    let s = this.pool[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.pool[i] = s;
      this.tape.addChild(s);
    }
    s.visible = true;
    return s;
  }

  private place(i: number, symbol: number) {
    const s = this.sprite(i);
    this.tapeSymbols[i] = symbol;
    const sharp = this.textures.get(symbol, this.profile);
    s.texture = this.blurred ? this.textures.blurred(symbol, this.profile) : sharp;
    // Scale from the sharp art so the blurred version occupies the same cell.
    const f = symbolFit(symbol, this.profile, sharp.width, sharp.height, this.geo.cellWidth, this.geo.cellHeight);
    const fit = f.scale * this.geo.symbolFit;
    s.scale.set(this.blurred ? fit * (sharp.width / s.texture.width) : fit);
    s.alpha = 1;
    s.rotation = 0;
    s.x = this.geo.cellWidth / 2;
    // Tape index 0 is the cell above the window.
    s.y = (i - 1) * this.geo.cellHeight + this.geo.cellHeight / 2 + f.shiftY * this.geo.symbolFit;
    this.baseScales.set(s, fit);
  }

  /** Shows `symbols` at rest (plus a neighbour above and below for the bounce). */
  setSymbols(symbols: number[], above = symbols[0], below = symbols[symbols.length - 1]) {
    this.visible = [...symbols];
    const all = [above, ...symbols, below];
    all.forEach((sym, i) => this.place(i, sym));
    for (let i = all.length; i < this.pool.length; i++) this.pool[i].visible = false;
    this.tape.y = 0;
  }

  /** Swaps every tape sprite between its sharp and motion-blurred art. */
  private setBlurred(on: boolean) {
    if (this.blurred === on) return;
    this.blurred = on;
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].visible) this.place(i, this.tapeSymbols[i]);
    }
  }

  /** Scrolls to the plan's landing. `onLand` fires at the moment the reel stops (for sounds). */
  spin(ticker: Ticker, plan: ReelSpinPlan, isAlive: () => boolean, onLand?: () => void): Promise<void> {
    const { strip, stop, landed, travelCells, msPerCell } = plan;
    const h = this.geo.cellHeight;
    const at = (i: number) => strip[((i % strip.length) + strip.length) % strip.length];

    // Tape, top to bottom: [above target] [target x5] [fillers...] [current x5] [below current]
    const tapeSymbols = [at(stop - 1), ...landed];
    for (let i = 0; i < travelCells; i++) tapeSymbols.push(at(stop + ROWS + i));
    tapeSymbols.push(...this.visible, at(stop + ROWS + travelCells));
    tapeSymbols.forEach((sym, i) => this.place(i, sym));
    for (let i = tapeSymbols.length; i < this.pool.length; i++) this.pool[i].visible = false;

    const startY = -(ROWS + travelCells) * h; // current window in view
    const endY = 0; // target window in view
    const distance = endY - startY;
    const windup = h * 0.18;
    const settle = h * 1.4;
    const overshoot = h * 0.22;
    const speed = h / msPerCell; // px per ms at full speed
    const windupMs = 110;
    const cruiseMs = Math.max(0, (distance - settle) / speed);
    const settleMs = (settle / speed) * 2.2;
    const bounceMs = 170;

    this.tape.y = startY;
    let elapsed = 0;
    let landedFired = false;

    return new Promise((resolve) => {
      const step = (t: Ticker) => {
        if (!isAlive()) {
          ticker.remove(step);
          resolve();
          return;
        }
        elapsed += t.deltaMS;
        let y: number;
        let e = elapsed;
        if (e < windupMs) {
          y = startY - windup * Math.sin((e / windupMs) * Math.PI);
        } else if ((e -= windupMs) < cruiseMs) {
          y = startY + e * speed;
          this.setBlurred(true);
        } else if ((e -= cruiseMs) < settleMs) {
          // Decelerate into a slight overshoot past the target.
          const p = e / settleMs;
          const eased = 1 - Math.pow(1 - p, 2);
          y = endY - settle + (settle + overshoot) * eased;
          this.setBlurred(p < 0.55);
        } else if ((e -= settleMs) < bounceMs) {
          if (!landedFired) {
            landedFired = true;
            onLand?.();
          }
          const p = e / bounceMs;
          y = endY + overshoot * (1 - Math.sin((p * Math.PI) / 2));
        } else {
          ticker.remove(step);
          if (!landedFired) onLand?.();
          this.blurred = false;
          this.setSymbols(landed, at(stop - 1), at(stop + ROWS));
          resolve();
          return;
        }
        this.tape.y = y;
      };
      ticker.add(step);
    });
  }

  /** Replaces one visible cell's symbol in place (used for wild reels settling back). */
  setCell(row: number, symbol: number) {
    this.visible[row] = symbol;
    this.place(row + 1, symbol);
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
