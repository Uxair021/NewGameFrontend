import { Container, Graphics } from "pixi.js";

/** Radius (px, before any scale) the reticle is drawn at — FishGameScene scales the whole
 * indicator by `entry.hitRadius / RADIUS` so it roughly matches whichever creature it's shown
 * over, big shark or small fish alike. */
export const RADIUS = 46;

const ROTATE_SPEED = 1.4; // rad/sec — slow "scanning" spin so it reads as active, not static
const TICK_LENGTH = 14;
const TICK_GAP = 8;
const COLOR = 0xff3b30;

/**
 * A rotating "locked on" reticle shown over whichever creature the auto-target feature is
 * currently tracking — auto-picked (nearest to the gun) by default, or whichever one the player
 * clicked on instead (see FishGameScene's lockedTarget). Hidden whenever auto-target is off or
 * nothing is currently locked. Pure Graphics like HitEffect, driven the same way (update(deltaMS)
 * each tick), just persistent instead of a one-shot burst.
 */
export class LockIndicator extends Container {
  private ring: Graphics;

  constructor() {
    super();
    this.ring = new Graphics();
    this.addChild(this.ring);
    this.redraw();
    this.visible = false;
  }

  private redraw(): void {
    this.ring.clear();
    this.ring.circle(0, 0, RADIUS);
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI / 2) * i + Math.PI / 4;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const innerR = RADIUS + TICK_GAP;
      const outerR = innerR + TICK_LENGTH;
      this.ring.moveTo(dx * innerR, dy * innerR).lineTo(dx * outerR, dy * outerR);
    }
    this.ring.stroke({ color: COLOR, width: 5, alpha: 0.95 });
    this.ring.moveTo(-10, 0).lineTo(10, 0).moveTo(0, -10).lineTo(0, 10).stroke({ color: COLOR, width: 3, alpha: 0.85 });
  }

  update(deltaMS: number): void {
    this.ring.rotation += (ROTATE_SPEED * deltaMS) / 1000;
  }
}
