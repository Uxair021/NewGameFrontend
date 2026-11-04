import { Container, Graphics } from "pixi.js";

const BURST_MS = 380; // spray outward from the catch
const HOLD_MS = 120; // brief hang in the air before heading home
const FLY_MS = 700; // travel to the credits box
const RADIUS = 18;

/**
 * One gold coin from a catch: it sprays out of the creature, hangs for a beat, then arcs into
 * the credits box (`target`, in canvas px) and disappears there. `delayMs` staggers a group of
 * coins so they stream in one after another instead of arriving as a single blob. The coin
 * "spins" by squashing its width on a sine wave. Driven like HitEffect: update(deltaMS) each
 * tick, removed once isFinished(); `landed` flips true on the frame it arrives.
 */
export class FlyingCoin extends Container {
  private elapsed: number;
  private coin: Graphics;
  private startX: number;
  private startY: number;
  private burstX: number;
  private burstY: number;
  private spinOffset = Math.random() * Math.PI * 2;
  landed = false;

  constructor(x: number, y: number, private target: { x: number; y: number }, delayMs: number) {
    super();
    this.startX = x;
    this.startY = y;
    this.x = x;
    this.y = y;
    this.elapsed = -delayMs;

    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 90;
    this.burstX = x + Math.cos(angle) * distance;
    this.burstY = y + Math.sin(angle) * distance - 40;

    this.coin = new Graphics()
      .circle(0, 0, RADIUS)
      .fill(0xffc928)
      .stroke({ color: 0xa8660a, width: 3 })
      .circle(0, 0, RADIUS * 0.62)
      .stroke({ color: 0xfff0a0, width: 2.5 })
      .circle(-RADIUS * 0.35, -RADIUS * 0.4, RADIUS * 0.22)
      .fill({ color: 0xffffff, alpha: 0.7 });
    this.addChild(this.coin);
    this.visible = delayMs <= 0;
  }

  update(deltaMS: number): void {
    this.elapsed += deltaMS;
    if (this.elapsed < 0) return;
    this.visible = true;

    this.coin.scale.x = Math.abs(Math.cos(this.elapsed / 90 + this.spinOffset)) * 0.8 + 0.2;

    if (this.elapsed < BURST_MS) {
      const t = easeOutCubic(this.elapsed / BURST_MS);
      this.x = this.startX + (this.burstX - this.startX) * t;
      this.y = this.startY + (this.burstY - this.startY) * t;
      this.scale.set(0.5 + t * 0.6);
      return;
    }

    const flyElapsed = this.elapsed - BURST_MS - HOLD_MS;
    if (flyElapsed < 0) return;

    const t = Math.min(1, flyElapsed / FLY_MS);
    const eased = easeInCubic(t);
    // Quadratic curve with the control point above the midpoint, so coins arc rather than slide.
    const controlX = (this.burstX + this.target.x) / 2;
    const controlY = Math.min(this.burstY, this.target.y) - 220;
    const inv = 1 - eased;
    this.x = inv * inv * this.burstX + 2 * inv * eased * controlX + eased * eased * this.target.x;
    this.y = inv * inv * this.burstY + 2 * inv * eased * controlY + eased * eased * this.target.y;
    this.scale.set(1.1 - eased * 0.5);

    if (t >= 1) this.landed = true;
  }

  isFinished(): boolean {
    return this.landed;
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}
