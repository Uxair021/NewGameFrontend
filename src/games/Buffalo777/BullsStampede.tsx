import { useEffect, useRef } from "react";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "./pixi/Buffalo777Scene";

const FRAMES_BASE = "/symbols/buffalo777/bulls";
const BULLS_RUN_FRAME_COUNT = 15;

/** Herd size relative to the original 1918x784 art — 1 = original size. */
const BULLS_RUN_SCALE = 0.8;
/** The frame files on disk are this fraction of that original art (959x392), to save memory —
 * they're drawn back up to BULLS_RUN_SCALE, so changing the files only needs this updated. */
const BULLS_FRAME_FILE_SCALE = 0.5;
/** How long the herd takes to cross from just off the right edge to fully off the left. */
const BULLS_RUN_DURATION_MS = 3200;
/** How fast the bulls' run cycle plays (leg movement), in frames per second. */
const BULLS_RUN_FPS = 24;
/** Y (canvas px) of the herd's bottom edge — CANVAS_HEIGHT = flush with the bottom of the screen. */
const BULLS_RUN_BOTTOM_Y = CANVAS_HEIGHT + 40;
/** Horizontal extent (original-art px) of the visible herd inside each padded frame — used so the run
 * starts with the herd just off-screen right and ends once its last bull clears the left edge. */
const BULLS_CONTENT_LEFT = 205;
const BULLS_CONTENT_RIGHT = 1775;

let preloaded: Promise<HTMLImageElement[]> | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Loads (once) the herd's run-cycle frames — call early so they're ready when the bonus hits. */
export function preloadBullsRunFrames(): Promise<HTMLImageElement[]> {
  if (!preloaded) {
    preloaded = Promise.all(
      Array.from({ length: BULLS_RUN_FRAME_COUNT }, (_, i) =>
        loadImage(`${FRAMES_BASE}/bulls_${String(i).padStart(5, "0")}.webp`)
      )
    );
    // Let a later call retry instead of caching the failure forever.
    preloaded.catch(() => {
      preloaded = null;
    });
  }
  return preloaded;
}

/** The herd of bulls charging along the bottom of the screen from right to left until the whole
 * herd has left the screen. Drawn on its own canvas at z-index 999 so it runs over the game's
 * HTML controls too. Calls onDone once the run is over (or straight away if the frames failed). */
export function BullsStampede({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;

    preloadBullsRunFrames()
      .then((frames) => {
        if (cancelled) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) {
          onDoneRef.current();
          return;
        }
        const w = (frames[0].naturalWidth / BULLS_FRAME_FILE_SCALE) * BULLS_RUN_SCALE;
        const h = (frames[0].naturalHeight / BULLS_FRAME_FILE_SCALE) * BULLS_RUN_SCALE;
        const y = BULLS_RUN_BOTTOM_Y - h;
        const startX = CANVAS_WIDTH - BULLS_CONTENT_LEFT * BULLS_RUN_SCALE;
        const endX = -BULLS_CONTENT_RIGHT * BULLS_RUN_SCALE;
        const start = performance.now();

        const tick = (now: number) => {
          const elapsed = Math.max(now - start, 0);
          const t = Math.min(elapsed / BULLS_RUN_DURATION_MS, 1);
          const frame = frames[Math.floor((elapsed / 1000) * BULLS_RUN_FPS) % frames.length];
          ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          ctx.drawImage(frame, startX + (endX - startX) * t, y, w, h);
          if (t < 1) rafId = requestAnimationFrame(tick);
          else onDoneRef.current();
        };
        rafId = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) onDoneRef.current();
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="pointer-events-none absolute inset-0"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, zIndex: 999 }}
    />
  );
}
