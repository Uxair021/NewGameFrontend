import { Assets, Rectangle, Texture } from "pixi.js";
import type { Profile } from "../engine";
import {
  BACKGROUNDS,
  COLUMN_BORDER,
  COLUMN_FX,
  COLUMN_STONE,
  LOGO,
  REEL_FRAMES,
  SYMBOL_IDS,
  WIN_FRAMES,
  CELEBRATION_FX,
  SYMBOL_ANIMS,
  SYMBOL_LIGHTNING,
  LETTER_FIRE_HADES,
  LETTER_LIGHTNING_OLYMPUS,
  symbolAnimUrl,
  type SymbolAnimMeta,
  WIN_WORDS,
  WILD_VIDEOS,
  DIGIT_SHEET,
  DIGIT_FRAMES,
  blurUrl,
  symbolUrl,
  type Frame,
  type WildClipId,
} from "../art";

/** Display names now live in art.ts (so non-Pixi code can use them without loading Pixi). */
export { SYMBOL_NAMES } from "../art";

export interface SymbolTextures {
  get(symbol: number, profile: Profile): Texture;
  /** Motion-blurred version shown while a reel spins. */
  blurred(symbol: number, profile: Profile): Texture;
}

export interface SceneArt {
  olympusSky: Texture;
  olympusTemple: Texture;
  hadesBg: Texture;
  reelFrames: Record<Profile, Texture>;
  /** Null if the logo file is missing — the game still runs without it. */
  logo: Texture | null;
  winFrames: Record<Profile, Texture[]>;
  columnFx: Record<Profile, Texture[]>;
  columnStone: Texture;
  columnBorder: Texture;
  words: { nice: Texture; mega: Texture; superb: Texture; sensational: Texture; bar: Texture };
  /** Object URLs of the downloaded expanding-wild clips (missing = not loaded). */
  wildVideos: Partial<Record<WildClipId, string>>;
  /** Gold digits "0"-"9" and "x" for relabelled wild multipliers. */
  digits: Record<string, Texture>;
  clouds: Texture;
  bolts: Texture[];
  /** Win-animation frames + layout, by animation name (missing = failed to load, use the pulse). */
  symbolAnims: Record<string, { frames: Texture[]; meta: SymbolAnimMeta }>;
  /** Behind winning Olympus symbols: lightning bolt frames + two smoky cloud puffs. */
  symbolLightning: { bolts: Texture[]; clouds: Texture[] };
  /** Hades letter-fire win animation parts by symbol (10, J, K); a sheet that fails is left out. */
  /** Olympus letter-lightning parts by symbol (A, K, J, Q, helmet). */
  letterLightning: Record<number, { glow: Texture; bolt: Texture; shine: Texture[] }>;
  letterFire: Record<number, { fire: { tex: Texture; rot: boolean }[]; fireTen: Texture | null }>;
}

/** Loads every packed symbol win animation; one that fails is just left out. */
async function loadSymbolAnims(): Promise<Record<string, { frames: Texture[]; meta: SymbolAnimMeta }>> {
  const names = [...new Set(Object.values(SYMBOL_ANIMS).flatMap((m) => Object.values(m)))] as string[];
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const [meta, sheet] = await Promise.all([
          fetch(symbolAnimUrl(name, "json")).then((r) => r.json() as Promise<SymbolAnimMeta>),
          Assets.load<Texture>(symbolAnimUrl(name, "webp")),
        ]);
        const frames = Array.from({ length: meta.frames }, (_, i) =>
          crop(sheet, {
            x: (i % meta.cols) * meta.frameW,
            y: Math.floor(i / meta.cols) * meta.frameH,
            w: meta.frameW,
            h: meta.frameH,
          })
        );
        return [name, { frames, meta }] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e) => e !== null));
}

