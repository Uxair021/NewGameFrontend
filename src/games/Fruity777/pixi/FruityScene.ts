import gsap from "gsap";
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { FruitySymbol, PayoutRow } from "../api";
import { loadSymbolTextures, loadFairyFrames, loadBellFrames } from "./symbols";
import { Flipbook } from "./flipbook";
import { Reel, FILLER_COUNT } from "./Reel";
import { COIN_COLOR, COIN_SHINE_COLOR } from "./effects";

const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

/** The Pixi canvas covers only this part of the 1920x1080 design (the background is an HTML image
 * under it — see Fruity777Game): from just left of the sidebar panel and just above the reel window
 * to the right/bottom edges, which the fairy and the falling sidebar coins reach. Everything left of
 * / above it was transparent pixels the GPU still had to hold. */
export const VIEW_LEFT = 260;
export const VIEW_TOP = 90;
export const VIEW_WIDTH = CANVAS_WIDTH - VIEW_LEFT;
export const VIEW_HEIGHT = CANVAS_HEIGHT - VIEW_TOP;

// Reel window bounds, measured directly from bg.png's own gold-bordered frame (the 3
// diamond-pattern boxes under the "777 FRUITY" title) — not eyeballed.
const WINDOW_LEFT_FRAC = 551 / CANVAS_WIDTH;
const WINDOW_RIGHT_FRAC = 1469 / CANVAS_WIDTH;
const WINDOW_TOP_FRAC = 104 / CANVAS_HEIGHT;
const WINDOW_BOTTOM_FRAC = 880 / CANVAS_HEIGHT;
const COLUMN_GAP = 10;

const WINDOW_WIDTH = (WINDOW_RIGHT_FRAC - WINDOW_LEFT_FRAC) * CANVAS_WIDTH;
const WINDOW_HEIGHT = (WINDOW_BOTTOM_FRAC - WINDOW_TOP_FRAC) * CANVAS_HEIGHT;
export const CELL_WIDTH = (WINDOW_WIDTH - (REEL_COUNT - 1) * COLUMN_GAP) / REEL_COUNT;
export const CELL_HEIGHT = WINDOW_HEIGHT / VISIBLE_ROWS;

// The empty purple-framed sidebar box (also baked into bg.png, to the left of the reel
// window) that the paytable renders into — same measurement approach as the window above.
const PANEL_LEFT_FRAC = 279 / CANVAS_WIDTH;
const PANEL_RIGHT_FRAC = 527 / CANVAS_WIDTH;
const PANEL_TOP_FRAC = 131 / CANVAS_HEIGHT;
const PANEL_BOTTOM_FRAC = 839 / CANVAS_HEIGHT;

/** Row order top-to-bottom: the Bonus/free-spins feature headlines the list (it's the
 * flagship "big feature" row, not a numeric payout), then every real symbol descending by
 * payout — mirrors the reference paytable's "highest at top" convention. */
const SIDEBAR_ORDER: FruitySymbol[] = [
  "BONUS",
  "STAR",
  "BAR",
  "SEVEN",
  "DRAGON_FRUIT",
  "WATERMELON",
  "GRAPE",
  "PINEAPPLE",
  "PEACH",
  "ORANGE",
  "LEMON",
  "APPLE",
];

const ROW_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "500",
  fontSize: 22,
  fill: 0xffe37a,
  stroke: { color: 0x3a1e08, width: 4 },
  align: "right",
});

/** The Bonus row's "3-10 FREE SPINS" label is longer than any dollar amount — smaller font
 * so it still fits the same column the numbers use. */
const BONUS_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "600",
  fontSize: 22,
  fill: 0xffe37a,
  stroke: { color: 0x3a1e08, width: 3 },
  align: "right",
});

/** How many identical icons render per row — 3-in-a-row, matching exactly what a win on the
 * payline looks like, instead of a single icon + a bare "xN" multiplier. */
const ICONS_PER_ROW = 3;

