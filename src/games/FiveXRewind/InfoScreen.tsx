import { useState } from "react";
import {
  GameInfoPopup,
  InfoAccent,
  InfoCard,
  InfoControls,
  InfoGradient,
  InfoLead,
  InfoList,
  InfoMoney,
  InfoSymbol,
  InfoTheme,
  fmtMoney,
} from "../shared/GameInfoPopup";
import { FiveXSymbol, LineTierKey, getFiveXRtpConfig } from "./api";

const ASSET_BASE = "/symbols/5xRewind";

/** The reels' own palette: deep magenta frames with gold highlights. */
const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #5b0f3a 0%, #22071a 50%, #0a0306 100%)",
  accent: "#fbbf24",
  titleGradient: "linear-gradient(180deg, #fff1c2 0%, #fcd34d 45%, #ea580c 100%)",
  buttonBackground: "linear-gradient(180deg, #f9a8d4 0%, #ec4899 55%, #9d174d 100%)",
  buttonEdge: "#500724",
};

const SYMBOL_IMAGES: Record<FiveXSymbol, string> = {
  WHITE_BAR: `${ASSET_BASE}/WHITE-BAR.webp`,
  SEVEN_BAR: `${ASSET_BASE}/7-BAR.webp`,
  RED_BAR: `${ASSET_BASE}/RED-BAR.webp`,
  PURPLE_BAR: `${ASSET_BASE}/PURPLE-BAR.webp`,
  RED_7: `${ASSET_BASE}/RED-7.webp`,
  PURPLE_7: `${ASSET_BASE}/PURPLE-7.webp`,
  BLUE_7: `${ASSET_BASE}/BLUE-7.webp`,
  COIN_2X: `${ASSET_BASE}/2X-coin.webp`,
  COIN_3X: `${ASSET_BASE}/3X-coin.webp`,
  COIN_4X: `${ASSET_BASE}/4X-coin.webp`,
  COIN_5X: `${ASSET_BASE}/5X-coin.webp`,
};

/** Every line win, each tied to the live RTP tier that pays it (same order as the old paytable).
 * `fallback` = api.ts's built-in payout, used when the admin config leaves a tier's payout unset. */
const LINE_ROWS: { key: LineTierKey; name: string; icons: FiveXSymbol[]; fallback: number }[] = [
  { key: "red7", name: "3 Red Sevens", icons: ["RED_7", "RED_7", "RED_7"], fallback: 20 },
  { key: "purple7", name: "3 Purple Sevens", icons: ["PURPLE_7", "PURPLE_7", "PURPLE_7"], fallback: 15 },
  { key: "blue7", name: "3 Blue Sevens", icons: ["BLUE_7", "BLUE_7", "BLUE_7"], fallback: 12 },
  { key: "sevenBar", name: "3 Seven Bars", icons: ["SEVEN_BAR", "SEVEN_BAR", "SEVEN_BAR"], fallback: 10 },
  { key: "purpleBar", name: "3 Purple Bars", icons: ["PURPLE_BAR", "PURPLE_BAR", "PURPLE_BAR"], fallback: 6 },
  { key: "redBar", name: "3 Red Bars", icons: ["RED_BAR", "RED_BAR", "RED_BAR"], fallback: 5 },
  { key: "whiteBar", name: "3 White Bars", icons: ["WHITE_BAR", "WHITE_BAR", "WHITE_BAR"], fallback: 1 },
  { key: "any3Sevens", name: "Any 3 Sevens (mixed)", icons: ["RED_7", "SEVEN_BAR", "BLUE_7"], fallback: 8 },
  { key: "any3BarWithSevenBar", name: "Any 3 White / Seven Bars", icons: ["WHITE_BAR", "SEVEN_BAR", "WHITE_BAR"], fallback: 4 },
  { key: "any3BarOnly", name: "Any 3 Bars (mixed, no Seven Bar)", icons: ["WHITE_BAR", "RED_BAR", "PURPLE_BAR"], fallback: 2 },
];

const COINS: { symbol: FiveXSymbol; value: number }[] = [
  { symbol: "COIN_2X", value: 2 },
  { symbol: "COIN_3X", value: 3 },
  { symbol: "COIN_4X", value: 4 },
  { symbol: "COIN_5X", value: 5 },
];

/** The two position-exact coin jackpots (see api.ts calculateWin). */
const JACKPOTS: { icons: FiveXSymbol[]; multiplier: number }[] = [
  { icons: ["COIN_2X", "COIN_5X", "COIN_2X"], multiplier: 1000 },
  { icons: ["COIN_2X", "COIN_4X", "COIN_2X"], multiplier: 400 },
];

