import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";

/**
 * Everything animated around the reels, all purely visual — nothing here can affect a spin's result
 * or payout. SlotMachineScene adds the layers in this order:
 *   background → `behind` (scenery life, chase lights, rainbow) → fire → `actor` (the leprechaun)
 *   → reels + payline → `front` (coins, sparkles, flash).
 *
 * Self-contained: textures are generated here, particles come from fixed pools (no per-frame
 * allocation), and one ticker callback drives it all. It also owns the ticker's frame cap: full
 * rate while something fast is moving, 30fps for the gentle idle motion.
 */

// All positions are canvas coordinates (1683×929).
const SCENERY_LEFT_WIDTH = 191;
const SCENERY_RIGHT_X = 1492;
const LANTERN = { x: 1556, y: 272 };
const MOON = { x: 1610, y: 70 };
const COIN_PILES = [
  { x: 10, y: 385, w: 170, h: 110 },
  { x: 1505, y: 535, w: 165, h: 70 },
];

/** character.webp is 1024x1024 with the leprechaun's visible pixels at x 263-668, y 31-995. The
 * anchor is the middle of his feet, which stand just above the control bar (its top is at y 770). */
const CHARACTER_ANCHOR_X = (263 + 668) / 2 / 1024;
const CHARACTER_ANCHOR_Y = 995 / 1024;
const CHARACTER_X = 150;
const CHARACTER_FEET_Y = 768;
const CHARACTER_HEIGHT = 600;
const CHARACTER_SCALE = CHARACTER_HEIGHT / (995 - 31);
/** Where coins fly from when he throws them — roughly his hand. */
const CHARACTER_HAND = { x: 225, y: 500 };

const DRIFTING_CLOVERS = 12;
const FIREFLIES = 16;
const TWINKLES = 8;
const PARTICLE_POOL = 130;
const BULB_SIZE = 34;

/** Win size relative to the stake → 0 regular, 1 big, 2 huge, 3 mega. */
export function winTier(multiple: number): 0 | 1 | 2 | 3 {
  if (multiple >= 40) return 3;
  if (multiple >= 15) return 2;
  if (multiple >= 5) return 1;
  return 0;
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext("2d")!];
}

function makeGlowTexture(): Texture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(canvas);
}

function drawClover(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  for (const angle of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makeCoinTexture(): Texture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const body = ctx.createRadialGradient(24, 20, 4, 32, 32, 30);
  body.addColorStop(0, "#fff6b8");
  body.addColorStop(0.5, "#ffc927");
  body.addColorStop(1, "#b86f06");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7d4703";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = "#ffe88a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(32, 32, 22, 0, Math.PI * 2);
  ctx.stroke();
  drawClover(ctx, 32, 33, 7, "#a9690a");
  return Texture.from(canvas);
}

function makeCloverTexture(): Texture {
  const [canvas, ctx] = makeCanvas(64, 64);
  ctx.strokeStyle = "#0d6b25";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(32, 34);
  ctx.quadraticCurveTo(34, 48, 42, 58);
  ctx.stroke();
  drawClover(ctx, 32, 28, 12, "#2fbf4e");
  drawClover(ctx, 32, 28, 6, "#6fe388");
  return Texture.from(canvas);
}

function makeSparkleTexture(): Texture {
  const [canvas, ctx] = makeCanvas(64, 64);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 32 : 4;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  return Texture.from(canvas);
}

/** A soft vertical bar of light, brightest at the top and along its middle. */
function makeBeamTexture(): Texture {
  const [canvas, ctx] = makeCanvas(64, 256);
  const across = ctx.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "destination-in";
  const along = ctx.createLinearGradient(0, 0, 0, 256);
  along.addColorStop(0, "rgba(255,255,255,1)");
  along.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 64, 256);
  return Texture.from(canvas);
}

