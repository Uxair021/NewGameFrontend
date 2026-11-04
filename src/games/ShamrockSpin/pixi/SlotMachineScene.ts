import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { SlotSymbol, isShamrockSymbol } from "../api";
import { loadSymbolTextures, loadBackgroundTexture, loadFreeSpinBackgroundTexture, loadCharacterTexture } from "./symbols";
import { Reel } from "./Reel";
import { FireEffect, PANEL_FIRE } from "./FireEffect";
import { SceneEffects } from "./SceneEffects";

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
/** Base spin duration for the first reel to land; each subsequent reel lands REEL_STOP_STAGGER_MS
 * later than the previous one — all 3 start spinning at the same instant (right after the shared
 * nudge-up), only their stop times are staggered. */
const SPIN_DURATION_MS = 900;
const REEL_STOP_STAGGER_MS = 300;
/** The last reel keeps spinning this much longer when the first two payline symbols match. */
const ANTICIPATION_EXTRA_MS = 800;

/** bg.webp is 1920x1060: the original 1484x1060 machine art centred, with 218px of scenery
 * added on each side. The canvas keeps the machine's old 929px height and widens to match. */
const BG_ASPECT = 1920 / 1060;

export const CANVAS_HEIGHT = 929;
export const CANVAS_WIDTH = Math.round(CANVAS_HEIGHT * BG_ASPECT); // 1683
/** Where the machine (formerly the whole 1300px-wide canvas) starts horizontally. */
export const MACHINE_OFFSET_X = Math.round((218 * CANVAS_HEIGHT) / 1060); // 191

/**
 * Pixel-perfect reel window metrics mapped from the machine art, given relative to the
 * machine (1300x929) and shifted by MACHINE_OFFSET_X:
 * - Reel 0: x = 268, width = 236
 * - Divider 0-1: x = 504..531 (fully preserved chrome divider with vertical green neon line)
 * - Reel 1: x = 531, width = 237
 * - Divider 1-2: x = 768..794 (fully preserved chrome divider with vertical green neon line)
 * - Reel 2: x = 794, width = 237
 */
interface ReelGeometry {
  x: number;
  width: number;
}

const REEL_WINDOWS: ReelGeometry[] = [
  { x: MACHINE_OFFSET_X + 268, width: 236 }, // Reel 0 (left)
  { x: MACHINE_OFFSET_X + 531, width: 237 }, // Reel 1 (center)
  { x: MACHINE_OFFSET_X + 794, width: 237 }, // Reel 2 (right)
];

const REEL_WINDOW_TOP = 229;
const REEL_WINDOW_HEIGHT = 564;
export const CELL_HEIGHT = REEL_WINDOW_HEIGHT / VISIBLE_ROWS; // 188
export const CELL_WIDTH = 236;

/** Same symbol family (both wild, both sevens or both bars) — purely decides the anticipation
 * animation; the spin's result is already fixed by the time this is asked. */
function sameFamily(a: SlotSymbol, b: SlotSymbol): boolean {
  if (isShamrockSymbol(a) || isShamrockSymbol(b)) return isShamrockSymbol(a) && isShamrockSymbol(b);
  return a.endsWith("_SEVEN") === b.endsWith("_SEVEN");
}

export class SlotMachineScene {
  private reels: Reel[] = [];
  private root: Container;
  private bgSprite: Sprite;
  private bgNormalTexture: Texture;
  private bgFreeSpinTexture: Texture;
  /** Free-spin fire, layered over the background and under the reels: a red one inside the top
   * counter panel. */
  private fires: FireEffect[];
  private effects: SceneEffects;

  private constructor(
    app: Application,
    bgSprite: Sprite,
    bgNormalTexture: Texture,
    bgFreeSpinTexture: Texture,
    characterTexture: Texture,
    textures: Awaited<ReturnType<typeof loadSymbolTextures>>
  ) {
    this.root = new Container();
    app.stage.addChild(this.root);

    this.bgSprite = bgSprite;
    this.bgNormalTexture = bgNormalTexture;
    this.bgFreeSpinTexture = bgFreeSpinTexture;
    this.root.addChild(this.bgSprite);

    this.effects = new SceneEffects(app, this.root, characterTexture, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      reelCenters: REEL_WINDOWS.map((geo) => geo.x + geo.width / 2),
      paylineY: REEL_WINDOW_TOP + 1.5 * CELL_HEIGHT,
      reelTop: REEL_WINDOW_TOP,
      reelBottom: REEL_WINDOW_TOP + REEL_WINDOW_HEIGHT,
    });
    this.root.addChild(this.effects.behind);

    this.fires = [new FireEffect(app, PANEL_FIRE)];
    this.fires.forEach((fire) => this.root.addChild(fire.view));

    this.root.addChild(this.effects.actor);

