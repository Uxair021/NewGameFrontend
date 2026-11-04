import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";

/**
 * Win celebrations layered over the reels:
 *  - MultiplierStamp: a big "×3" / "×10" / … slammed over the reels when 10X / 3X wilds multiply
 *    a win.
 *  - CoinShower: gold coins pouring down over the machine on big wins.
 *
 * Like the rest of this game's animations they run on requestAnimationFrame and only change
 * sprites — the app's ticker draws them (Mega10XPayGame lifts its idle fps cap while one plays).
 * Cheap on GPU memory: one small generated coin texture shared by a fixed pool of sprites, and
 * one Text for the stamp.
 */

const STAMP_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 150,
  fill: 0xffd84a,
  stroke: { color: 0x6a1f00, width: 12, join: "round" },
  dropShadow: { color: 0xff7a00, blur: 18, distance: 0, alpha: 0.95, angle: 0 },
  padding: 24,
});

const STAMP_IN_MS = 280;
const STAMP_HOLD_MS = 900;
const STAMP_OUT_MS = 300;

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class MultiplierStamp {
  readonly view = new Container();
  private rafId: number | null = null;
  private text: Text | null = null;
  /** resolves the current play()'s promises */
  private finish: (() => void) | null = null;

  constructor(private centerX: number, private centerY: number) {}

  /** Slams `×multiplier` in, holds, fades out. `landed` resolves the moment the slam hits,
   * `done` once it's gone (or cut short by clear()). */
  play(multiplier: number): { landed: Promise<void>; done: Promise<void> } {
    this.clear();
    const text = new Text({ text: `×${multiplier}`, style: STAMP_STYLE });
    text.anchor.set(0.5);
    text.position.set(this.centerX, this.centerY);
    text.alpha = 0;
    this.view.addChild(text);
    this.text = text;

    let landedResolve!: () => void;
    let doneResolve!: () => void;
    const landed = new Promise<void>((r) => (landedResolve = r));
    const done = new Promise<void>((r) => (doneResolve = r));
    let hasLanded = false;

    const start = performance.now();
    const step = (now: number) => {
      const t = now - start;
      if (t < STAMP_IN_MS) {
        const k = t / STAMP_IN_MS;
        text.scale.set(2.6 - 1.6 * easeOutBack(k));
        text.alpha = Math.min(1, k * 1.6);
      } else if (t < STAMP_IN_MS + STAMP_HOLD_MS) {
        if (!hasLanded) {
          hasLanded = true;
          landedResolve();
        }
        const pulse = Math.sin(((t - STAMP_IN_MS) / 300) * Math.PI);
        text.scale.set(1 + 0.05 * Math.abs(pulse));
        text.alpha = 1;
      } else if (t < STAMP_IN_MS + STAMP_HOLD_MS + STAMP_OUT_MS) {
        const k = (t - STAMP_IN_MS - STAMP_HOLD_MS) / STAMP_OUT_MS;
        text.scale.set(1 + 0.25 * k);
        text.alpha = 1 - k;
      } else {
        this.clear(); // resolves both via finish
        return;
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.finish = () => {
      if (!hasLanded) landedResolve();
      doneResolve();
    };
    this.rafId = requestAnimationFrame(step);
    return { landed, done };
  }

  clear(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.text?.destroy();
    this.text = null;
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
  }
}

/* ------------------------------------------------------------------ */

const COIN_SIZE = 48;
const POOL_SIZE = 70;
const GRAVITY = 1500; // px/s²
const EMIT_MS = 1100;

interface Coin {
  sprite: Sprite;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  phase: number;
  size: number;
  bounced: boolean;
  fade: number;
}

/** One gold coin, drawn once and shared by every coin sprite. */
function makeCoinTexture(app: Application): Texture {
  const r = COIN_SIZE / 2;
  const g = new Graphics();
  g.circle(r, r, r - 1).fill({ color: 0xe0a100 });
  g.circle(r, r, r - 1).stroke({ color: 0x8a5200, width: 2.5 });
  g.circle(r, r, r - 7).fill({ color: 0xffcf3a });
  g.circle(r, r, r - 7).stroke({ color: 0xb97800, width: 2 });
  g.rect(r - 3, r - 11, 6, 22).fill({ color: 0xc98a00 });
  g.ellipse(r - 6, r - 9, 7, 4).fill({ color: 0xffffff, alpha: 0.55 });
  const texture = app.renderer.generateTexture({ target: g, resolution: 1 });
  g.destroy();
  return texture;
}

export class CoinShower {
  readonly view = new Container();
  private texture: Texture;
  private coins: Coin[] = [];
  private rafId: number | null = null;
  private resolveDone: (() => void) | null = null;

  constructor(app: Application, private width: number, private floorY: number) {
    this.texture = makeCoinTexture(app);
    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.view.addChild(sprite);
      this.coins.push({ sprite, alive: false, x: 0, y: 0, vx: 0, vy: 0, spin: 0, phase: 0, size: 1, bounced: false, fade: 1 });
    }
  }

  /** Pours `count` coins (capped at the pool) down over the machine; resolves once they're gone. */
  play(count: number): Promise<void> {
    this.stop();
    const total = Math.min(POOL_SIZE, Math.max(1, Math.round(count)));
    let emitted = 0;
    const start = performance.now();
    let last = start;

    return new Promise<void>((resolve) => {
      this.resolveDone = resolve;
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        // spread the spawns evenly over EMIT_MS
        const due = Math.min(total, Math.ceil(((now - start) / EMIT_MS) * total));
        while (emitted < due) {
          const coin = this.coins.find((c) => !c.alive);
          if (!coin) break;
          this.spawn(coin);
          emitted++;
        }

        let anyAlive = false;
        for (const c of this.coins) {
          if (!c.alive) continue;
          c.vy += GRAVITY * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.phase += c.spin * dt;
          if (!c.bounced && c.y >= this.floorY) {
            c.y = this.floorY;
            c.vy = -c.vy * (0.35 + Math.random() * 0.2);
            c.vx *= 0.7;
            c.bounced = true;
          }
          if (c.bounced) c.fade -= dt * 1.4;
          if (c.fade <= 0 || c.y > this.floorY + 80 || c.x < -60 || c.x > this.width + 60) {
            c.alive = false;
            c.sprite.visible = false;
            continue;
          }
          anyAlive = true;
          c.sprite.position.set(c.x, c.y);
          // a coin tumbling end over end: squash its width with the flip
          c.sprite.scale.set(c.size * Math.max(0.12, Math.abs(Math.cos(c.phase))), c.size);
          c.sprite.tint = Math.cos(c.phase) > 0 ? 0xffffff : 0xffe08a;
          c.sprite.alpha = Math.min(1, c.fade);
        }

        if (!anyAlive && emitted >= total) {
          this.stop();
          return;
        }
        this.rafId = requestAnimationFrame(step);
      };
      this.rafId = requestAnimationFrame(step);
    });
  }

  private spawn(c: Coin): void {
    c.alive = true;
    c.bounced = false;
    c.fade = 1;
    c.x = Math.random() * this.width;
    c.y = -COIN_SIZE - Math.random() * 60;
    c.vx = (Math.random() - 0.5) * 240;
    c.vy = 150 + Math.random() * 350;
    c.spin = 6 + Math.random() * 8;
    c.phase = Math.random() * Math.PI * 2;
    c.size = 0.75 + Math.random() * 0.55;
    c.sprite.visible = true;
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.coins.forEach((c) => {
      c.alive = false;
      c.sprite.visible = false;
    });
    const resolve = this.resolveDone;
    this.resolveDone = null;
    resolve?.();
  }

  destroy(): void {
    this.stop();
    this.view.destroy({ children: true });
    this.texture.destroy(true);
  }
}
