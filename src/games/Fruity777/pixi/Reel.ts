import gsap from "gsap";
import { reelLanding } from "../../shared/pixi/reelLanding";
import { Container, Sprite, Texture } from "pixi.js";
import { Flipbook } from "./flipbook";
import { FruitySymbol } from "../api";

export const FILLER_COUNT = 18;

/** Fraction (0..1) of the scroll done `elapsed` ms into a boosted spin (see spinTo's `boost`):
 * constant speed v until atMs, a linear ramp up to factor*v over rampMs, then a cubic ease-out
 * from that speed to a stop at `duration`. v is solved so the whole distance is covered exactly. */
function boostedProgress(elapsed: number, duration: number, boost: { atMs: number; rampMs: number; factor: number }): number {
  const T1 = Math.min(boost.atMs, duration);
  const R = Math.min(boost.rampMs, Math.max(0, duration - T1));
  const Td = Math.max(1, duration - T1 - R);
  const k = boost.factor;
  // Distance (in units of v) covered by each phase; normalising by their sum gives fractions.
  const total = T1 + ((1 + k) / 2) * R + (k * Td) / 3;
  const t = Math.min(Math.max(elapsed, 0), duration);
  let x: number;
  if (t < T1) x = t;
  else if (t < T1 + R) {
    const u = t - T1;
    x = T1 + u + ((k - 1) * u * u) / (2 * R);
  } else {
    const s = (t - T1 - R) / Td;
    x = T1 + ((1 + k) / 2) * R + ((k * Td) / 3) * (1 - Math.pow(1 - s, 3));
  }
  return Math.min(1, x / total);
}
const SYMBOL_PADDING = 20;
const GLOW_PULSE_PERIOD_MS = 580;
/** How long one full rotation of the rainbow glow takes — independent of GLOW_PULSE_PERIOD_MS,
 * which drives the glow's size/alpha and the symbol's scale bounce. The glow itself already
 * shows every hue at once (see buildRainbowGlowTexture); this just slowly spins that fixed
 * rainbow ring rather than cycling through one flat color over time. */
const GLOW_ROTATION_PERIOD_MS = 6000;
/** How dim the non-payline (above/below) rows go while the payline is celebrating a win. */
const NON_PAYLINE_DIM_ALPHA = 0.32;

/** Manual switch between the winning symbol's two animation styles — flip this and reload to
 * try the other one; the glow's own spin+size pulse (see playGlowEffect) is unaffected either
 * way. false = PULSE (grows/shrinks via scale, the original). true = WOBBLE (rocks side to
 * side via rotation instead of resizing). */
const USE_WOBBLE_ANIMATION = false;
/** PULSE's scale swing (as a fraction of baseScale) — only used when USE_WOBBLE_ANIMATION is false. */
const PULSE_SCALE_AMOUNT = 0.32;
/** WOBBLE's max tilt each way, in radians (~7°), and how long one full left-right-left cycle
 * takes — only used when USE_WOBBLE_ANIMATION is true. */
const WOBBLE_MAX_RADIANS = 0.12;
const WOBBLE_PERIOD_MS = 450;

/** How many stars sweep across the winning cell (see playStarSweep) — raise this for a denser
 * sweep. */
const STAR_COUNT = 450;
/** Length of the star ribbon (front star to last star), as a fraction of cellWidth — stars are
 * scattered randomly along it, so more STAR_COUNT = denser ribbon, not a longer one. */
const STAR_TRAIL_LENGTH_FRAC = 2.5;
/** How long the whole ribbon takes to fully pass through the cell, in seconds. */
export const STAR_SWEEP_SECONDS = 1.82;
/** The fruit's pulse + rainbow glow start after the star sweep. 0 = exactly when the stars
 * finish; e.g. 0.4 = start 0.4s before they finish, for a slight overlap/smoother hand-off. */
export const WIN_GLOW_START_OVERLAP_SECONDS = 0;

