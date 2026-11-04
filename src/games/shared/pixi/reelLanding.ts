/** How close (design px) a reel strip must be to its resting position to count as "landed". */
const LAND_PX = 3;

/**
 * Fires `onLand` once, the moment a spinning reel strip visually reaches its stop — not when its
 * animation finishes. An ease-out crawls its last few pixels for a long time (and an overshoot
 * curve passes the stop, then eases back), so waiting for the animation's end played the reel-stop
 * sound 0.5–1s after the reel already looked stopped.
 *
 * Call the returned function with the strip's y on every animation frame, and once more with
 * `finalY` when the animation ends (that last call only fires if it hasn't already).
 */
export function reelLanding(startY: number, finalY: number, onLand?: () => void): (y: number) => void {
  let fired = !onLand;
  const dir = Math.sign(finalY - startY) || 1;
  return (y) => {
    if (fired || (finalY - y) * dir > LAND_PX) return;
    fired = true;
    onLand?.();
  };
}
