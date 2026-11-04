/** Shared renderer settings for every game's `app.init({...})` — tune GPU cost for all games here.
 *
 * At idle most of a game's GPU memory is the canvas's own drawing buffers (color + depth/stencil
 * + the compositor's copy), each width × height × resolution² × 4 bytes — so resolution is the
 * biggest lever, and antialias (MSAA) is the most expensive flag: it keeps 4 samples per pixel,
 * roughly quadrupling those buffers. */

/** Highest backing resolution (before any per-game `upscale`). */
const MAX_RESOLUTION = 1.25;

/**
 * @param upscale extra multiplier for games whose canvas is CSS-scaled up past its design size
 *   (e.g. TheFinerThing), so the cap scales with it and the reels stay crisp.
 */
export function gameRendererOptions(upscale = 1) {
  const dpr = window.devicePixelRatio || 1;
  return {
    resolution: Math.min(dpr, MAX_RESOLUTION) * upscale,
    // Off: MSAA ~4× the canvas buffers' GPU memory. Only Graphics edges get slightly less smooth;
    // sprites and text are unaffected.
    antialias: false,
    // Lets dual-GPU laptops stay on the integrated GPU — plenty for 2D slot rendering.
    powerPreference: "low-power" as const,
  };
}

/** Lowest backing resolution `fitResolution` will drop to, so text and edges stay readable. */
const MIN_RESOLUTION = 0.5;

/**
 * Backing resolution for a canvas that's CSS-`scale()`d by `fitScale` (see useFitScale): the
 * screen only ever shows design-size × fitScale × devicePixelRatio pixels, so rendering more
 * than that is GPU memory the browser just downsamples away. Never higher than
 * `gameRendererOptions(upscale).resolution`, so a canvas scaled up past 1 keeps today's cap.
 */
export function fitResolution(fitScale: number, upscale = 1): number {
  const dpr = window.devicePixelRatio || 1;
  const cap = gameRendererOptions(upscale).resolution;
  return Math.max(MIN_RESOLUTION, Math.min(cap, dpr * fitScale));
}

/**
 * fitResolution, further capped so the canvas's backing buffer holds at most `maxPixels` pixels.
 * Each backing pixel costs ~12 bytes of GPU memory (color + depth/stencil + the compositor's
 * copy), so this puts a hard ceiling on the canvas's share of a game's GPU memory on big screens.
 */
export function budgetResolution(fitScale: number, width: number, height: number, maxPixels: number): number {
  return Math.min(fitResolution(fitScale), Math.sqrt(maxPixels / (width * height)));
}
