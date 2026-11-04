import { useEffect, useRef, useState } from "react";
import { isFullscreen } from "../games/shared/fullscreen";
import { SwipeUpPrompt } from "./SwipeUpPrompt";

/**
 * Full-screen flow for Google Chrome on Android phones / tablets ONLY (iPhone / iPad have their own,
 * separate IOSFullscreen.tsx — nothing here runs there, on other Android browsers or desktop).
 * Mounted by App.tsx on every page except admin, only when IS_ANDROID_CHROME (src/platform.ts).
 *
 * - Full screen is KEPT when the device is turned upright (the RotatePhone screen covers the page),
 *   so turning back to landscape is full screen again automatically — no swipe. Chrome only lets a
 *   page ENTER full screen right after a tap / swipe (a rotation alone never counts), so staying in
 *   it is the only way rotation can return to full screen by itself. Trade-off: while upright the
 *   address bar stays hidden.
 * - The "Swipe up for full screen" layer shows only when the page is in landscape and really not
 *   full screen: the first time (nothing has entered full screen yet), or after full screen was
 *   left (the phone's Back button, swipe-down from the top). One swipe up enters it again.
 * - Turned to landscape while not full screen: full screen is still tried straight away (works when
 *   the player tapped a moment before); otherwise the layer shows.
 *
 * Underneath, the page / game stays mounted and keeps running — entering or leaving full screen
 * only resizes the viewport, which the games already handle (useFitScale re-fits on resize).
 */

const LANDSCAPE_QUERY = "(orientation: landscape)";
const TOUCH_QUERY = "(any-pointer: coarse)";
/** Minimum upward travel (CSS px) for a swipe. */
const SWIPE_MIN = 60;

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Google Chrome on Android — not Samsung Internet, Edge, Opera, Firefox, other Chromium
 * browsers or in-app WebViews (all of which also say "Chrome/" in their user agent). */
function isAndroidChrome(): boolean {
  const ua = navigator.userAgent;
  return (
    /Android/.test(ua) &&
    /Chrome\/\d/.test(ua) &&
    !/SamsungBrowser|EdgA|OPR\/|Firefox|YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser|DuckDuckGo|; wv\)/.test(ua)
  );
}

function enterFullscreen() {
  const el = document.documentElement as FsElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.();
    if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
  } catch {
    /* refused — the layer stays up and the next swipe tries again */
  }
}

/** A tap within the last few seconds still counts as the user's permission for full screen. */
function recentTapActive(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return !!activation?.isActive;
}

export function AndroidChromeFullscreen() {
  const [enabled] = useState(() => isAndroidChrome() && !isStandalone() && window.matchMedia(TOUCH_QUERY).matches);
  const [landscape, setLandscape] = useState(() => window.matchMedia(LANDSCAPE_QUERY).matches);
  const [full, setFull] = useState(isFullscreen);
  // bumped every time the layer appears, so the text reveal replays
  const [shownCount, setShownCount] = useState(0);
  const startY = useRef<number | null>(null);

  const visible = enabled && landscape && !full;

  /* orientation: full screen is kept through portrait (so landscape returns to it by itself);
   * landscape while not full screen → try it right away */
  useEffect(() => {
    if (!enabled) return;
    const mql = window.matchMedia(LANDSCAPE_QUERY);
    const onChange = () => {
      setLandscape(mql.matches);
      if (mql.matches && !isFullscreen() && recentTapActive()) {
        enterFullscreen(); // otherwise Chrome refuses — the swipe layer shows instead
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [enabled]);

  /* full-screen state (entered by a swipe, a game opening, or left by Back / swipe-down) */
  useEffect(() => {
    if (!enabled) return;
    const update = () => setFull(isFullscreen());
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, [enabled]);

  useEffect(() => {
    if (visible) setShownCount((n) => n + 1);
  }, [visible]);

  if (!enabled || !landscape) return null;

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const from = startY.current;
    startY.current = null;
    const to = e.changedTouches[0]?.clientY;
    // touchend is the moment Chrome grants the gesture full screen needs
    if (from !== null && to !== undefined && from - to >= SWIPE_MIN) enterFullscreen();
  };

  return (
    <SwipeUpPrompt
      visible={visible}
      replayKey={shownCount}
      touchClass="touch-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    />
  );
}