function Icons({ icons, size = 44 }: { icons: FiveXSymbol[]; size?: number }) {
  return (
    <div className="flex items-center gap-1">
      {icons.map((s, i) => (
        <InfoSymbol key={i} src={SYMBOL_IMAGES[s]} alt={s} size={size} />
      ))}
    </div>
  );
}

function PayRow({ icons, name, multiplier, bet }: { icons: FiveXSymbol[]; name: string; multiplier: number; bet: number }) {
  return (
    <div className="flex items-center gap-3 border-t border-white/10 px-2 py-2 first:border-t-0 sm:px-4">
      <Icons icons={icons} />
      <span className="flex-1 text-[14px] font-semibold text-white/85 sm:text-[16px]">{name}</span>
      <span className="text-right">
        <InfoGradient className="block text-[18px] sm:text-[22px]">×{multiplier}</InfoGradient>
        <span className="text-[12px] text-white/55 sm:text-[13px]">
          <InfoMoney>{fmtMoney(multiplier * bet)}</InfoMoney>
        </span>
      </span>
    </div>
  );
}

export function InfoScreen({ bet, onClose }: { bet: number; onClose: () => void }) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [config] = useState(() => getFiveXRtpConfig());
  const payout = (key: LineTierKey, fallback: number) => config.tiers.find((t) => t.key === key)?.payoutMultiplier ?? fallback;

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Line up <InfoAccent>3 symbols</InfoAccent> on the payline. Prizes below are × your bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <InfoCard className="mx-auto max-w-[760px] !p-0">
            {LINE_ROWS.map((row) => (
              <PayRow key={row.key} icons={row.icons} name={row.name} multiplier={payout(row.key, row.fallback)} bet={bet} />
            ))}
          </InfoCard>
        </>
      ),
    },
    {
      tab: "Coins",
      title: "MULTIPLIER COINS",
      body: (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
            {COINS.map((c) => (
              <InfoCard key={c.symbol} className="flex flex-col items-center !px-3 !py-2">
                <InfoSymbol src={SYMBOL_IMAGES[c.symbol]} alt={`${c.value}X coin`} size={64} />
                <span className="mt-1 text-[13px] font-bold text-white/70">×{c.value}</span>
              </InfoCard>
            ))}
          </div>
          <InfoList
            items={[
              <>
                A coin <InfoAccent>stands in</InfoAccent> for a missing symbol, so 2 matching symbols + a coin still completes the 3 of a
                kind.
              </>,
              <>
                Every coin on the line <InfoAccent>multiplies</InfoAccent> the win, and coins stack: a 2X and a 3X together make ×6.
              </>,
              <>
                Coins pay <InfoAccent>on their own</InfoAccent> too: any coin on the line pays your bet × the coins' stacked value.
              </>,
            ]}
          />
          <div className="mt-5 flex flex-col items-center gap-3">
            {JACKPOTS.map((j) => (
              <div key={j.multiplier} className="flex flex-wrap items-center justify-center gap-4">
                <Icons icons={j.icons} size={52} />
                <span className="text-[19px] font-black text-amber-300 sm:text-[26px]">→</span>
                <span className="text-center">
                  <InfoGradient className="block text-[21px] sm:text-[30px]">×{j.multiplier}</InfoGradient>
                  <span className="text-[12px] text-white/60 sm:text-[13px]">exact order · {fmtMoney(j.multiplier * bet)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "Payline",
      title: "ONE PAYLINE",
      body: (
        <InfoList
          items={[
            <>
              The <InfoAccent>black line</InfoAccent> through the middle of the 3 reels is the only payline. Only the symbols sitting on it
              count.
            </>,
            <>A reel can stop between two symbols. That leaves its spot on the line empty, and an empty spot never pays.</>,
            <>Wins are paid instantly, and the reels' frames glow red to show them.</>,
          ]}
        />
      ),
    },
    {
      tab: "Controls",
      title: "HOW TO PLAY",
      body: (
        <InfoControls
          rows={[
            ["Spin", "Spin the reels at the current bet."],
            ["Hold Spin", "Starts auto spin. Press STOP to end it."],
            ["Bet − / +", "Lower or raise your bet."],
            ["Turbo", "Faster spins."],
            ["Menu", "Home, sound settings and these rules."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="5x Rewind rules" theme={THEME} steps={steps} onClose={onClose} />;
}
