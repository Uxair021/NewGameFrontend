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
import { TierKey, TopDollarSymbol, getTopDollarRtpConfig } from "./api";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #1e3a8a 0%, #0f1d4a 50%, #050a1c 100%)",
  accent: "#fbbf24",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #bef264 0%, #22c55e 55%, #15803d 100%)",
  buttonEdge: "#052e16",
};

/** Raw art has a baked-in white card, so it's always shown on a white tile. */
const SYMBOL_IMAGES: Record<TopDollarSymbol, string> = {
  SEVEN: "/symbols/dollarGame/7.webp",
  TRIPLE_BAR: "/symbols/dollarGame/TripleBar.webp",
  DOUBLE_BAR: "/symbols/dollarGame/doubleBar.webp",
  SINGLE_BAR: "/symbols/dollarGame/singleBar.webp",
  DIAMOND: "/symbols/dollarGame/daimond.webp",
  DOLLAR: "/symbols/dollarGame/dollar.webp",
};

const LINE_ROWS: { key: TierKey; name: string; icons: TopDollarSymbol[] }[] = [
  { key: "seven", name: "3 Sevens", icons: ["SEVEN", "SEVEN", "SEVEN"] },
  { key: "tripleBar", name: "3 Triple Bars", icons: ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"] },
  { key: "doubleBar", name: "3 Double Bars", icons: ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"] },
  { key: "singleBar", name: "3 Single Bars", icons: ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"] },
  { key: "anyBar", name: "Any 3 Bars (mixed)", icons: ["TRIPLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"] },
];

const DIAMOND_ROWS: { key: TierKey; name: string; count: number }[] = [
  { key: "diamondThree", name: "3 Diamonds", count: 3 },
  { key: "diamondTwo", name: "2 Diamonds", count: 2 },
  { key: "diamondOne", name: "1 Diamond", count: 1 },
];

function PayRow({ icons, name, tag, mult, bet }: { icons: TopDollarSymbol[]; name: string; tag: "Line" | "Anywhere"; mult: number; bet: number }) {
  return (
    <InfoCard className="flex items-center gap-3 !px-3 !py-2">
      <span
        className={`w-[78px] flex-none rounded-md px-2 py-0.5 text-center text-[11px] font-bold uppercase tracking-wide ${
          tag === "Anywhere" ? "bg-violet-500/25 text-violet-200" : "bg-yellow-400/20 text-yellow-200"
        }`}
      >
        {tag}
      </span>
      <div className="flex w-[104px] sm:w-[160px] flex-none items-center gap-1">
        {icons.map((s, i) => (
          <InfoSymbol key={i} src={SYMBOL_IMAGES[s]} alt={i === 0 ? name : ""} size={46} tile />
        ))}
      </div>
      <InfoGradient className="min-w-0 flex-1 text-[16px]">{name}</InfoGradient>
      <div className="text-right">
        <InfoMoney>{fmtMoney(mult * bet)}</InfoMoney>
        <div className="text-[12px] text-white/50">{mult}x</div>
      </div>
    </InfoCard>
  );
}

export function InfoScreen({ bet, offerCount, onClose }: { bet: number; offerCount: number; onClose: () => void }) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [config] = useState(() => getTopDollarRtpConfig());
  const payout = (key: TierKey) => config.tiers.find((t) => t.key === key)?.payoutMultiplier ?? 0;
  const poolValues = [...new Set(config.bonusPool.map((p) => p.payoutMultiplier))].sort((a, b) => a - b);

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            <InfoAccent>Line</InfoAccent> wins need 3 symbols on the middle payline. <InfoAccent>Diamonds</InfoAccent> pay anywhere on the reels.
            Amounts are for your current bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="mx-auto flex max-w-[860px] flex-col gap-2.5">
            {LINE_ROWS.map((r) => (
              <PayRow key={r.key} icons={r.icons} name={r.name} tag="Line" mult={payout(r.key)} bet={bet} />
            ))}
            {DIAMOND_ROWS.map((r) => (
              <PayRow key={r.key} icons={Array(r.count).fill("DIAMOND")} name={r.name} tag="Anywhere" mult={payout(r.key)} bet={bet} />
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "Payline",
      title: "THE PAYLINE",
      body: (
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
          <div className="flex-none">
            <div className="relative grid grid-cols-3 gap-2 rounded-2xl border-2 border-amber-300/50 bg-black/40 p-3">
              {Array.from({ length: 9 }, (_, k) => {
                const onLine = Math.floor(k / 3) === 1;
                const filler: TopDollarSymbol[] = ["SINGLE_BAR", "DIAMOND", "DOUBLE_BAR", "TRIPLE_BAR", "SINGLE_BAR", "DOUBLE_BAR"];
                return (
                  <div key={k} className={`flex h-[84px] w-[84px] items-center justify-center rounded-xl ${onLine ? "bg-amber-400/25 ring-2 ring-amber-300" : "bg-white/[0.06]"}`}>
                    <img src={SYMBOL_IMAGES[onLine ? "SEVEN" : filler[k % 6]]} alt="" className={`h-[64px] w-[64px] rounded-lg bg-white object-contain p-1 ${onLine ? "" : "opacity-35"}`} />
                  </div>
                );
              })}
              <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-yellow-400 shadow-[0_0_14px_rgba(250,204,21,.9)]" />
            </div>
            <div className="mt-2 text-center text-[14px] font-bold tracking-widest text-amber-300">1 PAYLINE — MIDDLE ROW</div>
          </div>
          <InfoList
            items={[
              <>
                Top Dollar is a 3-reel game with a <InfoAccent>single payline</InfoAccent> across the middle row.
              </>,
              <>
                Line up <InfoAccent>3 matching</InfoAccent> Sevens or Bars on it to win. Any mix of Single, Double and Triple Bars also pays.
              </>,
              <>
                <InfoAccent>Diamonds</InfoAccent> are different: they count anywhere on the reels, above, on or below the line.
              </>,
              <>Win = multiplier × your bet.</>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Bonus",
      title: "TOP DOLLAR BONUS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-4 rounded-2xl border-2 border-amber-300/60 bg-amber-400/10 px-2 sm:px-6 py-3">
            <InfoSymbol src={SYMBOL_IMAGES.DOLLAR} alt="Dollar" size={80} tile />
            <span className="text-[22px] sm:text-[34px] font-black text-amber-300">→</span>
            <span className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-2 sm:px-5 py-2 text-[18px] sm:text-[24px] font-black uppercase tracking-wide text-amber-950">
              Bonus
            </span>
          </div>
          <InfoList
            items={[
              <>
                Land the <InfoAccent>Top Dollar</InfoAccent> symbol on the payline of <InfoAccent>reel 3</InfoAccent> to start the bonus.
              </>,
              <>
                You get up to <InfoAccent>{offerCount} cash offers</InfoAccent>, one at a time.
              </>,
              <>
                <b className="text-lime-300">✓ Take It</b> banks the current offer straight to your balance.{" "}
                <b className="text-orange-300">↻ Try Again</b> throws it away for the next offer, which could be higher or lower.
              </>,
              <>The last offer is locked in automatically.</>,
              <>
                Each offer is made of 1 to 3 cash prizes added together, picked from:{" "}
                {poolValues.map((v, i) => (
                  <span key={v}>
                    <InfoMoney>{v}</InfoMoney>
                    {i < poolValues.length - 1 ? ", " : ""}
                  </span>
                ))}
                .
              </>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Controls",
      title: "HOW TO PLAY",
      body: (
        <InfoControls
          rows={[
            ["Spin", "Spin the reels at the selected bet."],
            ["Bet buttons", "Pick your bet."],
            ["i", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game."],
            ["Home", "Back to the lobby."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Top Dollar rules" theme={THEME} steps={steps} onClose={onClose} />;
}
