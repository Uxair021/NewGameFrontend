import { Application, Container, Sprite } from "pixi.js";
import { CashSymbol } from "../api";
import { loadSymbolTextures, loadBackgroundTexture, loadForegroundTexture } from "./symbols";
import { CashReel } from "./CashReel";

// Fractional positions of the 3 reel windows within bg.webp (1564x1006 original art) — two
// oval windows flanking a shield-shaped center window, unevenly spaced/sized, so each
// gets its own fractions rather than one evenly-spaced formula. Eyeballed from the art;
// expect to tune these empirically against real renders, same as ShamrockSpin's did.
const REEL_WINDOWS = [
  { leftFrac: 0.190, rightFrac: 0.379 }, // left oval
  { leftFrac: 0.412, rightFrac: 0.587 }, // center shield
  { leftFrac: 0.615, rightFrac: 0.800 }, // right oval
];
const WINDOW_TOP_FRAC = 0.313;
const WINDOW_BOTTOM_FRAC = 0.701;

const BG_ASPECT = 1564 / 1006;

export const CANVAS_WIDTH = 1450;
export const CANVAS_HEIGHT = Math.round(CANVAS_WIDTH / BG_ASPECT);

export class CashMachineScene {
  private reels: CashReel[] = [];
  private root: Container;
  private activeReelCount = 3;
  /** Spins in flight + whether the win glow is pulsing — the ticker only runs while either is. */
  private spinsInFlight = 0;
  private glowing = false;
  private destroyed = false;

  private constructor(
    private readonly app: Application,
    background: Sprite,
    foreground: Sprite,
    textures: Awaited<ReturnType<typeof loadSymbolTextures>>
  ) {
    this.root = new Container();
    app.stage.addChild(this.root);
    this.root.addChild(background);

    const windowTop = WINDOW_TOP_FRAC * app.screen.height;
    const windowHeight = (WINDOW_BOTTOM_FRAC - WINDOW_TOP_FRAC) * app.screen.height;

    for (const win of REEL_WINDOWS) {
      const left = win.leftFrac * app.screen.width;
      const width = (win.rightFrac - win.leftFrac) * app.screen.width;

      // No mask: the foreground frame added below is fully opaque above and below every
      // window, so it already hides the reel strip outside it — a mask would only add a
      // stencil pass per reel every frame without changing a pixel.
      const reelWindow = new Container();
      reelWindow.x = left;
      reelWindow.y = windowTop;

      const reel = new CashReel(textures, width, windowHeight);
      reelWindow.addChild(reel.container);
      reel.showStatic("null");

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    // On top of every reel: bg2.webp's transparent oval/shield cutouts let the reel
    // content show through in the frame's exact curve, while its opaque ornate border
    // occludes any symbol/glow overflow past that curve — bg.png underneath still
    // supplies the silver window fill since both share the same composition.
    this.root.addChild(foreground);

    // Nothing moves until the first spin, so don't redraw 60 times a second while idle: draw
    // this one frame, then run the ticker only during spins and the win glow (see updateTicker).
    app.ticker.stop();
    app.render();
  }

  /** Runs the render loop only while something animates; otherwise draws one final frame and stops. */
  private updateTicker(): void {
    if (this.destroyed) return;
    if (this.spinsInFlight > 0 || this.glowing) {
      if (!this.app.ticker.started) this.app.ticker.start();
    } else if (this.app.ticker.started) {
      this.app.ticker.stop();
      this.app.render();
    }
  }

  /** Redraws once — for changes made while the ticker is stopped (e.g. after a canvas resize). */
  renderNow(): void {
    if (!this.destroyed && !this.app.ticker.started) this.app.render();
  }

  static async create(app: Application): Promise<CashMachineScene> {
    const [background, foreground, textures] = await Promise.all([
      loadBackgroundTexture(),
      loadForegroundTexture(),
      loadSymbolTextures(),
    ]);
    const bgSprite = new Sprite(background);
    bgSprite.width = app.screen.width;
    bgSprite.height = app.screen.height;
    const fgSprite = new Sprite(foreground);
    fgSprite.width = app.screen.width;
    fgSprite.height = app.screen.height;
    return new CashMachineScene(app, bgSprite, fgSprite, textures);
  }

  /**
   * Spins the reels actually in play for this bet tier and lands on `symbols` (length
   * equals `activeReels`). Reels beyond `activeReels` are dimmed and shown blank — no
   * spin animation — since lower bet tiers only put reel 1 (then 1-2, then 1-2-3) in
   * play. Reels in `respunIndexes` get a second, reverse-direction spin after the first
   * lands (the bonus-respin visual cue). Resolves once every reel (including any
   * respins) has finished.
   */
  async spin(
    symbols: CashSymbol[],
    activeReels: number,
    respunIndexes: number[],
    onReelLand?: (index: number) => void
  ): Promise<void> {
    this.activeReelCount = activeReels;
    this.spinsInFlight++;
    this.updateTicker();
    try {
      await this.runSpin(symbols, activeReels, respunIndexes, onReelLand);
    } finally {
      this.spinsInFlight--;
      this.updateTicker();
    }
  }

  private async runSpin(
    symbols: CashSymbol[],
    activeReels: number,
    respunIndexes: number[],
    onReelLand?: (index: number) => void
  ): Promise<void> {
    const respunSet = new Set(respunIndexes);
    const firstPass = this.reels.map((reel, i) => {
      if (i >= activeReels) {
        reel.setDimmed(true);
        reel.showStatic("null");
        return Promise.resolve();
      }
      reel.setDimmed(false);
      // A respun reel was "null" before the respin (that's the only trigger condition on
      // the backend) — land the first pass on that, and the *final* value in the reverse pass.
      const firstTarget = respunSet.has(i) ? "null" : symbols[i];
      return reel.spinTo(firstTarget, 900 + i * 350, i * 150).then(() => onReelLand?.(i));
    });
    await Promise.all(firstPass);

    if (respunIndexes.length === 0) return;

    const respinPass = respunIndexes.map((i, order) =>
      this.reels[i].spinTo(symbols[i], 700, order * 150, true).then(() => onReelLand?.(i))
    );
    await Promise.all(respinPass);
  }

  /** Updates which reels read as "in play" without spinning anything — used to reflect
   * a bet change immediately, before the next spin. */
  setActiveReelsPreview(activeReels: number): void {
    this.activeReelCount = activeReels;
    this.reels.forEach((reel, i) => reel.setDimmed(i >= activeReels));
    this.renderNow();
  }

  setWinGlow(active: boolean): void {
    this.reels.forEach((reel, i) => {
      if (i >= this.activeReelCount) return; // never glow a dimmed, not-in-play reel
      active ? reel.startWinGlow() : reel.stopWinGlow();
    });
    this.glowing = active;
    this.updateTicker();
  }

  destroy(): void {
    this.destroyed = true;
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
  }
}
