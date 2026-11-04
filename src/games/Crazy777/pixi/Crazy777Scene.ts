import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { CrazySymbol, SpecialSymbol, PayoutRow, SpecialPayoutRow } from "../api";
import { loadSymbolTextures, loadSpecialSymbolTextures, loadBackgroundImage, loadFreeSpinBackgroundImage } from "./symbols";
import { makeScaledTexture } from "../../shared/pixi/scaledTexture";
import { drawSoftRect } from "../../shared/pixi/softGlow";
import { Reel, SYMBOL_PADDING, FILLER_COUNT } from "./Reel";

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
const COLUMN_GAP = 25;

// Fractional position of the 3-reel window and the separate special-reel box within bg.png
// (1672x941 source art) — measured this session from the actual background art (the 3 white
// boxes under "Crazy 777", and the separately-framed box to their right). First-pass estimate;
// tune by eye as needed.
const WINDOW_LEFT_FRAC = 0.064;
const WINDOW_RIGHT_FRAC = 0.706;
const WINDOW_TOP_FRAC = 0.345;
const WINDOW_BOTTOM_FRAC = 0.809;

const SPECIAL_LEFT_FRAC = 0.727;
const SPECIAL_RIGHT_FRAC = 0.969;
const SPECIAL_TOP_FRAC = 0.385;
const SPECIAL_BOTTOM_FRAC = 0.765;

const BG_ASPECT = 1672 / 941;

export const CANVAS_WIDTH = 1672;
export const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH / BG_ASPECT);

const WINDOW_WIDTH = (WINDOW_RIGHT_FRAC - WINDOW_LEFT_FRAC) * CANVAS_WIDTH;
const WINDOW_HEIGHT = (WINDOW_BOTTOM_FRAC - WINDOW_TOP_FRAC) * CANVAS_HEIGHT;
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
export const CELL_HEIGHT = WINDOW_HEIGHT / VISIBLE_ROWS;

const SPECIAL_WIDTH = (SPECIAL_RIGHT_FRAC - SPECIAL_LEFT_FRAC) * CANVAS_WIDTH;
const SPECIAL_HEIGHT = (SPECIAL_BOTTOM_FRAC - SPECIAL_TOP_FRAC) * CANVAS_HEIGHT;
export const SPECIAL_CELL_HEIGHT = SPECIAL_HEIGHT / VISIBLE_ROWS;

/** GPU-memory knob for the whole game: the canvas renders at this fraction of its on-screen
 * pixel size (see Crazy777Game's fitResolution use), and every texture — background and
 * symbols — is sized to match. 1 = pixel-exact; lower = less GPU memory, slightly softer art. */
export const RENDER_QUALITY = 0.85;

/** Icon-size multipliers passed to Reel (see its constructor) — also used to size each
 * symbol's texture to how big it's actually drawn. */
const LINE_SYMBOL_SCALE = 1.6;
const SPECIAL_SYMBOL_SCALE = 2;
// singleDollar.png's artwork fills its own canvas more tightly than its siblings, so it
// renders oversized once fit-scaled to the cell like the others — shrink it specifically.
const SPECIAL_SCALE_OVERRIDES: Partial<Record<SpecialSymbol, number>> = { DOLLAR_PLUS: 2 };
/** Reel's win-glow pulse grows the payline symbol by up to 9%. */
const WIN_PULSE_GROWTH = 1.09;

/** Texture scale for art drawn fit inside a `cellW`x`cellH` cell at `iconScale` — the largest
 * it's ever drawn in design px, times RENDER_QUALITY (textures are sized for a backing
 * resolution of up to 1; higher-DPI backings just sample them a little softer). */
function symbolTextureScale(img: HTMLImageElement, cellW: number, cellH: number, iconScale: number): number {
  const fit = Math.min((cellW - SYMBOL_PADDING * 2) / img.naturalWidth, (cellH - SYMBOL_PADDING * 2) / img.naturalHeight);
  return Math.min(1, fit * iconScale * WIN_PULSE_GROWTH * RENDER_QUALITY);
}

