import {
  Application,
  Assets,
  Container,
  FederatedPointerEvent,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
  Ticker,
} from "pixi.js";
import { AnimatedGIF } from "@pixi/gif";
import { Fish } from "./Fish";
import { Gun, type AimDirection } from "./Gun";
import { Bullet } from "./Bullet";
import { HitEffect } from "./HitEffect";
import { LockIndicator, RADIUS as LOCK_INDICATOR_RADIUS } from "./LockIndicator";
import { WinPopup } from "./WinPopup";
import { FireBurst } from "./FireBurst";
import { FlyingCoin } from "./FlyingCoin";
import { SPECIES, speciesFramePath, type SpeciesConfig } from "./species";

// Catching a "freeze" creature (the ice crystal) stops every creature's movement for a random
// time in this range. Hitting another one while frozen extends it (never shortens it).
const FREEZE_MIN_MS = 10_000;
const FREEZE_MAX_MS = 15_000;

// A creature that's caught or swims off screen stays gone for a random time in this range, then
// a fresh one of the same species swims in from a random edge — so a catch feels real instead of
// the same creature instantly reappearing.
const RESPAWN_MIN_MS = 3000;
const RESPAWN_MAX_MS = 8000;

const FREEZE_TEXT_STYLE = new TextStyle({
  fontFamily: "Arial Black, Arial, sans-serif",
  fontWeight: "900",
  fontSize: 64,
  fill: 0xe6f7ff,
  stroke: { color: 0x0b4f7a, width: 10 },
  align: "center",
});

/** Any one-shot effect driven by update(deltaMS) and removed once isFinished(). */
type TimedEffect = Container & { update(deltaMS: number): void; isFinished(): boolean };

/** Where caught coins fly to (the credits box, in canvas px), plus a callback as each one lands. */
export interface CoinTarget {
  getPosition(): { x: number; y: number } | null;
  onCoinLanded(): void;
}

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

const BG_PATH = "/symbols/fishGame/bg.png";
const GUN_BASE_PATH = "/symbols/fishGame/bottomGun.gif";
const BULLET_PATH = "/symbols/fishGame/bullet.png";

// The turret head sitting on the fixed base — trimmed + re-encoded as WebP from a 42-frame
// "gun002_00000.png".."gun002_00041.png" set (2514x1394 PNGs, 41MB), renamed to frame_0000.webp..
const GUN_HEAD_FRAME_COUNT = 36;
function gunHeadFramePath(i: number): string {
  return `/symbols/fishGame/gun/frame_${String(i).padStart(4, "0")}.webp`;
}

/** Fetches the base's raw GIF bytes and decodes it — same pattern as SizzlingSevens'
 * loadWinGifAnimations, just a single file instead of a per-symbol map. */
async function loadGunBase(): Promise<AnimatedGIF> {
  const res = await fetch(GUN_BASE_PATH);
  const buffer = await res.arrayBuffer();
  return AnimatedGIF.fromBuffer(buffer, { loop: true, autoPlay: true });
}

const GUN_SCALE = 0.6;
const GUN_Y_OFFSET = 30; // px the gun's mount point sits above the very bottom edge
const FIRE_COOLDOWN_MS = 220;

// Population auto-derives from a species' own payoutMultiplier instead of another number to
// hand-tune per species — small/cheap creatures should be common, big/valuable ones rare.
// Toughness is no longer decided here: the server rolls each hit's kill chance (rtp / multiplier),
// so valuable creatures naturally take many more hits on average.
function countForPayout(payoutMultiplier: number): number {
  if (payoutMultiplier <= 10) return 3;
  if (payoutMultiplier <= 40) return 2;
  return 1;
}

/** Bridges the scene to the player's balance and the server — implemented by FishGameGame. */
export interface FishWallet {
  /** Reserves one bet for a bullet about to be fired. Returns that bet, or null if the player
   * can't afford it (in which case nothing fires). */
  reserveShot(): number | null;
  /** A bullet left the screen without hitting anything — nothing is charged for it. */
  releaseShot(bet: number): void;
  /** A bullet hit a creature — the server charges the bet and decides whether it's caught.
   * Resolves null if the request failed. */
  resolveHit(speciesId: string, bet: number): Promise<{ killed: boolean; winAmount: number } | null>;
}

/** species.count if explicitly set, otherwise the auto-derived default — the one place both the
 * spawn loop and the frame-loading logic read from, so they can't drift out of sync. */
