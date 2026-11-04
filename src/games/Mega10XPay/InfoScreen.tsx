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
import { Mega10xSymbol, TierKey, getMega10xRtpConfig } from "./api";

const ASSET_BASE = "/symbols/mega10x";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #5b1446 0%, #260a1f 50%, #0b0409 100%)",
  accent: "#fbbf24",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #bef264 0%, #22c55e 55%, #15803d 100%)",
  buttonEdge: "#052e16",
};

const SYMBOL_IMAGES: Record<Mega10xSymbol, string> = {
  TEN_X: `${ASSET_BASE}/10x.webp`,
  THREE_X: `${ASSET_BASE}/3x.webp`,
  SEVEN: `${ASSET_BASE}/7.webp`,
  SEVEN_BAR: `${ASSET_BASE}/7Bar.webp`,
  TRIPLE_BAR: `${ASSET_BASE}/TripleBar.webp`,
  DOUBLE_BAR: `${ASSET_BASE}/doubleBar.webp`,
  SINGLE_BAR: `${ASSET_BASE}/singleBar.webp`,
  CHERRY: `${ASSET_BASE}/cherry.webp`,
};

/** Every paying combination, each tied to the live RTP tier that pays it. */
const ROWS: { key: TierKey; name: string; icons: Mega10xSymbol[] }[] = [
  { key: "tenX", name: "3 × 10X Pay", icons: ["TEN_X", "TEN_X", "TEN_X"] },
  { key: "threeX", name: "3 × 3X Pay", icons: ["THREE_X", "THREE_X", "THREE_X"] },
  { key: "cherry", name: "3 Cherries", icons: ["CHERRY", "CHERRY", "CHERRY"] },
  { key: "seven", name: "3 Sevens", icons: ["SEVEN", "SEVEN", "SEVEN"] },
  { key: "sevenBar", name: "3 Seven Bars", icons: ["SEVEN_BAR", "SEVEN_BAR", "SEVEN_BAR"] },
  { key: "oneCherry", name: "1 Cherry on the line", icons: ["CHERRY"] },
  { key: "tripleBar", name: "3 Triple Bars", icons: ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"] },
  { key: "any3SevenSevenBar", name: "Any 3 Sevens / Seven Bars", icons: ["SEVEN", "SEVEN_BAR", "SEVEN"] },
  { key: "doubleBar", name: "3 Double Bars", icons: ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"] },
  { key: "any3BarFamilyMix", name: "Any 3 Bars (mixed)", icons: ["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR"] },
  { key: "singleBar", name: "3 Single Bars", icons: ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"] },
  { key: "any3SingleBarSevenBar", name: "Any 3 Single Bars / Seven Bars", icons: ["SINGLE_BAR", "SEVEN_BAR", "SINGLE_BAR"] },
  { key: "twoCherry", name: "2 Cherries on the line", icons: ["CHERRY", "CHERRY"] },
  { key: "anyWild", name: "10X Pay / 3X Pay on the line", icons: ["TEN_X", "THREE_X"] },
];

export function InfoScreen({ bet, onClose }: { bet: number; onClose: () => void }) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [config] = useState(() => getMega10xRtpConfig());
  const payout = (key: TierKey) => config.tiers.find((t) => t.key === key)?.payoutMultiplier ?? 0;
  // A lone 10X / 3X pays its multiplier, so it's ranked (and shown) at its 10X value.
  const rank = (key: TierKey) => payout(key) * (key === "anyWild" ? 10 : 1);
  const rows = ROWS.filter((r) => payout(r.key) > 0).sort((a, b) => rank(b.key) - rank(a.key));

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Every combination below pays when it lands on the payline. Amounts are shown for your current bet of{" "}
            <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rows.map((r) => {
              const mult = payout(r.key);
              return (
                <InfoCard key={r.key} className="flex items-center gap-3 !px-3 !py-2">
                  <div className="flex w-[100px] sm:w-[156px] flex-none items-center">
                    {r.icons.map((s, i) => (
                      <InfoSymbol key={i} src={SYMBOL_IMAGES[s]} alt={i === 0 ? r.name : ""} size={50} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <InfoGradient className="text-[16px]">{r.name}</InfoGradient>
                    </div>
                    {r.key === "anyWild" ? (
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[15px]">
                        <span>
                          <span className="text-white/60">10X: {mult * 10}x = </span>
                          <InfoMoney>{fmtMoney(mult * 10 * bet)}</InfoMoney>
                        </span>
                        <span>
                          <span className="text-white/60">3X: {mult * 3}x = </span>
                          <InfoMoney>{fmtMoney(mult * 3 * bet)}</InfoMoney>
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2 text-[15px]">
                        <span className="text-white/60">{mult}x</span>
                        <span className="text-white/40">=</span>
                        <InfoMoney>{fmtMoney(mult * bet)}</InfoMoney>
                      </div>
                    )}
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
            <div className="relative grid grid-cols-3 gap-2 rounded-2xl border-2 border-amber-300/50 bg-black/40 p-3">
              {Array.from({ length: 9 }, (_, k) => {
                const onLine = Math.floor(k / 3) === 1;
                const filler: Mega10xSymbol[] = ["SINGLE_BAR", "SEVEN", "DOUBLE_BAR", "CHERRY", "SEVEN_BAR", "TRIPLE_BAR"];
                return (
                  <div key={k} className={`flex h-[84px] w-[84px] items-center justify-center rounded-xl ${onLine ? "bg-amber-400/25 ring-2 ring-amber-300" : "bg-white/[0.06]"}`}>
                    <img src={SYMBOL_IMAGES[onLine ? "TEN_X" : filler[k % 6]]} alt="" className={`h-[66px] w-[66px] object-contain ${onLine ? "" : "opacity-35"}`} />
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
                Mega 10X Pay is a 3-reel game with a <InfoAccent>single payline</InfoAccent> across the middle row.
              </>,
              <>
                Most wins need <InfoAccent>3 symbols</InfoAccent> on the payline: 3 of a kind, or one of the mixed Bar / Seven combinations.
              </>,
              <>
                <InfoAccent>Cherries</InfoAccent> pay even without a full match: 1 or 2 Cherries anywhere on the payline still win.
              </>,
              <>
                <InfoAccent>10X Pay</InfoAccent> and <InfoAccent>3X Pay</InfoAccent> are <InfoAccent>wild</InfoAccent>: on the payline they stand in for any
                symbol except Cherry to complete a win, and multiply it <InfoAccent>×10</InfoAccent> or <InfoAccent>×3</InfoAccent>. Two of them multiply
                together (×9, ×30 or ×100) — e.g. 1 Cherry + 3X Pay pays {payout("oneCherry")} × 3 = {payout("oneCherry") * 3}x your bet.
              </>,
              <>
                Line up 3 of the same for the top prizes: <InfoMoney>{payout("tenX")}x</InfoMoney> (10X Pay) or{" "}
                <InfoMoney>{payout("threeX")}x</InfoMoney> (3X Pay) your bet.
              </>,
              <>Win = combination multiplier × any wild multiplier × your bet. One win is paid per spin.</>,
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
            ["Bet − / +", "Lower or raise your bet."],
            ["Auto", "Keeps spinning until you press it again or your balance runs out."],
            ["i / Mega 10X Pay", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game."],
            ["Home", "Back to the lobby."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Mega 10X Pay rules" theme={THEME} steps={steps} onClose={onClose} />;
}