/** Fractional (x, y) center of each LCD readout baked into bg.png's paytable ladder —
 * measured this session via a pixel grid overlaid on the actual art. First-pass estimate;
 * tune by eye as needed. */
const LADDER_POSITIONS: Record<PayoutRow["symbol"], { xFrac: number; yFrac: number }> = {
  SEVEN_HIGH: { xFrac: 0.4035, yFrac: 0.0665 },
  SEVEN_MID: { xFrac: 0.4035, yFrac: 0.152 },
  SEVEN_LOW: { xFrac: 0.4035, yFrac: 0.236 },
  DOUBLE_BAR: { xFrac: 0.6925, yFrac: 0.0635 },
  SINGLE_BAR: { xFrac: 0.6925, yFrac: 0.1238 },
  ANY_GLOBAL: { xFrac: 0.6955, yFrac: 0.267 },
  ANY_SEVEN: { xFrac: 0.5143, yFrac: 0.267 },
  ANY_BAR: { xFrac: 0.6045, yFrac: 0.267 },
};

/** Only DOUBLE_DOLLAR_PLUS/DOLLAR_PLUS have a real LCD box in the special-reel legend — the
 * 2x/5x/10x/RESPIN badges are icon-only (a multiplier has no fixed amount of its own). */
const SPECIAL_LADDER_POSITIONS: Partial<Record<SpecialSymbol, { xFrac: number; yFrac: number }>> = {
  DOUBLE_DOLLAR_PLUS: { xFrac: 0.8418, yFrac: 0.154 },
  DOLLAR_PLUS: { xFrac: 0.9765, yFrac: 0.154 },
};

// Digital-7 (public/fonts/, @font-face'd in index.css — scoped to just this ladder, not used
// anywhere else) — an authentic 7-segment digital-clock look, matching the segmented-digit LCD
// boxes baked into bg.png's ladder art.
const LADDER_TEXT_STYLE = new TextStyle({
  fontFamily: "Digital-7, monospace",
  fontSize: 45,
  fill: 0xffe37a,
  stroke: { color: 0x3a1e08, width: 3 },
  align: "right",
});

// Same font, smaller — for the ANY-7/ANY-BAR/ANY-global and $+/$$+ rows, whose LCD boxes in
// the art are noticeably smaller than the main 7/BAR rows.
const LADDER_TEXT_STYLE_SMALL = new TextStyle({
  fontFamily: "Digital-7, monospace",
  fontSize: 30,
  fill: 0xffe37a,
  stroke: { color: 0x3a1e08, width: 3 },
  align: "right",
});

/** Line-tier rows that use the smaller LCD text style (the 3 mixed-combo "ANY" rows). */
const SMALL_LADDER_SYMBOLS: ReadonlySet<PayoutRow["symbol"]> = new Set(["ANY_SEVEN", "ANY_BAR", "ANY_GLOBAL"]);

/** Formats an LCD readout dropping insignificant trailing zeros — 3 -> "3", 1.5 -> "1.5",
 * 0.02 -> "0.02" — while still rounding to cents first so float noise never leaks through. */
function formatLcd(value: number): string {
  return parseFloat(value.toFixed(2)).toString();
}

const PAYLINE_COLOR_IDLE = 0xf5ff2e;
/** How much longer reel 4 spins (with its box glowing) when reels 1-3 have won. */
const SUSPENSE_EXTRA_MS = 5800;
const PAYLINE_COLOR_WIN = 0x2ea3ff;
const PAYLINE_TRIANGLE_SIZE = 50;

export class Crazy777Scene {
  private reels: Reel<CrazySymbol>[] = [];
  private specialReel: Reel<SpecialSymbol>;
  private root: Container;
  private ladderTexts: Partial<Record<PayoutRow["symbol"], Text>> = {};
  private specialLadderTexts: Partial<Record<SpecialSymbol, Text>> = {};
  private paylineGraphics: Graphics[] = [];
  private specialAreaGlow: Graphics | null = null;
  private specialAreaGlowRafId: number | null = null;

