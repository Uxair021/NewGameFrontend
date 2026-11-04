/**
 * Platforms that use the "Please rotate your phone" flow (RotatePhone screen when upright instead
 * of the CSS 90° page rotation, a 1.3s home splash, and their own full-screen handling):
 *
 * - IS_IOS: iPhone / iPad — every browser there (Safari, Chrome, Firefox, …) runs on Safari's WebKit
 *   engine and behaves the same. iPadOS reports itself as a Mac, so it's recognised by its touchscreen.
 * - IS_ANDROID_CHROME: Google Chrome on Android phones / tablets — not Samsung Internet, Edge, Opera,
 *   Firefox, other Chromium browsers or in-app WebViews (all of which also say "Chrome/").
 *
 * index.html sets the matching `rotate-screen` class on <html> before any CSS / JS runs — keep the
 * conditions identical.
 */
const ua = navigator.userAgent;

export const IS_IOS: boolean = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export const IS_ANDROID_CHROME: boolean =
  /Android/.test(ua) &&
  /Chrome\/\d/.test(ua) &&
  !/SamsungBrowser|EdgA|OPR\/|Firefox|YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser|DuckDuckGo|; wv\)/.test(ua);

export const USES_ROTATE_SCREEN: boolean = IS_IOS || IS_ANDROID_CHROME;
