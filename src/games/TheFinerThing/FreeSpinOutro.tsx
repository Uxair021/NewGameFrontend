import { useEffect, useRef, useState } from "react";
import { useFitScale } from "../shared/useFitScale";

const FINER_FONT = '"Times New Roman", Georgia, serif';

interface FreeSpinOutroProps {
  /** Pre-bonus sum of every free spin's own win this round. */
  totalWin: number;
  /** Total WILD cells landed across the round (server-authoritative). */
  wildCount: number;
  /** wildCount + 1 — always defined even at wildCount 0, where it's just 1 (no change). */
  multiplier: number;
  /** totalWin * multiplier — the amount actually credited, and the number this banner leads with. */
  finalWin: number;
  /** The triggering spin's own win, paid with the round on top of the multiplied total. */
  triggerWin?: number;
  onDismiss: () => void;
}

/** Full-screen "free spins round is over" banner — congrat.webp with the final (wild-multiplied)
 * win amount overlaid dead-center on the image. Stays up until the player taps it — the round's
 * total is only added to the balance then (see the game's collect handler). When at least one wild landed during the round, a small line
 * underneath spells out the multiplier that turned totalWin into finalWin; at 0 wilds the win is
 * just the win, so that line is skipped entirely. */
export function FreeSpinOutro({ totalWin, wildCount, multiplier, finalWin, triggerWin = 0, onDismiss }: FreeSpinOutroProps) {
  const [dismissing, setDismissing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const fitScale = useFitScale([contentRef]);

  useEffect(() => {
    if (!dismissing) return;
    const t = window.setTimeout(onDismiss, 300); // matches the fade-out transition below
    return () => window.clearTimeout(t);
  }, [dismissing, onDismiss]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/75 transition-opacity duration-300 ${
        dismissing ? "opacity-0" : "opacity-100"
      }`}
      onClick={() => setDismissing(true)}
      role="button"
      tabIndex={0}
    >
      <div
        ref={contentRef}
        className="relative inline-block"
        style={fitScale < 1 ? { transform: `scale(${fitScale})` } : undefined}
      >
        <img
          src="/symbols/theFinerThing/congrat.webp"
          alt="Congratulations"
          className="block max-h-[90vh] max-w-[92vw] drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]"
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 pt-[10%]">
          <span
            className="text-8xl text-amber-300"
            style={{ fontFamily: FINER_FONT, fontWeight: 700, textShadow: "0 3px 0 #6b3b00, 0 6px 16px rgba(0,0,0,0.7)" }}
          >
            {finalWin.toFixed(2)}
          </span>
          {wildCount > 0 && (
            <span
              className="flex items-center gap-2 rounded-full border border-sky-300 bg-sky-950/80 px-4 py-1.5 text-xl font-black text-sky-200"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}
            >
              <img src="/symbols/theFinerThing/daimond.webp" alt="" className="h-6 w-6 rounded-full object-cover" />
              {wildCount} Wild{wildCount > 1 ? "s" : ""} · {totalWin.toFixed(2)} × {multiplier}
              {triggerWin > 0 && ` + ${triggerWin.toFixed(2)}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
