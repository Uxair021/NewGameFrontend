/**
 * Shrinks Fish Game creature art to what the game actually needs, so it fits in GPU memory.
 *
 * Why: the GPU stores every frame uncompressed (width × height × 4 bytes) no matter whether the
 * file is PNG or WebP, and most frames were exported far bigger than they're ever drawn. For
 * each species this:
 *   1. crops every frame to one shared bounding box of visible pixels (shared, so the
 *      animation doesn't wobble),
 *   2. resizes to its on-screen size × QUALITY (a little headroom for high-DPI screens) — never
 *      upscales,
 *   3. keeps every 2nd frame on sequences longer than LONG_SEQUENCE (fps is halved to match, so
 *      it plays at the same speed),
 *   4. saves as WebP (frame_0000.webp ...).
 *
 * Usage (from frontEnd/, needs `sharp` and `esbuild` resolvable — e.g. `npm i -D sharp`):
 *   node scripts/optimize-fish-art.cjs stage [folder ...]   → writes to OUT_DIR, prints a report
 *   node scripts/optimize-fish-art.cjs apply [folder ...]   → backs up originals to BACKUP_DIR,
 *                                                             copies staged art in, updates species.ts
 * With no folders it processes every species. Run it only on NEW creatures later: a species that
 * was already processed is already at its on-screen size, but would lose half its frames again.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const esbuild = require("esbuild");

const FRONTEND = path.resolve(__dirname, "..");
const PUBLIC = path.join(FRONTEND, "public");
const ART_DIR = path.join(PUBLIC, "symbols", "fishGame");
const SPECIES_TS = path.join(FRONTEND, "src", "games", "FishGame", "pixi", "species.ts");
const OUT_DIR = process.env.FISH_ART_OUT || path.join(FRONTEND, ".fish-art-staging");
const BACKUP_DIR = process.env.FISH_ART_BACKUP || path.resolve(FRONTEND, "..", "fishGame-originals");

const QUALITY = 1.25; // stored resolution = on-screen size × this
const LONG_SEQUENCE = 60; // more frames than this → keep every 2nd one
const ALPHA_THRESHOLD = 8; // alpha at or below this counts as empty when cropping
const PAD = 4; // px of breathing room kept around the crop
const WEBP = { quality: 86, alphaQuality: 90, effort: 5 };

function loadSpecies() {
  const out = esbuild.buildSync({ entryPoints: [SPECIES_TS], bundle: true, write: false, format: "cjs", platform: "node" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

async function alphaBounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < info.width; x++) {
      if (data[row + x] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { width: info.width, height: info.height, minX, minY, maxX, maxY };
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

async function stageSpecies(lib, species) {
  const framePaths = Array.from({ length: species.frameCount }, (_, i) => path.join(PUBLIC, lib.speciesFramePath(species, i)));
  const missing = framePaths.filter((p) => !fs.existsSync(p));
  if (missing.length) return { folder: species.folder, skipped: `${missing.length} frame file(s) missing, e.g. ${missing[0]}` };

  const halve = species.frameCount > LONG_SEQUENCE;
  const kept = framePaths.filter((_, i) => !halve || i % 2 === 0);

  // Some sets (e.g. turtle) were trimmed per frame, so frames differ in size. The game draws each
  // frame centered (anchor 0.5), so place every frame centered on one common canvas first — that
  // reproduces exactly what's on screen — then find one shared crop box across all of them.
  const bounds = [];
  for (const file of kept) bounds.push(await alphaBounds(file));
  const srcW = Math.max(...bounds.map((b) => b.width));
  const srcH = Math.max(...bounds.map((b) => b.height));
  const offsets = bounds.map((b) => ({ x: Math.floor((srcW - b.width) / 2), y: Math.floor((srcH - b.height) / 2) }));

  let box = null, diskBefore = 0;
  bounds.forEach((b, i) => {
    if (b.maxX < 0) return; // fully transparent frame
    const o = offsets[i];
    const fb = { minX: b.minX + o.x, minY: b.minY + o.y, maxX: b.maxX + o.x, maxY: b.maxY + o.y };
    box = box
      ? { minX: Math.min(box.minX, fb.minX), minY: Math.min(box.minY, fb.minY), maxX: Math.max(box.maxX, fb.maxX), maxY: Math.max(box.maxY, fb.maxY) }
      : fb;
  });
  for (const file of framePaths) diskBefore += fs.statSync(file).size;
  if (!box) return { folder: species.folder, skipped: "every frame is fully transparent" };

  const left = Math.max(0, box.minX - PAD);
  const top = Math.max(0, box.minY - PAD);
  const cropW = Math.min(srcW, box.maxX + PAD + 1) - left;
  const cropH = Math.min(srcH, box.maxY + PAD + 1) - top;

  const factor = Math.min(1, species.size * QUALITY);
  const outW = Math.max(1, Math.round(cropW * factor));
  const outH = Math.max(1, Math.round(cropH * factor));

  const outFolder = path.join(OUT_DIR, species.folder);
  fs.rmSync(outFolder, { recursive: true, force: true });
  fs.mkdirSync(outFolder, { recursive: true });
  let diskAfter = 0;
  for (let i = 0; i < kept.length; i++) {
    const outFile = path.join(outFolder, `frame_${String(i).padStart(4, "0")}.webp`);
    const b = bounds[i];
    const o = offsets[i];
    // Center on the common canvas (as a buffer, so the crop applies after the padding), then crop.
    const centered = await sharp(kept[i])
      .ensureAlpha()
      .extend({
        left: o.x,
        top: o.y,
        right: srcW - b.width - o.x,
        bottom: srcH - b.height - o.y,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    await sharp(centered).extract({ left, top, width: cropW, height: cropH }).resize(outW, outH).webp(WEBP).toFile(outFile);
    diskAfter += fs.statSync(outFile).size;
  }

  // Keeps the on-screen size identical: the art is now `factor` times smaller, so draw it 1/factor bigger.
  const newSize = Number((species.size / factor).toFixed(4));
  return {
    folder: species.folder,
    // A lone still image sitting directly in fishGame/ (not a frame sequence in a folder).
    single: Boolean(species.framePath) && species.frameCount === 1,
    framesBefore: species.frameCount,
    framesAfter: kept.length,
    halved: halve,
    before: `${srcW}x${srcH}`,
    after: `${outW}x${outH}`,
    sizeBefore: species.size,
    sizeAfter: newSize,
    fpsMin: halve ? Number((species.fpsMin / 2).toFixed(2)) : species.fpsMin,
    fpsMax: halve ? Number((species.fpsMax / 2).toFixed(2)) : species.fpsMax,
    gpuBefore: species.frameCount * srcW * srcH * 4,
    gpuAfter: kept.length * outW * outH * 4,
    diskBefore,
    diskAfter,
    sourceFiles: framePaths,
  };
}

function printReport(results) {
  let gb = 0, ga = 0, db = 0, da = 0;
  console.log("folder      frames      size(px)               scale          GPU MB          disk MB");
  for (const r of results) {
    if (r.skipped) {
      console.log(`${r.folder.padEnd(11)} SKIPPED — ${r.skipped}`);
      continue;
    }
    gb += r.gpuBefore; ga += r.gpuAfter; db += r.diskBefore; da += r.diskAfter;
    console.log(
      `${r.folder.padEnd(11)} ${String(r.framesBefore).padStart(3)}→${String(r.framesAfter).padEnd(4)} ` +
        `${r.before.padStart(9)}→${r.after.padEnd(10)} ${String(r.sizeBefore).padStart(5)}→${String(r.sizeAfter).padEnd(7)} ` +
        `${mb(r.gpuBefore).padStart(6)}→${mb(r.gpuAfter).padEnd(7)} ${mb(r.diskBefore).padStart(6)}→${mb(r.diskAfter)}`
    );
  }
  console.log(`TOTAL  GPU ${mb(gb)} MB → ${mb(ga)} MB   disk ${mb(db)} MB → ${mb(da)} MB`);
}

/** Rewrites one species entry in species.ts: frame naming, count, size, and fps if halved. */
function updateSpeciesSource(source, r) {
  const start = source.indexOf(`folder: "${r.folder}",`);
  if (start < 0) throw new Error(`species.ts: no entry for ${r.folder}`);
  const blockStart = source.lastIndexOf("{", start);
  const blockEnd = source.indexOf("\n  },", start);
  let block = source.slice(blockStart, blockEnd);

  const replaceLine = (key, value) => {
    const re = new RegExp(`(\\n\\s*)${key}: [^\\n]*,`);
    if (!re.test(block)) throw new Error(`species.ts: ${r.folder} has no ${key}`);
    block = block.replace(re, `$1${key}: ${value},`);
  };

  replaceLine("frameCount", r.framesAfter);
  replaceLine("size", r.sizeAfter);
  if (r.halved) {
    replaceLine("fpsMin", r.fpsMin);
    replaceLine("fpsMax", r.fpsMax);
  }
  replaceLine("frameFile", r.single ? `() => "frame_0000.webp"` : `paddedFrames("frame_", 4, "webp", 0)`);
  // The optimized frames always live in the species' own folder, so any custom source path goes.
  block = block.replace(/\n\s*framePath: [^\n]*,/, "");
  return source.slice(0, blockStart) + block + source.slice(blockEnd);
}

