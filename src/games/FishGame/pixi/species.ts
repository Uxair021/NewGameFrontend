// Pure data (no Pixi imports) so non-game code like the admin panel can use it cheaply.

export interface SpeciesConfig {
  /** Folder name under public/symbols/fishGame/. */
  folder: string;
  /** How many frames that folder has. */
  frameCount: number;
  /** Filename (not full path) for frame index i (0-based) inside `folder`. */
  frameFile: (i: number) => string;
  /** How many of this creature swim on screen at once. Optional — omit it to auto-derive from
   * payoutMultiplier (see countForPayout below): common/cheap species get more, rare/valuable
   * ones fewer. Only set this explicitly to override that, e.g. count: 0 to disable a species
   * entirely while testing. */
  count?: number;
  /** Fixed scale applied to every copy of this species — all copies render at exactly this
   * size (only speed/animation timing vary per copy), so "make the turtle bigger" is a single
   * number to change here, not something that drifts between spawns. */
  size: number;
  /** Swim speed range (px/sec) — each copy picks its own random value in this range so the
   * group doesn't move in lockstep, but stays within a range you control per species. */
  speedMin: number;
  speedMax: number;
  /** Animation frame-rate range (frames/sec) for the swim-cycle flip-book. */
  fpsMin: number;
  fpsMax: number;
  /** false if the source art faces left instead of right (see Fish.ts). Defaults to true. */
  facesRight?: boolean;
  /** "pingpong" (default) for a short hand-drawn beat cycle, "forward" for a long pre-rendered
   * loop meant to play straight through and repeat. See Fish.ts. */
  loop?: "pingpong" | "forward";
  /** Degrees the source art's nose is drawn away from pointing along +x (screen convention:
   * negative = tilted up, positive = tilted down) — see Fish.ts. Defaults to 0. */
  artAngleDeg?: number;
  /** True to mirror instead of rotating past vertical, so this species never renders upside-
   * down — see Fish.ts. Off by default; set for large/prominent species where it's distracting
   * (WhiteTiger, shark). */
  preventUpsideDown?: boolean;
  /** True to move only left/right along a fixed y, with no arcing turns or rotation at all —
   * see Fish.ts. Off by default. */
  xAxisOnly?: boolean;
  /** Hex color for a soft blurred glow behind this species, tinted to match its own color — see
   * Fish.ts. Undefined (default) means no glow. */
  glowColor?: number;
  /** Default bet multiplier for this species, only used here to derive its on-screen count
   * (see countForPayout). The live payout is set per species by admins on the server
   * (backEnd/src/games/FishGame/config.ts) and comes back with each hit result. */
  payoutMultiplier: number;
  /** Full path for frame i, used instead of folder + frameFile — for art that isn't in its own
   * folder (e.g. a single still image sitting directly in public/symbols/fishGame/). `folder` is
   * still the species' id either way (it's what the server knows it by). */
  framePath?: (i: number) => string;
  /** Overrides HIT_RADIUS_FRACTION (see FishGameScene) — for art that fills most of its canvas,
   * where the default fraction would make the hit area much smaller than what you see. */
  hitRadiusFraction?: number;
  /** Special power when caught. "freeze": every creature on screen stops moving for a while. */
  effect?: "freeze";
  /** Rare visitors: how long (ms, random in [min, max]) this species stays away after being caught
   * or leaving the screen. Species with this set also start the game away (their first visit comes
   * after one such wait), so they come and go instead of always being on screen. Omit for normal
   * creatures, which come back after FishGameScene's short default wait. */
  absentMs?: [number, number];
  /** Chance (0–1) that each new wander target sends it off screen instead of somewhere inside —
   * higher means it passes through and leaves sooner. Defaults to Fish.ts's EXIT_PROBABILITY. */
  exitChance?: number;
}

/** The rarity ladder, rarest first: pot → frozenIce → tigers → crabs. Rarer = stays away longer
 * between visits. All of them lean toward leaving (exitChance) rather than lingering. */