/** Bonus-trigger bell (see startBellEffect): flipbook speed in frames per second (30 frames →
 * one swing per second at 30), and its size relative to the normal BONUS symbol. */
const BELL_FPS = 30;
const BELL_SCALE = 0.95;
/** Wave height — how far the smooth up/down wave goes above/below the cell's center, as a
 * fraction of cellHeight (0.5 = touches the top/bottom edge of the winning cell). Each star
 * gets its own random 50%-150% of this, so the flow looks organic instead of rigid. */
const STAR_WAVE_AMPLITUDE_FRAC = 0.05;
/** How many full up-and-down waves fit across one cell width — higher = tighter wave. */
const STAR_WAVE_PER_CELL = 1.5;
/** How tall the ribbon is (fraction of cellHeight) — each star gets a random height inside it. */
const STAR_BAND_HEIGHT_FRAC = 0.68;
/** Each sparkle's size is a random radius between these two values (px). */
const STAR_MIN_RADIUS = 9;
const STAR_MAX_RADIUS = 15;
/** Per-star speed variation (0.25 = each star moves at 75%-125% of the base speed) — gives the
 * flow depth, like real particles, instead of one block moving in lockstep. 0 = all identical. */
const STAR_SPEED_VARIATION = 0.25;
/** Fraction of sparkles that are bigger "hero" glints (2x size) — the bright flashes that catch
 * the eye in real slot win effects. */
const STAR_HERO_FRACTION = 0.06;
/** How fast each sparkle twinkles (brightness/size flicker), random between these (cycles/sec). */
const STAR_TWINKLE_MIN_HZ = 1.2;
const STAR_TWINKLE_MAX_HZ = 3;
/** Sparkle tints, picked at random — warm gold/white like casino win sparkles. */
const STAR_COLORS = [0xffffff, 0xfff6d5, 0xffe9a0, 0xffd45c];

/** Full-saturation rainbow color at hue fraction `h` (0-1) — used for the win glow's color
 * cycling, no external color-conversion lib needed for one hue sweep. Mirrors 7 Crystal
 * Clover's Reel.ts hueToHex exactly. */
function hueToHex(h: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = 1;
      g = f;
      b = 0;
      break;
    case 1:
      r = q;
      g = 1;
      b = 0;
      break;
    case 2:
      r = 0;
      g = 1;
      b = f;
      break;
    case 3:
      r = 0;
      g = q;
      b = 1;
      break;
    case 4:
      r = f;
      g = 0;
      b = 1;
      break;
    default:
      r = 1;
      g = 0;
      b = q;
      break;
  }
  return (Math.round(r * 255) << 16) + (Math.round(g * 255) << 8) + Math.round(b * 255);
}

export class Reel {
  public readonly container: Container;
  private textures: Record<FruitySymbol, Texture>;
  private fillerPool: FruitySymbol[];
  private pendingTimeouts: number[] = [];
  private pendingFrames: Array<() => void> = [];
  /** [above, middle, below] cells currently on screen — middle is the scored payline symbol. */
  private visibleCells: Container[] = [];
  /**
   * y-index (in cellHeight units) the *next* prepended cell will take — always decreases
   * (more negative) with each prepend, so new cells stack above whatever's already there.
   * Reset to 0 by keepOnly()/showStatic() after every spin settles, so this never drifts to
   * an ever-larger magnitude across many spins.
   */
  private nextSlotAbove = 0;
  private glowGraphics: Sprite | null = null;
  private glowRafId: number | null = null;
  /** Built once, lazily, and reused for every win after the first — a static texture, not
   * something redrawn per frame (see buildRainbowGlowTexture). */
  private rainbowGlowTexture: Texture | null = null;
  /** Shared glint texture for the win star sweep — built lazily, see buildSparkleTexture. */
  private sparkleTexture: Texture | null = null;
  /** The one-shot star-sweep's own container/timeline — torn down in stopWinEffect() if a
   * new spin interrupts it before it finishes. */
  private starSweepLayer: Container | null = null;
  private starSweepTimeline: gsap.core.Timeline | null = null;
  /** The swinging bell shown in place of the payline BONUS symbol on a free-spins trigger. */
  private bellAnim: Flipbook | null = null;

