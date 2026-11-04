import { useEffect, useRef, useState } from "react";

/**
 * "Please rotate your phone" — React + Tailwind clone of the reference screen.
 *
 * A fixed 488×892 design canvas, scaled to fit the screen (same fit as the reference script).
 * Every 5s: the phone outline drops in and turns 90° into landscape, a divider line draws in,
 * the vertical text is revealed and hidden again, the line retracts, and the phone is wiped
 * away left → right. With "reduce
 * motion" on, it shows the still rotated phone, line and text. Keyframes: KEYFRAMES below.
 */
/* The four animations (same steps / easings as the reference, 5s loop). They ship with the
 * component instead of tailwind.config.js, so the screen can never appear without them — a dev
 * server that hasn't reloaded the Tailwind config (or a build that drops unused theme keyframes)
 * would otherwise leave it frozen on its first frame: upright phone, no line, no text. The
 * elements use Tailwind's arbitrary animate-[…] classes, generated straight from this file. */
const KEYFRAMES = `
@keyframes rotate-phone-turn {
  0%, 2% { opacity: 0; transform: translate(-4px,236px) rotate(4deg) scale(1.4); }
  2.1% { opacity: 1; transform: translate(-4px,236px) rotate(4deg) scale(1.4); animation-timing-function: cubic-bezier(.55,0,.25,1); }
  17%, 100% { opacity: 1; transform: translate(0,0) rotate(90deg) scale(1); }
}
@keyframes rotate-phone-wipe {
  0%, 73% { clip-path: inset(0 0 0 0); }
  73.1% { clip-path: inset(0 0 0 16%); animation-timing-function: cubic-bezier(.6,0,.4,1); }
  79%, 100% { clip-path: inset(0 0 0 84%); }
}
@keyframes rotate-phone-rule {
  0%, 17% { transform: scaleX(0); animation-timing-function: cubic-bezier(.5,0,.2,1); }
  23%, 72% { transform: scaleX(1); animation-timing-function: cubic-bezier(.6,0,.4,1); }
  78%, 100% { transform: scaleX(0); }
}
@keyframes rotate-phone-text {
  0%, 31% { clip-path: inset(0 0 100% 0); animation-timing-function: cubic-bezier(.5,0,.2,1); }
  37%, 65% { clip-path: inset(0 0 0 0); animation-timing-function: cubic-bezier(.6,0,.4,1); }
  69%, 100% { clip-path: inset(0 0 100% 0); }
}`;

/** Phone / tablet held upright. `any-pointer: coarse` = the device has a touchscreen, so tablets
 * with a keyboard cover / trackpad attached (whose *primary* pointer is fine) still count; a
 * desktop or laptop without a touchscreen never matches. Same condition as #boot-rotate in
 * index.html — keep the two identical. */
const TOUCH_PORTRAIT = "[@media(orientation:portrait)_and_(any-pointer:coarse)]:flex";

/** 5s loop position shared with the #boot-rotate copy in index.html: both derive their animation
 * delay from the page clock, so swapping that copy for this component never restarts the loop. */
const LOOP_MS = 5000;

export function RotatePhone({
  className = "",
  touchPortraitOnly = false,
}: {
  className?: string;
  /** show only on phones / tablets held upright; hidden in landscape and on desktop (pure CSS,
   *  so it updates instantly on rotation with no listeners and never remounts anything) */
  touchPortraitOnly?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [delay] = useState(() => `-${Math.round(performance.now() % LOOP_MS)}ms`);
  const sync = { animationDelay: delay };

  // React is up — the plain-HTML copy shown while the app was loading (index.html) is replaced
  useEffect(() => {
    document.getElementById("boot-rotate")?.remove();
  }, []);

  // Scale the 488×892 canvas to fit any screen
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 488, window.innerHeight / 892);
      if (stageRef.current) stageRef.current.style.transform = `scale(${s})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const stroke = {
    fill: "none",
    stroke: "#fff",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };

  return (
    <div
      className={`fixed inset-0 z-[100000] items-center justify-center overflow-hidden bg-black [padding:env(safe-area-inset-top,0px)_env(safe-area-inset-right,0px)_env(safe-area-inset-bottom,0px)_env(safe-area-inset-left,0px)] ${
        touchPortraitOnly ? `hidden ${TOUCH_PORTRAIT}` : "flex"
      } ${className}`}
    >
      <div
        ref={stageRef}
        role="img"
        aria-label="Please rotate your phone"
        className="relative h-[892px] w-[488px] flex-none origin-center"
      >
        <style>{KEYFRAMES}</style>

        {/* ---------- Phone ---------- */}
        <div style={sync} className="absolute inset-0 animate-[rotate-phone-wipe_5s_linear_infinite] motion-reduce:animate-none motion-reduce:[clip-path:none]">
          <div
            style={sync}
            // centred on (241,192): 170×323 box offset by half its size
            className="absolute left-[241px] top-[192px] -ml-[85px] -mt-[161.5px] h-[323px] w-[170px] animate-[rotate-phone-turn_5s_infinite] motion-reduce:animate-none motion-reduce:rotate-90"
          >
            {/* drawn upright (portrait); rotated by the animation */}
            <svg viewBox="0 0 170 323" className="h-full w-full overflow-visible" aria-hidden>
              <rect x="0" y="0" width="170" height="323" rx="22" ry="22" {...stroke} />
              <line x1="70" y1="16" x2="100" y2="16" {...stroke} />
              <line x1="172.5" y1="68" x2="172.5" y2="86" {...stroke} />
              <line x1="172.5" y1="93" x2="172.5" y2="113" {...stroke} />
            </svg>
          </div>
        </div>

        {/* ---------- Divider line ---------- */}
        <div style={sync} className="absolute left-[62px] top-[321px] h-[3px] w-[374px] origin-left scale-x-0 bg-white animate-[rotate-phone-rule_5s_infinite] motion-reduce:animate-none motion-reduce:scale-x-100" />

        {/* ---------- Text (lines stack right → left, letters turned 90°) ---------- */}
        <div style={sync} className="absolute right-[108px] top-[366px] whitespace-nowrap font-['Helvetica_Neue',Helvetica,Arial,sans-serif] text-[77px] font-medium leading-[102px] tracking-[-0.5px] text-white [clip-path:inset(0_0_100%_0)] [writing-mode:vertical-rl] animate-[rotate-phone-text_5s_infinite] motion-reduce:animate-none motion-reduce:[clip-path:none]">
          Please
          <br />
          rotate your
          <br />
          phone
        </div>
      </div>
    </div>
  );
}
