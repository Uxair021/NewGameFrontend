import { Application, Container, Texture } from "pixi.js";
import { FiveXSymbol } from "../api";
import { loadSymbolTextures } from "./symbols";
import { Reel } from "./Reel";
import { BgAnimation } from "./BgAnimation";

const REEL_COUNT = 3;

// No cabinet bg image to derive an aspect ratio from — bg.gif renders as a plain HTML <img>
// behind the (transparent) canvas, see FiveXRewindGame.tsx. Clean reference resolution;
// reel positions are first-pass estimates from the reference screenshot, hand-tuned after.
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

const REEL_TOP_FRAC = 0.15;
const REEL_BOTTOM_FRAC = 0.85;
const REEL_LEFT_FRAC = 0.10;
const REEL_RIGHT_FRAC = 0.90;
const REEL_GAP_PX = 18;

const REEL_AREA_WIDTH = (REEL_RIGHT_FRAC - REEL_LEFT_FRAC) * CANVAS_WIDTH;
export const CELL_WIDTH = (REEL_AREA_WIDTH - (REEL_COUNT - 1) * REEL_GAP_PX) / REEL_COUNT;
export const CELL_HEIGHT = (REEL_BOTTOM_FRAC - REEL_TOP_FRAC) * CANVAS_HEIGHT;

export class FiveXRewindScene {
  private reels: Reel[] = [];
  private root: Container;

  private constructor(
    app: Application,
    textures: Record<FiveXSymbol, Texture>,
    private readonly background: BgAnimation | null
  ) {
    this.root = new Container();
    app.stage.addChild(this.root);
    if (background) this.root.addChild(background.sprite);

    const areaLeft = REEL_LEFT_FRAC * app.screen.width;
    const areaTop = REEL_TOP_FRAC * app.screen.height;

    for (let i = 0; i < REEL_COUNT; i++) {
      const reel = new Reel(textures, CELL_WIDTH, CELL_HEIGHT);
      reel.view.x = areaLeft + i * (CELL_WIDTH + REEL_GAP_PX);
      reel.view.y = areaTop;
      reel.showStatic("WHITE_BAR");
      this.root.addChild(reel.view);
      this.reels.push(reel);
    }
  }

  /** `backgroundUrl`: the animated bg.webp, played inside the canvas when the browser can
   * (see BgAnimation) — check `hasCanvasBackground` and show it as an <img> otherwise. */
  static async create(app: Application, backgroundUrl: string): Promise<FiveXRewindScene> {
    const [textures, background] = await Promise.all([
      loadSymbolTextures(),
      BgAnimation.create(app, backgroundUrl, CANVAS_WIDTH, CANVAS_HEIGHT).catch((err) => {
        console.warn("5x Rewind: in-canvas background unavailable, using <img>", err);
        return null;
      }),
    ]);
    return new FiveXRewindScene(app, textures, background);
  }

  /** True when the background animation is drawn in the canvas (no <img> needed behind it). */
  get hasCanvasBackground(): boolean {
    return this.background !== null;
  }

  /** Spins all reels and lands on the given result. Reels flagged in `halfStopReels` stop
   * between two symbols, leaving their payline spot empty (losses only — see the api's
   * pickLossHalfStops); every other reel lands its symbol squarely on the payline. */
  async spin(
    reelsResult: [FiveXSymbol, FiveXSymbol, FiveXSymbol],
    halfStopReels: readonly boolean[],
    onReelLand?: (index: number) => void,
    turbo = false
  ): Promise<void> {
    const speed = turbo ? 0.9 : 1;
    const spins = this.reels.map((reel, i) =>
      reel.spinTo(reelsResult[i], (1050 + i * 250) * speed, 0, halfStopReels[i]).then(() => onReelLand?.(i))
    );
    await Promise.all(spins);
  }

  setWinGlow(active: boolean): void {
    this.reels.forEach((reel) => (active ? reel.startWinGlow() : reel.stopWinGlow()));
  }

  destroy(): void {
    this.reels.forEach((r) => r.destroy());
    this.background?.destroy();
    this.root.destroy({ children: true });
  }
}
