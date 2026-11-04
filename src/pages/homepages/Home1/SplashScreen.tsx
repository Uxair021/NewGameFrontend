import { useEffect, useState } from "react";
import { HOME_IMAGES } from "../shared/images";

const BAR_DELAY = 1000;
const FILL_DURATION = 2000;

export function SplashScreen({
  onFinish,
  barDelay = BAR_DELAY,
  fillDuration = FILL_DURATION,
}: {
  onFinish: () => void;
  /** ms before the progress bar appears (default 1000) */
  barDelay?: number;
  /** ms the bar takes to fill; the splash ends when it's full (default 2000) */
  fillDuration?: number;
}) {
  const [showBar, setShowBar] = useState(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const barTimer = window.setTimeout(() => {
      setShowBar(true);
      requestAnimationFrame(() => setFilled(true));
    }, barDelay);
    const finishTimer = window.setTimeout(onFinish, barDelay + fillDuration);
    return () => {
      window.clearTimeout(barTimer);
      window.clearTimeout(finishTimer);
    };
  }, [onFinish, barDelay, fillDuration]);

  return (
    <div className="fixed inset-0 z-[10000] bg-black">
      <img src={HOME_IMAGES.firstImage} alt="Loading" className="absolute inset-0 h-full w-full object-cover" />

      {showBar && (
        <div className="absolute inset-x-0 bottom-14 px-16">
          <div className="mx-auto h-5 max-w-2xl overflow-hidden rounded-full border border-amber-400/60 bg-black/50 shadow-[0_0_12px_rgba(0,0,0,0.6)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-brand-yellow"
              style={{
                width: filled ? "100%" : "0%",
                transition: `width ${fillDuration}ms linear`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