/** Loads the Olympus letter-lightning sheets. */
async function loadLetterLightning(): Promise<Record<number, { glow: Texture; bolt: Texture; shine: Texture[] }>> {
  const entries = await Promise.all(
    Object.entries(LETTER_LIGHTNING_OLYMPUS).map(async ([sym, spec]) => {
      try {
        const sheet = await Assets.load<Texture>(spec.src);
        return [
          Number(sym),
          { glow: crop(sheet, spec.glow), bolt: crop(sheet, spec.bolt), shine: spec.shine.map((fr) => crop(sheet, fr)) },
        ] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e) => e !== null));
}

/** Loads the Hades letter-fire sheets (10, J, K). */
async function loadLetterFire(): Promise<Record<number, { fire: { tex: Texture; rot: boolean }[]; fireTen: Texture | null }>> {
  const entries = await Promise.all(
    Object.entries(LETTER_FIRE_HADES).map(async ([sym, spec]) => {
      try {
        const sheet = await Assets.load<Texture>(spec.src);
        return [
          Number(sym),
          { fire: spec.fire.map(({ frame, rot }) => ({ tex: crop(sheet, frame), rot })), fireTen: spec.shape ? crop(sheet, spec.shape) : null },
        ] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e) => e !== null));
}

/** Downloads the wild videos up front so they start instantly; a failure just skips that video. */
async function loadWildVideos(): Promise<Partial<Record<WildClipId, string>>> {
  const entries = await Promise.all(
    (Object.entries(WILD_VIDEOS) as [WildClipId, (typeof WILD_VIDEOS)[WildClipId]][]).map(async ([clip, v]) => {
      try {
        const res = await fetch(v.src);
        if (!res.ok) return null;
        return [clip, URL.createObjectURL(await res.blob())] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e): e is readonly [WildClipId, string] => e !== null));
}

const crop = (sheet: Texture, fr: Frame) =>
  new Texture({ source: sheet.source, frame: new Rectangle(fr.x, fr.y, fr.w, fr.h) });

const PROFILES: Profile[] = ["olympus", "hades"];

export async function loadArt(): Promise<{ symbols: SymbolTextures; scene: SceneArt }> {
  const load = (src: string) => Assets.load<Texture>(src);

  const symbolEntries = PROFILES.flatMap((p) =>
    SYMBOL_IDS.map(async (id) => [`${p}-${id}`, await load(symbolUrl(id, p)), await load(blurUrl(id, p))] as const)
  );
  const [letterLightning, letterFire, symbolLightningSheet, symbolAnims, clouds, bolts, wildVideos, digitSheet, wfO, wfH, symbolList, olympusSky, olympusTemple, hadesBg, frameO, frameH, logo, cfO, cfH, stone, border, ...words] =
    await Promise.all([
      loadLetterLightning(),
      loadLetterFire(),
      load(SYMBOL_LIGHTNING.src),
      loadSymbolAnims(),
      load(CELEBRATION_FX.clouds),
      Promise.all(CELEBRATION_FX.bolts.map(load)),
      loadWildVideos(),
      load(DIGIT_SHEET),
      Promise.all(WIN_FRAMES.olympus.srcs.map(load)),
      Promise.all(WIN_FRAMES.hades.srcs.map(load)),
      Promise.all(symbolEntries),
      load(BACKGROUNDS.olympusSky),
      load(BACKGROUNDS.olympusTemple),
      load(BACKGROUNDS.hades),
      load(REEL_FRAMES.olympus.src),
      load(REEL_FRAMES.hades.src),
      load(LOGO).catch(() => null),
      load(COLUMN_FX.olympus.src),
      load(COLUMN_FX.hades.src),
      load(COLUMN_STONE),
      load(COLUMN_BORDER),
      load(WIN_WORDS.nice),
      load(WIN_WORDS.mega),
      load(WIN_WORDS.superb),
      load(WIN_WORDS.sensational),
      load(WIN_WORDS.bar),
    ]);

  const sharp = new Map<string, Texture>();
  const blur = new Map<string, Texture>();
  for (const [key, s, b] of symbolList) {
    sharp.set(key, s);
    blur.set(key, b);
  }

  return {
    symbols: {
      get: (symbol, profile) => sharp.get(`${profile}-${symbol}`) ?? Texture.EMPTY,
      blurred: (symbol, profile) => blur.get(`${profile}-${symbol}`) ?? sharp.get(`${profile}-${symbol}`) ?? Texture.EMPTY,
    },
    scene: {
      olympusSky,
      olympusTemple,
      hadesBg,
      reelFrames: { olympus: frameO, hades: frameH },
      logo,
      winFrames: { olympus: wfO, hades: wfH },
      columnFx: {
        olympus: COLUMN_FX.olympus.frames.map((fr) => crop(cfO, fr)),
        hades: COLUMN_FX.hades.frames.map((fr) => crop(cfH, fr)),
      },
      columnStone: stone,
      columnBorder: border,
      words: { nice: words[0], mega: words[1], superb: words[2], sensational: words[3], bar: words[4] },
      wildVideos,
      clouds,
      bolts,
      symbolAnims,
      letterFire,
      letterLightning,
      symbolLightning: {
        bolts: SYMBOL_LIGHTNING.bolts.map((fr) => crop(symbolLightningSheet, fr)),
        clouds: SYMBOL_LIGHTNING.clouds.map((fr) => crop(symbolLightningSheet, fr)),
      },
      digits: Object.fromEntries(Object.entries(DIGIT_FRAMES).map(([ch, fr]) => [ch, crop(digitSheet, fr)])),
    },
  };
}