function resolvedCount(species: SpeciesConfig): number {
  return species.count ?? countForPayout(species.payoutMultiplier);
}

// Hit radius is derived per-species from that species' own native frame size (width+height
// averaged, so it's reasonable for both square frames and very elongated ones like fish2) times
// this fraction — no longer a single hardcoded frame size, since species now have wildly
// different source dimensions (GoldenFish's hand-drawn 500x500 frames vs. the trimmed
// high-res turtle/fish2 renders below).
const HIT_RADIUS_FRACTION = 0.35;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// 10+ species with count > 0 now adds up to 600+ active frames, so 24-at-a-time was making cold
// loads take ~2 minutes even with no errors (confirmed by watching requests complete steadily,
// just slowly). Bumped to 64 — still well short of the ~500+ *simultaneous* requests that caused
// the original silent-hang bug (see the loop above create()), since local dev-server round trips
// are fast enough that 64-at-a-time doesn't reproduce that failure. If more species keep getting
// added, the real fix is trimming which ones have count > 0 at once, not raising this further.
const TEXTURE_LOAD_CONCURRENCY = 64;

/** Loads every path in `paths`, but never more than `limit` requests in flight at once — see
 * FishGameScene.create() for why unconditionally firing hundreds of simultaneous image loads
 * turned out to be unreliable. Order of the returned array matches `paths`. */
async function loadTexturesWithConcurrencyLimit(paths: string[], limit = TEXTURE_LOAD_CONCURRENCY): Promise<Texture[]> {
  const results: Texture[] = new Array(paths.length);
  let next = 0;

  async function worker() {
    while (next < paths.length) {
      const i = next++;
      results[i] = await Assets.load<Texture>(paths[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, paths.length) }, worker));
  return results;
}

interface LiveFish {
  fish: Fish;
  speciesIndex: number;
  hitRadius: number;
  /** Where it was caught, once it has been — a second in-flight hit on the same creature can
   * also come back as a kill (each hit is paid for and rolled independently on the server), and
   * its popup still needs a position after the sprite itself is destroyed. */
  caughtAt: { x: number; y: number } | null;
}

export class FishGameScene {
  private app: Application;
  private wallet: FishWallet;
  private destroyed = false;
  private root: Container;
  private framesBySpecies: Texture[][] = [];
  private fishLayer: Container;
  private liveFish: LiveFish[] = [];
  /** Caught creatures playing their death fall — no longer hittable/lockable, just animating out. */
  private dyingFish: Fish[] = [];
  /** Species waiting to come back, and the scene time (ms) each one is due. */
  private pendingRespawns: { speciesIndex: number; dueAt: number }[] = [];
  private sceneTimeMs = 0;
  private bounds = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

  private gun: Gun;
  private bulletTexture: Texture;
  private bulletsLayer: Container;
  private bullets: Bullet[] = [];
  private aimDirection: AimDirection = { x: 0, y: -1 };
  private lastFiredAt = -Infinity;
  private autoFire = false;
  private autoTarget = false;
  private lockedTarget: LiveFish | null = null;
  private lockIndicator: LockIndicator;

  private effectsLayer: Container;
  private effects: TimedEffect[] = [];
  private winPopups: WinPopup[] = [];
  private coins: FlyingCoin[] = [];
  private coinTarget: CoinTarget | null = null;

  private freezeRemainingMs = 0;
  private frostOverlay: Graphics;
  private freezeText: Text;
  /** Bullets fired while locked on, and the creature each one is homing in on. */
  private bulletTargets = new Map<Bullet, LiveFish>();

