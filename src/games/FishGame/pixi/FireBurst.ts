import { Container, Graphics } from "pixi.js";

const LIFETIME_MS = 380;
const FLAME_COUNT = 12;
const FLAME_SPEED = 260; // px/sec outward, before scale
const FLAME_COLORS = [0xfff3a0, 0xffc233, 0xff8a1f, 0xff4d12];

interface Flame {
  angle: number;
  speed: number;
  x: number;
  y: number;
  radius: number;
  color: number;
}

/**
 * The fiery impact spawned wherever a bullet hits a creature: a bright white-yellow flash at the
 * point of impact plus embers flying outward (drifting slightly upward like real flame) that
 * cool from yellow to red as they shrink and fade. Additive blending makes overlapping embers
 * glow. Driven like HitEffect: update(deltaMS) each tick, removed once isFinished().
 */
export class FireBurst extends Container {
  private elapsed = 0;
  private graphics: Graphics;
  private flames: Flame[];

  constructor(x: number, y: number, scale = 1) {
    super();
    this.x = x;
    this.y = y;
    this.scale.set(scale);

    this.graphics = new Graphics();
    this.graphics.blendMode = "add";
    this.addChild(this.graphics);

    this.flames = Array.from({ length: FLAME_COUNT }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: FLAME_SPEED * (0.4 + Math.random() * 0.8),
      x: 0,
      y: 0,
      radius: 9 + Math.random() * 9,
      color: FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)],
    }));
  }

  update(deltaMS: number): void {
    this.elapsed += deltaMS;
    const t = Math.min(1, this.elapsed / LIFETIME_MS);
    const dt = deltaMS / 1000;

    for (const f of this.flames) {
      f.x += Math.cos(f.angle) * f.speed * dt;
      f.y += Math.sin(f.angle) * f.speed * dt - 90 * dt; // flames rise
      f.speed *= 0.93;
    }

    this.graphics.clear();

    // Core flash: big and white-hot at first, gone by a third of the way through.
    const flashT = Math.min(1, t * 3);
    if (flashT < 1) {
      this.graphics.circle(0, 0, 38 * (0.6 + flashT * 0.6)).fill({ color: 0xffb347, alpha: 0.55 * (1 - flashT) });
      this.graphics.circle(0, 0, 20 * (0.6 + flashT * 0.4)).fill({ color: 0xffffe0, alpha: 0.9 * (1 - flashT) });
    }

    const alpha = 1 - t;
    for (const f of this.flames) {
      const color = t > 0.55 ? 0xff4d12 : f.color; // embers cool toward red as they die
      this.graphics.circle(f.x, f.y, f.radius * (1 - t * 0.7)).fill({ color, alpha });
    }
  }

  isFinished(): boolean {
    return this.elapsed >= LIFETIME_MS;
  }
}
