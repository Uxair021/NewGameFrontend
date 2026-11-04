/**
 * Packs the provided symbol win-animation frame folders (public/symbols/zeusVsHades/<folder>/*.png)
 * into one sprite sheet per animation: game/anim/<name>.webp + <name>.json.
 *
 *   node scripts/zeusVsHades-anims.mjs
 *
 * The source frames are huge (up to 2160px, ~300 MB in total); each is cropped to the area any
 * frame ever uses and scaled so the first frame is drawn at 2x the symbol's on-screen size
 * (crisp on high-DPI screens). The JSON records the frame grid and where the first frame's
 * symbol sits, so the game can line the animation up exactly over the static symbol.
 *
 * Needs Playwright (Chromium decodes/encodes the images); set PLAYWRIGHT_PATH if `playwright`
 * isn't resolvable from here. One-off asset step, not part of the build.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public/symbols/zeusVsHades");
const OUT = path.join(SRC, "game/anim");

/** Folder -> output name. Keep in sync with SYMBOL_ANIMS in src/games/ZeusVsHades/art.ts. */
const ANIMS = {
  Wild: "wild",
  hades: "hades",
  hadesCup: "hades-chalice",
  hadesDog: "cerberus",
  olympusEgle: "eagle",
  plumpusCup: "olympus-chalice",
  olympusHorse: "pegasus",
  olympusHouse: "olympus-temple",
  hadesHouse: "hades-temple",
};

/** Reel cell size in the game (ZeusVsHadesScene CELL_W/CELL_H) and how much of it a symbol fills. */
const CELL = { w: 143, h: 109, fit: 0.98 };
const TEXTURE_SCALE = 2;
const MAX_SHEET = 4096;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body></body>");

for (const [folder, name] of Object.entries(ANIMS)) {
  const dir = path.join(SRC, folder);
  if (!fs.existsSync(dir)) {
    console.warn(`skip ${folder}: not found`);
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();

  // Pass 1: bounding box of the visible pixels, per frame.
  const boxes = [];
  for (const f of files) {
    const dataUrl = "data:image/png;base64," + fs.readFileSync(path.join(dir, f)).toString("base64");
    boxes.push(
      await page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y += 2)
          for (let x = 0; x < c.width; x += 2)
            if (d[(y * c.width + x) * 4 + 3] > 12) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
        return { W: img.width, H: img.height, x0, y0, x1: x1 + 1, y1: y1 + 1 };
      }, dataUrl)
    );
  }
  const u = boxes.reduce(
    (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  );
  const f0 = boxes[0];

  // Scale: the first frame's symbol at TEXTURE_SCALE x its on-screen size; shrink further if the
  // whole sheet wouldn't fit in MAX_SHEET.
  const f0w = f0.x1 - f0.x0, f0h = f0.y1 - f0.y0;
  let scale = (TEXTURE_SCALE * CELL.fit * Math.min(CELL.w / f0w, CELL.h / f0h));
  const uw = u.x1 - u.x0, uh = u.y1 - u.y0;
  let cols, rows, fw, fh;
  for (;;) {
    fw = Math.ceil(uw * scale);
    fh = Math.ceil(uh * scale);
    cols = Math.max(1, Math.floor(MAX_SHEET / fw));
    rows = Math.ceil(files.length / cols);
    if (rows * fh <= MAX_SHEET) break;
    scale *= 0.92;
  }

  // Pass 2: draw every frame into the sheet.
  const sheet = await page.evaluateHandle(
    ({ w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    },
    { w: cols * fw, h: rows * fh }
  );
  for (let i = 0; i < files.length; i++) {
    const dataUrl = "data:image/png;base64," + fs.readFileSync(path.join(dir, files[i])).toString("base64");
    await page.evaluate(
      async ({ sheet, src, sx, sy, sw, sh, dx, dy, dw, dh }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const ctx = sheet.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      },
      { sheet, src: dataUrl, sx: u.x0, sy: u.y0, sw: uw, sh: uh, dx: (i % cols) * fw, dy: Math.floor(i / cols) * fh, dw: fw, dh: fh }
    );
  }
  const webp = await page.evaluate((c) => c.toDataURL("image/webp", 0.88), sheet);
  fs.writeFileSync(path.join(OUT, `${name}.webp`), Buffer.from(webp.split(",")[1], "base64"));

  const meta = {
    frames: files.length,
    cols,
    frameW: fw,
    frameH: fh,
    textureScale: TEXTURE_SCALE,
    // Centre of the first frame's symbol, in frame pixels — aligned to the cell centre in-game.
    anchorX: +(((f0.x0 + f0.x1) / 2 - u.x0) * scale).toFixed(1),
    anchorY: +(((f0.y0 + f0.y1) / 2 - u.y0) * scale).toFixed(1),
    fps: 25,
  };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(meta, null, 2) + "\n");
  const kb = Math.round(fs.statSync(path.join(OUT, `${name}.webp`)).size / 1024);
  console.log(`${folder} -> anim/${name}.webp  ${files.length} frames ${fw}x${fh} (${cols}x${rows})  ${kb} KB`);
}
await browser.close();
