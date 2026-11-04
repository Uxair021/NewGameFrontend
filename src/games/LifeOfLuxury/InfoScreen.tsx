import {
  GameInfoPopup,
  InfoAccent,
  InfoCard,
  InfoControls,
  InfoGradient,
  InfoLead,
  InfoList,
  InfoMoney,
  InfoPaylineDiagram,
  InfoSymbol,
  InfoTheme,
  fmtMoney,
  fmtMult,
} from "../shared/GameInfoPopup";
import { LifeOfLuxuryConfigResponse, LifeOfLuxurySymbol } from "./api";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #1b4372 0%, #0b2240 50%, #030b17 100%)",
  accent: "#f2c14e",
  titleGradient: "linear-gradient(180deg, #fff2b0 0%, #f2c14e 45%, #c8890f 100%)",
  buttonBackground: "linear-gradient(180deg, #fff2b0 0%, #f2c14e 45%, #c8890f 100%)",
  buttonEdge: "#8a5a00",
  buttonText: "#1a2a52",
};

const SYMBOL_IMAGES: Record<LifeOfLuxurySymbol, string> = {
  AEROPLANE: "/symbols/lifeOfLuxury/aeroplane.webp",
  BOAT: "/symbols/lifeOfLuxury/boat.webp",
  CAR: "/symbols/lifeOfLuxury/car.webp",
  RING: "/symbols/lifeOfLuxury/ring.webp",
  MONEY: "/symbols/lifeOfLuxury/money.webp",
  WATCH: "/symbols/lifeOfLuxury/watch.webp",
  GOLD_BAR: "/symbols/lifeOfLuxury/goldBar.webp",
  SILVER_BAR: "/symbols/lifeOfLuxury/silverBar.webp",
  BRONZE_BAR: "/symbols/lifeOfLuxury/bronzeBar.webp",
  COIN: "/symbols/lifeOfLuxury/coin.webp",
  WILD: "/symbols/lifeOfLuxury/daimond.webp",
};

const SYMBOL_NAMES: Record<LifeOfLuxurySymbol, string> = {
  AEROPLANE: "Aeroplane",
  BOAT: "Boat",
  CAR: "Car",
  RING: "Ring",
  MONEY: "Money",
  WATCH: "Watch",
  GOLD_BAR: "Gold Bar",
  SILVER_BAR: "Silver Bar",
  BRONZE_BAR: "Bronze Bar",
  COIN: "Coin",
  WILD: "Diamond Wild",
};

/** "3 / 4 / 5 of a kind" prices for one symbol at the current bet. */
function PayCard({ symbol, pays, bet }: { symbol: LifeOfLuxurySymbol; pays: [number, number, number]; bet: number }) {
  return (
    <InfoCard className="flex items-center gap-3">
      <span className="overflow-hidden rounded-lg">
        <InfoSymbol src={SYMBOL_IMAGES[symbol]} alt={SYMBOL_NAMES[symbol]} size={64} />
      </span>
      <div className="min-w-0 flex-1">
        <InfoGradient className="text-[18px]">{SYMBOL_NAMES[symbol]}</InfoGradient>
        <div className="grid grid-cols-3 gap-2 text-[14px]">
          {pays.map((mult, i) => (
            <div key={i} className="leading-tight">
              <div className="text-white/55">{i + 3} ×</div>
              <InfoMoney>{fmtMoney(mult * bet)}</InfoMoney>
            </div>
          ))}
        </div>
      </div>
    </InfoCard>
  );
}

export function InfoScreen({ config, bet, onClose }: { config: LifeOfLuxuryConfigResponse; bet: number; onClose: () => void }) {
  const { scatter } = config;

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Land <InfoAccent>3, 4 or 5 matching symbols</InfoAccent> in a row from the leftmost reel on any of the {config.lineCount} paylines.
            Wins on different lines add up. Amounts are for your current bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {config.symbolPayouts.map((row) => (
              <PayCard key={row.symbol} symbol={row.symbol} pays={[row.x3, row.x4, row.x5]} bet={bet} />
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "Specials",
      title: "WILD & FREE SPINS",
      body: (
        <div className="flex flex-col gap-5">
          <InfoCard className="flex flex-col items-center gap-5 md:flex-row">
            <span className="overflow-hidden rounded-xl">
              <InfoSymbol src={SYMBOL_IMAGES.WILD} alt="Wild" size={110} />
            </span>
            <div className="flex-1">
              <InfoGradient className="text-[19px] sm:text-[26px]">DIAMOND WILD</InfoGradient>
              <InfoList
                items={[
                  <>Substitutes for <InfoAccent>every symbol except the Coin</InfoAccent> to complete a line.</>,
                  <>Only lands on <InfoAccent>reels 2, 3 and 4</InfoAccent>.</>,
                  <>During Free Spins, every Wild that lands raises the round's end bonus (see below).</>,
                ]}
              />
            </div>
          </InfoCard>
          <InfoCard className="flex flex-col items-center gap-5 md:flex-row">
            <span className="overflow-hidden rounded-xl">
              <InfoSymbol src={SYMBOL_IMAGES.COIN} alt="Coin" size={110} />
            </span>
            <div className="flex-1">
              <InfoGradient className="text-[19px] sm:text-[26px]">COIN SCATTER</InfoGradient>
              <p className="mb-3">
                Pays <InfoAccent>anywhere on the reels</InfoAccent> — no payline needed. {scatter.triggerCount} or more Coins also award{" "}
                <InfoAccent>{scatter.freeSpinsAwarded} Free Spins</InfoAccent>.
              </p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  ["3 Coins", scatter.x3],
                  ["4 Coins", scatter.x4],
                  ["5+ Coins", scatter.x5],
                ] as const).map(([label, mult]) => (
                  <div key={label} className="rounded-xl border border-amber-300/30 bg-black/30 px-2 py-2 text-center">
                    <div className="text-[14px] font-bold text-amber-200">{label}</div>
                    <div className="text-[19px] font-black text-lime-300 tabular-nums">{fmtMoney(mult * bet)}</div>
                    <div className="text-[12px] text-white/50">{fmtMult(mult)} bet</div>
                  </div>
                ))}
              </div>
            </div>
          </InfoCard>
          <InfoCard>
            <InfoGradient className="text-[19px] sm:text-[26px]">FREE SPINS</InfoGradient>
            <InfoList
              items={[
                <>Free Spins play automatically at the bet that triggered them.</>,
                <>Coins still pay during Free Spins, but can't award more Free Spins.</>,
                <>
                  <InfoAccent>Wild bonus:</InfoAccent> when the round ends, its total win is multiplied by{" "}
                  <InfoAccent>1 + the number of Wilds</InfoAccent> that landed during the round.
                </>,
              ]}
            />
          </InfoCard>
        </div>
      ),
    },
    {
      tab: "Paylines",
      title: `${config.lineCount} PAYLINES`,
      body: (
        <>
          <InfoLead>All {config.lineCount} lines are always active. A line pays its best run of matching symbols starting from reel 1.</InfoLead>
          <div className="mx-auto grid max-w-[900px] grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
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
            ["Spin", "Spin the reels at the current bet. Hold it to start Auto."],
            ["− / +", "Lower or raise your bet."],
            ["Turbo", "Spins the reels faster. It doesn't change the odds or payouts."],
            ["Auto", "Keeps spinning until you press it again or your balance runs out."],
            ["Lines", "Shows or hides all the paylines on the reels."],
            ["i", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game."],
            ["Home", "Back to the lobby."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Life of Luxury rules" theme={THEME} steps={steps} onClose={onClose} />;
}
