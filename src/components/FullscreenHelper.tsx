import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { USES_ROTATE_SCREEN } from "../platform";

/**
 * Full screen on phones / tablets, the way each platform allows it:
 *
 * - Android (and iPad): browsers only allow full screen in response to a user gesture, so the
 *   first tap anywhere asks for it (and the next tap again if the player leaves full screen).
 *   One passive document listener — nothing runs per frame, games / layout are untouched.
 * - iPhone: Safari doesn't support full screen for web pages at all (only videos), so instead a
 *   small "Full Screen" button opens a short "Add to Home Screen" guide — launched from that
 *   home-screen icon, the site runs without Safari's bars (see manifest.webmanifest / index.html).
 *
 * Skipped: desktop (mouse), the admin area, and when already running as the installed app.
 */

const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
/** same condition as the CSS rotation in index.css / FORCE_LANDSCAPE_QUERY */
const ROTATED_QUERY = "(orientation: portrait) and (hover: none) and (pointer: coarse)";
const HINT_DISMISSED_KEY = "texasSlots.fullscreenHintDismissed";

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function fullscreenSupported(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

function requestFullscreen(): void {
  const el = document.documentElement as FsElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen?.();
    // a refused request (e.g. the browser declines) is harmless — just try again on the next tap
    if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
  } catch {
    /* not allowed right now — next tap retries */
  }
}

/** iPhone / iPod (iPads report as Mac with touch and do support full screen, so they're excluded). */
function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function FullscreenHelper() {
  const { pathname } = useLocation();
  const inAdmin = pathname.startsWith("/admin");
  const inGame = pathname.startsWith("/games/");
  // pages that CSS-rotate into landscape on a phone held upright (see index.css)
  const rotatedPage = pathname === "/" || pathname === "/home2" || inGame;

  /* ---------- Android / iPad: tap anywhere → full screen ---------- */
  useEffect(() => {
    // iPad / Android Chrome: handled by IOSFullscreen / AndroidChromeFullscreen
    if (USES_ROTATE_SCREEN || inAdmin || isStandalone() || !fullscreenSupported() || !window.matchMedia(TOUCH_QUERY).matches) return;
    const onTap = () => {
      if (!isFullscreen()) requestFullscreen();
    };
    // capture + passive: runs before the tapped element's own handler and never blocks it
    document.addEventListener("pointerdown", onTap, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", onTap, { capture: true });
  }, [inAdmin]);

  /* ---------- iPhone: "Full Screen" button → Add to Home Screen guide ---------- */
  const [dismissed, setDismissed] = useState(readDismissed);
  const [guideOpen, setGuideOpen] = useState(false);
  const [rotated, setRotated] = useState(() => window.matchMedia(ROTATED_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(ROTATED_QUERY);
    const onChange = () => setRotated(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const showIPhoneHint = isIPhone() && !isStandalone() && !inAdmin && !inGame && !dismissed;
  if (!showIPhoneHint) return null;

  // On a CSS-rotated page the button / guide turn with it, so they read upright in landscape:
  // the page's top-right corner is the screen's bottom-right corner after a 90° turn.
  const turn = rotated && rotatedPage && !USES_ROTATE_SCREEN; // those pages are never CSS-rotated

  const dismiss = () => {
    setDismissed(true);
    setGuideOpen(false);
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, "1");
    } catch {
      /* storage unavailable — hides for this visit only */
    }
  };

  return (
    <>
      <div
        className={`fixed z-[60] flex items-center gap-1 ${turn ? "bottom-3 right-3" : "right-3 top-3"}`}
        // turned: pivot on the bottom-right corner, then shift one height so it stays on screen
        style={turn ? { transform: "rotate(90deg) translateY(100%)", transformOrigin: "bottom right" } : undefined}
      >
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-amber-400/80 bg-[#0a1230]/90 px-3 py-1.5 text-xs font-bold text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.35)]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          Full Screen
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide full screen tip"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm leading-none text-white/80"
        >
          ×
        </button>
      </div>

      {guideOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={() => setGuideOpen(false)}>
          <div
            role="dialog"
            aria-labelledby="fsGuideTitle"
            onClick={(e) => e.stopPropagation()}
            className={`w-full rounded-2xl border-2 border-amber-400 bg-gradient-to-b from-[#16244f] to-[#0a1230] p-5 text-white shadow-2xl ${
              turn ? "max-w-[min(420px,85vh)] rotate-90" : "max-w-[420px]"
            }`}
          >
            <h2 id="fsGuideTitle" className="mb-1 text-lg font-bold text-amber-300">
              Play in full screen
            </h2>
            <p className="mb-3 text-sm text-white/80">
              iPhone doesn&apos;t allow websites to go full screen, but you can add Texas Slots to your Home Screen — opened from
              there, it runs without Safari&apos;s bars.
            </p>
            <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm">
              <li>
                Tap the <b>Share</b> button{" "}
                <svg viewBox="0 0 24 24" className="inline h-4 w-4 -translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>{" "}
                in Safari.
              </li>
              <li>
                Choose <b>Add to Home Screen</b>.
              </li>
              <li>
                Open <b>Texas Slots</b> from your Home Screen.
              </li>
            </ol>
            <p className="mb-4 text-xs text-white/60">The first time you open it from the Home Screen you may need to log in again.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={dismiss} className="rounded-lg px-3 py-2 text-sm text-white/70">
                Don&apos;t show again
              </button>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="rounded-lg bg-gradient-to-b from-yellow-300 to-amber-500 px-4 py-2 text-sm font-bold text-slate-900"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