/** How long the winning sidebar row keeps visibly pulsing (per user request: 3-4s, not one
 * quick bounce) and how many full up/down bounces fit in that window. */
const PULSE_TOTAL_SECONDS = 4;
const PULSE_CYCLES = 10;

/** Gap between each reel's win effect starting — reel 1, then 2, then 3, left to right (per
 * user request: 0.5s apart), instead of all 3 glowing in perfect unison. */
const WIN_EFFECT_STAGGER_MS = 200;
/** How much longer reel 3 spins when reels 1 and 2 match on the payline (normal / FAST). */
const SUSPENSE_EXTRA_MS = 2800;
const SUSPENSE_EXTRA_FAST_MS = 1200;
/** When reel 3's suspense speed-up (with the frame + drum roll) starts, as a fraction of reel 2's
 * spin time — reel 2's ease-out has it looking stopped from about 80% on. */
const SUSPENSE_START_FRAC = 0.8;
/** How long reel 3 takes to reach its suspense speed, and how many times faster that is than
 * its steady speed before it. */
const SUSPENSE_RAMP_MS = 30;
const SUSPENSE_SPEED_UP = 0.9;

/** TESTING ONLY — true = the reel-3 suspense frame stays on screen all the time (still pulsing),
 * so its look and placement can be tuned in SUSPENSE_FRAME below while you watch. false = normal:
 * it only appears while reel 3 is building suspense. MUST be false before going live. */
export const SUSPENSE_FRAME_PREVIEW = false;

/** Reel-3 suspense frame — every number is in the game's 1920x1080 design pixels. */
const SUSPENSE_FRAME = {
  /** Moves the whole frame: + right / - left, + down / - up. */
  offsetX: -3,
  offsetY: 0,
  /** Grows (+) or shrinks (-) the frame around reel 3, split evenly between both sides. */
  widthAdjust: 5,
  heightAdjust: 0,
  /** Corner roundness. */
  radius: 0,
  /** The main border line — its width pulses between borderWidth and borderWidth + borderPulse. */
  borderColor: 0xffd700,
  borderWidth: 5,
  borderPulse: 8,
  /** Soft glow just outside the border (0 strength = none). */
  outerGlowColor: 0xffb300,
  outerGlowStrength: 1,
  /** Shadow just inside the border, fading toward the middle — keeps the border from looking
   * pasted on top of the reel. `innerShadowSize` is how far in it reaches; `innerShadowAlpha`
   * how dark it is at the border (0 = off). */
  innerShadowColor: 0xffb300,
  innerShadowSize: 70,
  innerShadowAlpha: 0.45,
};

/** The animated fairy hovering to the right of the reels, over the spot where bg.png has her
 * painted. Position/size are in canvas px (1920x1080) — FAIRY_X/FAIRY_Y is the frame's
 * top-left corner. Tweak these to line her up. */
const FAIRY_X = 1575;
const FAIRY_Y = 440;
/** Fairy size, relative to her original 527x750 frame — 0.65 ≈ the painted fairy's size. (The
 * frame files are already baked at 0.65, so 0.65 draws them 1:1; other values still work.) */
const FAIRY_SCALE = 0.65;
/** Flipbook speed (frames per second) of the 27-frame wing/fly loop. */
const FAIRY_FPS = 24;
/** Gentle hover so she "flies in place": up/down distance (px) and one up-down cycle (s). */
const FAIRY_HOVER_PX = 10;
const FAIRY_HOVER_SECONDS = 2.4;
/** Small side-to-side tilt while hovering, in radians (~1.5°). 0 = no tilt. */
const FAIRY_TILT_RADIANS = 0.025;

interface SidebarRow {
  symbol: FruitySymbol;
  container: Container;
  /** Holds just the 3 icon sprites, nothing else — animateRowPulse scales this alone (not
   * `container`) so the win pulse bounces the icons only, never the payout `text` next to
   * them. */
  iconsContainer: Container;
  icons: Sprite[];
  text: Text;
  highlight: Graphics;
}