  constructor(
    textures: Record<FruitySymbol, Texture>,
    private cellWidth: number,
    private cellHeight: number
  ) {
    this.textures = textures;
    this.fillerPool = Object.keys(textures) as FruitySymbol[];
    this.container = new Container();
  }

  private randomSymbol(): FruitySymbol {
    return this.fillerPool[Math.floor(Math.random() * this.fillerPool.length)];
  }

  private buildCell(symbol: FruitySymbol): Container {
    const cell = new Container();
    cell.label = symbol;
    const sprite = new Sprite(this.textures[symbol]);
    sprite.anchor.set(0.5);
    const maxW = this.cellWidth - SYMBOL_PADDING * 2;
    const maxH = this.cellHeight - SYMBOL_PADDING * 2;
    const scale = Math.min(maxW / sprite.texture.width, maxH / sprite.texture.height);
    sprite.scale.set(scale);
    (sprite as Sprite & { baseScale: number }).baseScale = scale;
    sprite.x = this.cellWidth / 2;
    sprite.y = this.cellHeight / 2;
    cell.addChild(sprite);
    return cell;
  }

  /** Appends cells *above* whatever's currently on screen — each successive symbol in
   * `symbols` gets placed one slot higher (more negative y) than the last, continuing on
   * from `nextSlotAbove`. This is the mirror image of a "scrolls upward" reel: as
   * `container.y` eases upward (more positive) toward its resting value, this newly-placed
   * stack (and the old stack sitting below it, at less-negative/positive y) both slide
   * downward on screen — new symbols enter from the top, old ones exit at the bottom, per
   * the user's "top to bottom" spec. Returns direct references — never rely on
   * container.children order afterwards (see keepOnly). */
  private prependCells(symbols: FruitySymbol[]): Container[] {
    const cells: Container[] = [];
    symbols.forEach((sym) => {
      this.nextSlotAbove -= 1;
      const cell = this.buildCell(sym);
      cell.y = this.nextSlotAbove * this.cellHeight;
      this.container.addChild(cell);
      cells.push(cell);
    });
    return cells;
  }

  /** Renders the reel showing exactly these 3 symbols (above/middle/below), no animation. */
  showStatic(target: [FruitySymbol, FruitySymbol, FruitySymbol]): void {
    this.stopWinEffect();
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.container.y = 0;
    this.nextSlotAbove = 0;
    const cells = target.map((sym, i) => {
      const cell = this.buildCell(sym);
      cell.y = i * this.cellHeight;
      this.container.addChild(cell);
      return cell;
    });
    this.visibleCells = cells;
  }