  private onTick = (ticker: Ticker) => {
    this.gun.update(ticker.deltaMS);

    if (this.autoTarget) this.updateAutoTarget();
    // Auto-target also fires on its own — locking onto a creature is pointless if nothing then
    // shoots at it — independent of whether the separate auto-fire toggle is on.
    if (this.autoFire || this.autoTarget) this.fire();

    if (this.freezeRemainingMs > 0) this.updateFreeze(ticker.deltaMS);

    this.lockIndicator.update(ticker.deltaMS);
    if (this.autoTarget && this.lockedTarget) {
      this.lockIndicator.visible = true;
      this.lockIndicator.x = this.lockedTarget.fish.x;
      this.lockIndicator.y = this.lockedTarget.fish.y;
      this.lockIndicator.scale.set(this.lockedTarget.hitRadius / LOCK_INDICATOR_RADIUS);
    } else {
      this.lockIndicator.visible = false;
    }

    this.sceneTimeMs += ticker.deltaMS;

    for (let i = this.liveFish.length - 1; i >= 0; i--) {
      const entry = this.liveFish[i];
      entry.fish.update(ticker.deltaMS);
      if (entry.fish.hasExited()) {
        this.liveFish.splice(i, 1);
        this.fishLayer.removeChild(entry.fish);
        entry.fish.destroy();
        this.scheduleRespawn(entry.speciesIndex);
      }
    }

    for (let i = this.pendingRespawns.length - 1; i >= 0; i--) {
      if (this.pendingRespawns[i].dueAt <= this.sceneTimeMs) {
        const [{ speciesIndex }] = this.pendingRespawns.splice(i, 1);
        this.spawnFish(speciesIndex, true);
      }
    }

    for (let i = this.dyingFish.length - 1; i >= 0; i--) {
      const fish = this.dyingFish[i];
      fish.update(ticker.deltaMS);
      if (fish.isDeathFinished()) {
        this.fishLayer.removeChild(fish);
        fish.destroy();
        this.dyingFish.splice(i, 1);
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];

      // A locked bullet homes in on its creature and ignores everything else in the way. If that
      // creature was already caught, it just carries on straight and can hit anything.
      let target = this.bulletTargets.get(bullet) ?? null;
      // Also stop homing once the creature swims off screen — steering at it would pin the bullet
      // against the edge it keeps bouncing off; it just keeps ricocheting normally instead.
      if (target && (!this.liveFish.includes(target) || !target.fish.isOnScreen())) {
        this.bulletTargets.delete(bullet);
        target = null;
      }
      if (target) bullet.steerToward(target.fish.x, target.fish.y);

      bullet.update(ticker.deltaMS, this.bounds);

      const touches = (entry: LiveFish) =>
        Math.hypot(entry.fish.x - bullet.x, entry.fish.y - bullet.y) < entry.hitRadius;
      const hit = target ? (touches(target) ? target : null) : (this.liveFish.find(touches) ?? null);

      if (hit) {
        this.registerHit(hit, bullet.bet, bullet.x, bullet.y);
        this.removeBullet(i);
        continue;
      }

      if (bullet.isExpired()) {
        this.wallet.releaseShot(bullet.bet);
        this.removeBullet(i);
      }
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.update(ticker.deltaMS);
      if (effect.isFinished()) {
        this.effectsLayer.removeChild(effect);
        effect.destroy();
        this.effects.splice(i, 1);
      }
    }

    for (let i = this.winPopups.length - 1; i >= 0; i--) {
      const popup = this.winPopups[i];
      popup.update(ticker.deltaMS);
      if (popup.isFinished()) {
        this.effectsLayer.removeChild(popup);
        popup.destroy();
        this.winPopups.splice(i, 1);
      }
    }

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      coin.update(ticker.deltaMS);
      if (coin.isFinished()) {
        this.coinTarget?.onCoinLanded();
        this.effectsLayer.removeChild(coin);
        coin.destroy();
        this.coins.splice(i, 1);
      }
    }
  };

  private onPointerMove = (e: FederatedPointerEvent) => {
    this.aimDirection = this.gun.aimAt(e.global.x, e.global.y);
  };

  private onPointerDown = (e: FederatedPointerEvent) => {
    this.aimDirection = this.gun.aimAt(e.global.x, e.global.y);

    // Clicking directly on a creature while auto-target is on locks onto that one specifically,
    // overriding whatever it would've auto-picked (nearest to the gun) — see updateAutoTarget.
    if (this.autoTarget) {
      const clicked = this.liveFish.find(
        (entry) => Math.hypot(entry.fish.x - e.global.x, entry.fish.y - e.global.y) < entry.hitRadius
      );
      if (clicked) this.lockedTarget = clicked;
    }

    this.fire();
  };

  private constructor(
    app: Application,
    wallet: FishWallet,
    bgTexture: Texture,
    gunBase: AnimatedGIF,
    gunHeadFrames: Texture[],
    bulletTexture: Texture,
    framesBySpecies: Texture[][]
  ) {
    this.app = app;
    this.wallet = wallet;
    this.root = new Container();
    app.stage.addChild(this.root);
    this.bulletTexture = bulletTexture;
    this.framesBySpecies = framesBySpecies;

    const bg = new Sprite(bgTexture);
    bg.width = CANVAS_WIDTH;
    bg.height = CANVAS_HEIGHT;
    this.root.addChild(bg);

    this.fishLayer = new Container();
    this.root.addChild(this.fishLayer);

    // Frosty wash over the pond while a freeze is active — above the creatures, below bullets,
    // effects and the gun so those still read clearly.
    this.frostOverlay = new Graphics()
      .rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      .fill({ color: 0x9fdcff, alpha: 0.18 })
      .rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      .stroke({ color: 0xe6f7ff, width: 60, alpha: 0.35 });
    this.frostOverlay.visible = false;
    this.root.addChild(this.frostOverlay);

    this.lockIndicator = new LockIndicator();
    this.root.addChild(this.lockIndicator);

    // Normal creatures start in the pond; rare visitors (absentMs set) start away and make their
    // first entrance after one of their own waits.
    SPECIES.forEach((species, speciesIndex) => {
      for (let i = 0; i < resolvedCount(species); i++) {
        if (species.absentMs) this.scheduleRespawn(speciesIndex);
        else this.spawnFish(speciesIndex);
      }
    });

    this.bulletsLayer = new Container();
    this.root.addChild(this.bulletsLayer);

    this.effectsLayer = new Container();
    this.root.addChild(this.effectsLayer);

    this.freezeText = new Text({ text: "", style: FREEZE_TEXT_STYLE });
    this.freezeText.anchor.set(0.5, 0);
    this.freezeText.x = CANVAS_WIDTH / 2;
    this.freezeText.y = 40;
    this.freezeText.visible = false;
    this.root.addChild(this.freezeText);

    this.gun = new Gun(gunBase, gunHeadFrames, GUN_SCALE);
    this.gun.x = CANVAS_WIDTH / 2.8;
    this.gun.y = CANVAS_HEIGHT - GUN_Y_OFFSET;
    this.gun.aimAt(this.gun.x, 0);
    this.root.addChild(this.gun);

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointermove", this.onPointerMove);
    app.stage.on("pointerdown", this.onPointerDown);

    app.ticker.add(this.onTick);
  }

  static async create(app: Application, wallet: FishWallet): Promise<FishGameScene> {
    // Species that resolve to a count of 0 are never spawned (see the constructor's spawn loop),
    // so their frames are never touched — skip fetching them entirely. With a dozen-plus species
    // now, several 50-100+ frames each, loading everything unconditionally meant 500+
    // simultaneous image requests, which was intermittently overwhelming the browser's fetch
    // queue and silently failing one of them — which hung the *entire* scene forever, since a
    // single rejected Assets.load fails the whole Promise.all before any of this ever resolves.
    const framePathsBySpecies = SPECIES.map((species) =>
      resolvedCount(species) > 0
        ? Array.from(
            { length: species.frameCount },
            (_, i) => speciesFramePath(species, i)
          )
        : []
    );

    // The gun head's frames go through the *same* concurrency-limited pool as every species'
    // frames below, not a separate one — running two independent 64-at-a-time pools at once
    // still adds up to more total simultaneous requests than the browser/loader can reliably
    // handle together, which reproduced the exact silent-hang bug described above.
    const gunHeadPaths = Array.from({ length: GUN_HEAD_FRAME_COUNT }, (_, i) => gunHeadFramePath(i));
    const allFramePaths = [...gunHeadPaths, ...framePathsBySpecies.flat()];

    const [bgTexture, gunBase, bulletTexture, allFrameTextures] = await Promise.all([
      Assets.load<Texture>(BG_PATH),
      loadGunBase(),
      Assets.load<Texture>(BULLET_PATH),
      loadTexturesWithConcurrencyLimit(allFramePaths),
    ]);

    const gunHeadFrames = allFrameTextures.slice(0, gunHeadPaths.length);
    const flatFrameTextures = allFrameTextures.slice(gunHeadPaths.length);

    let cursor = 0;
    const framesBySpecies = framePathsBySpecies.map((paths) => {
      const slice = flatFrameTextures.slice(cursor, cursor + paths.length);
      cursor += paths.length;
      return slice;
    });

    return new FishGameScene(app, wallet, bgTexture, gunBase, gunHeadFrames, bulletTexture, framesBySpecies);
  }

  private fire(): void {
    const now = performance.now();
    if (now - this.lastFiredAt < FIRE_COOLDOWN_MS) return;

    const bet = this.wallet.reserveShot();
    if (bet === null) return;
    this.lastFiredAt = now;

    const muzzle = this.gun.getMuzzlePosition(this.aimDirection);
    const bullet = new Bullet(this.bulletTexture, muzzle.x, muzzle.y, this.aimDirection, bet);
    this.bulletsLayer.addChild(bullet);
    this.bullets.push(bullet);
    if (this.autoTarget && this.lockedTarget) this.bulletTargets.set(bullet, this.lockedTarget);
  }

  /** Stops every creature's movement (their own animation keeps playing) for FREEZE_MIN_MS to
   * FREEZE_MAX_MS. Purely visual help for the player — it doesn't touch payouts or RTP. */
  private startFreeze(): void {
    const duration = FREEZE_MIN_MS + Math.random() * (FREEZE_MAX_MS - FREEZE_MIN_MS);
    this.freezeRemainingMs = Math.max(this.freezeRemainingMs, duration);
    for (const entry of this.liveFish) entry.fish.setFrozen(true);
    this.frostOverlay.visible = true;
    this.freezeText.visible = true;
  }

  private updateFreeze(deltaMS: number): void {
    this.freezeRemainingMs -= deltaMS;
    if (this.freezeRemainingMs <= 0) {
      this.freezeRemainingMs = 0;
      for (const entry of this.liveFish) entry.fish.setFrozen(false);
      this.frostOverlay.visible = false;
      this.freezeText.visible = false;
      return;
    }
    this.freezeText.text = `FROZEN ${Math.ceil(this.freezeRemainingMs / 1000)}`;
    // Gentle shimmer so the frost reads as "alive" rather than a flat color wash.
    this.frostOverlay.alpha = 0.85 + Math.sin(performance.now() / 300) * 0.15;
  }

  /** Where catch coins should fly to — set by the React layer, which knows where the credits box is. */
  setCoinTarget(target: CoinTarget | null): void {
    this.coinTarget = target;
  }

  /** Re-aims the gun at the currently locked target every tick, while autoTarget is on. Defaults
   * to whichever live fish is closest to the gun, auto-picked fresh each time there isn't
   * already a locked target (e.g. right after the previous one was caught) — but a fish the
   * player clicked on (see onPointerDown) stays locked instead of getting overridden by
   * "nearest," until it dies or they click a different one. */
  private updateAutoTarget(): void {
    // Let go once the creature is caught or has swum off screen — bullets can't reach it there.
    if (
      this.lockedTarget &&
      (!this.liveFish.includes(this.lockedTarget) || !this.lockedTarget.fish.isOnScreen())
    ) {
      this.lockedTarget = null;
    }

    if (!this.lockedTarget) {
      let nearest: LiveFish | null = null;
      let nearestDist = Infinity;
      for (const entry of this.liveFish) {
        if (!entry.fish.isOnScreen()) continue;
        const dist = Math.hypot(entry.fish.x - this.gun.x, entry.fish.y - this.gun.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = entry;
        }
      }
      this.lockedTarget = nearest;
    }

    if (this.lockedTarget) {
      this.aimDirection = this.gun.aimAt(this.lockedTarget.fish.x, this.lockedTarget.fish.y);
    }
  }

  /** Toggled from the on-screen "auto fire" button — while on, the gun fires continuously
   * (still respecting FIRE_COOLDOWN_MS) at whatever it's currently aimed at, no clicking needed. */
  setAutoFire(enabled: boolean): void {
    this.autoFire = enabled;
  }

  /** Toggled from the on-screen "auto target" button — while on, the gun ignores the pointer and
   * continuously tracks a locked-on live fish instead (see updateAutoTarget). */
  setAutoTarget(enabled: boolean): void {
    this.autoTarget = enabled;
  }

  /** Rare visitors wait their own (longer) absentMs range; everything else the short default. */
  private scheduleRespawn(speciesIndex: number): void {
    const [min, max] = SPECIES[speciesIndex].absentMs ?? [RESPAWN_MIN_MS, RESPAWN_MAX_MS];
    this.pendingRespawns.push({ speciesIndex, dueAt: this.sceneTimeMs + randRange(min, max) });
  }

  /** `fromEdge` = swim in from just off screen (every spawn after the opening population);
   * otherwise it's placed somewhere inside the pond, so the game doesn't start empty. */
  private spawnFish(speciesIndex: number, fromEdge = false): void {
    const species = SPECIES[speciesIndex];
    const frames = this.framesBySpecies[speciesIndex];
    const fish = new Fish(frames, this.bounds, {
      scale: species.size,
      speed: randRange(species.speedMin, species.speedMax),
      fps: randRange(species.fpsMin, species.fpsMax),
      facesRight: species.facesRight,
      loop: species.loop,
      artAngleDeg: species.artAngleDeg,
      preventUpsideDown: species.preventUpsideDown,
      xAxisOnly: species.xAxisOnly,
      glowColor: species.glowColor,
      exitProbability: species.exitChance,
    });
    if (fromEdge) fish.enterFromRandomEdge();
    if (this.freezeRemainingMs > 0) fish.setFrozen(true);
    this.fishLayer.addChild(fish);

    const nativeSize = (frames[0].width + frames[0].height) / 2;
    this.liveFish.push({
      fish,
      speciesIndex,
      hitRadius: (nativeSize / 2) * species.size * (species.hitRadiusFraction ?? HIT_RADIUS_FRACTION),
      caughtAt: null,
    });
  }

  /** A bullet touched this fish — flash it red and burst fire where the bullet struck right away,
   * so the shot visibly registers, then let the server decide (and charge for) the outcome. Only
   * a server-confirmed kill catches the fish. */
  private registerHit(entry: LiveFish, bet: number, impactX: number, impactY: number): void {
    entry.fish.flashHit();
    const burst = new FireBurst(impactX, impactY, 0.9);
    this.effectsLayer.addChild(burst);
    this.effects.push(burst);

    const speciesId = SPECIES[entry.speciesIndex].folder;
    this.wallet
      .resolveHit(speciesId, bet)
      .then((result) => {
        if (this.destroyed || !result?.killed) return;
        this.catchFish(entry, result.winAmount, bet);
      })
      .catch((err) => console.error("[FishGame] failed to show catch", err));
  }

  /** A server-confirmed kill — remove the fish, spawn a splash + win-amount popup where it was, and
   * put a fresh one of the same species back in play, so each species' on-screen count stays
   * constant over time instead of slowly draining as fish get caught. If an earlier hit already
   * caught this same fish, the win is still real (already credited), so only the popup shows. */
  private catchFish(entry: LiveFish, winAmount: number, bet: number): void {
    const species = SPECIES[entry.speciesIndex];

    if (!entry.caughtAt) {
      entry.caughtAt = { x: entry.fish.x, y: entry.fish.y };
      const index = this.liveFish.indexOf(entry);
      if (index !== -1) this.liveFish.splice(index, 1);
      entry.fish.die();
      this.dyingFish.push(entry.fish);

      const effect = new HitEffect(entry.caughtAt.x, entry.caughtAt.y, 0.6 + species.size * 0.5);
      this.effectsLayer.addChild(effect);
      this.effects.push(effect);

      if (species.effect === "freeze") this.startFreeze();
      this.scheduleRespawn(entry.speciesIndex);
    }

    const popup = new WinPopup(entry.caughtAt.x, entry.caughtAt.y, winAmount);
    this.effectsLayer.addChild(popup);
    this.winPopups.push(popup);

    this.sprayCoins(entry.caughtAt.x, entry.caughtAt.y, winAmount / bet);
  }

  /** Gold coins that burst out of the catch and stream into the credits box — more coins for
   * bigger multipliers (4 for a small fish up to 16 for the top prizes). */
  private sprayCoins(x: number, y: number, multiplier: number): void {
    const target = this.coinTarget?.getPosition();
    if (!target) return;
    const count = Math.round(Math.min(16, Math.max(4, 3 + multiplier / 10)));
    for (let i = 0; i < count; i++) {
      const coin = new FlyingCoin(x, y, target, i * 45);
      this.effectsLayer.addChild(coin);
      this.coins.push(coin);
    }
  }

  private removeBullet(index: number): void {
    const bullet = this.bullets[index];
    this.bulletTargets.delete(bullet);
    this.bulletsLayer.removeChild(bullet);
    bullet.destroy();
    this.bullets.splice(index, 1);
  }

  destroy(): void {
    this.destroyed = true;
    this.app.ticker.remove(this.onTick);
    this.app.stage.off("pointermove", this.onPointerMove);
    this.app.stage.off("pointerdown", this.onPointerDown);
    this.root.destroy({ children: true });
  }
}