export class FruityScene {
  private reels: Reel[] = [];
  private suspenseFrame: Graphics;
  private suspenseRafId: number | null = null;
  /** Pending per-reel win-effect start delays, so a spin that lands before the stagger
   * finishes (see setWinEffect) can cancel the ones that haven't fired yet. */
  private winEffectStartTimeouts: number[] = [];
  private root: Container;
  private sidebarRows: SidebarRow[] = [];
  private coinLayer: Container;
  private fairy: Flipbook;
  private bellFrames: HTMLImageElement[];

  private constructor(
    app: Application,
    textures: Awaited<ReturnType<typeof loadSymbolTextures>>,
    fairyFrames: HTMLImageElement[],
    bellFrames: HTMLImageElement[]
  ) {
    this.bellFrames = bellFrames;
    this.root = new Container();
    // Layout below stays in full 1920x1080 design coordinates; shift it into the cropped canvas.
    this.root.position.set(-VIEW_LEFT, -VIEW_TOP);
    app.stage.addChild(this.root);

    this.fairy = this.buildFairy(fairyFrames);
    this.root.addChild(this.fairy.sprite);

    const windowLeft = WINDOW_LEFT_FRAC * CANVAS_WIDTH;
    const windowTop = WINDOW_TOP_FRAC * CANVAS_HEIGHT;

    for (let i = 0; i < REEL_COUNT; i++) {
      const reelWindow = new Container();
      reelWindow.x = windowLeft + i * (CELL_WIDTH + COLUMN_GAP);
      reelWindow.y = windowTop;

      const mask = new Graphics();
      mask.rect(0, 0, CELL_WIDTH, VISIBLE_ROWS * CELL_HEIGHT);
      mask.fill({ color: 0xffffff });
      reelWindow.addChild(mask);
      reelWindow.mask = mask;

      const reel = new Reel(textures, CELL_WIDTH, CELL_HEIGHT);
      reelWindow.addChild(reel.container);

      const idleTarget: [FruitySymbol, FruitySymbol, FruitySymbol] = ["APPLE", "LEMON", "ORANGE"];
      reel.showStatic(idleTarget);

      this.root.addChild(reelWindow);
      this.reels.push(reel);
    }

    // Suspense frame around the last reel (see spin) — above the reel windows, hidden until used.
    this.suspenseFrame = new Graphics();
    this.suspenseFrame.x = windowLeft + (REEL_COUNT - 1) * (CELL_WIDTH + COLUMN_GAP);
    this.suspenseFrame.y = windowTop;
    this.suspenseFrame.visible = false;
    this.root.addChild(this.suspenseFrame);
    if (SUSPENSE_FRAME_PREVIEW) this.startSuspenseFrame();

    this.coinLayer = new Container();
    this.root.addChild(this.coinLayer);

    this.buildSidebar(textures);
  }

  /** Loops the fly animation forever and adds a slow hover (bob + tilt) on top, so she keeps
   * flying in place at her spot instead of standing still. Pivot is her center so the tilt
   * rocks around her body, not a corner. */
  private buildFairy(frames: HTMLImageElement[]): Flipbook {
    // One small canvas texture re-drawn per frame instead of 27 GPU textures — see Flipbook.
    const book = new Flipbook(frames, FAIRY_FPS);
    const fairy = book.sprite;
    fairy.anchor.set(0.5);
    fairy.scale.set((FAIRY_SCALE * 527) / book.width);
    fairy.x = FAIRY_X + fairy.width / 2;
    fairy.y = FAIRY_Y + fairy.height / 2;
    book.play();

    gsap.to(fairy, { y: fairy.y - FAIRY_HOVER_PX, duration: FAIRY_HOVER_SECONDS / 2, ease: "sine.inOut", yoyo: true, repeat: -1 });
    if (FAIRY_TILT_RADIANS) {
      fairy.rotation = -FAIRY_TILT_RADIANS;
      gsap.to(fairy, { rotation: FAIRY_TILT_RADIANS, duration: FAIRY_HOVER_SECONDS * 0.8, ease: "sine.inOut", yoyo: true, repeat: -1 });
    }
    return book;
  }

