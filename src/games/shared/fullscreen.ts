/**
 * Fullscreen helpers that are safe on every browser.
 *
 * iPhone browsers (Safari, and Chrome/Firefox, which use Safari's WebKit engine on iOS) have no
 * Element.requestFullscreen at all, so calling it throws a TypeError synchronously — before any
 * `.catch()` can run — and crashes the React tree into a blank page. iPad Safari only has the
 * older `webkit`-prefixed version. These helpers feature-detect both and quietly do nothing
 * where fullscreen isn't available.
 */

type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

/** Best-effort: asks for fullscreen; never throws. */
export function requestFullscreenSafe(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const e = el as WebkitElement;
  try {
    if (typeof e.requestFullscreen === "function") {
      void e.requestFullscreen().catch(() => {
        /* refused (no fresh user gesture, etc.) — the page still works, just not fullscreen */
      });
    } else if (typeof e.webkitRequestFullscreen === "function") {
      void Promise.resolve(e.webkitRequestFullscreen()).catch(() => {});
    }
  } catch {
    /* not allowed here — ignore */
  }
}

export function isFullscreen(): boolean {
  const d = document as WebkitDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Leaves fullscreen if the page is in it; never throws. */
export function exitFullscreenSafe(): Promise<void> {
  const d = document as WebkitDocument;
  try {
    if (d.fullscreenElement && typeof d.exitFullscreen === "function") return d.exitFullscreen().catch(() => {});
    if (d.webkitFullscreenElement && typeof d.webkitExitFullscreen === "function") {
      return Promise.resolve(d.webkitExitFullscreen()).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return Promise.resolve();
}
