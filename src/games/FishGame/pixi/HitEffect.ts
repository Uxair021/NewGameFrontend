import { Container, Graphics } from "pixi.js";

const LIFETIME_MS = 420;
const PARTICLE_COUNT = 9;
const RING_MAX_RADIUS = 60;
const PARTICLE_SPEED = 240; // px/sec outward, before scale

interface Particle {
  angle: number;
  speed: number;
  x: number;
  y: number;
}

/**
 * A short-lived "splash" burst spawned wherever a bullet catches a fish/turtle — an expanding
 * ring plus a handful of droplets flying outward, both fading out over LIFETIME_MS. Pure
 * Graphics (redrawn each frame; cheap since it's tiny and short-lived), no art asset needed.
 * Driven the same way as Fish/Bullet: FishGameScene calls update(deltaMS) every tick and removes
 * it once isFinished() is true.
 */
export class HitEffect extends Container {
  private elapsed = 0;
  private graphics: Graphics;
  private particles: Particle[];

  constructor(x: number, y: number, scale = 1) {
    super();
    this.x = x;
    this.y = y;
    this.scale.set(scale);

    this.graphics = new Graphics();
    this.addChild(this.graphics);

    this.particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: PARTICLE_SPEED * (0.6 + Math.random() * 0.7),
      x: 0,
      y: 0,
    }));
  }

  update(deltaMS: number): void {
    this.elapsed += deltaMS;
    const t = Math.min(1, this.elapsed / LIFETIME_MS);
    const dt = deltaMS / 1000;
    const fadeAlpha = 1 - t;

    for (const p of this.particles) {
      p.x += Math.cos(p.angle) * p.speed * dt;
      p.y += Math.sin(p.angle) * p.speed * dt;
    }

    this.graphics.clear();

    const ringRadius = RING_MAX_RADIUS * easeOutQuad(t);
    this.graphics.circle(0, 0, ringRadius).stroke({ color: 0xe3fbff, width: 6, alpha: fadeAlpha });

    const particleRadius = 7 * (1 - t * 0.5);
    for (const p of this.particles) {
      this.graphics.circle(p.x, p.y, particleRadius).fill({ color: 0x8be9ff, alpha: fadeAlpha });
    }
  }

  isFinished(): boolean {
    return this.elapsed >= LIFETIME_MS;
  }
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
