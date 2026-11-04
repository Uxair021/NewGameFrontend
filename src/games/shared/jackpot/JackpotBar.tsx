import { useEffect, useRef, useState } from "react";
import { JackpotInfo, JackpotRecordsTab } from "./jackpotApi";
import { JackpotTierGroup } from "./JackpotTicker";
import { JackpotRecords } from "./JackpotRecords";
import { useJackpot } from "./useJackpot";

/** The bar and the Jackpot Record screen are laid out at this size, then scaled to each game. */
const BASE_WIDTH = 1672;
const BASE_HEIGHT = 941;

interface JackpotBarProps {
  info: JackpotInfo | null;
  /** Lets a game pause autoplay while the Jackpot Record screen is open. */
  onRecordsOpenChange?: (open: boolean) => void;
}

/**
 * The shared jackpot bar across the top of every pool game — Jackpot + Mega on the left, a
 * see-through gap in the middle for the game's logo, Major + Mini on the right, on a blue bar with
 * a sloped notch. Tapping a tier opens the Jackpot Record screen on that tier's tab.
 *
 * Drop it anywhere inside the game's scaled card (the `relative` element sized to the game's
 * design width/height): it measures that card and scales itself to fit, so it works whatever the
 * game's design size is.
 */
export function JackpotBar({ info, onRecordsOpenChange }: JackpotBarProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: BASE_WIDTH, height: BASE_HEIGHT });
  const [recordsTab, setRecordsTab] = useState<JackpotRecordsTab | null>(null);

  // offsetWidth/Height are the card's design size — unaffected by the CSS scale on the card.
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => setBox({ width: node.offsetWidth || BASE_WIDTH, height: node.offsetHeight || BASE_HEIGHT });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [info?.inPool]);

  const recordsOpen = recordsTab !== null;
  useEffect(() => {
    onRecordsOpenChange?.(recordsOpen);
  }, [recordsOpen, onRecordsOpenChange]);

  if (!info?.inPool) return null;

  const barScale = box.width / BASE_WIDTH;
  const recordsScale = Math.min(box.width / BASE_WIDTH, box.height / BASE_HEIGHT);
  const left = info.tiers.filter((t) => t.key === "jackpot" || t.key === "mega");
  const right = info.tiers.filter((t) => t.key === "major" || t.key === "mini");

  return (
    // No z-index here on purpose: that would trap the Record screen below the game's own z-10
    // controls. The bar and the screen each carry their own z-index instead.
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
      {/* Jackpot bar — edge to edge across the top of the game. */}
      <div
        className="absolute left-0 top-0 z-[9] flex items-center py-2"
        style={{
          width: BASE_WIDTH,
          paddingLeft: 20,
          paddingRight: 20,
          transform: `scale(${barScale})`,
          transformOrigin: "top left",
        }}
      >
        {/* Blue background (#1163D6 base) with a sloped, see-through notch in the middle for the
         * logo. The shadow sits on a wrapper because clip-path would cut off a shadow on the same
         * element. */}
        <div className="absolute inset-0" style={{ filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.5))" }}>
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(180deg, #7cc4ff 0%, #2f86ea 12%, #1163D6 45%, #0b4fb0 80%, #083a85 100%)",
              clipPath: "polygon(0 0, 38% 0, 35.5% 100%, 64.5% 100%, 62% 0, 100% 0, 100% 100%, 0 100%)",
            }}
          />
        </div>

        {/* Jackpot + Mega */}
        <div className="relative flex-shrink-0">
          <JackpotTierGroup tiers={left} onTierClick={setRecordsTab} />
        </div>

        {/* Empty, transparent space so the game logo shows through */}
        <div className="flex-1" />

        {/* Major + Mini */}
        <div className="relative flex-shrink-0">
          <JackpotTierGroup tiers={right} onTierClick={setRecordsTab} />
        </div>
      </div>

      {/* Jackpot Record screen, scaled to fit the game and centred, letterboxed in its own navy. */}
      {recordsTab && (
        <div className="pointer-events-auto absolute inset-0 z-[60] bg-[#030a1f]">
          <div
            className="absolute"
            style={{
              left: (box.width - BASE_WIDTH * recordsScale) / 2,
              top: (box.height - BASE_HEIGHT * recordsScale) / 2,
              width: BASE_WIDTH,
              height: BASE_HEIGHT,
              transform: `scale(${recordsScale})`,
              transformOrigin: "top left",
            }}
          >
            <JackpotRecords tiers={info.tiers} initialTab={recordsTab} onClose={() => setRecordsTab(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** For games that only show the jackpot (they can't force a feature to deliver one yet): runs the
 * jackpot stream itself and renders the bar. One line per game: `<GameJackpotBar gameId="..." />`. */
export function GameJackpotBar({ gameId, onRecordsOpenChange }: { gameId: string; onRecordsOpenChange?: (open: boolean) => void }) {
  const { info } = useJackpot(gameId);
  return <JackpotBar info={info} onRecordsOpenChange={onRecordsOpenChange} />;
}
