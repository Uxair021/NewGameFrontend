import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";

/**
 * Free-spin fire: additive flame particles rising from emitters, plus optional sparks that drift
 * higher. PANEL_FIRE (red, clipped to the top counter panel) is the configuration SlotMachineScene
 * uses; it sits between the background and the reels, so the fire never covers a symbol.
 *
 * Self-contained: one generated soft-glow texture, a fixed pool of sprites (no per-frame
 * allocation), driven from the app's ticker only while it's burning or still dying out.
 */

interface Emitter {
  x: number;
  y: number;
  width: number;
  /** spawned per second */
  rate: number;
  /** how far up the flames reach (px) */
  height: number;
  /** start size (px) */
  size: number;
}

export interface FireConfig {
  emitters: Emitter[];
  /** sparks per second, rising from the first two emitters (0 = none) */
  sparkRate: number;
  poolSize: number;
  /** a flame's colour over its life, hot → cooling */
  colors: number[];
  /** clip the fire to this rectangle (x, y, w, h) */
  clip?: [number, number, number, number];
}

interface Particle {
  sprite: Sprite;
  alive: boolean;
  spark: boolean;
  age: number;
  life: number;
  vx: number;
  vy: number;
  size: number;
  sway: number;
  swaySpeed: number;
}

// Machine coordinates (1300×929), shifted by M onto the wider canvas (see SlotMachineScene).
// Kept local rather than imported, since SlotMachineScene imports this file.
const M = Math.round((218 * 929) / 1060); // = MACHINE_OFFSET_X

/** Inside the top panel of bg_freespin.webp (inner box x 250–1049, y 57–181), behind the free-spin
 * counter — a red fire: bright orange-red core → red → deep crimson. */
export const PANEL_FIRE: FireConfig = {
  emitters: [{ x: M + 250, y: 185, width: 799, rate: 110, height: 115, size: 80 }],
  sparkRate: 0,
  poolSize: 200,
  colors: [0xffb08a, 0xff4a1c, 0xe0140a, 0xa00008, 0x3a0004],
  clip: [M + 250, 57, 799, 124],
};

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

function flameColor(colors: number[], t: number): number {
  const scaled = Math.min(0.9999, Math.max(0, t)) * (colors.length - 1);
  const i = Math.floor(scaled);
  return lerpColor(colors[i], colors[i + 1], scaled - i);
}

function makeGlowTexture(): Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export class FireEffect {
  readonly view = new Container();
  private app: Application;
  private config: FireConfig;
  private texture = makeGlowTexture();
  private pool: Particle[] = [];
  private spawnDebt: number[];
  private sparkDebt = 0;
  private burning = false;
  private ticking = false;

  constructor(app: Application, config: FireConfig) {
    this.app = app;
    this.config = config;
    this.spawnDebt = config.emitters.map(() => 0);
    this.view.visible = false;
    if (config.clip) {
      const [x, y, w, h] = config.clip;
      const mask = new Graphics().rect(x, y, w, h).fill({ color: 0xffffff });
      this.view.addChild(mask);
      this.view.mask = mask;
    }
    for (let i = 0; i < config.poolSize; i++) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.visible = false;
      this.view.addChild(sprite);
      this.pool.push({ sprite, alive: false, spark: false, age: 0, life: 1, vx: 0, vy: 0, size: 1, sway: 0, swaySpeed: 0 });
    }
  }

  /** Start burning, or stop spawning and let the live flames die out. */
  setActive(active: boolean): void {
    this.burning = active;
    if (active) {
      this.view.visible = true;
      if (!this.ticking) {
        this.ticking = true;
        this.app.ticker.add(this.update, this);
      }
    }
  }

  private spawn(e: Emitter | null): void {
    const p = this.pool.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.age = 0;
    p.sway = Math.random() * Math.PI * 2;
    p.swaySpeed = 3 + Math.random() * 4;
    if (e) {
      p.spark = false;
      p.life = 0.6 + Math.random() * 0.6;
      p.vy = -(e.height / p.life) * (0.7 + Math.random() * 0.5);
      p.vx = (Math.random() - 0.5) * 30;
      p.size = e.size * (0.6 + Math.random() * 0.6);
      p.sprite.x = e.x + Math.random() * e.width;
      p.sprite.y = e.y + 10;
    } else {
      // a spark from one of the side panels, drifting high up
      const emitters = this.config.emitters;
      const side = emitters[Math.random() < 0.5 ? 0 : Math.min(1, emitters.length - 1)];
      p.spark = true;
      p.life = 1.6 + Math.random() * 1.4;
      p.vy = -(220 + Math.random() * 200);
      p.vx = (Math.random() - 0.5) * 60;
      p.size = 8 + Math.random() * 8;
      p.sprite.x = side.x + Math.random() * side.width;
      p.sprite.y = side.y - side.height * 0.4;
    }
    p.sprite.visible = true;
  }

  private update(): void {
    const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.05);

    if (this.burning) {
      this.config.emitters.forEach((e, i) => {
        this.spawnDebt[i] += e.rate * dt;
        while (this.spawnDebt[i] >= 1) {
          this.spawnDebt[i]--;
          this.spawn(e);
        }
      });
      this.sparkDebt += this.config.sparkRate * dt;
      while (this.sparkDebt >= 1) {
        this.sparkDebt--;
        this.spawn(null);
      }
    }

    let anyAlive = false;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      anyAlive = true;
      p.sway += p.swaySpeed * dt;
      p.sprite.x += (p.vx + Math.sin(p.sway) * (p.spark ? 40 : 25)) * dt;
      p.sprite.y += p.vy * dt;
      if (p.spark) {
        p.sprite.tint = flameColor(this.config.colors, 0.25 + t * 0.5);
        p.sprite.alpha = (1 - t) * (0.6 + Math.random() * 0.4);
        p.sprite.width = p.sprite.height = p.size;
      } else {
        // swell quickly, then taper as it rises; tall and narrow like a flame tongue
        const grow = t < 0.2 ? 0.6 + t * 2 : 1 - (t - 0.2) * 0.9;
        p.sprite.tint = flameColor(this.config.colors, t);
        p.sprite.alpha = Math.min(1, (1 - t) * 1.4) * 0.75;
        p.sprite.width = p.size * grow * 0.75;
        p.sprite.height = p.size * grow * 1.25;
      }
    }

    if (!this.burning && !anyAlive) {
      this.view.visible = false;
      this.ticking = false;
      this.app.ticker.remove(this.update, this);
    }
  }

  destroy(): void {
    if (this.ticking) this.app.ticker.remove(this.update, this);
    this.view.destroy({ children: true });
    this.texture.destroy(true);
  }
}
