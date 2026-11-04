/**
 * Cuts the Zeus vs Hades art out of the packed sheets in public/symbols/zeusVsHades/sharedItems
 * into named PNGs under public/symbols/zeusVsHades/game/, following zeusVsHades-slice.spec.json
 * (the sheets ship without atlas files, so the rectangles there were measured by hand).
 *
 *   node scripts/zeusVsHades-slice.mjs
 *
 * Needs Playwright (Chromium is used as the image decoder/encoder); run it from a folder where
 * `playwright` resolves, or `npm i -D playwright` first. One-off asset step, not part of the build.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "public/symbols/zeusVsHades/sharedItems");
const OUT_DIR = path.join(ROOT, "public/symbols/zeusVsHades/game");
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/zeusVsHades-slice.spec.json"), "utf8"));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body></body>");

for (const item of spec.items) {
  const srcPath = path.join(SRC_DIR, item.src);
  const mime = srcPath.endsWith(".jpg") ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,` + fs.readFileSync(srcPath).toString("base64");
  if (item.parts) {
    // Several pieces of one sheet joined into one image (frames the packer split in two).
    const png = await page.evaluate(
      async ({ dataUrl, size, parts }) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement("canvas");
        [c.width, c.height] = size;
        const ctx = c.getContext("2d");
        for (const { rect, at } of parts) ctx.drawImage(img, ...rect, at[0], at[1], rect[2], rect[3]);
        return c.toDataURL("image/png");
      },
      { dataUrl, size: item.size, parts: item.parts }
    );
    const outPath = path.join(OUT_DIR, item.out + ".png");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(png.split(",")[1], "base64"));
    continue;
  }
  const png = await page.evaluate(
    async ({ dataUrl, rect, rot, keepJpeg, clear }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const [x, y, w, h] = rect ?? [0, 0, img.width, img.height];
      const turned = rot === 90 || rot === 270;
      const c = document.createElement("canvas");
      c.width = turned ? h : w;
      c.height = turned ? w : h;
      const ctx = c.getContext("2d");
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(((rot ?? 0) * Math.PI) / 180);
      ctx.drawImage(img, x, y, w, h, -w / 2, -h / 2, w, h);
      if (clear) {
        // Erase a polygon (in output pixels) — for stray pieces the packer put inside a rect.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        clear.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        ctx.fill();
      }
      return c.toDataURL(keepJpeg ? "image/jpeg" : "image/png", 0.9);
    },
    { dataUrl, rect: item.rect, rot: item.rot, keepJpeg: mime === "image/jpeg", clear: item.clear }
  );
  const ext = mime === "image/jpeg" ? ".jpg" : ".png";
  const outPath = path.join(OUT_DIR, item.out + ext);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(png.split(",")[1], "base64"));
}

await browser.close();
console.log(`wrote ${spec.items.length} files to ${path.relative(ROOT, OUT_DIR)}`);