  private buildSidebar(textures: Record<FruitySymbol, Texture>): void {
    const panelLeft = PANEL_LEFT_FRAC * CANVAS_WIDTH;
    const panelRight = PANEL_RIGHT_FRAC * CANVAS_WIDTH;
    const panelTop = PANEL_TOP_FRAC * CANVAS_HEIGHT;
    const panelBottom = PANEL_BOTTOM_FRAC * CANVAS_HEIGHT;
    const panelWidth = panelRight - panelLeft;
    const rowHeight = (panelBottom - panelTop) / SIDEBAR_ORDER.length;

    const leftPad = panelWidth * 0.035;
    const rightPad = panelWidth * 0.05;
    const iconGap = panelWidth * 0.012;
    const iconSize = Math.min(rowHeight - 14, panelWidth * 0.16);
    // Right edge the text anchors to (see the anchor.set(1, 0.5) below) — right-aligning a
    // single-line Text means moving its anchor + x, not TextStyle.align (that only affects
    // how multiple wrapped/\n lines sit relative to each other, a no-op on one line).
    const textRightX = panelWidth - rightPad;

    SIDEBAR_ORDER.forEach((symbol, i) => {
      const rowContainer = new Container();
      rowContainer.x = panelLeft;
      rowContainer.y = panelTop + i * rowHeight;
      this.root.addChild(rowContainer);

      const highlight = new Graphics();
      highlight.roundRect(2, 2, panelWidth - 4, rowHeight - 4, 8);
      highlight.fill({ color: 0xffd700, alpha: 0 });
      rowContainer.addChild(highlight);

      // 3 identical icons side by side — reads as exactly the winning pattern (3-in-a-row on
      // the payline), not just a single sample icon next to a bare multiplier. Held in their
      // own sub-container (not added straight to rowContainer) so animateRowPulse can scale
      // just the icons on a win, never the payout text sitting next to them.
      const iconsContainer = new Container();
      rowContainer.addChild(iconsContainer);
      const icons: Sprite[] = [];
      for (let j = 0; j < ICONS_PER_ROW; j++) {
        const icon = new Sprite(textures[symbol]);
        icon.anchor.set(0.5);
        const scale = Math.min(iconSize / icon.texture.width * 1.5, iconSize / icon.texture.height * 1.5);
        icon.scale.set(scale);
        icon.x = leftPad + j * (iconSize + iconGap) + iconSize / 2;
        icon.y = rowHeight / 2;
        iconsContainer.addChild(icon);
        icons.push(icon);
      }

      const text = new Text({ text: "", style: symbol === "BONUS" ? BONUS_TEXT_STYLE : ROW_TEXT_STYLE });
      text.anchor.set(1, 0.5);
      text.x = textRightX;
      text.y = rowHeight / 2;
      rowContainer.addChild(text);

      this.sidebarRows.push({ symbol, container: rowContainer, iconsContainer, icons, text, highlight });
    });
  }

  static async create(app: Application): Promise<FruityScene> {
    const [textures, fairyFrames, bellFrames] = await Promise.all([
      loadSymbolTextures(),
      loadFairyFrames(),
      loadBellFrames(),
    ]);
    return new FruityScene(app, textures, fairyFrames, bellFrames);
  }