  private background: Sprite;
  private backgroundImage: HTMLImageElement;
  private freeSpinBackgroundImage: HTMLImageElement;
  /** True while the respin round's freespinBg.webp is the background (see setRespinMode). */
  private respinBackground = false;
  private backgroundResolution = 0;
  private lastRendererResolution = 1;

  private constructor(
    app: Application,
    backgroundImage: HTMLImageElement,
    freeSpinBackgroundImage: HTMLImageElement,
    textures: Awaited<ReturnType<typeof loadSymbolTextures>>,
    specialTextures: Awaited<ReturnType<typeof loadSpecialSymbolTextures>>
  ) {
    this.root = new Container();
    app.stage.addChild(this.root);
    this.backgroundImage = backgroundImage;
    this.freeSpinBackgroundImage = freeSpinBackgroundImage;
    this.background = new Sprite();
    this.root.addChild(this.background);
    this.setBackgroundResolution(app.renderer.resolution);

    const windowLeft = WINDOW_LEFT_FRAC * app.screen.width;
    const windowTop = WINDOW_TOP_FRAC * app.screen.height;

    for (let i = 0; i < REEL_COUNT; i++) {
      const reelWindow = new Container();
      reelWindow.x = windowLeft + i * (CELL_WIDTH + COLUMN_GAP);
      reelWindow.y = windowTop;

      const mask = new Graphics();
      mask.rect(0, 0, CELL_WIDTH, VISIBLE_ROWS * CELL_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel<CrazySymbol>(textures, CELL_WIDTH, CELL_HEIGHT, {}, LINE_SYMBOL_SCALE);
      reelWindow.addChild(reel.container);

      const idleTarget: [CrazySymbol, CrazySymbol, CrazySymbol] = ["SEVEN_LOW", "SINGLE_BAR", "DOUBLE_BAR"];
      reel.showStatic(idleTarget);

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    const specialWidth = (SPECIAL_RIGHT_FRAC - SPECIAL_LEFT_FRAC) * app.screen.width;
    const specialWindow = new Container();
    specialWindow.x = SPECIAL_LEFT_FRAC * app.screen.width;
    specialWindow.y = SPECIAL_TOP_FRAC * app.screen.height;

    const specialMask = new Graphics();
    specialMask.rect(0, 0, specialWidth, VISIBLE_ROWS * SPECIAL_CELL_HEIGHT);
    specialMask.fill({ color: 0xffffff });
    specialWindow.addChild(specialMask);
    specialWindow.mask = specialMask;

    // Background glow spanning the whole special-reel box (not just the landed symbol's own
    // cell) — added first so it renders behind the reel/symbols. Toggled by setSpecialGlow.
    const specialAreaGlow = drawSoftRect(new Graphics(), 0, 0, specialWidth, VISIBLE_ROWS * SPECIAL_CELL_HEIGHT, 0xffb300, 24, 0);
    specialAreaGlow.alpha = 0;
    specialWindow.addChild(specialAreaGlow);
    this.specialAreaGlow = specialAreaGlow;

    this.specialReel = new Reel<SpecialSymbol>(
      specialTextures,
      specialWidth,
      SPECIAL_CELL_HEIGHT,
      SPECIAL_SCALE_OVERRIDES,
      SPECIAL_SYMBOL_SCALE
    );
    // Reel 4's glow is the whole-box background wash (specialAreaGlow) — no square/border
    // drawn around the symbol itself.
    this.specialReel.cellGlowFrame = false;
    specialWindow.addChild(this.specialReel.container);
    this.specialReel.showStatic(["MULT_2X", "RESPIN", "MULT_5X"]);

    this.root.addChild(specialWindow);

    // Win-value readouts on the LCD boxes baked into bg.png's paytable ladder. Right-anchored
    // (anchor.x=1) so digits grow leftward from a fixed right edge, like a real LCD/odometer —
    // `xFrac` now marks each box's RIGHT edge, not its center.
    for (const [symbol, pos] of Object.entries(LADDER_POSITIONS) as [PayoutRow["symbol"], { xFrac: number; yFrac: number }][]) {
      const style = SMALL_LADDER_SYMBOLS.has(symbol) ? LADDER_TEXT_STYLE_SMALL : LADDER_TEXT_STYLE;
      const text = new Text({ text: "", style });
      text.anchor.set(1, 0.5);
      text.x = pos.xFrac * app.screen.width;
      text.y = pos.yFrac * app.screen.height;
      this.root.addChild(text);
      this.ladderTexts[symbol] = text;
    }
    for (const [symbol, pos] of Object.entries(SPECIAL_LADDER_POSITIONS) as [SpecialSymbol, { xFrac: number; yFrac: number }][]) {
      const text = new Text({ text: "", style: LADDER_TEXT_STYLE_SMALL });
      text.anchor.set(1, 0.5);
      text.x = pos.xFrac * app.screen.width;
      text.y = pos.yFrac * app.screen.height;
      this.root.addChild(text);
      this.specialLadderTexts[symbol] = text;
    }

    // Neon payline indicator — drawn from the same coordinates the reels themselves use
    // (windowLeft/windowTop/CELL_HEIGHT), so it always lines up with the true scoring row even
    // as those fractions get tuned, instead of relying on bg.png's own baked-in line staying
    // in sync. Added last so it renders on top of the reel windows.
    const paylineY = windowTop + 1.5 * CELL_HEIGHT;
    const paylineLeft = windowLeft;
    const paylineRight = SPECIAL_LEFT_FRAC * app.screen.width + specialWidth;
    this.drawPayline(paylineLeft, paylineRight, paylineY);
  }

  /** Draws the neon payline: a glowing horizontal line from `left` to `right` at `y`, with an
   * outlined (not filled) triangle at each end pointing inward toward the line. Drawn in white
   * and tinted — see setPaylineWon — so the color can switch (idle yellow / win blue) without
   * redrawing. */
  private drawPayline(left: number, right: number, y: number): void {
    // Soft halo from stacked translucent strokes (widest/faintest first) instead of a
    // BlurFilter — no filter render targets, no extra pass every frame.
    const glow = new Graphics();
    for (const [width, alpha] of [[22, 0.12], [15, 0.16], [9, 0.22]] as const) {
      glow.moveTo(left, y).lineTo(right, y);
      glow.stroke({ color: 0xffffff, width, alpha, cap: "round" });
    }
    this.root.addChild(glow);

    const line = new Graphics();
    line.moveTo(left, y).lineTo(right, y);
    line.stroke({ color: 0xffffff, width: 4, alpha: 0.95 });
    this.root.addChild(line);

    const leftTriangle = new Graphics();
    leftTriangle
      .poly([
        left, y - PAYLINE_TRIANGLE_SIZE / 2,
        left, y + PAYLINE_TRIANGLE_SIZE / 2,
        left + PAYLINE_TRIANGLE_SIZE, y,
      ])
      .stroke({ color: 0xffffff, width: 3 });
    this.root.addChild(leftTriangle);

    const rightTriangle = new Graphics();
    rightTriangle
      .poly([
        right, y - PAYLINE_TRIANGLE_SIZE / 2,
        right, y + PAYLINE_TRIANGLE_SIZE / 2,
        right - PAYLINE_TRIANGLE_SIZE, y,
      ])
      .stroke({ color: 0xffffff, width: 3 });
    this.root.addChild(rightTriangle);

    this.paylineGraphics = [glow, line, leftTriangle, rightTriangle];
    this.paylineGraphics.forEach((g) => (g.tint = PAYLINE_COLOR_IDLE));
  }

  /** Switches the payline between idle (yellow) and won (blue) — call with true once reels
   * 1-3 have landed a winning pattern, false to reset for the next spin. */
  setPaylineWon(won: boolean): void {
    const color = won ? PAYLINE_COLOR_WIN : PAYLINE_COLOR_IDLE;
    this.paylineGraphics.forEach((g) => (g.tint = color));
  }

  /** Fills in the ladder's LCD boxes with what each row is actually worth at the current bet
   * — line rows use Pay × Bet (the base-win formula), the $+/$$+ rows use their configured
   * bet-multiplier bonus. Recompute whenever the bet changes. */
  updatePayoutValues(paytable: PayoutRow[], specialPaytable: SpecialPayoutRow[], betAmount: number): void {
    for (const row of paytable) {
      const text = this.ladderTexts[row.symbol];
      if (text) text.text = formatLcd(row.payout * betAmount);
    }
    for (const row of specialPaytable) {
      const text = this.specialLadderTexts[row.symbol];
      if (text && row.betMultiplier !== null) text.text = formatLcd(row.betMultiplier * betAmount);
    }
  }

  /** (Re)builds the background texture at the canvas's backing resolution — at a backing
   * resolution below the art's own size, a full-size texture is mostly wasted GPU memory.
   * Call after changing the renderer's resolution. */
  setBackgroundResolution(resolution: number): void {
    this.lastRendererResolution = resolution;
    const image = this.respinBackground ? this.freeSpinBackgroundImage : this.backgroundImage;
    // Relative to the file's own size, which may be smaller than the 1672-wide design space.
    const scale = Math.min(1, (resolution * CANVAS_WIDTH) / image.naturalWidth);
    if (Math.abs(scale - this.backgroundResolution) < 0.01) return;
    this.backgroundResolution = scale;
    const old = this.background.texture;
    this.background.texture = makeScaledTexture(image, scale);
    this.background.width = CANVAS_WIDTH;
    this.background.height = CANVAS_HEIGHT;
    if (old && old !== Texture.EMPTY) old.destroy(true);
  }

  static async create(app: Application): Promise<Crazy777Scene> {
    const [backgroundImage, freeSpinBackgroundImage, textures, specialTextures] = await Promise.all([
      loadBackgroundImage(),
      loadFreeSpinBackgroundImage(),
      loadSymbolTextures((_, img) => symbolTextureScale(img, CELL_WIDTH, CELL_HEIGHT, LINE_SYMBOL_SCALE)),
      loadSpecialSymbolTextures((symbol, img) =>
        symbolTextureScale(img, SPECIAL_WIDTH, SPECIAL_CELL_HEIGHT, SPECIAL_SCALE_OVERRIDES[symbol] ?? SPECIAL_SYMBOL_SCALE)
      ),
      // Make sure Digital-7 is actually loaded before the ladder's LCD Text objects are
      // created — otherwise the first paint can briefly fall back to the default font.
      document.fonts.load("40px Digital-7"),
    ]);
    return new Crazy777Scene(app, backgroundImage, freeSpinBackgroundImage, textures, specialTextures);
  }

  /** Spins all 4 reels together (same start instant); the special reel runs a touch longer so
   * it lands last, after the 3 line reels have already shown their result — builds a beat of
   * anticipation for the bonus, same as a real "hold and spin" cabinet. `emptyReelIndex`
   * (0-2, or null) lands that one line reel physically between two symbols instead of on one
   * — how a loss is represented. `specialIsHalfStop` does the same for the special reel when
   * no bonus applies this round. During a respin round (`isRespin`) the special reel is held
   * completely frozen — it doesn't spin or move at all, only reels 1-3 do. */
  async spin(
    reelsResult: [CrazySymbol, CrazySymbol, CrazySymbol][],
    specialResult: [SpecialSymbol, SpecialSymbol, SpecialSymbol],
    emptyReelIndex: number | null,
    specialIsHalfStop: boolean,
    onReelLand?: (index: number) => void,
    turbo = false,
    isRespin = false,
    /** Reels 1-3 won — reel 4 spins on for SUSPENSE_EXTRA_MS more, its box glowing from the
     * moment the last line reel lands until it settles. */
    suspense = false
  ): Promise<void> {
    const speed = turbo ? 0.4 : 1;
    const spins = this.reels.map((reel, i) =>
      reel.spinTo(reelsResult[i], (900 + i * 350) * speed, 0, i === emptyReelIndex, 0, () => onReelLand?.(i))
    );
    if (isRespin) {
      await Promise.all(spins);
      return;
    }
    const baseMs = 900 + REEL_COUNT * 350;
    const extraMs = suspense ? SUSPENSE_EXTRA_MS : 0;
    // Same scroll speed for the extra time: proportionally more symbols to scroll past.
    const extraFiller = suspense ? Math.round((FILLER_COUNT * SUSPENSE_EXTRA_MS) / baseMs) : 0;
    const specialSpin = this.specialReel
      .spinTo(specialResult, (baseMs + extraMs) * speed, 0, specialIsHalfStop, extraFiller, () => onReelLand?.(REEL_COUNT));
    // The same background glow a reel-4 hit gets, while it keeps everyone waiting.
    if (suspense) void spins[REEL_COUNT - 1].then(() => this.startSpecialAreaGlow());
    await Promise.all([...spins, specialSpin]);
  }

  /** Glow + pulse on the line-reel payline (a standard 3-of-a-kind win) — call with false to
   * stop. `withBackdrop` false for a plain win (pulse only, no background color change), true
   * (default) for a BIG/MEGA/JACKPOT win. */
  setLineWinGlow(active: boolean, withBackdrop = true): void {
    this.reels.forEach((reel) => (active ? reel.startWinGlow(withBackdrop) : reel.stopWinGlow()));
  }

  /** Glow + pulse on the special reel's landed symbol, plus a soft background wash across the
   * whole special-reel box (not just the symbol's own cell) — call with false to stop. Same
   * `withBackdrop` meaning as setLineWinGlow. */
  setSpecialGlow(active: boolean, withBackdrop = true): void {
    if (active) this.specialReel.startWinGlow(withBackdrop);
    else this.specialReel.stopWinGlow();

    if (active) this.startSpecialAreaGlow();
    else this.stopSpecialAreaGlow();
  }

  private stopSpecialAreaGlow(): void {
    if (this.specialAreaGlowRafId !== null) {
      cancelAnimationFrame(this.specialAreaGlowRafId);
      this.specialAreaGlowRafId = null;
    }
    if (this.specialAreaGlow) this.specialAreaGlow.alpha = 0;
  }

  /** Pulsing background wash across the whole special-reel box (restarts if already running). */
  private startSpecialAreaGlow(): void {
    this.stopSpecialAreaGlow();
    if (!this.specialAreaGlow) return;
    const glow = this.specialAreaGlow;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.5 + 0.5 * Math.sin((elapsed / 520) * Math.PI * 2);
      glow.alpha = 0.35 + pulse * 0.35;
      this.specialAreaGlowRafId = requestAnimationFrame(animate);
    };
    this.specialAreaGlowRafId = requestAnimationFrame(animate);
  }

  /** A respin round's look, held for the whole round: the freespinBg.webp background, and reel
   * 4's frozen RESPIN symbol pulsing with its animated background wash. Call with false when the
   * round is over. */
  setRespinMode(active: boolean): void {
    if (this.respinBackground !== active) {
      this.respinBackground = active;
      this.backgroundResolution = 0; // force setBackgroundResolution to rebuild from the new image
      this.setBackgroundResolution(this.lastRendererResolution);
    }
    this.setSpecialGlow(active, true);
  }

  /** Call only when reels 1-3 have already won AND the special reel itself landed as a
   * half-stop (specialIsHalfStop — nothing clean was on the payline). Shakes it in place for
   * ~2s, then continues its scroll the remaining half-step so the pattern doesn't get left
   * visibly stuck between two symbols. Purely a visual tidy-up — specialEmpty still has no
   * bonus effect, so don't call setSpecialGlow afterward. If the special reel already landed
   * cleanly on a real bonus (not a half-stop), skip this entirely and just call
   * setSpecialGlow(true) directly — nothing needs "completing". */
  async resolveSpecialHalfStop(): Promise<void> {
    await this.specialReel.resolveHalfStopReveal();
  }

  destroy(): void {
    if (this.specialAreaGlowRafId !== null) cancelAnimationFrame(this.specialAreaGlowRafId);
    this.reels.forEach((r) => r.destroy());
    this.specialReel.destroy();
    const bgTexture = this.background.texture;
    this.root.destroy({ children: true });
    if (bgTexture !== Texture.EMPTY) bgTexture.destroy(true);
  }
}
