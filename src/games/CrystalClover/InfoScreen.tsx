import {
  GameInfoPopup,
  InfoAccent,
  InfoCard,
  InfoControls,
  InfoGradient,
  InfoLead,
  InfoMoney,
  InfoPaylineDiagram,
  InfoSymbol,
  InfoTheme,
  fmtMoney,
  fmtMult,
} from "../shared/GameInfoPopup";
import { CrystalCloverConfigResponse, CrystalCloverSymbol } from "./api";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #0f5f45 0%, #06301f 50%, #020f0a 100%)",
  accent: "#fbbf24",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #fcd34d 45%, #d97706 100%)",
  buttonBackground: "linear-gradient(180deg, #bef264 0%, #10b981 55%, #15803d 100%)",
  buttonEdge: "#14532d",
};

const SYMBOL_IMAGES: Record<CrystalCloverSymbol, string> = {
  SEVEN_CLOVER: "/symbols/crystalClover/7clover.webp",
  TRIPLE_BAR: "/symbols/crystalClover/trippleBar.webp",
  DOUBLE_BAR: "/symbols/crystalClover/doubleBar.webp",
  BAR: "/symbols/crystalClover/bar.webp",
  WILD: "/symbols/crystalClover/wild.webp",
  MULTIPLIER_2X: "/symbols/crystalClover/2X.webp",
};

const SYMBOL_NAMES: Partial<Record<CrystalCloverSymbol, string>> = {
  SEVEN_CLOVER: "7 Crystal Clover",
  TRIPLE_BAR: "Triple Bar",
  DOUBLE_BAR: "Double Bar",
  BAR: "Bar",
};

function PayCard({ icons, name, mult, bet }: { icons: CrystalCloverSymbol[]; name: string; mult: number; bet: number }) {
  return (
    <InfoCard className="flex items-center gap-3">
      <div className="flex flex-none items-center">
        {icons.map((s, i) => (
          <InfoSymbol key={i} src={SYMBOL_IMAGES[s]} alt={i === 0 ? name : ""} size={56} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <InfoGradient className="text-[18px]">{name}</InfoGradient>
        <div className="flex items-baseline gap-2 text-[15px]">
          <span className="text-white/60">{fmtMult(mult)}</span>
          <span className="text-white/40">=</span>
          <InfoMoney>{fmtMoney(mult * bet)}</InfoMoney>
        </div>
      </div>
    </InfoCard>
  );
}

export function InfoScreen({ config, bet, onClose }: { config: CrystalCloverConfigResponse; bet: number; onClose: () => void }) {
  const wildPays = config.wild.purePayout;

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Land <InfoAccent>3 matching symbols</InfoAccent> on any of the {config.paylineCount} paylines. Each line pays the amount shown, and
            wins on different lines add up. Amounts are for your current bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {config.paytable.map((row) => (
              <PayCard
                key={row.symbol}
                icons={[row.symbol, row.symbol, row.symbol]}
                name={SYMBOL_NAMES[row.symbol] ?? row.symbol}
                mult={row.payout}
                bet={bet}
              />
            ))}
            <PayCard icons={["BAR", "DOUBLE_BAR", "TRIPLE_BAR"]} name="Any 3 Bars (mixed)" mult={config.anyBarPayout} bet={bet} />
          </div>
        </>
      ),
    },
    {
      tab: "Specials",
      title: "WILD & 2X MULTIPLIER",
      body: (
        <div className="flex flex-col gap-5">
          <InfoCard className="flex flex-col items-center gap-5 md:flex-row">
            <InfoSymbol src={SYMBOL_IMAGES.WILD} alt="Wild" size={110} />
            <div className="flex-1">
              <InfoGradient className="text-[19px] sm:text-[26px]">WILD</InfoGradient>
              <p className="mb-3">
                Wilds pay on their own. Any payline with <InfoAccent>1, 2 or 3 Wilds</InfoAccent> on it pays a Wild prize:
              </p>
              <div className="grid grid-cols-3 gap-3">
                {([1, 2, 3] as const).map((n) => (
                  <div key={n} className="rounded-xl border border-amber-300/30 bg-black/30 px-2 py-2 text-center">
                    <div className="text-[14px] font-bold text-amber-200">
                      {n} Wild{n > 1 ? "s" : ""}
                    </div>
                    <div className="text-[19px] font-black text-lime-300 tabular-nums">{fmtMoney(wildPays[n] * bet)}</div>
                    <div className="text-[12px] text-white/50">{fmtMult(wildPays[n])} bet</div>
                  </div>
                ))}
              </div>
            </div>
          </InfoCard>
          <InfoCard className="flex flex-col items-center gap-5 md:flex-row">
            <InfoSymbol src={SYMBOL_IMAGES.MULTIPLIER_2X} alt="2X" size={110} />
            <div className="flex-1">
              <InfoGradient className="text-[19px] sm:text-[26px]">2X MULTIPLIER</InfoGradient>
              <p className="mb-3">
                Doesn't need a payline. Every 2X <InfoAccent>anywhere on the reels</InfoAccent> doubles the whole spin's win, and copies stack:
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["1 × 2X", "×2"],
                  ["2 × 2X", "×4"],
                  ["3 × 2X", "×8"],
                ].map(([label, mult]) => (
                  <div key={label} className="rounded-xl border border-amber-300/30 bg-black/30 px-2 py-2 text-center">
                    <div className="text-[14px] font-bold text-amber-200">{label}</div>
                    <div className="text-[17px] sm:text-[22px] font-black text-lime-300">{mult}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[14px] text-white/55">A 2X on its own, with no line win, pays nothing.</p>
            </div>
          </InfoCard>
        </div>
      ),
    },
    {
      tab: "Paylines",
      title: `${config.paylineCount} PAYLINES`,
      body: (
        <>
          <InfoLead>
            All {config.paylineCount} lines are always active. A line wins when the 3 symbols along it form a winning combination.
          </InfoLead>
          <div className="mx-auto grid max-w-[760px] grid-cols-3 gap-3 sm:grid-cols-5">
            {config.paylines.map((line, i) => (
              <InfoPaylineDiagram key={i} number={i + 1} line={line} />
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "Controls",
      title: "HOW TO PLAY",
      body: (
        <InfoControls
          rows={[
            ["Spin", "Spin the reels at the current bet."],
            ["◀ / ▶", "Lower or raise your bet."],
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

  return <GameInfoPopup label="7 Crystal Clover rules" theme={THEME} steps={steps} onClose={onClose} />;
}