const RARITY = {
  pot: { absentMs: [60_000, 120_000], exitChance: 0.8 },
  frozenIce: { absentMs: [40_000, 70_000], exitChance: 0.8 },
  tiger: { absentMs: [25_000, 45_000], exitChance: 0.75 },
  crab: { absentMs: [15_000, 30_000], exitChance: 0.7 },
} satisfies Record<string, Pick<SpeciesConfig, "absentMs" | "exitChance">>;

/** Frame files named like "prefix000.ext".."prefix0NN.ext" (zero-padded), counting up from
 * `start` (0 by default — pass 1 for a set numbered prefix01.ext, prefix02.ext, ...). */
function paddedFrames(prefix: string, pad: number, ext = "png", start = 1): (i: number) => string {
  return (i) => `${prefix}${String(i + start).padStart(pad, "0")}.${ext}`;
}

// One entry per creature type. Add a new species by dropping frames in a new folder under
// public/symbols/fishGame/ and adding a row here — everything else (loading, spawning,
// steering) is generic. Then shrink its art to what the game needs with
// `node scripts/optimize-fish-art.cjs stage <folder>` / `apply <folder>` (see that script).
//
// Every species below has been through that script: frames are cropped, stored at ~1.25× their
// on-screen size as frame_0000.webp.., and long sequences keep every 2nd frame (fps halved to
// match). So `size` is now ~0.8 for most (was the scale of the original oversized export) and some
// notes below describing the original files' names/sizes refer to the backups in
// texasSlots/fishGame-originals/, not what's in public/ now.
export const SPECIES: SpeciesConfig[] = [
  {
    folder: "GoldenFish",
    payoutMultiplier: 2,
    frameCount: 9,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 75,
    speedMax: 150,
    fpsMin: 6,
    fpsMax: 8,
  },
  {
    folder: "AnglusFish",
    payoutMultiplier: 3,
    frameCount: 8,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 150,
    fpsMin: 6,
    fpsMax: 8,
  },
  {
    // Frames named turtle_00000.png..turtle_00051.png (zero-padded, 0-based), each individually
    // auto-trimmed to its own content bounds (dimensions vary frame to frame — e.g. 210x185 vs
    // 190x205 — rather than sharing one fixed canvas). No companion fish baked in this time.
    folder: "turtle",    payoutMultiplier: 4,
    frameCount: 54,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 1.15,
    speedMin: 70,
    speedMax: 100,
    fpsMin: 30,
    fpsMax: 40,
    loop: "forward",
  },
  {
    // New species. Source was "fish_1(1).png".."fish_1(77).png" (2314x1283 PNGs, 43MB), trimmed
    // + re-encoded as WebP down to ~5.5MB, renamed to frame_0000.webp.. A fancy pink/magenta
    // fish with a cube-shaped head, faces left (head/eyes clearly on the left, fins trail right).
    folder: "fish1",    payoutMultiplier: 5,
    frameCount: 39,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 150,
    fpsMin: 15,
    fpsMax: 24,
    facesRight: false,
    loop: "forward",
  },
  {
    // Frames named fish_frame_01.png..fish_frame_50.png (zero-padded to 2 digits, 1-based).
    // This one's source art faces left, unlike every other species here, so facesRight: false.
    folder: "fish2",    payoutMultiplier: 6,
    frameCount: 39,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.88,
    speedMin: 75,
    speedMax: 100,
    fpsMin: 30,
    fpsMax: 39,
    facesRight: false,
    loop: "pingpong",
  },
  {
    // New species. Source was "fish001_00000.png".."fish001_00082.png" (2466x1380 PNGs, 55MB),
    // trimmed + re-encoded as WebP down to ~1.7MB, renamed to frame_0000.webp.. A small green/
    // tan pufferfish-like creature, faces right by default (eye clearly on the right).
    folder: "fish3",    payoutMultiplier: 8,
    frameCount: 42,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 70,
    speedMax: 120,
    fpsMin: 15,
    fpsMax: 24,
    loop: "forward",
  },
  {
    // Frames named fish32_00010.png..fish32_00060.png (5-digit padded, starting at 10, not 0/1).
    // A small spiky blue/gold fish, faces right by default like GoldenFish/AnglusFish/turtle.
    folder: "fish4",    payoutMultiplier: 10,
    frameCount: 51,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 180,
    fpsMin: 15,
    fpsMax: 22,
    loop: "forward",
  },
  {
    // New species. Source was "fish5(1).png".."fish5(73).png" (2314x1283 PNGs, 47MB), trimmed +
    // re-encoded as WebP down to ~2.1MB, renamed to frame_0000.webp.. A red-headed, yellow
    // fan-tailed angelfish, faces right by default. loop: "pingpong" plays 1..73..1..73.. (back
    // and forth) instead of snapping from frame 73 back to frame 1, as asked.
    folder: "fish5",    payoutMultiplier: 12,
    frameCount: 37,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 90,
    speedMax: 140,
    fpsMin: 15,
    fpsMax: 25,
    loop: "forward",
  },
  {
    // Frames named Animation12_00000.png..Animation12_00043.png (5-digit padded, 0-based). The
    // art itself is drawn nose-up-and-right at ~40-42° instead of straight along +x like every
    // other species, so artAngleDeg corrects for it — without this it would visibly swim
    // sideways relative to the direction it's actually moving.
    folder: "fish6",
    payoutMultiplier: 15,
    frameCount: 36,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.98,
    speedMin: 80,
    speedMax: 160,
    fpsMin: 20,
    fpsMax: 25,
    artAngleDeg: -41,
    loop: "forward",
  },
  {
    // Replaced with a new 43-frame set, now centered in its 500x500 canvas. Oddly named —
    // "Untitled-1_0000_fish7_00042.png" .. "Untitled-1_0042_fish7_00000.png" — where the
    // leading Untitled-1_ index is the real (ascending) frame order and the trailing fish7_
    // number just counts back down from 42 to 0 in lockstep (an artifact of whatever exported
    // it, not a second independent frame set), so frameFile reconstructs both halves together.
    // Its eye/head is still on the left in this new art too, so facesRight stays false — set to
    // true it would visibly swim backwards.
    folder: "fish7",    payoutMultiplier: 18,
    frameCount: 43,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.95,
    speedMin: 80,
    speedMax: 180,
    fpsMin: 20,
    fpsMax: 25,
    facesRight: false,
    loop: "forward",
  },
  {
    // Frames named fish8001_00000.png..fish8001_00039.png (5-digit padded, 0-based). A small
    // green spotted fish, faces right by default.
    folder: "fish8",
    payoutMultiplier: 20,
    frameCount: 30,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 1.45,
    speedMin: 80,
    speedMax: 180,
    fpsMin: 15,
    fpsMax: 20,
    facesRight: false,
    loop: "forward",
  },
  {
    // Frames named fish9_00000.png..fish9_00074.png (5-digit padded, 0-based). Small green fish,
    // already a reasonable size and cleanly cropped — no trim/WebP preprocessing needed.
    folder: "fish9",    payoutMultiplier: 22,
    frameCount: 38,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 1.1,
    speedMin: 120,
    speedMax: 180,
    fpsMin: 12.5,
    fpsMax: 15,
    facesRight: false,
    loop: "forward",
  },
  {
    // Source was a 101-frame set of 2160x1304 PNGs (70MB) oddly named
    // "1_0000_fish11_00099.png".."1_0100_fish11_00100.png" (the fish11_ number just counts
    // back down in lockstep with the real 1_ index, plus one extra frame at the very end that
    // breaks the mirror and reuses "100"). Trimmed to content + re-encoded as WebP down to
    // ~8.5MB (see scratchpad/trim_fish10_11_12.js) and renamed to plain frame_0000.webp..
    // frame_0100.webp so the folder doesn't have to carry that naming scheme forward. A blue
    // dolphin wearing swim goggles, faces right by default.
    folder: "fish10",    payoutMultiplier: 25,
    frameCount: 51,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 130,
    speedMax: 150,
    fpsMin: 22.5,
    fpsMax: 26,
    loop: "forward",
  },
  {
    // Same oversized-source story as fish10 (2160x1304 PNGs named "fish12 (1).png".."fish12
    // (43).png" despite living in the fish11 folder) — trimmed + re-encoded as WebP, renamed to
    // frame_0000.webp.. A green fish with a long ribbon dorsal fin, faces right by default.
    folder: "fish11",    payoutMultiplier: 28,
    frameCount: 43,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 90,
    speedMax: 150,
    fpsMin: 32,
    fpsMax: 48,
    loop: "forward",
  },
  {
    // Same story again — source was "fish12(1).png".."fish12(47).png" (2132x1288 PNGs, 49MB),
    // trimmed + re-encoded as WebP, renamed to frame_0000.webp.. A gold/tan spotted fish with a
    // long ribbon dorsal fin, faces right by default.
    folder: "fish12",    payoutMultiplier: 30,
    frameCount: 47,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 90,
    speedMax: 170,
    fpsMin: 12,
    fpsMax: 18,
    loop: "forward",
  },
  {
    // Re-added with a new 100-frame set — "fish13(1).png".."fish13(100).png" (2314x1283 PNGs,
    // 69MB), trimmed + re-encoded as WebP, renamed to frame_0000.webp.. Same creature family as
    // fish11/fish12 (spotted body, long ribbon dorsal fin) but this pose faces left, not right.
    // loop: "pingpong" plays it 1..100..1..100.. (back and forth) rather than snapping from
    // frame 100 back to frame 1, per how this set was asked to play.
    folder: "fish13",    payoutMultiplier: 35,
    frameCount: 50,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 70,
    speedMax: 100,
    fpsMin: 20,
    fpsMax: 30,
    facesRight: false,
    loop: "pingpong",
  },
  {
    // New species. Source was "fish14321_00010.png".."fish14321_00069.png" (2314x1283 PNGs,
    // 176MB!), trimmed + re-encoded as WebP down to ~4MB, renamed to frame_0000.webp.. A blue/
    // green cartoon manta ray, faces left (eyes on the left, tail point trails right).
    folder: "fish14",    payoutMultiplier: 40,
    frameCount: 60,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 90,
    speedMax: 120,
    fpsMin: 30,
    fpsMax: 40,
    facesRight: false,
    loop: "forward",
  },
  {
    // New species. Source was "fish15211_00000.png".."fish15211_00062.png" (2314x1283 PNGs,
    // 92MB), trimmed + re-encoded as WebP down to ~5.8MB, renamed to frame_0000.webp.. A
    // stylized gold/white swirl-patterned shark, faces left (broad head on the left, tail fin
    // on the right).
    folder: "fish15",    payoutMultiplier: 45,
    frameCount: 32,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 120,
    speedMax: 180,
    fpsMin: 12.5,
    fpsMax: 19,
    facesRight: false,
    loop: "pingpong",
  },
  {
    // New species. Source was "fish_16(1).png".."fish_16(89).png" (2314x1283 PNGs, 7.1MB —
    // already fairly small), trimmed + re-encoded as WebP down to ~1.1MB, renamed to
    // frame_0000.webp.. A small blue needle-nosed fish. Orientation is genuinely hard to read at
    // this resolution — treated as facing right (like fish4's similar silhouette: round
    // eye-marking near one end, thin tapered point at the other) — flip facesRight to false if
    // it looks backwards in practice.
    folder: "fish16",    payoutMultiplier: 50,
    frameCount: 45,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 100,
    speedMax: 180,
    fpsMin: 15,
    fpsMax: 24,
    loop: "pingpong",
  },
  {
    // New species. Source was "fish17_00000.png".."fish17_00084.png" (2466x1380 PNGs, 286MB!) —
    // the creature fills almost the entire canvas here (little transparent margin, unlike most
    // other species), so trimming saved less than usual, but WebP still brought it down to
    // ~18MB. Renamed to frame_0000.webp.. A large, detailed teal/yellow armored fish with an
    // orange-spotted back, faces right by default (eye/mouth clearly on the right, tail left).
    folder: "fish17",    payoutMultiplier: 55,
    frameCount: 40,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 50,
    speedMax: 120,
    fpsMin: 12.5,
    fpsMax: 24,
    loop: "forward",
  },
  {
    // New species. Source was "fish22_00000.png".."fish22_00044.png" (2162x1264 PNGs, 50MB),
    // trimmed + re-encoded as WebP down to ~2MB, renamed to frame_0000.webp.. An orange/pink
    // hammerhead-shark-like creature with a big eye, faces left (eye clearly on the left).
    folder: "fish22",    payoutMultiplier: 60,
    frameCount: 45,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 120,
    fpsMin: 25,
    fpsMax: 40,
    facesRight: false,
    loop: "forward",
  },
  {
    // New species. Source was "shark_00000.png".."shark_00030.png" (640x360 PNGs, 2.6MB —
    // already small, but content only filled ~30% of the canvas off-center, so trimmed anyway
    // for correct steering/hit-detection centering, same reason as every other species). Down
    // to ~0.4MB as WebP, renamed to frame_0000.webp.. A realistic great white shark, faces left
    // (head/mouth on the left, dorsal fin and tail on the right).
    folder: "shark",
    payoutMultiplier: 70,
    frameCount: 31,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 1.25,
    speedMin: 120,
    speedMax: 220,
    fpsMin: 20,
    fpsMax: 45,
    facesRight: false,
    preventUpsideDown: true,
    loop: "forward",
  },
  {
    // The main character. Re-exported again with a new winged-tiger rig — a leaping/pouncing
    // pose this time, not the old gliding one. Source was "whiteTiger_00000.png"..
    // "whiteTiger_00027.png" (2840x1591 PNGs, 144MB), trimmed + re-encoded as WebP down to
    // ~5.9MB, renamed to frame_0000.webp.. White/black striped, head almost dead-left with a
    // slight upward tilt (~8°), tail/hindquarters trailing right — facesRight + a small
    // artAngleDeg handle that, same pattern as every other diagonal species.
    folder: "tiger1",
    ...RARITY.tiger,
    payoutMultiplier: 150,
    frameCount: 25,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 150,
    speedMax: 220,
    fpsMin: 35,
    fpsMax: 35,
    facesRight: true,
    artAngleDeg: -2,
    preventUpsideDown: true,
    xAxisOnly: false,
    glowColor: 0xffffff,
    loop: "forward",
  },
  {
    // New species — same winged-tiger rig/pose as whiteTiger above, orange/black striped this
    // time. Source was "orangeTiger_00000.png".."orangeTiger_00027.png" (2840x1591 PNGs,
    // 132MB), trimmed + re-encoded as WebP down to ~4.9MB, redTiger_0027_orangeTiger_00000 renamed to frame_0000.webp..
    folder: "tiger2",
    ...RARITY.tiger,
    payoutMultiplier: 100,
    frameCount: 25,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 120,
    speedMax: 150,
    fpsMin: 35,
    fpsMax: 35,
    facesRight: true,
    artAngleDeg: -4,
    preventUpsideDown: false,
    xAxisOnly: false,
    glowColor: 0xff8c00,
    loop: "forward",
  },
  {
    // Same winged-tiger rig/pose as tiger1/tiger2, royal-blue/black striped — art from the
    // "tiger blue" folder (tigerBlue_00000.png..tigerBlue_00025.png, 1605x889).
    folder: "tiger3",
    ...RARITY.tiger,
    payoutMultiplier: 110,
    frameCount: 26,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.85,
    speedMin: 130,
    speedMax: 140,
    fpsMin: 35,
    fpsMax: 35,
    facesRight: true,
    artAngleDeg: 0,
    preventUpsideDown: true,
    xAxisOnly: false,
    glowColor: 0x2196f3,
    loop: "forward",
  },
  {
    // New species. Source was "creature_00000.png".."creature_00039.png" (1394x867 PNGs, 32MB),
    // trimmed + re-encoded as WebP down to ~2MB, renamed to frame_0000.webp.. A spiky rainbow-
    // colored sea-urchin/pom-pom ball — a 3D turntable render with no head or tail (radially
    // symmetric from every angle shown), so artAngleDeg/facesRight don't apply here; it just
    // drifts and tumbles like everything else.
    folder: "creature",    payoutMultiplier: 65,
    frameCount: 40,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 180,
    fpsMin: 25,
    fpsMax: 30,
    loop: "forward",
  },
  {
    // New species. Source was "crab1_00000.png".."crab1_00087.png" (1394x867 PNGs, 123MB),
    // trimmed + re-encoded as WebP down to ~7.8MB, renamed to frame_0000.webp.. A jeweled
    // clockwork crab, shown face-on the whole sequence (a slow turntable render, not a sideways
    // walk cycle) — no clear left/right facing, so artAngleDeg/facesRight don't apply.
    folder: "crab1",
    ...RARITY.crab,    payoutMultiplier: 75,
    frameCount: 44,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 170,
    fpsMin: 15,
    fpsMax: 30,
    loop: "pingpong",
  },
  {
    // New species. Source was "crab2_00000.png".."crab2_00091.png" (2488x1547 PNGs, 256MB),
    // trimmed + re-encoded as WebP down to ~13.6MB, renamed to frame_0000.webp.. A second
    // jeweled clockwork crab (orange/blue), same face-on turntable treatment as crab1 — no
    // clear left/right facing, so artAngleDeg/facesRight don't apply.
    folder: "crab2",
    ...RARITY.crab,    payoutMultiplier: 80,
    frameCount: 46,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 170,
    fpsMin: 15,
    fpsMax: 30,
    loop: "pingpong",
  },
  {
    // New species. Source was "crab2_00000.png".."crab2_00091.png" (2488x1547 PNGs, 256MB),
    // trimmed + re-encoded as WebP down to ~13.6MB, renamed to frame_0000.webp.. A second
    // jeweled clockwork crab (orange/blue), same face-on turntable treatment as crab1 — no
    // clear left/right facing, so artAngleDeg/facesRight don't apply.
    folder: "crab3",
    ...RARITY.crab,
    payoutMultiplier: 85,
    frameCount: 41,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 0.8,
    speedMin: 80,
    speedMax: 170,
    fpsMin: 20,
    fpsMax: 30,
    loop: "pingpong",
  },
  {
    // New species. Source was "wheel_00000.png".."wheel_00121.png" (1394x867 PNGs, 115MB),
    // trimmed + re-encoded as WebP down to ~5.9MB, renamed to frame_0000.webp.. A jeweled ship's
    // wheel that visibly spins across its own frame sequence — fully symmetric, so
    // artAngleDeg/facesRight don't apply.
    folder: "wheel",    payoutMultiplier: 200,
    frameCount: 61,
    frameFile: paddedFrames("frame_", 4, "webp", 0),
    size: 1.32,
    speedMin: 80,
    speedMax: 160,
    fpsMin: 25,
    fpsMax: 30,
    loop: "forward",
  },
  {
    // Special: a single still image (1394x1128 PNG) of a blue ice crystal. Catching it freezes
    // every creature's movement for 10–15s (see FishGameScene.startFreeze). Art fills most of its
    // canvas, so it gets a bigger hit area than the default.
    folder: "frozenIce",
    ...RARITY.frozenIce,
    count: 1,
    payoutMultiplier: 20,
    frameCount: 1,
    frameFile: () => "frame_0000.webp",
    size: 0.8,
    speedMin: 70,
    speedMax: 110,
    fpsMin: 1,
    fpsMax: 1,
    loop: "forward",
    hitRadiusFraction: 0.6,
    glowColor: 0x6fd3ff,
    effect: "freeze",
  },
  {
    // A single still image (1514x1039 PNG) of a gold-and-red treasure chest with a green glow
    // baked in. Moves only left/right so the chest never tilts or turns upside down.
    folder: "pot",
    ...RARITY.pot,
    count: 1,
    payoutMultiplier: 60,
    frameCount: 1,
    frameFile: () => "frame_0000.webp",
    size: 0.85,
    speedMin: 70,
    speedMax: 110,
    fpsMin: 1,
    fpsMax: 1,
    loop: "forward",
    xAxisOnly: false,
    hitRadiusFraction: 0.6,
  },
];

/** Path to frame i of a species' art. */
export function speciesFramePath(species: SpeciesConfig, i: number): string {
  return species.framePath?.(i) ?? `/symbols/fishGame/${species.folder}/${species.frameFile(i)}`;
}

/** First frame of a species' swim cycle — used as its thumbnail (e.g. in the admin panel). */
export function speciesPreviewPath(species: SpeciesConfig): string {
  return speciesFramePath(species, 0);
}
