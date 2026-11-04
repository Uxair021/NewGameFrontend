/**
 * Converts a provided expanding-wild GIF (full-canvas recording, one reel strip inside) into a
 * small cropped WebM the game can play as a video texture. A 1056x836x150-frame GIF would take
 * ~500 MB to decode in the browser; the cropped video is a few MB and one texture.
 *
 *   node scripts/zeusVsHades-gif2webm.cjs <input.gif> <output.webm>
 *
 * Needs Playwright (Chromium encodes the JPEG frames) and an ffmpeg with the libvpx encoder and
 * mjpeg decoder; set FFMPEG to its path (Playwright's bundled ffmpeg works) and PLAYWRIGHT_PATH
 * if `playwright` isn't resolvable from here. One-off asset step, not part of the build.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { parseGIF, decompressFrames } = require("gifuct-js");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/zeusVsHades-gif2webm.cjs <input.gif> <output.webm>");
  process.exit(1);
}
const FFMPEG = process.env.FFMPEG || "ffmpeg";

(async () => {
  const gif = parseGIF(fs.readFileSync(input));
  const frames = decompressFrames(gif, true);
  const W = gif.lsd.width;
  const H = gif.lsd.height;
  const fps = Math.round(1000 / (frames[0].delay || 40));

  // Composite every frame (honouring disposal) and find the area that's ever drawn.
  const canvas = new Uint8ClampedArray(W * H * 4);
  const composited = [];
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const f of frames) {
    const { left, top, width, height } = f.dims;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4;
        if (f.patch[s + 3] === 0) continue;
        const d = ((y + top) * W + (x + left)) * 4;
        canvas[d] = f.patch[s];
        canvas[d + 1] = f.patch[s + 1];
        canvas[d + 2] = f.patch[s + 2];
        canvas[d + 3] = 255;
      }
    }
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (canvas[(y * W + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    composited.push(Buffer.from(canvas));
    if (f.disposalType === 2) {
      for (let y = 0; y < height; y++) canvas.fill(0, ((y + top) * W + left) * 4, ((y + top) * W + left + width) * 4);
    }
  }
  // Even dimensions for the encoder.
  const cw = (x1 - x0 + 2) & ~1;
  const ch = (y1 - y0 + 2) & ~1;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<body></body>");
  // Some ffmpeg builds (e.g. Playwright's) can't read stdin, so the JPEG stream goes to a temp
  // file that the image2pipe demuxer reads back.
  const stream = path.join(os.tmpdir(), `zvh-${process.pid}.mjpeg`);
  const fd = fs.openSync(stream, "w");

  for (const rgba of composited) {
    // Crop here so only the reel strip crosses into the browser.
    const crop = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      const sy = Math.min(H - 1, y0 + y);
      const sx = x0;
      const len = Math.min(cw, W - sx) * 4;
      rgba.copy(crop, y * cw * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + len);
    }
    const jpeg = await page.evaluate(
      ({ b64, cw, ch }) => {
        const raw = Uint8ClampedArray.from(atob(b64), (c) => c.charCodeAt(0));
        for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
        const out = document.createElement("canvas");
        out.width = cw;
        out.height = ch;
        out.getContext("2d").putImageData(new ImageData(raw, cw, ch), 0, 0);
        return out.toDataURL("image/jpeg", 0.95).split(",")[1];
      },
      { b64: crop.toString("base64"), cw, ch }
    );
    fs.writeSync(fd, Buffer.from(jpeg, "base64"));
  }
  fs.closeSync(fd);
  await browser.close();

  const ff = spawn(FFMPEG, [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", stream,
    "-c:v", "libvpx", "-b:v", "3M", "-crf", "8", "-pix_fmt", "yuv420p", "-auto-alt-ref", "0",
    output,
  ]);
  ff.stderr.pipe(process.stderr);
  await new Promise((resolve, reject) => ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  fs.unlinkSync(stream);
  const kb = Math.round(fs.statSync(output).size / 1024);
  console.log(`${path.basename(input)} -> ${path.basename(output)}: ${frames.length} frames @${fps}fps, ${cw}x${ch}, ${kb} KB`);
})();
