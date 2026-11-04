import { useEffect, useRef, useState } from "react";

const ASSET_BASE = "/symbols/fruity777";

const OVERLAY_CSS = `
@keyframes f7-fg-in { from { opacity: 0; transform: scale(1.08); } to { opacity: 1; transform: scale(1); } }
@keyframes f7-fg-pop { 0% { opacity: 0; transform: scale(.4); } 70% { opacity: 1; transform: scale(1.08); } 100% { transform: scale(1); } }
@keyframes f7-fg-blink { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.f7-fg-in { animation: f7-fg-in .5s ease-out both; }
.f7-fg-pop { animation: f7-fg-pop .7s cubic-bezier(.2,.9,.3,1.2) both; }
.f7-fg-blink { animation: f7-fg-blink 1.2s ease-in-out infinite; }
`;

const GOLD_AMOUNT_STYLE = {
  background: "linear-gradient(180deg, #fffbe0 0%, #ffe066 35%, #f59e0b 70%, #b45309 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  filter: "drop-shadow(0 6px 0 #7c2d12) drop-shadow(0 0 24px rgba(251,191,36,.8))",
} as const;

/** Full-screen FREE GAMES intro (FreeSpinBg.png) shown right after the bonus bells — stays up
 * until the player taps it or presses SPIN (`startRequested`), then the game swaps to
 * FreeGameBg.png. */
export function FreeGamesIntro({ spins, onDone, startRequested = false }: { spins: number; onDone: () => void; startRequested?: boolean }) {
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  useEffect(() => {
    if (startRequested) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRequested]);

  return (
    <div className="f7-fg-in absolute inset-0 z-30 cursor-pointer select-none" onClick={finish}>
      <style>{OVERLAY_CSS}</style>
      <img src={`${ASSET_BASE}/FreeSpinBg.webp`} alt="Free Games" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      {/* Sits under the picture's own "FREE GAMES" title (right half of the image). */}
      <div className="f7-fg-pop absolute left-[930px] top-[680px] w-[600px] text-center" style={{ animationDelay: ".35s" }}>
        <div className="text-[110px] font-black italic leading-none" style={GOLD_AMOUNT_STYLE}>
          {spins}
        </div>
        <div className="mt-1 text-[46px] font-black tracking-wider text-white" style={{ textShadow: "0 4px 0 #166534, 0 0 18px rgba(0,0,0,.5)" }}>
          FREE SPINS
        </div>
      </div>
      <div className="f7-fg-blink absolute bottom-[60px] left-0 w-full text-center text-[32px] font-bold tracking-[0.3em] text-white" style={{ textShadow: "0 3px 6px rgba(0,0,0,.7)" }}>
        TAP TO START
      </div>
    </div>
  );
}

/** How long the free spins total takes to count up from 0. */
const COUNT_UP_MS = 2200;

const BIG_WIN_AMOUNT_STYLE = {
  color: "#ffd84a",
  textShadow: "0 6px 0 #7c2d12, 0 0 18px rgba(0,0,0,.6)",
} as const;

/** End of the free spins round: bigWin.webp over colorBg.webp with the round's total win counting
 * up — tap anywhere (or COLLECT) to close it. Deliberately plain HTML — two static <img>s and text, no canvas, CSS animation or filter —
 * so it adds no GPU layers or textures; the images just paint into the page like any other. */
export function FreeGamesBigWin({
  totalWin,
  onClose,
  caption = "TOTAL FREE SPINS WIN",
}: {
  totalWin: number;
  onClose: () => void;
  /** Line under the amount — the base game's 10x+ Big Win passes its own. */
  caption?: string;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / COUNT_UP_MS, 1);
      setShown(totalWin * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [totalWin]);

  return (
    <div className="absolute inset-0 z-30 cursor-pointer select-none" onClick={onClose} role="button" aria-label="Collect free spins win">
      <img src={`${ASSET_BASE}/colorBg.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="relative flex h-full flex-col items-center justify-center">
        <img src={`${ASSET_BASE}/bigWin.webp`} alt="Big Win" width={720} height={573} draggable={false} />
        <div className="-mt-2 text-[150px] font-black leading-none tabular-nums" style={BIG_WIN_AMOUNT_STYLE}>
          {shown.toFixed(2)}
        </div>
        <div className="mt-3 text-[30px] font-bold tracking-[0.25em] text-white" style={{ textShadow: "0 3px 6px rgba(0,0,0,.7)" }}>
          {caption}
        </div>
        <button
          className="mt-8 rounded-full bg-gradient-to-b from-yellow-300 via-amber-500 to-orange-600 px-16 py-4 text-[36px] font-black text-white shadow-[0_6px_0_#7c2d12,0_10px_18px_rgba(0,0,0,.6)]"
          style={{ textShadow: "0 3px 0 #9a3412" }}
        >
          COLLECT
        </button>
      </div>
    </div>
  );
}
