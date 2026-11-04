import type { Application } from "pixi.js";
import { FORCE_LANDSCAPE_QUERY } from "../useFitScale";
import { USES_ROTATE_SCREEN } from "../../../platform";

/**
 * On portrait touch devices GamePage rotates the whole page 90deg with CSS (see
 * `.force-landscape-wrapper` in index.css). Pixi's default pointer mapping only accounts for
 * scale, not rotation, so taps would land on the wrong spot — this remaps them for any scene
 * that takes input inside the canvas. `width`/`height` are the canvas' logical size.
 */
export function fixPointerMappingWhenRotated(app: Application, width: number, height: number) {
  const rotated = window.matchMedia(FORCE_LANDSCAPE_QUERY);
  const events = app.renderer.events;
  const baseMap = events.mapPositionToPoint.bind(events);
  events.mapPositionToPoint = (point, x, y) => {
    if (USES_ROTATE_SCREEN || !rotated.matches) {
      baseMap(point, x, y);
      return;
    }
    // rotate(90deg) clockwise: canvas +x runs screen-down, canvas +y runs screen-left.
    const rect = app.canvas.getBoundingClientRect();
    point.x = ((y - rect.top) / rect.height) * width;
    point.y = ((rect.right - x) / rect.width) * height;
  };
}
