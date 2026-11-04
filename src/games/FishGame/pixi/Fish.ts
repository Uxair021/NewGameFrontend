import { BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";

export interface FishBounds {
  width: number;
  height: number;
}

export interface FishOptions {
  scale?: number;
  speed?: number;
  fps?: number;
  /** false if the source frames are drawn facing left (e.g. fish2's swordfish) instead of the
   * usual right. Baked once into the inner sprite at construction, so the rest of the class can
   * always treat "angle 0" as pointing along the container's own +x. Defaults to true. */
  facesRight?: boolean;
  /** "pingpong" (default) steps back-and-forth (0..N..0) — right for a short hand-drawn beat
   * cycle like GoldenFish's 9 frames, which reads as a tail wag either direction. "forward"
   * loops straight 0..N..0..N — right for a long, smoothly-captured sequence (e.g. a 52-frame
   * turtle swim loop) where frame N is meant to flow back into frame 0. */
  loop?: "pingpong" | "forward";
  /** How fast (radians/sec) this fish can turn. If you don't pass this, it's derived from
   * `turnRadius` and this fish's own speed instead (see turnRadius) — that's almost always what
   * you want, since a fixed turnRate produces a different-sized arc for every different speed.
   * Only set this directly if you specifically want to bypass the radius clamp. */
  turnRate?: number;
  /** The physical radius (px) of the circular arc this fish turns through — this is "the
   * distance between where it started turning and where it swings out to" the arc traces.
   * Randomized per instance within [MIN_TURN_RADIUS, MAX_TURN_RADIUS] by default so turns are
   * never so tight the fish looks like it's spinning near one spot, nor so wide it barely
   * curves. turnRate is computed from this and the fish's speed (turnRate = speed / radius), so
   * the arc size stays consistent across species even though their speeds vary a lot. */
  turnRadius?: number;
  /** Degrees the source art's own nose is drawn away from pointing along +x — same atan2/screen
   * convention as everywhere else in this file (negative = tilted up, positive = tilted down).
   * E.g. fish6 is drawn nose-up-and-right at ~40°, so that's artAngleDeg: -40. Baked into the
   * inner sprite once at construction so the rest of the class can keep assuming "nose at local
   * +x" like every other species. Defaults to 0 (art already drawn pointing right). */
  artAngleDeg?: number;
  /** When true, this fish never rotates past vertical — instead of the default full 360°
   * rotation (which looks upside-down for about half the compass, when heading points into the
   * left half-plane), it mirrors horizontally and rotates by `heading - π` for those headings,
   * which maps them onto the safe -90°..+90° band. Off by default (every other species keeps
   * the plain full-rotation look), turn on per-species for ones where upside-down reads badly —
   * e.g. WhiteTiger and shark, both large and prominent enough that it's very noticeable. */
  preventUpsideDown?: boolean;
  /** When true, this fish only ever moves left/right along a fixed y — no arcing turns, no
   * rotation at all. Heading snaps instantly between exactly-right and exactly-left instead of
   * sweeping through the turnRate-clamped arc every other species uses, and it only enters/exits
   * from the left/right edges (never top/bottom). Off by default. */
  xAxisOnly?: boolean;
  /** Hex color (e.g. 0xff8c00) for a soft blurred glow rendered behind the sprite, tinted to
   * match the creature's own color — a "box shadow" of sorts. Undefined (default) means no
   * glow. Shares the same texture/frame and transform as the main sprite, just tinted, scaled up
   * slightly, and blurred, so it always sits directly behind it. */
  glowColor?: number;
  /** Chance each new wander target is off screen instead of inside it — see EXIT_PROBABILITY,
   * which is the default. Higher = passes through and leaves sooner (used for rare visitors). */
  exitProbability?: number;
}

const MARGIN = 140;
const ARRIVE_RADIUS = 60;
// The turning arc's radius (px) is randomized per fish within this range — never tight enough to
// look like it's spinning near one spot, never wide enough to barely curve. See turnRadius above.
const MIN_TURN_RADIUS = 200;
const MAX_TURN_RADIUS = 400;
const EXIT_PROBABILITY = 0.45; // chance a freshly-picked target sends the fish off-screen instead of to an interior point
const EXIT_OVERSHOOT_MIN = 250; // how far past the edge an exit target sits, so the fish fully clears the screen before re-entering
const EXIT_OVERSHOOT_MAX = 450;
const OFFSCREEN_RESPAWN_MARGIN = 400; // how far past the edge counts as "gone" — triggers re-entry from a (possibly different) random edge
const ENTRY_SPAWN_MARGIN = 180; // how far outside the edge a re-entering fish appears
const GLOW_SCALE = 1.01; // how much bigger than the sprite itself the glow is drawn, so it peeks out as a halo
const GLOW_BLUR_STRENGTH = 15;
const HIT_FLASH_MS = 160; // how long a creature stays tinted red after a bullet hits it
const HIT_FLASH_TINT = 0xff3b3b;
const FROZEN_TINT = 0x9fdcff; // icy blue while a freeze is active
// Death animation: a small upward hop, then it tumbles and falls under gravity while fading out.
const DEATH_DURATION_MS = 1300;
const DEATH_HOP_SPEED = 260; // px/sec upward at the moment it's caught
const DEATH_GRAVITY = 1400; // px/sec² pulling it down
const DEATH_DRIFT_MAX = 120; // px/sec sideways drift, random direction
const DEATH_SPIN_MIN = 5; // rad/sec
const DEATH_SPIN_MAX = 9;
const DEATH_ANIM_SPEEDUP = 2; // its own swim animation plays this much faster, like it's thrashing

/**
 * Goldfish (and every other species) driven by real vehicle-style steering: each fish holds an
 * actual movement heading (`angle`) and turns it toward the target at a limited angular rate,
 * then moves forward along whatever that heading currently is. Turning at a constant rate while
 * moving at constant speed traces a real circular arc — sweeping through 0°..90° to head
 * "upward", easing back around on a curve to reverse, etc. — instead of the fish instantly
 * re-aiming itself at the target in a straight line every frame (which is what the previous
 * version did; the small tilt/flip it layered on top was purely cosmetic and didn't actually
 * match the fish's real path).
 *
 * By default this rotates through the full 360° — heading straight at the target, however that
 * looks at any given angle, no mirroring. A side-view sprite technically looks upside-down for
 * about half of that circle (headings in the left half-plane), which reads fine for most of the
 * small fish here but is distracting on bigger/more prominent species — see
 * `preventUpsideDown`, which mirrors instead of rotating past vertical for those.
 *
 * Targets aren't always interior points, either: pickNewTarget() sometimes (EXIT_PROBABILITY)
 * aims well past a random edge instead, so the fish actually swims off-screen rather than always
 * curving back before it gets there. Once it's fully cleared the visible area, update() calls
 * enterFromRandomEdge() to pop it back in from a fresh random edge (not necessarily the one it
 * left through) and send it back across — random coming and going through all four sides,
 * instead of a fish that's confined to the screen forever just turning in place.
 */
export class Fish extends Container {
  private sprite: Sprite;
  private glowSprite: Sprite | null = null;
  private frameTime: number;
  private fps: number;
  private loopMode: "pingpong" | "forward";

  private swimSpeed: number;
  private turnRate: number;
  private heading: number; // actual current movement heading — atan2 convention, screen space (+y down)
  private targetX = 0;
  private targetY = 0;
  private baseScale: number;
  private preventUpsideDown: boolean;
  private xAxisOnly: boolean;
  private hitFlashRemaining = 0;
  private frozen = false;
  private exited = false;
  private exitProbability: number;
  private dying: { elapsed: number; vx: number; vy: number; spin: number } | null = null;

  constructor(private frames: Texture[], private bounds: FishBounds, options: FishOptions = {}) {
    super();

    const scale = options.scale ?? 1;
    this.baseScale = scale;
    this.preventUpsideDown = options.preventUpsideDown ?? false;
    this.xAxisOnly = options.xAxisOnly ?? false;
    this.exitProbability = options.exitProbability ?? EXIT_PROBABILITY;
    this.swimSpeed = options.speed ?? 60 + Math.random() * 40;
    this.fps = options.fps ?? 7 + Math.random() * 2;
    this.frameTime = Math.random() * 10; // desync fish so they don't all beat in unison
    this.loopMode = options.loop ?? "pingpong";
    const turnRadius = options.turnRadius ?? MIN_TURN_RADIUS + Math.random() * (MAX_TURN_RADIUS - MIN_TURN_RADIUS);
    this.turnRate = options.turnRate ?? this.swimSpeed / turnRadius;

    if (options.glowColor !== undefined) {
      this.glowSprite = new Sprite(frames[0]);
      this.glowSprite.anchor.set(0.5);
      this.glowSprite.tint = options.glowColor;
      this.glowSprite.scale.x = ((options.facesRight ?? true) ? 1 : -1) * GLOW_SCALE;
      this.glowSprite.scale.y = GLOW_SCALE;
      this.glowSprite.rotation = -((options.artAngleDeg ?? 0) * Math.PI) / 180;
      this.glowSprite.filters = [new BlurFilter({ strength: GLOW_BLUR_STRENGTH })];

      // Clip the glow to the source frame's own canvas — the scale-up + blur above are what
      // make it peek out past the character's silhouette (the actual "glow" look), but it should
      // never bleed past the edge of the image it was cut from. A plain rect the size of the
      // untouched frame, kept unrotated/unscaled itself, does that regardless of how big or
      // blurred glowSprite gets.
      const glowMask = new Graphics()
        .rect(-frames[0].width / 2, -frames[0].height / 2, frames[0].width, frames[0].height)
        .fill(0xffffff);
      this.addChild(glowMask);
      this.glowSprite.mask = glowMask;

      this.addChild(this.glowSprite);
    }

    this.sprite = new Sprite(frames[0]);
    this.sprite.anchor.set(0.5);
    this.sprite.scale.x = (options.facesRight ?? true) ? 1 : -1;
    this.sprite.rotation = -((options.artAngleDeg ?? 0) * Math.PI) / 180;
    this.addChild(this.sprite);

    this.scale.set(scale);
    this.pickNewTarget(true); // interior — don't have it try to exit before it's ever appeared
    this.x = Math.random() * bounds.width;
    this.y = Math.random() * bounds.height;
    this.heading = Math.atan2(this.targetY - this.y, this.targetX - this.x);
  }

  /** Most picks land inside the visible area (normal wandering); the rest deliberately aim well
   * past one random edge, so the fish swims off-screen instead of always curving back before it
   * gets there. `forceInterior` is used right after re-entering, so a fish doesn't immediately
   * turn around and leave again the instant it comes back on screen. */
  private pickNewTarget(forceInterior = false): void {
    if (this.xAxisOnly) {
      if (!forceInterior && Math.random() < this.exitProbability) {
        const overshoot = EXIT_OVERSHOOT_MIN + Math.random() * (EXIT_OVERSHOOT_MAX - EXIT_OVERSHOOT_MIN);
        this.targetX = Math.random() < 0.5 ? -overshoot : this.bounds.width + overshoot;
      } else {
        this.targetX = MARGIN + Math.random() * Math.max(1, this.bounds.width - MARGIN * 2);
      }
      return;
    }

    if (!forceInterior && Math.random() < this.exitProbability) {
      const side = Math.floor(Math.random() * 4); // 0=left, 1=right, 2=top, 3=bottom
      const overshoot = EXIT_OVERSHOOT_MIN + Math.random() * (EXIT_OVERSHOOT_MAX - EXIT_OVERSHOOT_MIN);
      switch (side) {
        case 0:
          this.targetX = -overshoot;
          this.targetY = Math.random() * this.bounds.height;
          break;
        case 1:
          this.targetX = this.bounds.width + overshoot;
          this.targetY = Math.random() * this.bounds.height;
          break;
        case 2:
          this.targetX = Math.random() * this.bounds.width;
          this.targetY = -overshoot;
          break;
        default:
          this.targetX = Math.random() * this.bounds.width;
          this.targetY = this.bounds.height + overshoot;
          break;
      }
      return;
    }

    this.targetX = MARGIN + Math.random() * Math.max(1, this.bounds.width - MARGIN * 2);
    this.targetY = MARGIN + Math.random() * Math.max(1, this.bounds.height - MARGIN * 2);
  }

  /** True once the fish has swum fully off screen. It then stops moving; FishGameScene removes it
   * and brings a fresh one of the same species back in later (see FishGameScene.scheduleRespawn),
   * so a creature that left is actually gone for a while instead of turning straight back. */
  hasExited(): boolean {
    return this.exited;
  }

  /** Places the fish just outside a random edge, aimed at an interior point, so it swims in from
   * off screen — used for every fish spawned after the first population. */
  enterFromRandomEdge(): void {
    if (this.xAxisOnly) {
      this.x = Math.random() < 0.5 ? -ENTRY_SPAWN_MARGIN : this.bounds.width + ENTRY_SPAWN_MARGIN;
      this.pickNewTarget(true);
      this.heading = this.targetX >= this.x ? 0 : Math.PI;
      return;
    }

    const side = Math.floor(Math.random() * 4);
    switch (side) {
      case 0:
        this.x = -ENTRY_SPAWN_MARGIN;
        this.y = Math.random() * this.bounds.height;
        break;
      case 1:
        this.x = this.bounds.width + ENTRY_SPAWN_MARGIN;
        this.y = Math.random() * this.bounds.height;
        break;
      case 2:
        this.x = Math.random() * this.bounds.width;
        this.y = -ENTRY_SPAWN_MARGIN;
        break;
      default:
        this.x = Math.random() * this.bounds.width;
        this.y = this.bounds.height + ENTRY_SPAWN_MARGIN;
        break;
    }
    this.pickNewTarget(true);
    this.heading = Math.atan2(this.targetY - this.y, this.targetX - this.x);
  }

  /** Tints the creature red for a moment so it's obvious the bullet landed on it. */
  flashHit(): void {
    this.hitFlashRemaining = HIT_FLASH_MS;
    this.sprite.tint = HIT_FLASH_TINT;
  }

  /** While frozen the creature stays exactly where it is (no swimming, no turning) but its own
   * animation frames keep playing, and it's tinted icy blue. */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    if (this.hitFlashRemaining <= 0 && !this.dying) this.sprite.tint = this.baseTint();
  }

  private baseTint(): number {
    return this.frozen ? FROZEN_TINT : 0xffffff;
  }

  /** Switches from swimming to the death animation — update() then drives the hop, spin and
   * fall until isDeathFinished(). */
  die(): void {
    if (this.dying) return;
    this.dying = {
      elapsed: 0,
      vx: (Math.random() * 2 - 1) * DEATH_DRIFT_MAX,
      vy: -DEATH_HOP_SPEED,
      spin: (DEATH_SPIN_MIN + Math.random() * (DEATH_SPIN_MAX - DEATH_SPIN_MIN)) * (Math.random() < 0.5 ? -1 : 1),
    };
    this.hitFlashRemaining = 0;
    this.sprite.tint = HIT_FLASH_TINT;
  }

  isDeathFinished(): boolean {
    return this.dying !== null && (this.dying.elapsed >= DEATH_DURATION_MS || this.y > this.bounds.height + 300);
  }

  private updateDeath(deltaMS: number): void {
    const d = this.dying!;
    const dt = deltaMS / 1000;
    d.elapsed += deltaMS;
    const t = Math.min(1, d.elapsed / DEATH_DURATION_MS);

    this.frameTime += dt * DEATH_ANIM_SPEEDUP;
    const frameIndex = Math.floor(this.frameTime * this.fps) % this.frames.length;
    this.sprite.texture = this.frames[frameIndex];
    if (this.glowSprite) this.glowSprite.texture = this.frames[frameIndex];

    d.vy += DEATH_GRAVITY * dt;
    this.x += d.vx * dt;
    this.y += d.vy * dt;
    this.rotation += d.spin * dt;

    // Red fades back to its own colors in the first moment, then the whole thing fades out.
    const redFade = Math.min(1, t * 4);
    this.sprite.tint = lerpColor(HIT_FLASH_TINT, 0xffffff, redFade);
    this.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
    const shrink = 1 - t * 0.25;
    this.scale.set(Math.sign(this.scale.x || 1) * this.baseScale * shrink, this.baseScale * shrink);
  }

  /** On-screen right now (not off past an edge waiting to re-enter). */
  isOnScreen(): boolean {
    return this.x >= 0 && this.x <= this.bounds.width && this.y >= 0 && this.y <= this.bounds.height;
  }

  /** Advance one frame. `deltaMS` is the elapsed time since the last call, in milliseconds. */
  update(deltaMS: number): void {
    if (this.dying) {
      this.updateDeath(deltaMS);
      return;
    }
    const dt = deltaMS / 1000;

    if (this.hitFlashRemaining > 0) {
      this.hitFlashRemaining -= deltaMS;
      if (this.hitFlashRemaining <= 0) this.sprite.tint = this.baseTint();
    }

    this.frameTime += dt;
    const frameCount = this.frames.length;
    let frameIndex: number;
    if (this.loopMode === "forward") {
      frameIndex = Math.floor(this.frameTime * this.fps) % frameCount;
    } else {
      const cycleLen = (frameCount - 1) * 2 || 1;
      const t = (this.frameTime * this.fps) % cycleLen;
      frameIndex = t < frameCount ? Math.floor(t) : cycleLen - Math.floor(t);
    }
    this.sprite.texture = this.frames[frameIndex];
    if (this.glowSprite) this.glowSprite.texture = this.frames[frameIndex];

    if (this.frozen) return;

    const dx = this.targetX - this.x;
    const dy = this.xAxisOnly ? 0 : this.targetY - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < ARRIVE_RADIUS) this.pickNewTarget();

    if (this.xAxisOnly) {
      // No arc, no rotation — just snap to facing whichever way the target is and walk straight
      // there along a fixed y.
      this.heading = dx >= 0 ? 0 : Math.PI;
      this.x += Math.cos(this.heading) * this.swimSpeed * dt;
    } else {
      // Turn the heading toward the target by at most turnRate*dt radians this frame, then move
      // forward along that heading — the clamp (not a straight jump to the target) is what
      // produces a real constant-curvature arc through every turn.
      const desiredAngle = Math.atan2(dy, dx);
      let diff = desiredAngle - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // normalize to [-pi, pi]
      const maxStep = this.turnRate * dt;
      this.heading += clamp(diff, -maxStep, maxStep);

      this.x += Math.cos(this.heading) * this.swimSpeed * dt;
      this.y += Math.sin(this.heading) * this.swimSpeed * dt;
    }

    // A fish that headed toward an off-screen exit target eventually clears the visible area —
    // flag it as exited so the scene can retire it (see hasExited).
    const wentOffscreen =
      this.x < -OFFSCREEN_RESPAWN_MARGIN ||
      this.x > this.bounds.width + OFFSCREEN_RESPAWN_MARGIN ||
      this.y < -OFFSCREEN_RESPAWN_MARGIN ||
      this.y > this.bounds.height + OFFSCREEN_RESPAWN_MARGIN;
    if (wentOffscreen) this.exited = true;

    if (this.xAxisOnly) {
      this.rotation = 0;
      this.scale.x = this.heading === 0 ? this.baseScale : -this.baseScale;
    } else if (this.preventUpsideDown && Math.cos(this.heading) < 0) {
      // Heading points into the left half-plane — rotating straight to it would pass through
      // vertical and render upside-down, so mirror horizontally instead and rotate by the
      // equivalent angle on the safe right-half-plane side.
      this.scale.x = -this.baseScale;
      this.rotation = this.heading - Math.PI;
    } else {
      this.scale.x = this.baseScale;
      this.rotation = this.heading;
    }
  }
}

function lerpColor(from: number, to: number, t: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