    for (let i = 0; i < REEL_COUNT; i++) {
      const geo = REEL_WINDOWS[i];

      const reelWindow = new Container();
      reelWindow.x = geo.x;
      reelWindow.y = REEL_WINDOW_TOP;

      const mask = new Graphics();
      mask.rect(0, 0, geo.width, REEL_WINDOW_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel(textures, geo.width, CELL_HEIGHT);
      reelWindow.addChild(reel.container);

      const idleTarget: [SlotSymbol, SlotSymbol, SlotSymbol] = ["SINGLE_BAR", "SHAMROCK_1", "GREEN_SEVEN"];
      reel.showStatic(idleTarget);

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    // Payline across the middle row (payline center y = 511)
    const paylineY = REEL_WINDOW_TOP + 1.5 * CELL_HEIGHT;
    const paylineLeft = REEL_WINDOWS[0].x - 18;
    const paylineRight = REEL_WINDOWS[2].x + REEL_WINDOWS[2].width + 18;

    const payline = new Graphics();
    // Golden payline wire
    payline.moveTo(paylineLeft, paylineY);
    payline.lineTo(paylineRight, paylineY);
    payline.stroke({ color: 0xe8c15a, width: 3, alpha: 0.95 });

    // Left ruby indicator gem matching user reference screenshot
    payline.circle(paylineLeft, paylineY, 8);
    payline.fill({ color: 0xd32f2f });
    payline.circle(paylineLeft, paylineY, 8);
    payline.stroke({ color: 0xe8c15a, width: 2 });
    payline.circle(paylineLeft - 2, paylineY - 2, 2.5);
    payline.fill({ color: 0xffffff, alpha: 0.85 });

    // Right ruby indicator gem matching user reference screenshot
    payline.circle(paylineRight, paylineY, 8);
    payline.fill({ color: 0xd32f2f });
    payline.circle(paylineRight, paylineY, 8);
    payline.stroke({ color: 0xe8c15a, width: 2 });
    payline.circle(paylineRight - 2, paylineY - 2, 2.5);
    payline.fill({ color: 0xffffff, alpha: 0.85 });

    this.root.addChild(payline);
    this.effects.attachPayline(payline);
    this.root.addChild(this.effects.front);
  }

  static async create(app: Application): Promise<SlotMachineScene> {
    const [background, freeSpinBg, character, textures] = await Promise.all([
      loadBackgroundTexture(),
      loadFreeSpinBackgroundTexture(),
      loadCharacterTexture(),
      loadSymbolTextures(),
    ]);
    const bgSprite = new Sprite(background);
    bgSprite.width = app.screen.width;
    bgSprite.height = app.screen.height;
    return new SlotMachineScene(app, bgSprite, background, freeSpinBg, character, textures);
  }

  /**
   * Spins all reels and lands on the given result. All 3 reels first lift together (nudgeUp),
   * then start spinning at the same instant; reel 0 stops after SPIN_DURATION_MS, reel 1 stops
   * REEL_STOP_STAGGER_MS after that, reel 2 another REEL_STOP_STAGGER_MS after that. Resolves once
   * every reel has stopped. onReelLand fires as each individual reel stops (for a per-reel landing sound).
   * When the first two payline symbols match, the last reel takes ANTICIPATION_EXTRA_MS longer.
   */
  async spin(reelsResult: [SlotSymbol, SlotSymbol, SlotSymbol][], onReelLand?: (index: number) => void): Promise<void> {
    this.effects.setSpinning(true);
    const anticipate = sameFamily(reelsResult[0][1], reelsResult[1][1]);
    try {
      await Promise.all(this.reels.map((reel) => reel.nudgeUp()));
      const spins = this.reels.map((reel, i) => {
        const last = i === REEL_COUNT - 1;
        const duration = SPIN_DURATION_MS + i * REEL_STOP_STAGGER_MS + (last && anticipate ? ANTICIPATION_EXTRA_MS : 0);
        return reel.spinTo(reelsResult[i], duration, 0, () => {
          onReelLand?.(i);
          this.effects.reelLanded(i);
          if (anticipate && i === REEL_COUNT - 2) this.effects.setAnticipation(REEL_COUNT - 1);
          if (last) this.effects.setAnticipation(null);
        });
      });
      await Promise.all(spins);
    } finally {
      this.effects.setSpinning(false);
    }
  }

  /** Coins, jumps and lights for a win — `multiple` is the win divided by the stake. */
  celebrateWin(multiple: number): void {
    this.effects.celebrateWin(multiple);
  }

  /** Glow + pulse on the payline symbols (any win) — call with false to stop, e.g. when the next spin starts. */
  setWinGlow(active: boolean): void {
    this.reels.forEach((reel) => (active ? reel.startWinGlow() : reel.stopWinGlow()));
  }

  /**
   * Switches to the free-spin background (bg_freespin.webp) and lights the fire for the whole
   * free-spin bonus round; reverts to the regular background (the fire dies out) during regular play.
   */
  setFreeSpinOverlay(active: boolean): void {
    this.bgSprite.texture = active ? this.bgFreeSpinTexture : this.bgNormalTexture;
    this.fires.forEach((fire) => fire.setActive(active));
    this.effects.setFreeSpins(active);
  }

  destroy(): void {
    this.reels.forEach((r) => r.destroy());
    this.fires.forEach((fire) => fire.destroy());
    this.effects.destroy();
    this.root.destroy({ children: true });
  }
}
