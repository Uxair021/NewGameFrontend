import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isFullscreen } from "../games/shared/fullscreen";
import { SwipeUpPrompt } from "./SwipeUpPrompt";

/**
 * Full screen in landscape on iPhone / iPad (every browser there is Safari's WebKit). Mounted by
 * App.tsx on every page except admin, only on iOS (src/ios.ts). Android / desktop never run this.
 *
 * - iPad: real full screen (Safari's Fullscreen API). Safari only grants it right after a tap, never
 *   from a rotation alone, so: the first tap in landscape enters it, and turning to landscape tries
 *   it straight away (works when the player tapped a moment before). It is KEPT while the device is
 *   upright (RotatePhone covers the page), so turning back to landscape is full screen again.
 * - iPhone: no Fullscreen API for web pages at all. In landscape, while Safari's address / tab bars
 *   are showing, a "Swipe up for full screen" layer covers the page; the swipe scrolls the document
 *   (html.ios-bar-collapse in index.css gives it a little scroll room while #root stays fixed) and
 *   Safari collapses its own bars — the closest thing to full screen an iPhone allows. The layer
 *   hides once the bars are gone and comes back if they return.
 * - Opened from the Home Screen icon (installed app): already full screen — nothing runs.
 */

const LANDSCAPE_QUERY = "(orientation: landscape)";
/** iPhone: bars count as collapsed once the visible height is within this of the screen height. */
const IOS_BAR_TOLERANCE = 24;

type FsDocument = Document & { webkitFullscreenEnabled?: boolean };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function hasFullscreenApi(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function enterFullscreen() {
  const el = document.documentElement as FsElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
  } catch {
    /* refused — the next tap tries again */
  }
}

function recentTapActive(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return !!activation?.isActive;
}

/** iPhone: Safari's bars are collapsed when the visible height is (about) the screen's short side. */
function iosBarsCollapsed(): boolean {
  const screenHeight = Math.min(window.screen.width, window.screen.height);
  return window.innerHeight >= screenHeight - IOS_BAR_TOLERANCE;
}

export function IOSFullscreen() {
  const [mode] = useState<"ipad" | "iphone" | "none">(() =>
    isStandalone() ? "none" : hasFullscreenApi() ? "ipad" : "iphone"
  );
  if (mode === "ipad") return <IPadFullscreen />;
  if (mode === "iphone") return <IPhoneSwipeUp />;
  return null;
}

/* ---------------------------------------------- iPad ---------------------------------------------- */

function IPadFullscreen() {
  useEffect(() => {
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    // turned to landscape: try right away (granted only if the player tapped a moment before)
    const onRotate = () => {
      if (mql.matches && !isFullscreen() && recentTapActive()) enterFullscreen();
    };
    // any tap in landscape: enter full screen. pointerup — the moment Safari counts the gesture.
    const onTap = () => {
      if (mql.matches && !isFullscreen()) enterFullscreen();
    };
    mql.addEventListener("change", onRotate);
    document.addEventListener("pointerup", onTap, { capture: true, passive: true });
    return () => {
      mql.removeEventListener("change", onRotate);
      document.removeEventListener("pointerup", onTap, { capture: true });
    };
  }, []);
  return null;
}

/* --------------------------------------------- iPhone --------------------------------------------- */

function IPhoneSwipeUp() {
  const [landscape, setLandscape] = useState(() => window.matchMedia(LANDSCAPE_QUERY).matches);
  const [collapsed, setCollapsed] = useState(iosBarsCollapsed);
  // bumped every time the layer appears, so the text reveal replays
  const [shownCount, setShownCount] = useState(0);

  const visible = landscape && !collapsed;

  useEffect(() => {
    // scroll room for the swipe (index.css) — only while this flow is mounted
    document.documentElement.classList.add("ios-bar-collapse");
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const onRotate = () => {
      setLandscape(mql.matches);
      if (!mql.matches) window.scrollTo(0, 0);
    };
    const update = () => setCollapsed(iosBarsCollapsed());
    mql.addEventListener("change", onRotate);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      document.documentElement.classList.remove("ios-bar-collapse");
      mql.removeEventListener("change", onRotate);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (visible) setShownCount((n) => n + 1);
  }, [visible]);

  if (!landscape) return null;

  // Rendered straight into <body>, outside the fixed #root, so a swipe on it scrolls the document
  // itself — that is what makes Safari collapse its bars.
  return createPortal(
    <SwipeUpPrompt visible={visible} replayKey={shownCount} touchClass="touch-pan-y" />,
    document.body
  );
}