function makeRainbowTexture(): Texture {
  const [canvas, ctx] = makeCanvas(1500, 640);
  const colors = ["#ff3b3b", "#ff9a2e", "#ffe83d", "#3fdc58", "#3aa8ff", "#5a5cff", "#b04dff"];
  const band = 26;
  ctx.lineWidth = band + 2;
  colors.forEach((color, i) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(750, 640, 625 - i * band, Math.PI, 0);
    ctx.stroke();
  });
  // Fade the two feet out rather than ending them in a hard edge.
  ctx.globalCompositeOperation = "destination-out";
  const feet = ctx.createLinearGradient(0, 400, 0, 640);
  feet.addColorStop(0, "rgba(0,0,0,0)");
  feet.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = feet;
  ctx.fillRect(0, 400, 1500, 240);
  return Texture.from(canvas);
}

function makeMoonTexture(): Texture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const halo = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
  halo.addColorStop(0, "rgba(210,225,255,0.75)");
  halo.addColorStop(1, "rgba(210,225,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#f4f6ff";
  ctx.beginPath();
  ctx.arc(64, 64, 24, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas);
}

type ParticleKind = "coin" | "clover" | "sparkle";

interface Particle {
  sprite: Sprite;
  kind: ParticleKind;
  alive: boolean;
  age: number;
  life: number;
  vx: number;
  vy: number;
  gravity: number;
  spin: number;
  spinSpeed: number;
  size: number;
}

interface DriftingClover {
  sprite: Sprite;
  speed: number;
  sway: number;
  swaySpeed: number;
  spinSpeed: number;
  baseX: number;
}

interface Firefly {
  sprite: Sprite;
  x: number;
  y: number;
  phase: number;
  speed: number;
}

interface Twinkle {
  sprite: Sprite;
  age: number;
  life: number;
}

export interface SceneEffectsLayout {
  width: number;
  height: number;
  /** Horizontal centre of each reel. */
  reelCenters: number[];
  paylineY: number;
  /** Top and bottom of the reel windows. */
  reelTop: number;
  reelBottom: number;
}

export class SceneEffects {
  readonly behind = new Container();
  readonly actor = new Container();
  readonly front = new Container();

  private app: Application;
  private root: Container;
  private layout: SceneEffectsLayout;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private textures: Texture[] = [];
  private glowTexture: Texture;
  private coinTexture: Texture;
  private cloverTexture: Texture;
  private sparkleTexture: Texture;

  private time = 0;
  private spinning = false;
  private freeSpins = false;
  /** 0 = day, 1 = free-spin night — fades between the two. */
  private night = 0;
  private destroyed = false;

  private particles: Particle[] = [];
  private rainLeft = 0;
  private rainRate = 0;
  private rainDebt = 0;

  private beams: Sprite[] = [];
  private lanternGlow: Sprite;
  private nightShade: Graphics;
  private moon: Sprite;
  private fireflies: Firefly[] = [];
  private twinkles: Twinkle[] = [];
  private drifting: DriftingClover[] = [];

  private bulbs: Sprite[] = [];
  private bulbFlash = 0;

  private logoShine: Sprite;
  private logoShineTimer = 2;

  private rainbow: Sprite;
  private rainbowMask: Graphics;
  /** Seconds since the rainbow started; negative = not showing. */
  private rainbowAge = -1;

  private flash: Graphics;
  private flashAlpha = 0;
  private shakeLeft = 0;
  private shakeAmp = 0;

  private payline: Container | null = null;
  private paylinePulse = 0;
  private anticipation: Graphics;
  private anticipationX: number | null = null;