async function main() {
  const [mode, ...folders] = process.argv.slice(2);
  if (mode !== "stage" && mode !== "apply") {
    console.error("usage: node scripts/optimize-fish-art.cjs <stage|apply> [folder ...]");
    process.exit(1);
  }
  const reportFile = path.join(OUT_DIR, "report.json");

  if (mode === "stage") {
    const lib = loadSpecies();
    const selected = lib.SPECIES.filter((s) => folders.length === 0 || folders.includes(s.folder));
    const results = [];
    for (const species of selected) {
      process.stdout.write(`processing ${species.folder}...\r`);
      results.push(await stageSpecies(lib, species));
    }
    printReport(results);
    fs.writeFileSync(reportFile, JSON.stringify(results, null, 2));
    console.log(`\nStaged in ${OUT_DIR} — nothing in public/ was changed. Run "apply" to install.`);
    return;
  }

  // apply: installs exactly what "stage" produced (no reprocessing). Whatever is in the species'
  // folder right now is backed up first (under a new name if a backup already exists), so
  // re-running after a partial failure is safe too — it just re-installs the same staged frames.
  const results = JSON.parse(fs.readFileSync(reportFile, "utf8")).filter(
    (r) => !r.skipped && (folders.length === 0 || folders.includes(r.folder))
  );
  let source = fs.readFileSync(SPECIES_TS, "utf8");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const r of results) {
    const liveFolder = path.join(ART_DIR, r.folder);
    const staged = path.join(OUT_DIR, r.folder);
    if (r.single) {
      // A lone image in fishGame/ — back it up, then the species gets its own folder like the rest.
      for (const file of r.sourceFiles) {
        const backup = path.join(BACKUP_DIR, path.basename(file));
        if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
        if (fs.existsSync(file)) fs.rmSync(file);
      }
      fs.cpSync(staged, liveFolder, { recursive: true });
    } else {
      // Copy-then-replace rather than renaming the folder: Windows refuses to rename a folder the
      // dev server or editor is watching, but replacing the files inside it works. A species whose
      // source frames live elsewhere (framePath) may not have a folder here yet.
      if (fs.existsSync(liveFolder)) {
        let backup = path.join(BACKUP_DIR, r.folder);
        if (fs.existsSync(backup)) backup = path.join(BACKUP_DIR, `${r.folder}-replaced-${Date.now()}`);
        fs.cpSync(liveFolder, backup, { recursive: true });
        for (const name of fs.readdirSync(liveFolder)) fs.rmSync(path.join(liveFolder, name), { recursive: true });
      }
      fs.cpSync(staged, liveFolder, { recursive: true });
    }
    source = updateSpeciesSource(source, r);
  }
  // Written in place (not delete-and-recreate) so a running dev server never sees an empty file.
  fs.writeFileSync(SPECIES_TS, source);
  console.log(`Installed ${results.length} species. Originals are in ${BACKUP_DIR}. species.ts updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
