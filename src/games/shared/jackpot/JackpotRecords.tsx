import { CSSProperties, useEffect, useState } from "react";
import { X } from "lucide-react";
import { JackpotRecord, JackpotRecordsTab, JackpotTierInfo, JackpotTierKey, jackpotRecordsRequest } from "./jackpotApi";
import { AMOUNT_GRADIENT, JACKPOT_FONT, TIER_STYLE, formatAmount, gradientText, useCountUp } from "./JackpotTicker";

const TABS: { key: JackpotRecordsTab; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "jackpot", label: "Jackpot" },
  { key: "mega", label: "Mega" },
  { key: "major", label: "Major" },
  { key: "mini", label: "Mini" },
];

/** Stars above each tier on the left — more for bigger tiers. */
const TIER_STARS: Record<JackpotTierKey, number> = { jackpot: 6, mega: 4, major: 2, mini: 1 };
/** Each tier's display shrinks a little going down, like a podium. */
const TIER_SCALE: Record<JackpotTierKey, number> = { jackpot: 1, mega: 0.93, major: 0.86, mini: 0.8 };

const TITLE_GRADIENT = "linear-gradient(180deg, #fffbd0 0%, #ffd23f 45%, #ff8a00 75%, #e0301e 100%)";
const PANEL_BLUE = "linear-gradient(180deg, #1d5fd0, #123f9c)";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface JackpotRecordsProps {
  /** Current prize per tier, shown on the left. */
  tiers: JackpotTierInfo[];
  /** Tab open when the screen appears — the tier the player tapped on the jackpot bar. */
  initialTab: JackpotRecordsTab;
  onClose: () => void;
}

/** Jackpot Record screen, shared by every pool game: the four tiers' current prizes on the left,
 * and recent winners on the right with a tab per tier. Rendered inside the game's own
 * (design-size, CSS-scaled) card and laid out for a 1672x941 design. */