  /** Fills in each sidebar row with the actual amount that combo currently pays (payout ×
   * `betAmount`) — not a bare "xN" multiplier — so it reads the same way the reels' own Win
   * readout does. Recompute whenever the paytable loads *or the bet changes* (see
   * Fruity777Game.tsx's effect keyed on betAmount). The Bonus row shows its free-spin range
   * instead, since it has no cash payout of its own. */
  updatePaytable(paytable: PayoutRow[], betAmount: number): void {
    const bySymbol = Object.fromEntries(paytable.map((row) => [row.symbol, row.payout])) as Partial<
      Record<FruitySymbol, number>
    >;
    for (const row of this.sidebarRows) {
      if (row.symbol === "BONUS") {
        row.text.text = `BONUS`;
      } else {
        const payout = bySymbol[row.symbol];
        row.text.text = payout !== undefined ? (payout * betAmount).toFixed(2) : "";
      }
    }
  }

  /** Spins all reels and lands on the given result. Resolves once every reel has stopped.
   * All 3 reels start scrolling at the same instant; the staggered stop (each landing
   * progressively later) comes from the increasing duration per reel index. `fast` (the
   * FAST spin toggle) runs the same animation in well under half the time. */
  async spin(
    reelsResult: [FruitySymbol, FruitySymbol, FruitySymbol][],
    onReelLand?: (index: number) => void,
    fast = false,
    /** Starts the suspense sound for the given ms; returns a stop function (see below). */
    startSuspenseSound?: (durationMs: number) => () => void
  ): Promise<void> {
    const durationOf = (i: number) => (fast ? 380 + i * 140 : 900 + i * 350);
    const last = REEL_COUNT - 1;
    // Reels 1 and 2 show the same payline symbol → suspense on the last reel: it spins at a
    // steady speed until reel 2 has visibly stopped, then speeds up — and on that same frame the
    // pulsing frame and the drum roll start — then eases out and lands extraMs later than usual.
    const suspense = reelsResult[0][1] === reelsResult[1][1];
    const extraMs = suspense ? (fast ? SUSPENSE_EXTRA_FAST_MS : SUSPENSE_EXTRA_MS) : 0;
    const lastMs = durationOf(last) + extraMs;
    // Reel 2's ease-out has it looking stopped well before its spin officially ends.
    const boostAt = Math.round(durationOf(last - 1) * SUSPENSE_START_FRAC);
    const boost = { atMs: boostAt, rampMs: SUSPENSE_RAMP_MS, factor: SUSPENSE_SPEED_UP };
    // Symbols to scroll so the steady phase runs at a normal reel's mid-spin speed.
    const steadySpeed = (FILLER_COUNT * 1.5) / durationOf(last); // symbols per ms
    const boostedLength = boost.atMs + ((1 + boost.factor) / 2) * boost.rampMs + (boost.factor * (lastMs - boost.atMs - boost.rampMs)) / 3;
    const extraFiller = suspense ? Math.max(0, Math.round(steadySpeed * boostedLength) - FILLER_COUNT) : 0;

    let stopSound: (() => void) | null = null;
    let suspenseTimer: number | null = null;
    if (suspense) {
      suspenseTimer = window.setTimeout(() => {
        suspenseTimer = null;
        this.startSuspenseFrame();
        stopSound = startSuspenseSound?.(lastMs - boostAt) ?? null;
      }, boostAt);
    }
    const spins = this.reels.map((reel, i) => {
      const isLast = i === last;
      return reel
        .spinTo(
          reelsResult[i],
          isLast ? lastMs : durationOf(i),
          0,
          isLast ? extraFiller : 0,
          isLast && suspense ? boost : undefined,
          () => onReelLand?.(i)
        )
        .then(() => {
          if (isLast && suspense) {
            if (suspenseTimer !== null) window.clearTimeout(suspenseTimer);
            if (!SUSPENSE_FRAME_PREVIEW) this.stopSuspenseFrame();
            stopSound?.();
          }
        });
    });
    await Promise.all(spins);
  }

