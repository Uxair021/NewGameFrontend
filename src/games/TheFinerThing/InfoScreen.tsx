import { useState, CSSProperties, ReactNode } from "react";
import { GameInfoPopup, InfoTheme } from "../shared/GameInfoPopup";
import { getTheFinerThingRtpConfig, TheFinerThingSymbol } from "./api";

/** Rules / info popup opened by the cabinet's HELP button — the shared stepped GameInfoPopup in
 * this cabinet's purple + gold luxury look. It covers the real viewport (not the scaled card), so
 * it stays readable on a phone. */

const ASSET_BASE = "/symbols/theFinerThing";
const CABINET_FONT = '"Times New Roman", Georgia, serif';

type RegularSymbol = Exclude<TheFinerThingSymbol, "COIN" | "WILD">;

const SYMBOL_IMAGES: Record<TheFinerThingSymbol, string> = {
  AEROPLANE: `${ASSET_BASE}/aeroplane.webp`,
  BOAT: `${ASSET_BASE}/boat.webp`,
  CAR: `${ASSET_BASE}/car.webp`,
  RING: `${ASSET_BASE}/ring.webp`,
  MONEY: `${ASSET_BASE}/money.webp`,
  WATCH: `${ASSET_BASE}/watch.webp`,
  GOLD_BAR: `${ASSET_BASE}/goldBar.webp`,
  SILVER_BAR: `${ASSET_BASE}/silverBar.webp`,
  BRONZE_BAR: `${ASSET_BASE}/bronzeBar.webp`,
  WILD: `${ASSET_BASE}/daimond.webp`,
  COIN: `${ASSET_BASE}/coin.webp`,
};

const SYMBOL_NAMES: Record<RegularSymbol, string> = {
  AEROPLANE: "Aeroplane",
  BOAT: "Yacht",
  CAR: "Car",
  RING: "Diamond Ring",
  MONEY: "Money",
  WATCH: "Watch",
  GOLD_BAR: "Gold Bar",
  SILVER_BAR: "Silver Bar",
  BRONZE_BAR: "Bronze Bar",
};

/** Highest paying first. */
const REGULAR_SYMBOLS: RegularSymbol[] = ["AEROPLANE", "BOAT", "CAR", "RING", "MONEY", "WATCH", "GOLD_BAR", "SILVER_BAR", "BRONZE_BAR"];

const GOLD_TEXT: CSSProperties = {
  background: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

const fmt = (n: number) => n.toFixed(2);
const fmtMult = (n: number) => `${Number(n.toFixed(2))}x`;

/** Colours for the shared rules popup (see shared/GameInfoPopup). */
const INFO_THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #6a2a8c 0%, #3d0e55 50%, #1a0626 100%)",
  accent: "#fcd34d",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #fde047 0%, #f59e0b 50%, #ea580c 100%)",
  buttonEdge: "#7c2d12",
  titleFont: CABINET_FONT,
};