export function JackpotRecords({ tiers, initialTab, onClose }: JackpotRecordsProps) {
  const [tab, setTab] = useState<JackpotRecordsTab>(initialTab);
  const [records, setRecords] = useState<JackpotRecord[] | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRecords(null);
    setFailed(false);
    jackpotRecordsRequest(tab)
      .then((r) => {
        if (cancelled) return;
        setRecords(r.records);
        setMyRank(r.myRank);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center gap-10 px-10"
      style={{ background: "radial-gradient(ellipse at 50% 45%, #0f3c8c 0%, #071a45 60%, #030a1f 100%)" }}
    >
      {/* Current prizes */}
      <div className="flex w-[520px] flex-shrink-0 flex-col items-center gap-3">
        {tiers.map((t) => (
          <TierDisplay key={t.key} tier={t} />
        ))}
      </div>

      {/* Winners table */}
      <div
        className="relative flex h-[860px] w-[1000px] flex-col rounded-[28px] border-4"
        style={{
          borderColor: "#38d4ff",
          background: "linear-gradient(180deg, #0d2a63, #081736)",
          boxShadow: "0 0 30px rgba(56,212,255,0.45), inset 0 0 20px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="flex h-[120px] flex-shrink-0 items-center justify-center rounded-t-[24px]"
          style={{ background: "linear-gradient(180deg, #c8f3ff 0%, #7fd8f5 50%, #3aa9d8 100%)" }}
        >
          <span
            className="text-[78px] italic leading-none"
            style={{
              fontFamily: JACKPOT_FONT,
              ...gradientText(TITLE_GRADIENT),
              filter: "drop-shadow(0 4px 0 #8a1c06) drop-shadow(0 0 2px #5a1004)",
            }}
          >
            Jackpot Record
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-6 -top-6 flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 text-white transition-transform active:scale-90"
          style={{
            borderColor: "#38d4ff",
            background: "radial-gradient(circle at 50% 30%, #3d6fd6, #102a6b)",
            boxShadow: "0 4px 10px rgba(0,0,0,0.6)",
          }}
        >
          <X size={40} strokeWidth={3.5} />
        </button>

        <div className="mx-8 mt-6 grid h-[52px] flex-shrink-0 grid-cols-[90px_220px_230px_190px_1fr] items-center rounded-lg bg-black/80 px-3 text-[24px] uppercase text-sky-200">
          <span style={{ fontFamily: JACKPOT_FONT }}>Rank</span>
          <span style={{ fontFamily: JACKPOT_FONT }}>Player</span>
          <span className="text-center" style={{ fontFamily: JACKPOT_FONT }}>
            Jackpot
          </span>
          <span className="text-center" style={{ fontFamily: JACKPOT_FONT }}>
            Time
          </span>
          <span className="text-center" style={{ fontFamily: JACKPOT_FONT }}>
            Bonus
          </span>
        </div>

        <div className="mx-8 mt-3 flex-1 overflow-y-auto rounded-2xl border-2 border-sky-400/50 bg-[#1d2333] p-3">
          {records === null && !failed && <Message>Loading...</Message>}
          {failed && <Message>Couldn't load the records. Please try again.</Message>}
          {records?.length === 0 && <Message>No jackpot winners yet.</Message>}
          <div className="flex flex-col gap-3">
            {records?.map((r, i) => (
              <RecordRow key={`${r.paidAt}-${i}`} rank={i + 1} record={r} />
            ))}
          </div>
        </div>

        <div className="mx-8 mt-4 grid flex-shrink-0 grid-cols-5 gap-4">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="h-[64px] rounded-xl border-2 text-[30px] uppercase transition-transform active:scale-95"
                style={{
                  fontFamily: JACKPOT_FONT,
                  color: active ? "#5a2a06" : "#ffffff",
                  borderColor: active ? "#fff2a8" : "rgba(120,170,255,0.35)",
                  background: active
                    ? "linear-gradient(180deg, #ffe066 0%, #ffbf1f 50%, #f08c00 100%)"
                    : "linear-gradient(180deg, #2a3550, #151c2e)",
                  boxShadow: active ? "0 0 14px rgba(255,200,40,0.6)" : "inset 0 2px 3px rgba(255,255,255,0.12)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mb-4 mt-3 text-center text-[28px]" style={{ fontFamily: JACKPOT_FONT, ...gradientText(AMOUNT_GRADIENT) }}>
          {myRank ? `Your best rank: #${myRank}` : "You are not in the record list"}
        </div>
      </div>
    </div>
  );
}

function Message({ children }: { children: string }) {
  return <div className="py-16 text-center text-[28px] text-sky-200/70">{children}</div>;
}

function RecordRow({ rank, record }: { rank: number; record: JackpotRecord }) {
  const cell: CSSProperties = { background: PANEL_BLUE, boxShadow: "inset 0 2px 2px rgba(255,255,255,0.2)" };
  return (
    <div
      className="grid h-[76px] grid-cols-[90px_220px_230px_190px_1fr] items-stretch gap-1 rounded-lg"
      style={{ outline: record.isMe ? "3px solid #ffd23f" : undefined }}
    >
      <div
        className="flex items-center justify-center rounded-l-lg text-[46px] text-yellow-300"
        style={{ ...cell, fontFamily: JACKPOT_FONT, background: "linear-gradient(180deg, #2f7cf0, #1a4fc0)" }}
      >
        {rank}
      </div>
      <div className="flex items-center truncate px-3 text-[30px] text-white" style={{ ...cell, fontFamily: JACKPOT_FONT }}>
        {record.isMe ? "You" : record.player}
      </div>
      <div className="flex items-center justify-center px-2" style={cell}>
        <span
          className="w-full rounded-full py-1.5 text-center text-[28px] uppercase"
          style={{ background: "#2a0f45", fontFamily: JACKPOT_FONT }}
        >
          <span style={gradientText(TIER_STYLE[record.tier].label)}>{record.label}</span>
        </span>
      </div>
      <div className="flex items-center justify-center text-[24px] text-white" style={cell}>
        {formatWhen(record.paidAt)}
      </div>
      <div
        className="flex items-center justify-center rounded-r-lg text-[44px]"
        style={{ ...cell, fontFamily: JACKPOT_FONT }}
      >
        <span style={gradientText(AMOUNT_GRADIENT)}>{formatAmount(record.amount)}</span>
      </div>
    </div>
  );
}

/** One tier's collected amount (live): stars, a name badge, and the amount in odometer-style digit boxes. */
function TierDisplay({ tier }: { tier: JackpotTierInfo }) {
  const style = TIER_STYLE[tier.key];
  const scale = TIER_SCALE[tier.key];
  const chars = formatAmount(useCountUp(tier.amount)).split("");

  return (
    <div className="flex flex-col items-center" style={{ transform: `scale(${scale})`, margin: `${(scale - 1) * 40}px 0` }}>
      <div className="flex gap-0.5 text-[30px] leading-none text-yellow-300 drop-shadow-[0_2px_1px_rgba(0,0,0,0.8)]">
        {"★".repeat(TIER_STARS[tier.key])}
      </div>
      <div
        className="relative z-10 -mb-3 mt-1 rounded-full border-[3px] px-8 py-1 text-[36px] uppercase leading-none"
        style={{ background: style.bg, borderColor: "#ffe27a", fontFamily: JACKPOT_FONT, boxShadow: "0 3px 6px rgba(0,0,0,0.6)" }}
      >
        <span style={gradientText(style.label)}>{tier.label}</span>
      </div>
      <div
        className="rounded-[22px] border-[5px] p-3"
        style={{
          background: style.bg,
          borderColor: "#d9dee5",
          boxShadow: "inset 0 3px 4px rgba(255,255,255,0.4), inset 0 -5px 8px rgba(0,0,0,0.4), 0 6px 14px rgba(0,0,0,0.6)",
        }}
      >
        <div className="flex items-end rounded-xl bg-black/60 px-2 py-2">
          {chars.map((c, i) =>
            c === "," || c === "." ? (
              <span key={i} className="mx-[1px] mb-1 text-[30px] leading-none" style={{ fontFamily: JACKPOT_FONT, ...gradientText(AMOUNT_GRADIENT) }}>
                {c}
              </span>
            ) : (
              <span
                key={i}
                className="mx-[2px] flex h-[66px] w-[46px] items-center justify-center rounded-md text-[48px] leading-none"
                style={{
                  fontFamily: JACKPOT_FONT,
                  background: "linear-gradient(180deg, #ffffff 0%, #d5dbe2 45%, #8f9aa6 55%, #e8edf2 100%)",
                  boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.35)",
                }}
              >
                <span style={gradientText(AMOUNT_GRADIENT)}>{c}</span>
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