  constructor(app: Application, root: Container, characterTexture: Texture, layout: SceneEffectsLayout) {
    this.app = app;
    this.root = root;
    this.layout = layout;

    this.glowTexture = this.own(makeGlowTexture());
    this.coinTexture = this.own(makeCoinTexture());
    this.cloverTexture = this.own(makeCloverTexture());
    this.sparkleTexture = this.own(makeSparkleTexture());
    const beamTexture = this.own(makeBeamTexture());

    // --- Scenery strips either side of the machine — clipped, so none of this bleeds onto it.
    const scenery = new Container();
    const sceneryMask = new Graphics()
      .rect(0, 0, SCENERY_LEFT_WIDTH, layout.height)
      .rect(SCENERY_RIGHT_X, 0, layout.width - SCENERY_RIGHT_X, layout.height)
      .fill({ color: 0xffffff });
    scenery.addChild(sceneryMask);
    scenery.mask = sceneryMask;
    this.behind.addChild(scenery);

    this.nightShade = new Graphics().rect(0, 0, layout.width, layout.height).fill({ color: 0x06123a });
    this.nightShade.alpha = 0;
    scenery.addChild(this.nightShade);

    for (const [x, rotation] of [
      [40, -0.28],
      [150, -0.2],
      [1540, 0.2],
      [1650, 0.28],
    ]) {
      const beam = new Sprite(beamTexture);
      beam.anchor.set(0.5, 0);
      beam.position.set(x, -20);
      beam.rotation = rotation;
      beam.width = 150;
      beam.height = 800;
      beam.tint = 0xfff0b0;
      beam.blendMode = "add";
      scenery.addChild(beam);
      this.beams.push(beam);
    }

    this.moon = new Sprite(this.own(makeMoonTexture()));
    this.moon.anchor.set(0.5);
    this.moon.position.set(MOON.x, MOON.y);
    this.moon.alpha = 0;
    scenery.addChild(this.moon);

    this.lanternGlow = this.addGlow(scenery, LANTERN.x, LANTERN.y, 230, 0xffb648);

    for (let i = 0; i < TWINKLES; i++) {
      const sprite = new Sprite(this.sparkleTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.tint = 0xfff2b0;
      sprite.alpha = 0;
      scenery.addChild(sprite);
      this.twinkles.push({ sprite, age: 0, life: 0.5 + Math.random() * i * 0.3 });
    }

    for (let i = 0; i < FIREFLIES; i++) {
      const left = i % 2 === 0;
      const sprite = this.addGlow(scenery, 0, 0, 14 + Math.random() * 12, 0xd8ff6a);
      sprite.alpha = 0;
      this.fireflies.push({
        sprite,
        x: left ? Math.random() * SCENERY_LEFT_WIDTH : SCENERY_RIGHT_X + Math.random() * SCENERY_LEFT_WIDTH,
        y: 80 + Math.random() * 660,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.9,
      });
    }

    // --- Clovers drifting down past the machine's sides.
    for (let i = 0; i < DRIFTING_CLOVERS; i++) {
      const sprite = new Sprite(this.cloverTexture);
      sprite.anchor.set(0.5);
      sprite.width = sprite.height = 20 + Math.random() * 22;
      sprite.alpha = 0.85;
      const clover: DriftingClover = {
        sprite,
        speed: 22 + Math.random() * 34,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.8 + Math.random(),
        spinSpeed: (Math.random() - 0.5) * 1.6,
        baseX: 0,
      };
      this.placeDriftingClover(clover, i % 2 === 0);
      sprite.y = Math.random() * layout.height;
      this.behind.addChild(sprite);
      this.drifting.push(clover);
    }

    this.buildBulbs();

    // --- Light sweeping across the "Shamrock Spin" logo (day only — the night art has no logo).
    const shine = new Container();
    const shineMask = new Graphics().ellipse(838, 118, 140, 78).fill({ color: 0xffffff });
    shine.addChild(shineMask);
    shine.mask = shineMask;
    this.logoShine = new Sprite(beamTexture);
    this.logoShine.anchor.set(0.5);
    this.logoShine.width = 90;
    this.logoShine.height = 420;
    this.logoShine.rotation = 0.35;
    this.logoShine.blendMode = "add";
    this.logoShine.visible = false;
    shine.addChild(this.logoShine);
    this.behind.addChild(shine);

    // --- Rainbow: behind the reels, so it can't cover a symbol; wiped on from the left.
    const rainbowLayer = new Container();
    this.rainbowMask = new Graphics().rect(0, 0, layout.width, layout.height).fill({ color: 0xffffff });
    rainbowLayer.addChild(this.rainbowMask);
    rainbowLayer.mask = this.rainbowMask;
    this.rainbow = new Sprite(this.own(makeRainbowTexture()));
    this.rainbow.anchor.set(0.5, 1);
    this.rainbow.position.set(layout.width / 2, 650);
    this.rainbow.visible = false;
    rainbowLayer.addChild(this.rainbow);
    this.behind.addChild(rainbowLayer);

    // --- The leprechaun.
    const character = new Sprite(characterTexture);
    character.anchor.set(CHARACTER_ANCHOR_X, CHARACTER_ANCHOR_Y);
    character.position.set(CHARACTER_X, CHARACTER_FEET_Y);
    character.scale.set(CHARACTER_SCALE);
    this.actor.addChild(character);

    // --- Front layer.
    this.anticipation = new Graphics();
    this.anticipation.visible = false;
    this.front.addChild(this.anticipation);

    for (let i = 0; i < PARTICLE_POOL; i++) {
      const sprite = new Sprite(this.coinTexture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.front.addChild(sprite);
      this.particles.push({
        sprite,
        kind: "coin",
        alive: false,
        age: 0,
        life: 1,
        vx: 0,
        vy: 0,
        gravity: 0,
        spin: 0,
        spinSpeed: 0,
        size: 1,
      });
    }

    this.flash = new Graphics().rect(0, 0, layout.width, layout.height).fill({ color: 0xffffff });
    this.flash.blendMode = "add";
    this.flash.alpha = 0;
    this.front.addChild(this.flash);

    this.app.ticker.add(this.update, this);
  }

  private own(texture: Texture): Texture {
    this.textures.push(texture);
    return texture;
  }

  private addGlow(parent: Container, x: number, y: number, size: number, tint: number): Sprite {
    const sprite = new Sprite(this.glowTexture);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.width = sprite.height = size;
    sprite.tint = tint;
    sprite.blendMode = "add";
    parent.addChild(sprite);
    return sprite;
  }

  /** Chase lights: round the top panel's frame (leaving the logo clear) and up both chrome pillars. */
  private buildBulbs(): void {
    const add = (x: number, y: number) => this.bulbs.push(this.addGlow(this.behind, x, y, BULB_SIZE, 0xffe27a));
    for (let x = 431; x <= 1249; x += 46) {
      if (x > 685 && x < 990) continue;
      add(x, 48);
      add(x, 190);
    }
    for (let y = 94; y <= 144; y += 46) {
      add(431, y);
      add(1249, y);
    }
    for (let y = 30; y <= 750; y += 48) {
      add(355, y);
      add(1330, y);
    }
  }

  private placeDriftingClover(clover: DriftingClover, left: boolean): void {
    clover.baseX = left ? Math.random() * 330 : 1350 + Math.random() * 333;
    clover.sprite.y = -40;
  }

  /** Called with the payline graphic once the scene has built it, so it can dim and pulse. */
  attachPayline(payline: Container): void {
    this.payline = payline;
  }

  setSpinning(active: boolean): void {
    this.spinning = active;
    if (active) {
      this.rainLeft = 0;
      this.bulbFlash = 0;
      this.paylinePulse = 0;
    }
  }

  /** Sparks at the foot of a reel as it lands. */
  reelLanded(index: number): void {
    if (this.destroyed) return;
    const x = this.layout.reelCenters[index];
    for (let i = 0; i < 10; i++) {
      this.spawn("sparkle", x + (Math.random() - 0.5) * 210, this.layout.reelBottom, (Math.random() - 0.5) * 160, -60 - Math.random() * 220, 0.45, 18 + Math.random() * 16, 300);
    }
  }

  /** Gold frame pulsing round a reel still spinning while a win is possible; null turns it off. */
  setAnticipation(reelIndex: number | null): void {
    if (this.destroyed) return;
    this.anticipationX = reelIndex === null ? null : this.layout.reelCenters[reelIndex];
    this.anticipation.visible = reelIndex !== null;
    if (reelIndex === null) return;
    const { reelTop, reelBottom } = this.layout;
    const x = this.anticipationX as number;
    this.anticipation.clear();
    this.anticipation.roundRect(x - 128, reelTop - 10, 256, reelBottom - reelTop + 20, 14).stroke({ color: 0xffc93d, width: 22, alpha: 0.28 });
    this.anticipation.roundRect(x - 124, reelTop - 6, 248, reelBottom - reelTop + 12, 12).stroke({ color: 0xfff2a8, width: 5 });
  }

  /** The win reaction: scales with the win's size relative to the stake. */
  celebrateWin(multiple: number): void {
    if (this.destroyed) return;
    const tier = winTier(multiple);
    const { reelCenters, paylineY } = this.layout;

    reelCenters.forEach((x) => {
      this.burstCoins(x, paylineY, 5 + tier * 3, 380);
      for (let i = 0; i < 5; i++) {
        this.spawn("sparkle", x + (Math.random() - 0.5) * 200, paylineY + (Math.random() - 0.5) * 120, 0, -30, 0.6, 28 + Math.random() * 30, 0);
      }
    });
    this.burstCoins(CHARACTER_HAND.x, CHARACTER_HAND.y, 6 + tier * 4, 300, 320);

    this.bulbFlash = 1.4 + tier;
    this.paylinePulse = 1.4 + tier;

    if (tier >= 1) {
      this.startRain(1.6 + tier * 0.9, 22 + tier * 14);
      this.startRainbow();
      this.startFlash(0.3 + tier * 0.1);
      this.startShake(0.3 + tier * 0.15, 3 + tier * 2);
    }
  }

  /** Free spins: day turns to a moonlit night, with a rainbow and a shower of clovers to mark it. */
  setFreeSpins(active: boolean): void {
    if (this.destroyed || this.freeSpins === active) return;
    this.freeSpins = active;
    this.logoShine.visible = false;
    this.startFlash(0.55);
    if (active) {
      this.startRainbow();
      this.startRain(2, 30);
      this.bulbFlash = 2;
    }
  }

  private burstCoins(x: number, y: number, count: number, speed: number, drift = 0): void {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const v = speed * (0.5 + Math.random() * 0.8);
      this.spawn("coin", x, y, Math.cos(angle) * v + drift, Math.sin(angle) * v, 1.5, 26 + Math.random() * 16, 780);
    }
  }

  private spawn(kind: ParticleKind, x: number, y: number, vx: number, vy: number, life: number, size: number, gravity: number): void {
    const p = this.particles.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.kind = kind;
    p.age = 0;
    p.life = life;
    p.vx = vx;
    p.vy = vy;
    p.gravity = gravity;
    p.size = size;
    p.spin = Math.random() * Math.PI * 2;
    p.spinSpeed = kind === "coin" ? 8 + Math.random() * 8 : (Math.random() - 0.5) * 5;
    p.sprite.texture = kind === "coin" ? this.coinTexture : kind === "clover" ? this.cloverTexture : this.sparkleTexture;
    p.sprite.blendMode = kind === "sparkle" ? "add" : "normal";
    p.sprite.tint = kind === "sparkle" ? 0xfff0a0 : 0xffffff;
    p.sprite.rotation = 0;
    p.sprite.alpha = 1;
    p.sprite.position.set(x, y);
    p.sprite.visible = true;
  }

  private startRain(seconds: number, perSecond: number): void {
    this.rainLeft = seconds;
    this.rainRate = perSecond;
  }

  private startRainbow(): void {
    this.rainbowAge = 0;
    this.rainbow.visible = true;
  }

  private startFlash(alpha: number): void {
    if (!this.reducedMotion) this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  private startShake(seconds: number, amplitude: number): void {
    if (this.reducedMotion) return;
    this.shakeLeft = seconds;
    this.shakeAmp = amplitude;
  }

  private update(): void {
    const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.05);
    this.time += dt;
    this.night += Math.max(-dt * 1.4, Math.min(dt * 1.4, (this.freeSpins ? 1 : 0) - this.night));

    this.updateScenery(dt);
    this.updateBulbs(dt);
    this.updateLogoShine(dt);
    this.updateRainbow(dt);
    const particlesAlive = this.updateParticles(dt);
    this.updateFront(dt);

    // Smooth while anything fast is moving; the gentle idle motion is fine at 30.
    const busy = this.spinning || particlesAlive || this.rainLeft > 0 || this.shakeLeft > 0 || this.rainbowAge >= 0;
    this.app.ticker.maxFPS = busy ? 0 : 30;
  }

  private updateScenery(dt: number): void {
    const t = this.time;
    const night = this.night;

    this.nightShade.alpha = night * 0.62;
    this.moon.alpha = night;
    this.beams.forEach((beam, i) => {
      beam.alpha = (0.1 + 0.06 * Math.sin(t * 0.7 + i * 1.7)) * (1 - night);
    });

    const flicker = 0.75 + 0.15 * Math.sin(t * 11) + 0.1 * Math.sin(t * 23 + 1.3);
    this.lanternGlow.alpha = flicker * (0.55 + night * 0.45);
    this.lanternGlow.width = this.lanternGlow.height = 230 + night * 110 + flicker * 20;

    for (const tw of this.twinkles) {
      tw.age += dt;
      if (tw.age >= tw.life) {
        const pile = COIN_PILES[Math.floor(Math.random() * COIN_PILES.length)];
        tw.sprite.position.set(pile.x + Math.random() * pile.w, pile.y + Math.random() * pile.h);
        tw.sprite.width = tw.sprite.height = 18 + Math.random() * 26;
        tw.age = 0;
        tw.life = 0.5 + Math.random() * 1.1;
      }
      tw.sprite.alpha = Math.sin((tw.age / tw.life) * Math.PI) * (1 - night * 0.5);
    }

    if (night > 0) {
      for (const fly of this.fireflies) {
        fly.phase += fly.speed * dt;
        fly.sprite.position.set(fly.x + Math.sin(fly.phase) * 34, fly.y + Math.cos(fly.phase * 1.3) * 26);
        fly.sprite.alpha = night * (0.35 + 0.65 * Math.abs(Math.sin(fly.phase * 2.3)));
      }
    } else if (this.fireflies[0].sprite.alpha !== 0) {
      this.fireflies.forEach((fly) => (fly.sprite.alpha = 0));
    }

    this.drifting.forEach((clover, i) => {
      clover.sway += clover.swaySpeed * dt;
      clover.sprite.y += clover.speed * dt;
      clover.sprite.x = clover.baseX + Math.sin(clover.sway) * 26;
      clover.sprite.rotation += clover.spinSpeed * dt;
      if (clover.sprite.y > this.layout.height + 40) this.placeDriftingClover(clover, i % 2 === 0);
    });
  }

  private updateBulbs(dt: number): void {
    this.bulbFlash = Math.max(0, this.bulbFlash - dt);
    const speed = this.spinning ? 16 : this.freeSpins ? 7 : 3;
    const head = Math.floor(this.time * speed);
    const flashing = this.bulbFlash > 0;
    const flashOn = Math.sin(this.time * 22) > 0;
    const tint = flashing ? 0xfff4b0 : this.freeSpins ? 0xff7b3a : 0xffe27a;
    this.bulbs.forEach((bulb, i) => {
      bulb.tint = tint;
      if (flashing) bulb.alpha = flashOn ? 1 : 0.2;
      else bulb.alpha = (i + head) % 3 === 0 ? 0.95 : 0.14;
    });
  }

  private updateLogoShine(dt: number): void {
    if (this.freeSpins) return;
    this.logoShineTimer -= dt;
    if (this.logoShineTimer > 0) return;
    const u = -this.logoShineTimer / 0.9;
    if (u >= 1) {
      this.logoShine.visible = false;
      this.logoShineTimer = 4 + Math.random() * 3;
      return;
    }
    this.logoShine.visible = true;
    this.logoShine.alpha = 0.75;
    this.logoShine.position.set(660 + u * 360, 118);
  }

  private updateRainbow(dt: number): void {
    if (this.rainbowAge < 0) return;
    this.rainbowAge += dt;
    const age = this.rainbowAge;
    const lifetime = 3.4;
    if (age >= lifetime) {
      this.rainbowAge = -1;
      this.rainbow.visible = false;
      return;
    }
    // Wipe on left to right, hold, then fade.
    this.rainbowMask.scale.x = Math.min(1, age / 0.8);
    this.rainbow.alpha = 0.6 * Math.min(1, (lifetime - age) / 0.8);
  }

  private updateParticles(dt: number): boolean {
    if (this.rainLeft > 0) {
      this.rainLeft -= dt;
      this.rainDebt += this.rainRate * dt;
      while (this.rainDebt >= 1) {
        this.rainDebt--;
        const kind: ParticleKind = Math.random() < 0.25 ? "clover" : "coin";
        const x = Math.random() * this.layout.width;
        const size = kind === "coin" ? 26 + Math.random() * 20 : 28 + Math.random() * 18;
        this.spawn(kind, x, -40, (Math.random() - 0.5) * 70, 170 + Math.random() * 240, 2.6, size, 300);
      }
    }

    let anyAlive = false;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1 || p.sprite.y > this.layout.height + 60) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }
      anyAlive = true;
      p.vy += p.gravity * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.spin += p.spinSpeed * dt;
      // Scale relative to the texture's own 64px, flipping coins by squeezing their width.
      const scale = p.size / 64;
      if (p.kind === "coin") {
        p.sprite.scale.set(scale * Math.max(0.12, Math.abs(Math.cos(p.spin))), scale);
        p.sprite.alpha = Math.min(1, (1 - u) * 4);
      } else {
        p.sprite.rotation = p.spin;
        const pop = p.kind === "sparkle" ? Math.sin(u * Math.PI) : 1;
        p.sprite.scale.set(scale * pop);
        p.sprite.alpha = p.kind === "sparkle" ? 1 : Math.min(1, (1 - u) * 4);
      }
    }
    return anyAlive;
  }

  private updateFront(dt: number): void {
    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - dt * 1.6);
    }
    this.flash.alpha = this.flashAlpha;

    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      if (this.shakeLeft > 0) {
        const amp = this.shakeAmp * Math.min(1, this.shakeLeft * 3);
        this.root.position.set((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
      } else {
        this.root.position.set(0, 0);
      }
    }

    this.paylinePulse = Math.max(0, this.paylinePulse - dt);
    if (this.payline) {
      this.payline.alpha = this.spinning ? 0.35 : this.paylinePulse > 0 ? 0.55 + 0.45 * Math.sin(this.time * 16) : 1;
    }

    if (this.anticipationX !== null) {
      this.anticipation.alpha = 0.6 + 0.4 * Math.sin(this.time * 14);
      if (Math.random() < dt * 22) {
        const { reelTop, reelBottom } = this.layout;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.spawn("sparkle", this.anticipationX + side * 124, reelTop + Math.random() * (reelBottom - reelTop), side * 40, -50, 0.5, 20 + Math.random() * 18, 0);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.app.ticker.remove(this.update, this);
    this.root.position.set(0, 0);
    this.behind.destroy({ children: true });
    this.actor.destroy({ children: true });
    this.front.destroy({ children: true });
    this.textures.forEach((texture) => texture.destroy(true));
  }
}
