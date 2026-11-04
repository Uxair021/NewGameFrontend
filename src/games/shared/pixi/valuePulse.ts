import type { Application, Text, Ticker } from "pixi.js";

/** One beat every BEAT_MS, growing up to 1 + SCALE and flashing from the text's own colour
 * toward white at each peak. */
const BEAT_MS = 260;
const SCALE = 0.18;

function mix(from: number, to: number, t: number): number {
  const ch = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/**
 * Pulses a readout Text (e.g. a game's CREDIT value while a win counts into it): call
 * setActive(true) to start beating, setActive(false) to ease back to its normal size and colour.
 * The colour changes through `style.fill`, not `tint` — tint can only darken a Text, never
 * brighten it toward white.
 */
export function createValuePulse(app: Application, text: Text, baseColor: number) {
  let active = false;
  let elapsed = 0;

  const tick = (ticker: Ticker) => {
    if (active) {
      elapsed += ticker.deltaMS;
      const beat = Math.abs(Math.sin((Math.PI * elapsed) / BEAT_MS));
      text.scale.set(1 + SCALE * beat);
      text.style.fill = mix(baseColor, 0xffffff, beat);
    } else if (text.scale.x !== 1) {
      const next = 1 + (text.scale.x - 1) * 0.7;
      const settled = Math.abs(next - 1) < 0.005;
      text.scale.set(settled ? 1 : next);
      text.style.fill = settled ? baseColor : mix(baseColor, 0xffffff, (next - 1) / SCALE);
    }
  };
  app.ticker.add(tick);

  return {
    setActive(next: boolean) {
      if (next && !active) elapsed = 0;
      active = next;
    },
    destroy() {
      app.ticker.remove(tick);
    },
  };
}
