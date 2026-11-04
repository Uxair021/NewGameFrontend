import { Container, Sprite, Texture } from "pixi.js";
import type { AimDirection } from "./Gun";

const BULLET_SPEED = 1500; // px/sec
/** A bullet that never hits anything is removed after this many wall bounces or this long,
 * whichever comes first — its bet is released, so it costs the player nothing. */
const MAX_BOUNCES = 8;
const MAX_LIFETIME_MS = 8000;

/**
 * A single fired shot — travels in a straight line from where the gun fired it, in the
 * direction the gun was aimed at that instant, and bounces off all four screen edges (angle in
 * = angle out) until it hits something or runs out of bounces. bullet.png is drawn the same
 * "points up" way as gun.png (orb at top, trail at bottom), so it uses the same rotation formula
 * as Gun.aimAt.
 */
export class Bullet extends Container {
  private vx: number;
  private vy: number;
  private bounces = 0;
  private age = 0;
  /** The bet this shot was fired at — charged by the server only if/when the bullet hits. */
  readonly bet: number;

  constructor(texture: Texture, x: number, y: number, direction: AimDirection, bet: number, scale = 0.05) {
    super();
    this.bet = bet;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    this.addChild(sprite);

    this.scale.set(scale);
    this.x = x;
    this.y = y;
    this.vx = direction.x * BULLET_SPEED;
    this.vy = direction.y * BULLET_SPEED;
    this.faceVelocity();
  }

  /** Re-aims the bullet straight at (x, y) — called every tick for bullets fired while locked on,
   * so they follow the locked creature instead of flying to where it used to be. The bullet is
   * several times faster than any creature, so re-aiming every frame always catches it. */
  steerToward(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    this.vx = (dx / len) * BULLET_SPEED;
    this.vy = (dy / len) * BULLET_SPEED;
    this.faceVelocity();
  }

  update(deltaMS: number, bounds: { width: number; height: number }): void {
    const dt = deltaMS / 1000;
    this.age += deltaMS;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Reflect off whichever edge was crossed, mirroring the overshoot back inside so the bullet
    // never visibly pokes past the edge.
    let bounced = false;
    if (this.x < 0 || this.x > bounds.width) {
      this.x = this.x < 0 ? -this.x : 2 * bounds.width - this.x;
      this.vx = -this.vx;
      bounced = true;
    }
    if (this.y < 0 || this.y > bounds.height) {
      this.y = this.y < 0 ? -this.y : 2 * bounds.height - this.y;
      this.vy = -this.vy;
      bounced = true;
    }
    if (bounced) {
      this.bounces += 1;
      this.faceVelocity();
    }
  }

  isExpired(): boolean {
    return this.bounces > MAX_BOUNCES || this.age > MAX_LIFETIME_MS;
  }

  private faceVelocity(): void {
    this.rotation = Math.atan2(this.vx, -this.vy);
  }
}
