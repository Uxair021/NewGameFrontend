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
import { FruitSymbol, PayingSymbol, RubberDuckConfigResponse } from "./api";

const ASSET_BASE = "/symbols/rubberDuck";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #0e5a8a 0%, #082f49 50%, #020b14 100%)",
  accent: "#38bdf8",
  titleGradient: "linear-gradient(180deg, #fef9c3 0%, #facc15 45%, #f59e0b 100%)",
  buttonBackground: "linear-gradient(180deg, #7dd3fc 0%, #3b82f6 55%, #1d4ed8 100%)",
  buttonEdge: "#172554",
};

const SYMBOL_IMAGES: Record<PayingSymbol, string> = {
  TRIPLE_7: `${ASSET_BASE}/tripple7.webp`,
  DOUBLE_7: `${ASSET_BASE}/double7.webp`,
  SEVEN: `${ASSET_BASE}/7.webp`,
  BOAT: `${ASSET_BASE}/boat.webp`,
  GUN: `${ASSET_BASE}/gun.webp`,
  TOOL: `${ASSET_BASE}/tool.webp`,
  SHAMPOO: `${ASSET_BASE}/shampoo.webp`,
  TOWEL: `${ASSET_BASE}/towel.webp`,
  BRUSH: `${ASSET_BASE}/brush.webp`,
  SAFEGUARD: `${ASSET_BASE}/saveGaurd.webp`,
  CAP: `${ASSET_BASE}/cap.webp`,
  POT: `${ASSET_BASE}/pot.webp`,
  SOAP: `${ASSET_BASE}/soap.webp`,
  SPONGE: `${ASSET_BASE}/sponch.webp`,
};

const SYMBOL_NAMES: Record<PayingSymbol, string> = {
  TRIPLE_7: "Triple 7",
  DOUBLE_7: "Double 7",
  SEVEN: "Seven",
  BOAT: "Boat",
  GUN: "Water Gun",
  TOOL: "Bath Stool",
  SHAMPOO: "Shampoo",
  TOWEL: "Towel",
  BRUSH: "Brush",
  SAFEGUARD: "Life Ring",
  CAP: "Shower Cap",
  POT: "Bath Scoop",
  SOAP: "Soap",
  SPONGE: "Sponge",
};

const FRUIT_IMAGES: Record<FruitSymbol, string> = {
  AVOCADO: `${ASSET_BASE}/avacado.webp`,
  BANANA: `${ASSET_BASE}/banana.webp`,
  COCONUT: `${ASSET_BASE}/coconut.webp`,
  GRAPES: `${ASSET_BASE}/grapes.webp`,
  LEMON: `${ASSET_BASE}/lemon.webp`,
  STRAWBERRY: `${ASSET_BASE}/strawberry.webp`,
};

const BONUS_IMAGE = `${ASSET_BASE}/bonus.webp`;

export function InfoScreen({ config, bet, onClose }: { config: RubberDuckConfigResponse; bet: number; onClose: () => void }) {
  const fs = config.freeSpins;
  const paytable = [...config.paytable].sort((a, b) => b.payout - a.payout);

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Every symbol below <InfoAccent>pays for itself</InfoAccent> the moment it lands — no matching needed. Amounts are for your current
            bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>; during free spins they pay <InfoAccent>{fs.winMultiplier}×</InfoAccent> as much.
          </InfoLead>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {paytable.map((row) => (
              <InfoCard key={row.symbol} className="flex items-center gap-3 !px-3 !py-2">
                <InfoSymbol src={SYMBOL_IMAGES[row.symbol]} alt={SYMBOL_NAMES[row.symbol]} size={56} />
                <div className="min-w-0">
                  <InfoGradient className="block truncate text-[16px]">{SYMBOL_NAMES[row.symbol]}</InfoGradient>
                  <InfoMoney>{fmtMoney(row.payout * bet)}</InfoMoney>
                  <span className="ml-1 text-[12px] text-white/50">({row.payout}x)</span>
                </div>
              </InfoCard>
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "How it pays",
      title: "HOW IT PAYS",
      body: (
        <div className="flex flex-col items-center gap-5">
          <div className="flex items-center gap-2 rounded-2xl border-2 border-sky-300/50 bg-black/40 p-3">
            {(["SOAP", "LEMON", "BOAT", "SPONGE", "BANANA"] as const).map((s, i) => {
              const paying = s in SYMBOL_IMAGES;
              const src = paying ? SYMBOL_IMAGES[s as PayingSymbol] : FRUIT_IMAGES[s as FruitSymbol];
              return (
                <div
                  key={i}
                  className={`flex h-[78px] w-[78px] items-center justify-center rounded-xl ${paying ? "bg-sky-400/25 ring-2 ring-sky-300" : "bg-white/[0.06]"}`}
                >
                  <img src={src} alt="" className={`h-[62px] w-[62px] object-contain ${paying ? "" : "opacity-40"}`} />
                </div>
              );
            })}
          </div>
          <InfoList
            items={[
              <>
                There's a single row of <InfoAccent>5 reels</InfoAccent>. Every paying symbol that lands pays its own prize, wherever it lands.
              </>,
              <>
                If several paying symbols land in the same spin — the same one or different ones — their prizes simply{" "}
                <InfoAccent>add together</InfoAccent>.
              </>,
              <>In the example above, the Soap, Boat and Sponge all pay; the fruit pay nothing.</>,
            ]}
          />
          <InfoCard className="w-full max-w-[820px]">
            <div className="mb-2 text-center font-bold text-white/70">These fruit never pay:</div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {(Object.keys(FRUIT_IMAGES) as FruitSymbol[]).map((f) => (
                <InfoSymbol key={f} src={FRUIT_IMAGES[f]} alt={f.toLowerCase()} size={48} />
              ))}
            </div>
          </InfoCard>
        </div>
      ),
    },
    {
      tab: "Free Spins",
      title: "BONUS FREE SPINS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2 rounded-2xl border-2 border-sky-300/60 bg-sky-400/15 px-2 sm:px-6 py-3 shadow-[0_0_24px_rgba(56,189,248,.35)]">
            {[0, 1, 2].map((i) => (
              <InfoSymbol key={i} src={BONUS_IMAGE} alt={i === 0 ? "Bonus" : ""} size={80} />
            ))}
            <InfoGradient className="ml-3 text-[21px] sm:text-[30px]">= {fs.base} FREE SPINS</InfoGradient>
          </div>
          <InfoList
            items={[
              <>
                Land <InfoAccent>{fs.triggerCount} or more BONUS</InfoAccent> symbols anywhere on the reels to win <InfoAccent>{fs.base} free spins</InfoAccent>.
              </>,
              <>
                Every win during free spins pays <InfoMoney>{fs.winMultiplier}×</InfoMoney>.
              </>,
              <>
                Land {fs.triggerCount}+ BONUS again during free spins to add <InfoAccent>{fs.retrigger} more spins</InfoAccent> on top of what's left.
              </>,
              <>Tap the screen or SPIN to start — free spins then play automatically at the bet that triggered them, cost nothing, and always pay at least 1x that bet in total. The total is added to your balance when you tap it away; auto play stops when the round ends.</>,
              <>Bet changes and AUTO are locked until the round ends; a summary of your free spins win is shown at the end.</>,
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
            ["◀ / ▶", "Lower or raise your bet."],
            ["Auto", "Keeps spinning until you press it again or your balance runs out."],
            ["i", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game."],
            ["Home", "Back to the lobby."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Rubber Duck rules" theme={THEME} steps={steps} onClose={onClose} />;
}