export function InfoScreen({
  bet,
  paylines,
  lineColors,
  onClose,
}: {
  bet: number;
  paylines: readonly (readonly number[])[];
  lineColors: string[];
  onClose: () => void;
}) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [config] = useState(() => getTheFinerThingRtpConfig());
  const scatter = config.scatterRules;

  const symbolCard = (s: RegularSymbol) => {
    const p = config.symbolPayouts[s];
    return (
      <div
        key={s}
        className="flex items-center gap-3 rounded-2xl border border-amber-300/25 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-3 py-2"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 6px 14px rgba(0,0,0,.35)" }}
      >
        <img src={SYMBOL_IMAGES[s]} alt={SYMBOL_NAMES[s]} className="h-[46px] sm:h-[63px] w-[46px] sm:w-[63px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[12px] sm:text-[14px] font-bold" style={{ ...GOLD_TEXT, fontFamily: CABINET_FONT }}>
            {SYMBOL_NAMES[s]}
          </div>
          {([5, 4, 3] as const).map((n) => {
            const mult = n === 5 ? p.x5 : n === 4 ? p.x4 : p.x3;
            return (
              <div key={n} className="flex items-baseline justify-between text-[12px] sm:text-[11px] leading-[12px] sm:leading-[15px]">
                <span className="font-bold text-amber-200">{n} ×</span>
                <span className="text-white/60">{fmtMult(mult)}</span>
                <span className="w-[40px] sm:w-[54px] text-right font-bold tabular-nums text-lime-300">{fmt(mult * bet)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const steps: { tab: string; title: string; body: ReactNode }[] = [
    {
      tab: "Symbols",
      title: "PAYTABLE",
      body: (
        <>
          <p className="mb-4 text-center text-[12px] sm:text-[13px] text-white/80">
            Land <b className="text-amber-300">3, 4 or 5 matching symbols</b> on a payline, starting from the leftmost reel. Amounts are shown for
            your current bet of <b className="text-lime-300">{fmt(bet)}</b>.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{REGULAR_SYMBOLS.map(symbolCard)}</div>
        </>
      ),
    },
    {
      tab: "Specials",
      title: "WILD & COIN",
      body: (
        <div className="flex flex-col gap-3 sm:gap-5">
          <div className="flex items-center gap-3 sm:gap-6 rounded-2xl border border-sky-300/40 bg-gradient-to-r from-sky-500/15 to-violet-500/10 px-3 sm:px-6 py-4 flex-col sm:flex-row">
            <img src={SYMBOL_IMAGES.WILD} alt="Wild" className="h-[66px] sm:h-[90px] w-[66px] sm:w-[90px] flex-none object-contain drop-shadow-[0_0_16px_rgba(125,211,252,.7)]" />
            <div className="text-[12px] sm:text-[13px] leading-[16px] sm:leading-[20px] text-white/85">
              <div className="text-[17px] sm:text-[21px] font-black" style={{ ...GOLD_TEXT, fontFamily: CABINET_FONT }}>
                DIAMOND WILD
              </div>
              <ul className="list-disc pl-5">
                <li>
                  Substitutes for <b className="text-amber-300">every paying symbol</b> to complete a winning line.
                </li>
                <li>
                  Appears on <b className="text-amber-300">reels 2, 3 and 4</b> only.
                </li>
                <li>
                  During Free Games, every Wild that lands is <b className="text-sky-300">collected</b> and boosts your end-of-round bonus.
                </li>
              </ul>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6 rounded-2xl border border-amber-300/40 bg-gradient-to-r from-amber-500/15 to-fuchsia-500/10 px-3 sm:px-6 py-4 flex-col sm:flex-row">
            <img src={SYMBOL_IMAGES.COIN} alt="Coin" className="h-[66px] sm:h-[90px] w-[66px] sm:w-[90px] flex-none object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            <div className="flex-1 text-[12px] sm:text-[13px] leading-[16px] sm:leading-[20px] text-white/85">
              <div className="text-[17px] sm:text-[21px] font-black" style={{ ...GOLD_TEXT, fontFamily: CABINET_FONT }}>
                COIN SCATTER
              </div>
              <p>
                Pays <b className="text-amber-300">anywhere</b> on the reels — no payline needed. 3 or more Coins award{" "}
                <b className="text-lime-300">{scatter.freeSpinsAwarded} FREE GAMES</b>.
              </p>
              <div className="mt-2 flex gap-3">
                {(
                  [
                    ["5+", scatter.x5],
                    ["4", scatter.x4],
                    ["3", scatter.x3],
                  ] as const
                ).map(([n, mult]) => (
                  <div key={n} className="flex-1 rounded-xl border border-amber-300/30 bg-black/30 px-3 py-1 text-center">
                    <div className="text-[12px] sm:text-[11px] font-bold text-amber-200">{n} Coins</div>
                    <div className="text-[12px] sm:text-[14px] font-black tabular-nums text-lime-300">{fmt(mult * bet)}</div>
                    <div className="text-[12px] text-white/50">{fmtMult(mult)} bet</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      tab: "Paylines",
      title: `${paylines.length} PAYLINES`,
      body: (
        <>
          <p className="mb-4 text-center text-[12px] sm:text-[13px] text-white/80">
            Wins pay <b className="text-amber-300">left to right</b> from the first reel. Only the highest win per line is paid; wins on different
            lines are added together.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 gap-y-3">
            {paylines.map((line, i) => (
              <PaylineDiagram key={i} number={i + 1} line={line} color={lineColors[i] ?? "#fcd34d"} />
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "Free Games",
      title: "FREE GAMES BONUS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-3 sm:mb-5 flex items-center gap-2 rounded-2xl border-2 border-emerald-300/60 bg-emerald-400/10 px-3 sm:px-6 py-3 shadow-[0_0_24px_rgba(46,235,104,.3)]">
            {[0, 1, 2].map((i) => (
              <img key={i} src={SYMBOL_IMAGES.COIN} alt={i === 0 ? "Coin" : ""} className="h-[44px] sm:h-[60px] w-[44px] sm:w-[60px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]" />
            ))}
            <span className="ml-4 text-[21px] sm:text-[26px] font-black" style={{ ...GOLD_TEXT, fontFamily: CABINET_FONT }}>
              = {scatter.freeSpinsAwarded} FREE GAMES
            </span>
          </div>
          <ul className="max-w-[960px] list-disc space-y-2 pl-6 text-[12px] sm:text-[13px] leading-[16px] sm:leading-[19px] text-white/85">
            <li>
              Land <b className="text-amber-300">3 or more Coins</b> anywhere to trigger {scatter.freeSpinsAwarded} free games, played
              automatically at the <b className="text-amber-300">same bet</b> that triggered them.
            </li>
            <li>
              Every <b className="text-sky-300">Diamond Wild</b> that lands is collected into the counter at the top of the screen.
            </li>
            <li>
              When the round ends, your total free games win is multiplied by{" "}
              <b className="text-lime-300">(Wilds collected + 1)</b>. Example: 4 Wilds collected = <b className="text-lime-300">5×</b> your round
              win.
            </li>
            <li>Coins during free games still pay their scatter prize, but free games cannot be retriggered.</li>
            <li>
              Tap the screen or PLAY to start the free games. Every round pays at least <b className="text-lime-300">1×</b> your bet in total,
              and the total is added to your balance when you tap its result away.
            </li>
            <li>Bet changes and AUTO PLAY are locked until the round ends; AUTO PLAY switches off when it does.</li>
          </ul>
        </div>
      ),
    },
    {
      tab: "Controls",
      title: "HOW TO PLAY",
      body: (
        <div className="flex gap-3 sm:gap-8">
          <ul className="flex-1 space-y-2 text-[12px] sm:text-[13px] leading-[16px] sm:leading-[19px] text-white/85">
            {(
              [
                ["PLAY", "Spin the reels at the current bet."],
                ["LESS / ADD", "Lower or raise your bet."],
                ["MAX", "Jump straight to the maximum bet."],
                ["AUTO PLAY", "Keeps spinning until pressed again or your balance runs out."],
                ["HELP", "Opens this screen."],
                ["EXIT", "Return to the lobby."],
              ] as const
            ).map(([key, text]) => (
              <li key={key} className="flex items-start gap-3">
                <span
                  className="w-[72px] sm:w-[98px] flex-none rounded-lg border border-amber-300/50 bg-[#3d0e55] py-1 text-center text-[12px] sm:text-[12px] font-bold text-[#f6ecff]"
                  style={{ fontFamily: CABINET_FONT }}
                >
                  {key}
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
          <div className="w-full sm:w-[285px] flex-none rounded-2xl border border-amber-300/30 bg-black/25 px-3 sm:px-5 py-4 text-[12px] sm:text-[12px] leading-[15px] sm:leading-[18px] text-white/85">
            <p className="text-[14px] text-white/55">Malfunction voids all pays and plays.</p>
          </div>
        </div>
      ),
    },
  ];

  return <GameInfoPopup label="The Finer Thing rules" theme={INFO_THEME} steps={steps} onClose={onClose} />;
}


/** One payline drawn as a mini 5x3 grid with its path traced through the lit cells. */
function PaylineDiagram({ number, line, color }: { number: number; line: readonly number[]; color: string }) {
  const CELL = 34;
  const GAP = 3;
  const width = 5 * CELL + 4 * GAP;
  const height = 3 * CELL + 2 * GAP;
  const center = (i: number) => i * (CELL + GAP) + CELL / 2;
  const points = line.map((row, reel) => `${center(reel)},${center(row)}`).join(" ");
  return (
    <div className="flex flex-col items-center rounded-xl border border-amber-300/20 bg-black/25 px-2 pb-2 pt-1">
      <div className="mb-1 flex items-center gap-2 text-[14px] font-bold text-white/80">
        <span className="inline-block h-[12px] w-[12px] rounded-sm" style={{ backgroundColor: color }} />
        LINE {number}
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: 15 }, (_, k) => {
          const reel = k % 5;
          const row = Math.floor(k / 5);
          const lit = line[reel] === row;
          return (
            <rect
              key={k}
              x={reel * (CELL + GAP)}
              y={row * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={5}
              fill={lit ? color : "rgba(255,255,255,0.07)"}
              fillOpacity={lit ? 0.55 : 1}
              stroke={lit ? color : "none"}
              strokeWidth={2}
            />
          );
        })}
        <polyline points={points} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      </svg>
    </div>
  );
}
