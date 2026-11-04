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
import { BONUS_FREE_SPINS, Buffalo777TierKey, BuffaloSymbol, getBuffaloRtpConfig } from "./api";

const ASSET_BASE = "/symbols/buffalo777";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #8a5420 0%, #4a2a0c 50%, #1a0d04 100%)",
  accent: "#fbbf24",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #bef264 0%, #22c55e 55%, #15803d 100%)",
  buttonEdge: "#14532d",
};

const SYMBOL_IMAGES: Record<BuffaloSymbol, string> = {
  TEN: `${ASSET_BASE}/10.webp`,
  JACK: `${ASSET_BASE}/J.webp`,
  QUEEN: `${ASSET_BASE}/Q.webp`,
  KING: `${ASSET_BASE}/K.webp`,
  ACE: `${ASSET_BASE}/A.webp`,
  BULL: `${ASSET_BASE}/bull.webp`,
  SINGLE_BAR: `${ASSET_BASE}/SingleBar.webp`,
  DOUBLE_BAR: `${ASSET_BASE}/DoubleBar.webp`,
  TRIPLE_BAR: `${ASSET_BASE}/TripleBar.webp`,
  MONEY_BAG: `${ASSET_BASE}/MoneyBag.webp`,
  COIN: `${ASSET_BASE}/Coin.webp`,
};

/** Paytable rows, highest first — each one maps to the live RTP tier that pays it. */
const ROWS: { key: Buffalo777TierKey; name: string; icons: BuffaloSymbol[] }[] = [
  { key: "coin", name: "Gold Coin", icons: ["COIN", "COIN", "COIN"] },
  { key: "moneyBag", name: "Money Bag", icons: ["MONEY_BAG", "MONEY_BAG", "MONEY_BAG"] },
  { key: "tripleBar", name: "Triple Bar", icons: ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"] },
  { key: "doubleBar", name: "Double Bar", icons: ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"] },
  { key: "singleBar", name: "Single Bar", icons: ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"] },
  { key: "anyBar", name: "Any 3 Bars", icons: ["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR"] },
  { key: "bull", name: "Buffalo", icons: ["BULL", "BULL", "BULL"] },
  { key: "ace", name: "Ace", icons: ["ACE", "ACE", "ACE"] },
  { key: "king", name: "King", icons: ["KING", "KING", "KING"] },
  { key: "queen", name: "Queen", icons: ["QUEEN", "QUEEN", "QUEEN"] },
  { key: "jack", name: "Jack", icons: ["JACK", "JACK", "JACK"] },
  { key: "ten", name: "Ten", icons: ["TEN", "TEN", "TEN"] },
];

/** Must match Buffalo777Game.tsx's BONUS_MIN_WIN_BET_MULTIPLE. */
const BONUS_MIN_WIN_BET_MULTIPLE = 2;

export function InfoScreen({ bet, onClose }: { bet: number; onClose: () => void }) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [tiers] = useState(() => getBuffaloRtpConfig().tiers);
  const tierOf = (key: Buffalo777TierKey) => tiers.find((t) => t.key === key);
  const payout = (key: Buffalo777TierKey) => tierOf(key)?.payoutMultiplier ?? 0;

  const row = (r: (typeof ROWS)[number]) => {
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
  };

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Land <InfoAccent>3 matching symbols</InfoAccent> on the payline to win. Amounts are shown for your current bet of{" "}
            <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{ROWS.map(row)}</div>
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
                const filler: BuffaloSymbol[] = ["ACE", "KING", "QUEEN", "JACK", "TEN", "MONEY_BAG"];
                return (
                  <div key={k} className={`flex h-[84px] w-[84px] items-center justify-center rounded-xl ${onLine ? "bg-amber-400/25 ring-2 ring-amber-300" : "bg-white/[0.06]"}`}>
                    <img src={SYMBOL_IMAGES[onLine ? "BULL" : filler[k % 6]]} alt="" className={`h-[66px] w-[66px] object-contain ${onLine ? "" : "opacity-35"}`} />
                  </div>
                );
              })}
              <div className="pointer-events-none absolute left-1 right-1 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-200 via-red-500 to-amber-200 shadow-[0_0_14px_rgba(251,191,36,.9)]" />
            </div>
            <div className="mt-2 text-center text-[14px] font-bold tracking-widest text-amber-300">1 PAYLINE — MIDDLE ROW</div>
          </div>
          <InfoList
            items={[
              <>
                Buffalo 777 is a 3-reel game with a <InfoAccent>single payline</InfoAccent> straight across the middle row.
              </>,
              <>
                A win needs <InfoAccent>3 identical symbols</InfoAccent> on the payline. Symbols above and below the line don't pay.
              </>,
              <>
                Exception: <InfoAccent>any mix of Single, Double and Triple Bars</InfoAccent> on the line still pays the "Any 3 Bars" prize.
              </>,
              <>Win = symbol multiplier × your bet. One win is paid per spin.</>,
              <>The signs beside the reels show what each combination pays at your current bet.</>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Bonus",
      title: "GOLD COIN BONUS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2 rounded-2xl border-2 border-amber-300/60 bg-amber-400/15 px-2 sm:px-6 py-3 shadow-[0_0_24px_rgba(251,191,36,.35)]">
            {[0, 1, 2].map((i) => (
              <InfoSymbol key={i} src={SYMBOL_IMAGES.COIN} alt={i === 0 ? "Gold Coin" : ""} size={84} />
            ))}
            <InfoGradient className="ml-3 text-[21px] sm:text-[30px]">= {BONUS_FREE_SPINS} FREE SPINS</InfoGradient>
          </div>
          <InfoList
            items={[
              <>
                Land <InfoAccent>3 Gold Coins</InfoAccent> on the payline to win <InfoMoney>{payout("coin")}x</InfoMoney> your bet (
                <InfoMoney>{fmtMoney(payout("coin") * bet)}</InfoMoney>) <InfoAccent>and</InfoAccent> start the bonus.
              </>,
              <>The buffalo herd stampedes across the screen, then tap the board or SPIN to start — {BONUS_FREE_SPINS} free spins play automatically at the same bet and cost nothing. The bonus total is added to your balance when you tap its board away; auto play stops when the bonus ends.</>,
              <>Every free spin win is added straight to your balance.</>,
              <>
                The {BONUS_FREE_SPINS} free spins always pay at least <InfoAccent>{BONUS_MIN_WIN_BET_MULTIPLE}× your bet</InfoAccent> in total.
              </>,
              <>Gold Coins can't retrigger the bonus during free spins.</>,
              <>When the bonus ends, your total is shown on the winning board — tap it to carry on playing.</>,
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
            ["⚙ Info", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game (top-right corner)."],
            ["Home", "Back to the lobby (top-left corner)."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Buffalo 777 rules" theme={THEME} steps={steps} onClose={onClose} />;
}
