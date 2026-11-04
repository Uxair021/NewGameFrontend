import { useEffect } from "react";

const DISPLAY_MS = 3800;

/**
 * Plays `src` for DISPLAY_MS then calls onDone — no fly/shrink animation, it just appears
 * centered on the x-axis, spans the full height of its positioned ancestor, and sits behind
 * the top/bottom control bars (z-5, both bars are z-10) so they stay usable while it plays.
 */
export function CelebrationGifOverlay({ active, src, onDone }: { active: boolean; src: string; onDone: () => void }) {
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(onDone, DISPLAY_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;

  return (
    <img
      src={src}
      alt=""
      className="pointer-events-none absolute left-1/2 top-0 z-[5] h-full w-auto -translate-x-1/2 object-contain"
    />
  );
}
