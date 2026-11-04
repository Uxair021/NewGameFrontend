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
import { CrazySymbol, LineTierKey, SpecialSymbol, SpecialTierKey, getCrazy777RtpConfig } from "./api";

// Note: the actual asset folder on disk is spelled "carzy777" (not "crazy777").
const ASSET_BASE = "/symbols/carzy777";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #8b1a1a 0%, #4a0b0b 50%, #160303 100%)",
  accent: "#fbbf24",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #bef264 0%, #22c55e 55%, #15803d 100%)",
  buttonEdge: "#14532d",
};

const SYMBOL_IMAGES: Record<CrazySymbol, string> = {
  SEVEN_LOW: `${ASSET_BASE}/7.webp`,
  SEVEN_MID: `${ASSET_BASE}/77.webp`,
  SEVEN_HIGH: `${ASSET_BASE}/777.webp`,
  SINGLE_BAR: `${ASSET_BASE}/BAR1.webp`,
  DOUBLE_BAR: `${ASSET_BASE}/doubleBar.webp`,
};

const SPECIAL_IMAGES: Record<SpecialSymbol, string> = {
  MULT_2X: `${ASSET_BASE}/2X.webp`,
  MULT_5X: `${ASSET_BASE}/5X.webp`,
  MULT_10X: `${ASSET_BASE}/10X.webp`,
  DOLLAR_PLUS: `${ASSET_BASE}/singleDollar.webp`,
  DOUBLE_DOLLAR_PLUS: `${ASSET_BASE}/doubleDollar.webp`,
  RESPIN: `${ASSET_BASE}/respin.webp`,
};

