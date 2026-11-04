import type { AnimatedGIF } from "@pixi/gif";
import { Container, Sprite, Texture } from "pixi.js";

export interface AimDirection {
  x: number;
  y: number;
}

const MIN_UPWARD = 40; // px — how far "up" the aim target is forced to be at minimum, so the
// gun can never swing down and point back into its own mount.
const HEAD_FPS = 30; // how fast the turret head's own 42-frame sprite-sheet animation plays

// Tune the fixed base's own size/position here, independent of the head and of GUN_SCALE —
// these apply only to `base`, never to `headSprite`.
const BASE_SCALE = 1.5; // multiplier on top of the overall gun scale (GUN_SCALE) — >1 bigger, <1 smaller
const BASE_Y_OFFSET = 55; // px — negative moves the base up, positive moves it down, independent of the head

// Same, but for the rotating head — these apply only to `headSprite`, never to `base`.
const HEAD_SCALE = 1.1; // multiplier on top of the overall gun scale (GUN_SCALE) — >1 bigger, <1 smaller
const HEAD_Y_OFFSET = -80; // px — negative moves the head up, positive moves it down, independent of the base
// The "radius" — how far out from the head's own pivot the muzzle/bullet-spawn point sits, so
// bullets visibly come from the tip of the head as it swings around aiming instead of its
// pivot. 1 = the head's own texture height (its full length from pivot to tip); raise it to
// spawn bullets further out past the visible art, lower it to spawn them closer to the pivot.
const HEAD_MUZZLE_RADIUS_SCALE = 1;

/**
 * The cannon mounted at the bottom of the pond — two separate layers now instead of one static
 * sprite. `base` (an animated GIF) is the fixed mount: it never rotates, just plays its own
 * looping animation in place. `headFrames` is the turret head sitting on top of it: drawn
 * pointing straight up with its "muzzle" at the top edge (same convention the old single-sprite
 * gun used), so anchoring at (0.5, 1) makes it pivot naturally around its own base as it swivels
 * to face the aim direction — but only the head rotates, the base underneath stays put. The
 * head also continuously cycles through its own frames (a subtle idle animation baked into the
 * art, not tied to firing) via update(), same as every Fish.
 */
export class Gun extends Container {
  private base: AnimatedGIF;
  private headFrames: Texture[];
  private headSprite: Sprite;
  private headTime = 0;
  private barrelLength: number;

  constructor(base: AnimatedGIF, headFrames: Texture[], scale = 1) {
    super();

    this.base = base;
    // The gif's own 500x500 canvas has a lot of dead transparent space above the actual art (the
    // drawn content only fills roughly the bottom half) — anchoring at the canvas's true center
    // (0.5, 0.5) centers on that empty space instead of the art, which pushed the visible base
    // mostly below the gun's mount point (already near the bottom edge of the canvas) and off
    // screen. Bottom-anchoring instead — same convention as headSprite below — puts the base's
    // own bottom edge at the mount point, which is where the visible art actually sits.
    this.base.anchor.set(0.5, 1);
    this.base.scale.set(BASE_SCALE);
    this.base.y = BASE_Y_OFFSET;
    this.addChild(this.base);

    this.headFrames = headFrames;
    this.headSprite = new Sprite(headFrames[0]);
    this.headSprite.anchor.set(0.5, 1);
    this.headSprite.scale.set(HEAD_SCALE);
    this.headSprite.y = HEAD_Y_OFFSET;
    this.addChild(this.headSprite);

    this.scale.set(scale);
    // Includes HEAD_SCALE since the radius is measured from the head's own (independently
    // scaled) size, not the overall gun scale — that's applied separately in getMuzzlePosition.
    this.barrelLength = headFrames[0].height * HEAD_SCALE * HEAD_MUZZLE_RADIUS_SCALE;
  }

  /** Advances the turret head's own idle animation. Independent of aiming/firing — call every
   * tick, same as Fish.update(). */
  update(deltaMS: number): void {
    this.headTime += deltaMS / 1000;
    const frameIndex = Math.floor(this.headTime * HEAD_FPS) % this.headFrames.length;
    this.headSprite.texture = this.headFrames[frameIndex];
  }

  /** Rotates the head (not the fixed base) to face (targetX, targetY) in the same coordinate
   * space as this container's position, and returns the clamped, normalized aim direction (also
   * usable to spawn a bullet along the same line). */
  aimAt(targetX: number, targetY: number): AimDirection {
    const dx = targetX - this.x;
    let dy = targetY - this.y;
    if (dy > -MIN_UPWARD) dy = -MIN_UPWARD;
    const len = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / len, y: dy / len };
    this.headSprite.rotation = Math.atan2(dir.x, -dir.y);
    return dir;
  }

  /** World (parent-space) position of the muzzle tip, given the current aim direction. Measured
   * from the head's actual pivot (this.x/this.y shifted by HEAD_Y_OFFSET), not the gun's own
   * origin — otherwise this drifts out of sync every time HEAD_Y_OFFSET is retuned. */
  getMuzzlePosition(direction: AimDirection): { x: number; y: number } {
    const length = this.barrelLength * this.scale.y;
    const pivotX = this.x;
    const pivotY = this.y + HEAD_Y_OFFSET * this.scale.y;
    return { x: pivotX + direction.x * length, y: pivotY + direction.y * length };
  }
}
