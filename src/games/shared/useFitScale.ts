import { useEffect, useState, type RefObject } from "react";
import { USES_ROTATE_SCREEN } from "../../platform";

/** MUST stay byte-identical to the media query on ".force-landscape-wrapper" in index.css —
 * that CSS rule is what actually rotates game pages into landscape on touch-primary devices
 * held in portrait (see its own doc comment for the full explanation); this is the same
 * condition read in JS, so the fit-scale math below knows to measure against the swapped
 * (post-rotation) viewport dimensions instead of the raw portrait window size. */
export const FORCE_LANDSCAPE_QUERY = "(orientation: portrait) and (hover: none) and (pointer: coarse)";

interface FitScaleOptions {
  maxWidth?: number;
  /** An element whose current (already mobile-styled) height is subtracted from the
   * available viewport height before fitting — e.g. a HUD docked below `measureRefs`
   * that isn't part of the scaled block and shouldn't be measured/scaled with it. */
  reserveRef?: RefObject<HTMLElement | null>;
  /** Multiplies the computed fit scale — e.g. 0.85 to render deliberately smaller than the tightest fit. */
  extraShrink?: number;
  /** When true, scales up as well as down to fill as much of the viewport as possible
   * (aspect-ratio preserved) on every screen size, instead of only shrinking below
   * `maxWidth` on narrow/mobile viewports and otherwise staying at natural (1x) size. */
  fillViewport?: boolean;
}

/**
 * Computes a CSS scale factor so the combined natural (untransformed) size of
 * `measureRefs` fits inside the current viewport (minus `reserveRef`'s height, if given),
 * applied via `transform: scale()` instead of hand-tuning vh percentages.
 *
 * Default mode (`fillViewport` unset): shrink-only, capped at 1x, and only active below
 * `maxWidth` — used for celebration overlays, which are already sized for desktop and
 * should only shrink on narrow mobile viewports, never scale up.
 *
 * `fillViewport: true`: scales up *and* down so the block always fills as much of the
 * viewport as its aspect ratio allows, on any screen size — used for the game cards
 * themselves so fullscreen mode actually fills the screen instead of sitting at a fixed
 * pixel size with letterboxing.
 */
export function useFitScale(measureRefs: RefObject<HTMLElement | null>[], options: FitScaleOptions = {}): number {
  const { maxWidth = 900, reserveRef, extraShrink = 1, fillViewport = false } = options;
  const [scale, setScale] = useState(1);
  // Whether the force-landscape CSS rotation is currently active (see FORCE_LANDSCAPE_QUERY's
  // doc comment) — a plain media-query match, not a sensor reading, so no permission and no
  // debounce is needed; it's already exactly as stable as the browser's own orientation state.
  // iOS / Android Chrome never CSS-rotate (RotatePhone screen instead — see index.css), so never "rotated" there.
  const [rotated, setRotated] = useState(() => !USES_ROTATE_SCREEN && window.matchMedia(FORCE_LANDSCAPE_QUERY).matches);

  useEffect(() => {
    if (USES_ROTATE_SCREEN) return;
    const mql = window.matchMedia(FORCE_LANDSCAPE_QUERY);
    const handleChange = () => setRotated(mql.matches);
    handleChange();
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    function recompute() {
      const elements = measureRefs.map((r) => r.current).filter((el): el is HTMLElement => el !== null);
      if (elements.length === 0) return;

      // When rotated, the CSS wrapper's visual footprint is the window's dimensions swapped
      // (see index.css) — window.innerWidth/innerHeight themselves don't change under a CSS
      // transform, only the visual presentation does, so this has to be computed explicitly.
      const viewportWidth = rotated ? window.innerHeight : window.innerWidth;
      const viewportHeight = rotated ? window.innerWidth : window.innerHeight;

      if (!fillViewport && viewportWidth > maxWidth) {
        setScale(1);
        return;
      }

      const naturalWidth = Math.max(...elements.map((el) => el.offsetWidth));
      const naturalHeight = elements.reduce((sum, el) => sum + el.offsetHeight, 0);
      if (!naturalWidth || !naturalHeight) return;

      const reserveHeight = reserveRef?.current?.offsetHeight ?? 0;
      const availableHeight = Math.max(0, viewportHeight - reserveHeight);

      const cap = fillViewport ? Infinity : 1;
      const fit = Math.min(cap, viewportWidth / naturalWidth, availableHeight / naturalHeight);
      setScale(Math.min(cap, fit * extraShrink));
    }

    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    for (const r of measureRefs) {
      if (r.current) resizeObserver.observe(r.current);
    }
    if (reserveRef?.current) resizeObserver.observe(reserveRef.current);
    window.addEventListener("resize", recompute);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // measureRefs/reserveRef entries are stable useRef objects; the array
    // literal itself is intentionally not a dependency (see hook doc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxWidth, extraShrink, fillViewport, rotated]);

  return scale;
}