  private startSuspenseFrame(): void {
    this.stopSuspenseFrame();
    const frame = this.suspenseFrame;
    frame.visible = true;
    const f = SUSPENSE_FRAME;
    const x0 = f.offsetX - f.widthAdjust / 2;
    const y0 = f.offsetY - f.heightAdjust / 2;
    const w = CELL_WIDTH + f.widthAdjust;
    const h = VISIBLE_ROWS * CELL_HEIGHT + f.heightAdjust;
    const start = performance.now();
    const animate = () => {
      const pulse = 0.5 + 0.5 * Math.sin(((performance.now() - start) / 260) * Math.PI * 2);
      frame.clear();
      // Inner shadow: thin rings stepping inward from the border, each fainter than the last.
      const steps = 10;
      if (f.innerShadowAlpha > 0 && f.innerShadowSize > 0) {
        const ring = f.innerShadowSize / steps;
        for (let k = 0; k < steps; k++) {
          const inset = k * ring + ring / 2;
          frame.roundRect(x0 + inset, y0 + inset, w - inset * 2, h - inset * 2, Math.max(0, f.radius - inset));
          frame.stroke({ color: f.innerShadowColor, width: ring + 0.5, alpha: f.innerShadowAlpha * Math.pow(1 - k / steps, 2) });
        }
      }
      // Soft outer glow (a few widening, fading strokes).
      if (f.outerGlowStrength > 0) {
        for (let k = 3; k >= 1; k--) {
          frame.roundRect(x0 - 4 * k, y0 - 4 * k, w + 8 * k, h + 8 * k, f.radius + 2 + 4 * k);
          frame.stroke({ color: f.outerGlowColor, width: 8, alpha: (f.outerGlowStrength * (0.12 + pulse * 0.18)) / k });
        }
      }
      // The crisp border itself.
      frame.roundRect(x0 - 3, y0 - 3, w + 6, h + 6, f.radius);
      frame.stroke({ color: f.borderColor, width: f.borderWidth + pulse * f.borderPulse, alpha: 0.75 + pulse * 0.25 });
      this.suspenseRafId = requestAnimationFrame(animate);
    };
    this.suspenseRafId = requestAnimationFrame(animate);
  }

  private stopSuspenseFrame(): void {
    if (this.suspenseRafId !== null) cancelAnimationFrame(this.suspenseRafId);
    this.suspenseRafId = null;
    this.suspenseFrame.clear();
    this.suspenseFrame.visible = false;
  }

  /** Win treatment on the payline (a rainbow-cycling halo around the symbol plus a scale
   * pulse — see Reel.ts) plus the matching sidebar row's pulse + coin toss. Every reel's
   * above/below rows dim in one synchronous pass, all at the same instant — only the star
   * sweep/glow itself starts in sequence, left to right (reel 1, then 2, then 3, staggered by
   * WIN_EFFECT_STAGGER_MS), not the dimming (per user request: the dim used to be tied to each
   * reel's own staggered start, which made it visibly dim reel-by-reel instead of all at once).
   * Call with `false` to stop (e.g. when the next spin starts). */
  setWinEffect(active: boolean, winningSymbol?: FruitySymbol): void {
    this.winEffectStartTimeouts.forEach((id) => window.clearTimeout(id));
    this.winEffectStartTimeouts = [];

    if (active) {
      this.reels.forEach((reel) => reel.dimNonPayline());
      this.reels.forEach((reel, i) => {
        this.winEffectStartTimeouts.push(window.setTimeout(() => reel.startWinEffect(), i * WIN_EFFECT_STAGGER_MS));
      });
      if (winningSymbol) this.pulseSidebarRow(winningSymbol);
    } else {
      this.reels.forEach((reel) => reel.stopWinEffect());
    }
  }

  /** Free-spins trigger: the 3 payline BONUS symbols turn into swinging bells (left to right,
   * same stagger as a normal win), the other rows dim, and the sidebar BONUS row pulses.
   * Cleared by setWinEffect(false) / the next spin like any other win effect. */
  playBonusTrigger(): void {
    this.winEffectStartTimeouts.forEach((id) => window.clearTimeout(id));
    this.winEffectStartTimeouts = [];
    this.reels.forEach((reel) => reel.dimNonPayline());
    this.reels.forEach((reel, i) => {
      this.winEffectStartTimeouts.push(window.setTimeout(() => reel.startBellEffect(this.bellFrames), i * WIN_EFFECT_STAGGER_MS));
    });
    this.pulseBonusRow();
  }

