import type { TouchEvent } from "react";

/**
 * "Swipe up for full screen" — the shared LOOK of the layer. Behaviour (when it shows, how full
 * screen is entered) lives in each platform's own component, which renders this:
 *   - AndroidChromeFullscreen.tsx (Google Chrome on Android)
 *   - IOSFullscreen.tsx (iPhone — Safari collapses its bars)
 *
 * Built for landscape (the only orientation it shows in): the animated hand on the left, the text
 * beside it, centred as a group. Everything is sized from the screen HEIGHT (the short side in
 * landscape) with clamp(), so it is readable on 360px-tall phones and not oversized on tablets;
 * the hand's swipe travel is a share of its own box, so it scales with it. Safe-area padding keeps
 * it clear of the notch / Dynamic Island and the home indicator.
 *
 * Background: the page / game stays visible underneath — blurred, with a light dark tint and a
 * text shadow so the text reads over anything. Older iOS Safari only knows -webkit-backdrop-filter;
 * a browser without any backdrop blur gets a stronger tint instead.
 */

const CSS = `
.sup-root {
  background: rgba(3, 7, 20, .42);
  -webkit-backdrop-filter: blur(12px) saturate(1.1);
  backdrop-filter: blur(12px) saturate(1.1);
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .sup-root { background: rgba(3, 7, 20, .82); }
}

/* sizes: from the visible height (dvh), vh as the fallback */
.sup-group { --h: clamp(120px, 56vh, 420px); --fs: clamp(20px, 8.5vh, 60px); }
@supports (height: 1dvh) {
  .sup-group { --h: clamp(120px, 56dvh, 420px); --fs: clamp(20px, 8.5dvh, 60px); }
}
.sup-group { gap: clamp(14px, 5vw, 64px); }

/* the hand's area: the fingertip starts at 60% of the height and travels up to 10% */
.sup-area { position: relative; flex: none; height: var(--h); width: calc(var(--h) * .5); }
.sup-trail {
  position: absolute; left: 50%; top: 10%; height: 50%; width: 3px; margin-left: -1.5px; border-radius: 2px;
  background: linear-gradient(to top, rgba(255,255,255,0) 0%, #fff 70%);
  clip-path: inset(100% 0 0 0);
  animation: sup-trail 2.6s infinite;
}
.sup-ripple {
  position: absolute; left: 50%; top: 60%; width: calc(var(--h) * .16); height: calc(var(--h) * .16);
  margin: calc(var(--h) * -.08) 0 0 calc(var(--h) * -.08);
  border: 2.5px solid #fff; border-radius: 50%; opacity: 0; transform: scale(.3);
  animation: sup-ripple 2.6s infinite ease-out;
}
/* icon box 100×130 (viewBox), fingertip at (46, 8) → placed on the start point (50%, 60%) */
.sup-hand {
  position: absolute; width: calc(var(--h) * .33); height: calc(var(--h) * .429);
  left: calc(50% - var(--h) * .33 * .46); top: calc(60% - var(--h) * .429 * .0615);
  transform-origin: 46% 6.15%;
  animation: sup-hand 2.6s infinite;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.55));
}
.sup-text {
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 600;
  font-size: var(--fs); line-height: 1.15; letter-spacing: -.01em; color: #fff;
  text-shadow: 0 2px 12px rgba(0,0,0,.65), 0 1px 2px rgba(0,0,0,.6);
  white-space: nowrap;
  animation: sup-text .9s cubic-bezier(.5,0,.2,1) .2s both;
}

@keyframes sup-trail {
  0%, 22% { clip-path: inset(100% 0 0 0); animation-timing-function: cubic-bezier(.65,0,.35,1); }
  60% { clip-path: inset(0 0 0 0); animation-timing-function: cubic-bezier(.6,0,.4,1); }
  72%, 100% { clip-path: inset(0 0 100% 0); }
}
@keyframes sup-ripple {
  0%, 12% { opacity: 0; transform: scale(.3); }
  14% { opacity: 1; transform: scale(.4); }
  34%, 100% { opacity: 0; transform: scale(1.5); }
}
/* travel: 0.5 of the area height = 116.5% of the hand's own height */
@keyframes sup-hand {
  0% { opacity: 0; transform: translateY(20%) scale(1); animation-timing-function: ease-out; }
  10% { opacity: 1; transform: translateY(0) scale(1); }
  16% { opacity: 1; transform: translateY(0) scale(.9); }
  22% { opacity: 1; transform: translateY(0) scale(.9); animation-timing-function: cubic-bezier(.65,0,.35,1); }
  60% { opacity: 1; transform: translateY(-116.5%) scale(.9); }
  66% { opacity: 1; transform: translateY(-119%) scale(1); }
  80%, 100% { opacity: 0; transform: translateY(-124%) scale(1); }
}
@keyframes sup-text {
  from { clip-path: inset(0 0 100% 0); transform: translateY(12px); }
  to { clip-path: inset(0 0 0 0); transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .sup-trail, .sup-ripple, .sup-hand, .sup-text { animation: none; }
  .sup-trail { clip-path: none; }
  .sup-hand { transform: translateY(-58%); }
}`;

export function SwipeUpPrompt({
  visible,
  replayKey,
  touchClass,
  onTouchStart,
  onTouchEnd,
}: {
  /** shown (fades in) or hidden (fades out, no longer catches touches) */
  visible: boolean;
  /** change it each time the layer appears, so the text reveal replays */
  replayKey: number;
  /** "touch-none": the swipe is handled in JS (Android). "touch-pan-y": it must scroll the page (iPhone). */
  touchClass: "touch-none" | "touch-pan-y";
  onTouchStart?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
}) {
  return (
    <div
      aria-hidden={!visible}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`sup-root fixed inset-0 z-[99999] flex items-center justify-center overflow-hidden transition-opacity duration-[400ms] ${touchClass} ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <style>{CSS}</style>
      <div key={replayKey} role="img" aria-label="Swipe up for full screen" className="sup-group flex items-center">
        <div className="sup-area" aria-hidden>
          <div className="sup-trail" />
          <div className="sup-ripple" />
          <div className="sup-hand">
            <svg viewBox="0 0 100 130" className="h-full w-full overflow-visible">
              <path
                d="M38 88 V16 A8 8 0 0 1 54 16 V58 V50 A8 8 0 0 1 70 50 V60 V56 A8 8 0 0 1 86 56 V64 V62 A7 7 0 0 1 100 62 V96 C100 114 90 126 72 126 H56 C46 126 40 122 34 114 L14 88 A7 7 0 0 1 25 79 L38 92 Z"
                fill="rgba(0,0,0,.35)"
                stroke="#fff"
                strokeWidth={2.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
        <div className="sup-text">
          Swipe up for
          <br />
          full screen
        </div>
      </div>
    </div>
  );
}