  /**
   * Spins and lands exactly on `target` (above/middle/below on the payline). Continues from
   * whatever's currently displayed — filler + target are prepended *above* the existing
   * cells, then `container.y` eases from its current value up toward the offset that brings
   * the newly-prepended target into the window — see prependCells' doc comment for why this
   * reads as a top-to-bottom fall.
   */
  spinTo(
    target: [FruitySymbol, FruitySymbol, FruitySymbol],
    duration: number,
    delay: number,
    /** More symbols to scroll past — pair with a proportionally longer `duration` so the reel
     * genuinely spins longer (suspense) instead of just slowing down. */
    extraFiller = 0,
    /** Suspense speed-up: steady speed until `atMs`, then over `rampMs` it accelerates to
     * `factor`x that speed, then eases out to land at `duration`. Without it the reel just
     * decelerates (ease-out) over the whole spin. */
    boost?: { atMs: number; rampMs: number; factor: number },
    /** Called the moment the reel visually lands (for the reel-stop sound) — see reelLanding. */
    onLand?: () => void
  ): Promise<void> {
    this.stopWinEffect();
    if (this.visibleCells.length === 0) {
      // Nothing on screen yet (first render) — seed with a static frame to continue from.
      this.showStatic([this.randomSymbol(), this.randomSymbol(), this.randomSymbol()]);
    }

    const startY = this.container.y;
    const filler: FruitySymbol[] = Array.from({ length: FILLER_COUNT + extraFiller }, () => this.randomSymbol());
    // Prepend order matters: filler first (ends up *below* the target, closer to the old
    // stack — passes through the window first), then target BELOW->MIDDLE->ABOVE last, so
    // "above" ends up the most-negative (topmost) of the three, per prependCells' contract.
    this.prependCells(filler);
    const targetCells = this.prependCells([target[2], target[1], target[0]]).reverse(); // -> [above, middle, below]

    // After both prepend calls above, `nextSlotAbove` is exactly the "above" target cell's
    // slot index (it was the very last decrement applied) — landing it at window-local y=0
    // means the container must shift by the negation of that.
    const finalY = -this.nextSlotAbove * this.cellHeight;

    return new Promise((resolve) => {
      let rafId = 0;
      const timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const land = reelLanding(startY, finalY, onLand);
        const tick = (now: number) => {
          const t = Math.min(Math.max((now - start) / duration, 0), 1);
          const eased = boost ? boostedProgress(now - start, duration, boost) : 1 - Math.pow(1 - t, 3);
          this.container.y = startY + (finalY - startY) * eased;
          land(this.container.y);
          if (t < 1) {
            rafId = requestAnimationFrame(tick);
          } else {
            this.container.y = finalY;
            land(finalY);
            this.keepOnly(targetCells);
            resolve();
          }
        };
        rafId = requestAnimationFrame(tick);
      }, delay);

      this.pendingTimeouts.push(timeoutId);
      this.pendingFrames.push(() => cancelAnimationFrame(rafId));
    });
  }

  /** Destroys every cell except `keep` (by direct reference), re-indexes them to the
   * resting [above, middle, below] = [0, cellHeight, 2*cellHeight] window slots, and resets
   * `container.y`/`nextSlotAbove` back to 0 — so neither the child list nor the slot indices
   * grow unbounded across spins. Purely internal bookkeeping — no visible change. */
  private keepOnly(keep: Container[]): void {
    const toRemove = this.container.children.filter((c) => !keep.includes(c));
    toRemove.forEach((c) => {
      this.container.removeChild(c);
      c.destroy({ children: true });
    });
    keep.forEach((cell, i) => {
      cell.y = i * this.cellHeight;
    });
    this.container.y = 0;
    this.nextSlotAbove = 0;
    this.visibleCells = keep;
  }

  /** Fires the payline's win treatment in sequence: first a one-shot star sweep across the
   * winning cell, THEN (once the sweep is done — see WIN_GLOW_START_OVERLAP_SECONDS) a
   * rainbow-cycling halo around the symbol plus a pulse/wobble. If the player spins again
   * mid-sweep, stopWinAnimation kills the sweep timeline so the glow never starts. Same
   * treatment for every symbol now (fruit and seven/bar/star/bonus
   * alike; the old fruit-only slash+juice effect was removed per user request). Dimming the
   * above/below rows is handled separately (see dimNonPayline) so every reel dims at the same
   * instant even though this method itself is called staggered, reel-by-reel. The glow/pulse
   * loops indefinitely until stopWinEffect() is called (i.e. until the player spins again); the
   * star sweep is one-shot and cleans itself up on its own. */
  startWinEffect(): void {
    this.stopWinAnimation();
    const middle = this.visibleCells[1];
    const sprite = middle?.children[0] as (Sprite & { baseScale: number }) | undefined;
    if (!middle || !sprite) return;

    this.playStarSweep(middle, () => this.playGlowEffect(middle, sprite));
  }

  /** Free-spins trigger treatment for this reel's payline BONUS symbol: hides the static
   * bonus.png and plays the bell swing animation in its place (looping), with the rainbow glow
   * behind it. Stays until stopWinEffect() — i.e. the next spin starts. */
  startBellEffect(frames: HTMLImageElement[]): void {
    this.stopWinAnimation();
    const middle = this.visibleCells[1];
    const sprite = middle?.children[0] as (Sprite & { baseScale: number }) | undefined;
    if (!middle || !sprite || frames.length === 0) return;

    // One small canvas texture per bell instead of 30 GPU textures — see Flipbook.
    const book = new Flipbook(frames, BELL_FPS);
    const bell = book.sprite;
    bell.anchor.set(0.5);
    // Bell frames share bonus.webp's square canvas, so the symbol's own fit-to-cell scale applies.
    bell.scale.set((sprite.baseScale * BELL_SCALE * sprite.texture.width) / book.width);
    bell.x = sprite.x;
    bell.y = sprite.y;
    book.play();
    sprite.visible = false;
    middle.addChild(bell);
    this.bellAnim = book;

    this.playGlowEffect(middle, sprite);
  }

  /** One-shot "sparkle stream", styled like real slot win sparkles: STAR_COUNT soft glowing
   * 4-point glints (additive blend, so overlapping ones brighten each other), scattered randomly
   * inside a ribbon (STAR_TRAIL_LENGTH_FRAC long, STAR_BAND_HEIGHT_FRAC tall), flowing
   * left-to-right along a smooth shared wave. What keeps it from looking mechanical:
   *  - each sparkle has its own speed (STAR_SPEED_VARIATION), wave height and wave offset, so
   *    the stream has depth and drifts organically instead of moving as one rigid block;
   *  - each one twinkles (size + brightness flicker at its own rate) and slowly turns;
   *  - they fade in entering the cell and fade out leaving it (no hard pop at the mask edge),
   *    and the whole stream fades out gracefully at the end;
   *  - a few bigger "hero" glints (STAR_HERO_FRACTION) catch the eye.
   * Purely decorative — confined to this single cell via the mask each reel's window already
   * clips to. Runs independently of playGlowEffect (see startWinEffect) — nothing waits for this. */
  private playStarSweep(cell: Container, onSweepDone?: () => void): void {
    const layer = new Container();
    cell.addChild(layer);
    this.starSweepLayer = layer;

    const texture = this.buildSparkleTexture();
    const w = this.cellWidth;
    const centerY = this.cellHeight / 2;
    const amplitude = this.cellHeight * STAR_WAVE_AMPLITUDE_FRAC;
    const trailLength = w * STAR_TRAIL_LENGTH_FRAC;
    const startX = -w * 0.15; // front sparkle starts just off the left edge
    // Far enough that the *last* sparkle (trailLength behind the front one) fully exits on the right.
    const travel = w * 1.3 + trailLength;
    const bandHeight = this.cellHeight * STAR_BAND_HEIGHT_FRAC;
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

    const stars: {
      s: Sprite;
      baseX: number;
      baseY: number;
      speed: number;
      ampMul: number;
      wavePhase: number;
      twinkleHz: number;
      twinklePhase: number;
      baseScale: number;
      baseRot: number;
      spin: number;
    }[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const hero = Math.random() < STAR_HERO_FRACTION;
      const radius = rand(STAR_MIN_RADIUS, STAR_MAX_RADIUS) * (hero ? 2 : 1);
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
      s.alpha = 0;
      layer.addChild(s);
      stars.push({
        s,
        baseX: startX - Math.random() * trailLength,
        baseY: (Math.random() - 0.5) * bandHeight,
        speed: 1 + rand(-STAR_SPEED_VARIATION, STAR_SPEED_VARIATION),
        ampMul: rand(0.5, 1.5),
        wavePhase: rand(-0.15, 0.15),
        twinkleHz: rand(STAR_TWINKLE_MIN_HZ, STAR_TWINKLE_MAX_HZ),
        twinklePhase: Math.random() * Math.PI * 2,
        // Texture's glint arms span its full width; scale so the arms reach ~2x the radius.
        baseScale: (radius * 2.4) / texture.width,
        baseRot: rand(-0.3, 0.3),
        spin: rand(-1.2, 1.2),
      });
    }

    const place = (p: number) => {
      const t = p * STAR_SWEEP_SECONDS;
      // Whole stream fades out over the last 15% instead of vanishing on the final frame.
      const endFade = clamp01((1 - p) / 0.15);
      for (const st of stars) {
        const x = st.baseX + travel * st.speed * p;
        const wave = Math.sin(((x / w) * STAR_WAVE_PER_CELL + st.wavePhase) * Math.PI * 2);
        const twinkle = 0.5 + 0.5 * Math.sin(t * st.twinkleHz * Math.PI * 2 + st.twinklePhase); // 0..1
        // Fade in over the first 20% of the cell, out over the last 25% — no hard pop at the edges.
        const edgeFade = clamp01((x + w * 0.05) / (w * 0.2)) * clamp01((w * 1.05 - x) / (w * 0.25));

        st.s.x = x;
        st.s.y = centerY + st.baseY + wave * amplitude * st.ampMul;
        st.s.rotation = st.baseRot + st.spin * t;
        st.s.scale.set(st.baseScale * (0.7 + 0.45 * twinkle));
        st.s.alpha = edgeFade * endFade * (0.45 + 0.55 * twinkle);
      }
    };
    place(0);

    const progress = { p: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        layer.destroy({ children: true });
        if (this.starSweepLayer === layer) this.starSweepLayer = null;
      },
    });
    tl.to(progress, { p: 1, duration: STAR_SWEEP_SECONDS, ease: "none", onUpdate: () => place(progress.p) });
    // Hand off to the glow/pulse as the sweep finishes. Placed on the timeline (not a
    // setTimeout) so killing the timeline on a new spin also cancels it.
    if (onSweepDone) tl.call(onSweepDone, [], Math.max(0, STAR_SWEEP_SECONDS - WIN_GLOW_START_OVERLAP_SECONDS));
    this.starSweepTimeline = tl;
  }

  /** Builds (once, lazily) the sparkle texture every win-sweep star shares: a classic casino
   * "glint" — bright white core, soft warm glow, and four long tapered light rays (plus four
   * faint diagonal ones). White-ish on purpose so each sprite's `tint` can color it. One shared
   * texture + Sprites is also far cheaper than hundreds of per-star Graphics. */
  private buildSparkleTexture(): Texture {
    if (this.sparkleTexture) return this.sparkleTexture;

    const size = 96;
    const c = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    // Soft glow halo.
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.55);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.25, "rgba(255,236,170,0.55)");
    glow.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // Tapered light ray from the center out to `len`, rotated by `angle`.
    const ray = (angle: number, len: number, halfWidth: number, alpha: number) => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -halfWidth);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, halfWidth);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    for (let k = 0; k < 4; k++) ray((k * Math.PI) / 2, c * 0.98, 3.2, 1);
    for (let k = 0; k < 4; k++) ray((k * Math.PI) / 2 + Math.PI / 4, c * 0.45, 1.8, 0.55);

    // Hot white core.
    const core = ctx.createRadialGradient(c, c, 0, c, c, 7);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, 7, 0, Math.PI * 2);
    ctx.fill();

    this.sparkleTexture = Texture.from(canvas);
    return this.sparkleTexture;
  }

  /** Builds (once, lazily — see rainbowGlowTexture) a soft-edged circular texture showing the
   * *entire* rainbow simultaneously — a conic gradient sweeping every hue around the ring, all
   * visible at once, rather than one flat color that cycles over time. The blur is baked
   * straight into the canvas (via the 2D context's own `filter`, not a runtime Pixi
   * BlurFilter on the sprite) with generous padding around the circle — a Pixi filter needs
   * room to bleed past the sprite's own texture bounds to blur without clipping, and this
   * texture had none, which is exactly what showed up as a hard rectangular edge (worst in the
   * bottom-right corner) once the glow scaled down small enough for that clipped filter
   * boundary to become visible. Baking the blur into the texture itself, with real margin,
   * removes that whole class of problem. The sprite built from this is rotated per-frame for a
   * slow "spinning rainbow" look, far cheaper than redrawing the canvas every frame. */
  private buildRainbowGlowTexture(diameter: number): Texture {
    if (this.rainbowGlowTexture) return this.rainbowGlowTexture;

    const blurPx = diameter * 0.12;
    // The canvas is noticeably bigger than the visible circle so the baked-in blur has real
    // room to fade all the way to fully transparent well inside the edge, never right up
    // against it.
    const size = Math.ceil(diameter * 1.6);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const cx = size / 2;
    const cy = size / 2;
    const radius = diameter / 2 - blurPx;

    if (typeof ctx.createConicGradient === "function") {
      const conic = ctx.createConicGradient(0, cx, cy);
      const stopCount = 12;
      for (let i = 0; i <= stopCount; i++) {
        conic.addColorStop(i / stopCount, `#${hueToHex(i / stopCount).toString(16).padStart(6, "0")}`);
      }
      ctx.fillStyle = conic;
    } else {
      // Very old browsers without conic gradient support — a plain warm gold fallback.
      ctx.fillStyle = "#ffb300";
    }
    ctx.filter = `blur(${blurPx}px)`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";

    // A further radial fade on top of the baked-in blur, entirely within the padded canvas
    // (nowhere near its edge), so the very outer rim tapers all the way to alpha 0 instead of
    // trailing off as a faint but nonzero haze.
    ctx.globalCompositeOperation = "destination-in";
    const fadeRadius = size / 2;
    const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, fadeRadius);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(0.6, "rgba(255,255,255,0.9)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";

    this.rainbowGlowTexture = Texture.from(canvas);
    return this.rainbowGlowTexture;
  }

  /** A big, soft, all-colors-at-once rainbow halo radiating *around* the symbol itself (a
   * circle, not a rectangular backdrop spanning the whole cell) — slowly spinning, pulsing
   * larger and smaller — plus a much bigger scale pulse on the symbol itself so the win reads
   * as a real "pop", not a gentle wobble. The one win treatment every symbol gets now (fruit
   * and seven/bar/star/bonus alike). Loops until stopWinEffect() is called. */
  private playGlowEffect(middle: Container, sprite: Sprite & { baseScale: number }): void {
    const cx = this.cellWidth / 2;
    const cy = this.cellHeight / 2;
    const baseDiameter = Math.min(this.cellWidth, this.cellHeight) * 1.0;

    const texture = this.buildRainbowGlowTexture(baseDiameter);
    const glow = new Sprite(texture);
    glow.anchor.set(0.5);
    glow.x = cx;
    glow.y = cy;
    middle.addChildAt(glow, 0);
    this.glowGraphics = glow;

    // The texture itself is padded well beyond baseDiameter (see buildRainbowGlowTexture's doc
    // comment — that's what fixed the hard-edge artifact), so the sprite's *base* scale has to
    // shrink it back down to the intended visual size before the pulse's own scale multiplier
    // is layered on top; using glow.scale.set(pulseFactor) directly would render the whole
    // padded texture (1.6x too big) at face value.
    const glowBaseScale = baseDiameter / texture.width;

    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const pulse = 0.3 + 0.3 * Math.sin((elapsed / GLOW_PULSE_PERIOD_MS) * Math.PI * 2);

      glow.rotation = (elapsed / GLOW_ROTATION_PERIOD_MS) * Math.PI * 2;
      glow.scale.set(glowBaseScale * (1.25 + pulse * 0.75));
      glow.alpha = 0.55 + pulse * 0.35;

      if (USE_WOBBLE_ANIMATION) {
        sprite.rotation = Math.sin((elapsed / WOBBLE_PERIOD_MS) * Math.PI * 2) * WOBBLE_MAX_RADIANS;
      } else {
        sprite.scale.set(sprite.baseScale * (1 + pulse * PULSE_SCALE_AMOUNT));
      }
      this.glowRafId = requestAnimationFrame(animate);
    };
    this.glowRafId = requestAnimationFrame(animate);
  }

  /** Tears down the star sweep + glow/pulse-or-wobble animation only — deliberately does *not*
   * touch visibleCells' alpha (see dimNonPayline's doc comment for why). Used both by
   * stopWinEffect (the real "win celebration is over" cleanup) and as startWinEffect's own
   * defensive pre-clear, where resetting alpha would immediately wipe out a dim the scene may
   * have just applied moments earlier via dimNonPayline. */
  private stopWinAnimation(): void {
    if (this.glowRafId !== null) {
      cancelAnimationFrame(this.glowRafId);
      this.glowRafId = null;
    }
    if (this.glowGraphics) {
      this.glowGraphics.destroy();
      this.glowGraphics = null;
    }
    if (this.starSweepTimeline) {
      this.starSweepTimeline.kill();
      this.starSweepTimeline = null;
    }
    if (this.starSweepLayer) {
      this.starSweepLayer.destroy({ children: true });
      this.starSweepLayer = null;
    }
    if (this.bellAnim) {
      this.bellAnim.destroy();
      this.bellAnim = null;
    }
  }

  /** Dims the above/below (non-payline) rows immediately — split out from startWinEffect so
   * FruityScene.setWinEffect can call this on every reel in one synchronous pass (all reels
   * dim at the exact same instant) even though the star sweep/glow itself is staggered
   * reel-by-reel afterward (see WIN_EFFECT_STAGGER_MS). Calling this *before* scheduling the
   * staggered startWinEffect() calls is what makes it work: startWinEffect's own defensive
   * stopWinAnimation() never resets alpha, so the dim set here survives untouched until the
   * round truly ends (stopWinEffect). */
  dimNonPayline(): void {
    if (this.visibleCells[0]) this.visibleCells[0].alpha = NON_PAYLINE_DIM_ALPHA;
    if (this.visibleCells[2]) this.visibleCells[2].alpha = NON_PAYLINE_DIM_ALPHA;
  }

  stopWinEffect(): void {
    this.stopWinAnimation();
    this.visibleCells.forEach((cell) => {
      cell.alpha = 1;
      const sprite = cell.children[0] as (Sprite & { baseScale: number }) | undefined;
      if (sprite) {
        sprite.visible = true;
        sprite.scale.set(sprite.baseScale);
        sprite.rotation = 0;
        sprite.tint = 0xffffff;
      }
    });
  }

  /** The symbol currently showing on the payline (middle cell), if any. */
  get paylineSymbol(): FruitySymbol | null {
    return (this.visibleCells[1]?.label as FruitySymbol | undefined) ?? null;
  }

  destroy(): void {
    this.stopWinEffect();
    this.pendingTimeouts.forEach((id) => window.clearTimeout(id));
    this.pendingFrames.forEach((cancel) => cancel());
    this.container.destroy({ children: true });
    if (this.rainbowGlowTexture) {
      this.rainbowGlowTexture.destroy(true);
      this.rainbowGlowTexture = null;
    }
    if (this.sparkleTexture) {
      this.sparkleTexture.destroy(true);
      this.sparkleTexture = null;
    }
  }
}