  /** Announces a Bonus trigger the same way a numeric win does — pulses the BONUS sidebar
   * row (no coin toss; the free-spin award itself is announced via the full-screen banner). */
  pulseBonusRow(): void {
    const row = this.sidebarRows.find((r) => r.symbol === "BONUS");
    if (!row) return;
    this.animateRowPulse(row);
  }

  /** Scales/glows the winning symbol's sidebar row and fires a handful of gold coins arcing
   * from that row down to the bottom edge of the canvas — reads as "feeding" the win toward
   * the control bar sitting just below the canvas in the DOM (see plan's Decisions). */
  private pulseSidebarRow(symbol: FruitySymbol): void {
    const row = this.sidebarRows.find((r) => r.symbol === symbol);
    if (!row) return;
    this.animateRowPulse(row);
    this.throwCoins(row);
  }

  /** Pulses the row for PULSE_TOTAL_SECONDS (~3.5s, per user request) — a gentle repeating
   * scale bounce on all 3 icons only (scaling iconsContainer scales them together, leaving
   * `text` — the payout amount — untouched) plus a held gold highlight behind the whole row,
   * instead of one quick bounce. */
  private animateRowPulse(row: SidebarRow): void {
    gsap.killTweensOf(row.iconsContainer.scale);
    gsap.killTweensOf(row.highlight);
    row.iconsContainer.pivot.set(0, 0);
    row.iconsContainer.scale.set(1);

    const halfCycle = PULSE_TOTAL_SECONDS / (PULSE_CYCLES * 2);
    gsap.to(row.highlight, { alpha: 0.55, duration: 0.15 });
    gsap.to(row.highlight, { alpha: 0, duration: 0.5, delay: PULSE_TOTAL_SECONDS - 0.5 });
    gsap.to(row.iconsContainer.scale, {
      x: 1.12,
      y: 1.12,
      duration: halfCycle,
      ease: "sine.inOut",
      repeat: PULSE_CYCLES * 2 - 1,
      yoyo: true,
    });
  }

  private throwCoins(row: SidebarRow): void {
    const origin = row.icons[1] ?? row.icons[0];
    const startX = row.container.x + origin.x;
    const startY = row.container.y + origin.y;
    const targetY = CANVAS_HEIGHT;
    const coinCount = 6 + Math.floor(Math.random() * 3);

    for (let i = 0; i < coinCount; i++) {
      const coin = new Graphics();
      coin.circle(0, 0, 14).fill({ color: COIN_COLOR });
      coin.circle(-3, -3, 5.5).fill({ color: COIN_SHINE_COLOR, alpha: 0.8 });
      coin.x = startX;
      coin.y = startY;
      this.coinLayer.addChild(coin);

      const targetX = startX + (Math.random() - 0.3) * 420 + 200;
      const delay = i * 0.04;
      const duration = 0.7 + Math.random() * 0.3;

      gsap
        .timeline({ delay, onComplete: () => coin.destroy() })
        .to(coin, { x: targetX, duration, ease: "power1.in" }, 0)
        .to(coin, { y: targetY, duration, ease: "power2.in" }, 0)
        .to(coin, { rotation: Math.random() * 10 - 5, duration }, 0)
        .to(coin, { alpha: 0, duration: 0.2 }, duration - 0.2);
    }
  }

  destroy(): void {
    gsap.killTweensOf(this.fairy.sprite);
    this.fairy.destroy();
    this.winEffectStartTimeouts.forEach((id) => window.clearTimeout(id));
    if (this.suspenseRafId !== null) cancelAnimationFrame(this.suspenseRafId);
    this.reels.forEach((r) => r.destroy());
    this.root.destroy({ children: true });
  }
}