/** Paytable rows, highest first — each one maps to the live RTP line tier that pays it. */
const ROWS: { key: LineTierKey; name: string; icons: CrazySymbol[] }[] = [
  { key: "sevenHigh", name: "Triple Seven", icons: ["SEVEN_HIGH", "SEVEN_HIGH", "SEVEN_HIGH"] },
  { key: "sevenMid", name: "Double Seven", icons: ["SEVEN_MID", "SEVEN_MID", "SEVEN_MID"] },
  { key: "sevenLow", name: "Seven", icons: ["SEVEN_LOW", "SEVEN_LOW", "SEVEN_LOW"] },
  { key: "doubleBar", name: "Double Bar", icons: ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"] },
  { key: "singleBar", name: "Single Bar", icons: ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"] },
  { key: "anySeven", name: "Any 3 Sevens", icons: ["SEVEN_LOW", "SEVEN_MID", "SEVEN_HIGH"] },
  { key: "anyBar", name: "Any 3 Bars", icons: ["SINGLE_BAR", "DOUBLE_BAR", "SINGLE_BAR"] },
  { key: "anyGlobal", name: "Any 7s & Bars", icons: ["SEVEN_HIGH", "SINGLE_BAR", "SEVEN_LOW"] },
];

/** Reel 4's bonuses, biggest first — each one maps to the live special-reel tier behind it. */
const SPECIAL_ROWS: { key: SpecialTierKey; symbol: SpecialSymbol; name: string }[] = [
  { key: "multiplier10x", symbol: "MULT_10X", name: "10X Multiplier" },
  { key: "multiplier5x", symbol: "MULT_5X", name: "5X Multiplier" },
  { key: "multiplier2x", symbol: "MULT_2X", name: "2X Multiplier" },
  { key: "doubleDollarPlus", symbol: "DOUBLE_DOLLAR_PLUS", name: "Double Dollar Bonus" },
  { key: "dollarPlus", symbol: "DOLLAR_PLUS", name: "Dollar Bonus" },
  { key: "respin", symbol: "RESPIN", name: "Respin" },
];

export function InfoScreen({ bet, onClose }: { bet: number; onClose: () => void }) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [config] = useState(() => getCrazy777RtpConfig());
  const payout = (key: LineTierKey) => config.tiers.find((t) => t.key === key)?.payoutMultiplier ?? 0;
  const specialValue = (key: SpecialTierKey) => config.specialReelTiers.find((t) => t.key === key)?.payoutMultiplier ?? 0;
  const { min: respinMin, max: respinMax } = config.respinRange;
  const respinText = respinMin === respinMax ? `${respinMin}` : `${respinMin}-${respinMax}`;

  const specialEffect = (key: SpecialTierKey) => {
    switch (key) {
      case "multiplier2x":
      case "multiplier5x":
      case "multiplier10x":
        return (
          <>
            Base win <span className="text-white/40">×</span> <InfoMoney>{specialValue(key)}</InfoMoney>
          </>
        );
      case "dollarPlus":
      case "doubleDollarPlus":
        return (
          <>
            Base win <span className="text-white/40">+</span> <InfoMoney>{fmtMoney(specialValue(key) * bet)}</InfoMoney>
            <span className="text-white/50"> ({specialValue(key)}x bet)</span>
          </>
        );
      case "respin":
        return <>{respinText} free re-spins</>;
      default:
        return null;
    }
  };

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Land a winning combo on the <InfoAccent>payline</InfoAccent> of reels 1-2-3. Amounts are shown for your current bet of{" "}
            <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ROWS.map((r) => {
              const mult = payout(r.key);
              return (
                <InfoCard key={r.key} className="flex items-center gap-3 !px-3 !py-2">
                  <div className="flex flex-none items-center">
                    {r.icons.map((s, i) => (
                      <InfoSymbol key={i} src={SYMBOL_IMAGES[s]} alt={i === 0 ? r.name : ""} size={52} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <InfoGradient className="text-[18px]">{r.name}</InfoGradient>
                    <div className="flex items-baseline gap-2 text-[15px]">
                      <span className="text-white/60">{mult}x</span>
                      <span className="text-white/40">=</span>
                      <InfoMoney>{fmtMoney(mult * bet)}</InfoMoney>
                    </div>
                  </div>
                </InfoCard>
              );
            })}
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
            <div className="flex items-stretch gap-3">
              <div className="relative grid grid-cols-3 gap-2 rounded-2xl border-2 border-amber-300/50 bg-black/40 p-3">
                {Array.from({ length: 9 }, (_, k) => {
                  const onLine = Math.floor(k / 3) === 1;
                  const filler: CrazySymbol[] = ["SINGLE_BAR", "SEVEN_LOW", "DOUBLE_BAR", "SEVEN_MID"];
                  return (
                    <div key={k} className={`flex h-[76px] w-[76px] items-center justify-center rounded-xl ${onLine ? "bg-amber-400/25 ring-2 ring-amber-300" : "bg-white/[0.06]"}`}>
                      <img src={SYMBOL_IMAGES[onLine ? "SEVEN_HIGH" : filler[k % 4]]} alt="" className={`h-[60px] w-[60px] object-contain ${onLine ? "" : "opacity-35"}`} />
                    </div>
                  );
                })}
                <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-200 via-red-500 to-amber-200 shadow-[0_0_14px_rgba(251,191,36,.9)]" />
              </div>
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-fuchsia-300/60 bg-fuchsia-500/15 p-2">
                <img src={SPECIAL_IMAGES.MULT_10X} alt="" className="h-[70px] w-[70px] object-contain" />
                <div className="mt-1 text-[11px] font-bold tracking-widest text-fuchsia-200">REEL 4</div>
              </div>
            </div>
            <div className="mt-2 text-center text-[14px] font-bold tracking-widest text-amber-300">1 PAYLINE — MIDDLE ROW</div>
          </div>
          <InfoList
            items={[
              <>
                Crazy 777 has <InfoAccent>3 symbol reels</InfoAccent> with a <InfoAccent>single payline</InfoAccent> across the middle row, plus a 4th{" "}
                <InfoAccent>Special Reel</InfoAccent>.
              </>,
              <>
                <InfoAccent>3 identical symbols</InfoAccent> on the payline pay their own prize.
              </>,
              <>
                Mixed combos pay too: <InfoAccent>any 3 Sevens</InfoAccent>, <InfoAccent>any 3 Bars</InfoAccent>, or{" "}
                <InfoAccent>any mix of 7s and Bars</InfoAccent>.
              </>,
              <>A reel that stops between two symbols means no win on that spin.</>,
              <>Base win = symbol multiplier × your bet. One win is paid per spin.</>,
              <>The ladder beside the reels shows what each combination pays at your current bet.</>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Special Reel",
      title: "THE SPECIAL REEL",
      body: (
        <>
          <InfoLead>
            Whenever reels 1-2-3 <InfoAccent>win</InfoAccent>, whatever lands on <InfoAccent>reel 4</InfoAccent> boosts that win.
          </InfoLead>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SPECIAL_ROWS.map((r) => {
              return (
                <InfoCard key={r.key} className="flex items-center gap-3 !px-3 !py-2">
                  <InfoSymbol src={SPECIAL_IMAGES[r.symbol]} alt={r.name} size={64} />
                  <div className="min-w-0 flex-1">
                    <InfoGradient className="text-[17px]">{r.name}</InfoGradient>
                    <div className="text-[15px]">{specialEffect(r.key)}</div>
                  </div>
                </InfoCard>
              );
            })}
          </div>
          <p className="mt-4 text-center text-white/60">If reel 4 stops between two symbols, it shakes and drops onto a bonus — a winning spin always gets one.</p>
        </>
      ),
    },
    {
      tab: "Respins",
      title: "RESPIN BONUS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-3 rounded-2xl border-2 border-amber-300/60 bg-amber-400/15 px-2 sm:px-6 py-3 shadow-[0_0_24px_rgba(251,191,36,.35)]">
            <InfoSymbol src={SPECIAL_IMAGES.RESPIN} alt="Respin" size={96} />
            <InfoGradient className="text-[21px] sm:text-[30px]">= {respinText} FREE RE-SPINS</InfoGradient>
          </div>
          <InfoList
            items={[
              <>
                Win on reels 1-2-3 with <InfoAccent>RESPIN</InfoAccent> on reel 4 to get <InfoAccent>{respinText} free re-spins</InfoAccent>.
              </>,
              <>Tap the screen or SPIN to start the re-spins — they then play automatically at the same bet, cost nothing, and always pay at least 1x your bet in total. The round's total is added to your balance when you tap its result away; auto play stops when the round ends.</>,
              <>Reel 4 stays held on RESPIN, so re-spins pay the plain payline win with no extra bonus.</>,
              <>Every re-spin win is added straight to your balance.</>,
              <>The banner on screen shows how many re-spins are left.</>,
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
            ["Spin", "Spin the reels at the current bet."],
            ["− / +", "Lower or raise your bet."],
            ["Turbo", "Spins the reels faster. It doesn't change the odds or payouts."],
            ["Auto", "Keeps spinning until you press it again or your balance runs out."],
            ["i", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game."],
            ["Home", "Back to the lobby."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Crazy 777 rules" theme={THEME} steps={steps} onClose={onClose} />;
}
