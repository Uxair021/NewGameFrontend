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
import { SlotSymbol, WinRuleId, getFreeSpinMinWin, getRulePayout, getShamrockRtpConfig } from "./api";

const ASSET_BASE = "/symbols/shamrockSpin";

/** Same green + gold as the cabinet's control bar (tailwind `cabinet.*`). */
const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #136b3f 0%, #0b3d24 50%, #04170d 100%)",
  accent: "#e8c15a",
  titleGradient: "linear-gradient(180deg, #fff7c2 0%, #e8c15a 50%, #b7791f 100%)",
  buttonBackground: "linear-gradient(180deg, #fde68a 0%, #e8c15a 55%, #b7791f 100%)",
  buttonEdge: "#78350f",
  buttonText: "#1c1917",
};

const SYMBOL_FILES: Record<SlotSymbol, string> = {
  SHAMROCK_WILD: "Shamrock Spin.webp",
  SHAMROCK_1: "Shamrock Spin 1.webp",
  SHAMROCK_2: "Shamrock Spin 2.webp",
  SHAMROCK_3: "Shamrock Spin 3.webp",
  SHAMROCK_4: "Shamrock Spin 4.webp",
  GREEN_SEVEN: "Green 7.webp",
  ORANGE_SEVEN: "Orange 7.webp",
  YELLOW_SEVEN: "Yellow 7.webp",
  TRIPLE_BAR: "BAR BAR BAR.webp",
  DOUBLE_BAR: "BAR BAR.webp",
  SINGLE_BAR: "BAR.webp",
};
const img = (s: SlotSymbol) => `${ASSET_BASE}/${encodeURIComponent(SYMBOL_FILES[s])}`;

const RULES: { id: WinRuleId; name: string; icons: SlotSymbol[] }[] = [
  { id: "WILD_JACKPOT", name: "3 Shamrock Spin", icons: ["SHAMROCK_WILD", "SHAMROCK_WILD", "SHAMROCK_WILD"] },
  { id: "GREEN_SEVEN", name: "3 Green 7s", icons: ["GREEN_SEVEN", "GREEN_SEVEN", "GREEN_SEVEN"] },
  { id: "ORANGE_SEVEN", name: "3 Orange 7s", icons: ["ORANGE_SEVEN", "ORANGE_SEVEN", "ORANGE_SEVEN"] },
  { id: "YELLOW_SEVEN", name: "3 Yellow 7s", icons: ["YELLOW_SEVEN", "YELLOW_SEVEN", "YELLOW_SEVEN"] },
  { id: "TRIPLE_BAR", name: "3 Triple Bars", icons: ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"] },
  { id: "DOUBLE_BAR", name: "3 Double Bars", icons: ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"] },
  { id: "SINGLE_BAR", name: "3 Single Bars", icons: ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"] },
  { id: "ANY_SEVENS", name: "Any 3 Sevens", icons: ["GREEN_SEVEN", "ORANGE_SEVEN", "YELLOW_SEVEN"] },
  { id: "ANY_BARS", name: "Any 3 Bars", icons: ["SINGLE_BAR", "DOUBLE_BAR", "TRIPLE_BAR"] },
  { id: "TWO_WILDS", name: "2 Wilds + any", icons: ["SHAMROCK_WILD", "SHAMROCK_WILD"] },
  { id: "ONE_WILD", name: "1 Wild + any + any", icons: ["SHAMROCK_WILD"] },
];

export function InfoScreen({ bet, maxTotalFreeSpins, onClose }: { bet: number; maxTotalFreeSpins: number; onClose: () => void }) {
  // Read fresh on open so the popup always reflects the admin's live RTP config.
  const [config] = useState(() => getShamrockRtpConfig());
  const basePay = (id: WinRuleId) => getRulePayout(config, id, false);
  const freePay = (id: WinRuleId) => getRulePayout(config, id, true);

  const steps = [
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Land a winning combination on the payline. Amounts are for your current bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>, in the base
            game and during <InfoAccent>free spins</InfoAccent>.
          </InfoLead>
          <InfoCard className="!p-0">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-left text-[13px] uppercase tracking-wide" style={{ color: THEME.accent }}>
                  <th className="px-2 sm:px-4 py-2">Combination</th>
                  <th className="px-2 sm:px-4 py-2 text-right">Pays</th>
                  <th className="px-2 sm:px-4 py-2 text-right">Free spins</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map((r) => (
                  <tr key={r.id} className="border-t border-white/10">
                    <td className="px-2 sm:px-4 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex w-[96px] sm:w-[150px] flex-none items-center gap-1">
                          {r.icons.map((s, i) => (
                            <InfoSymbol key={i} src={img(s)} alt={i === 0 ? r.name : ""} size={44} tile />
                          ))}
                        </div>
                        <InfoGradient className="text-[16px]">{r.name}</InfoGradient>
                      </div>
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right">
                      <InfoMoney>{fmtMoney(basePay(r.id) * bet)}</InfoMoney>
                      <div className="text-[12px] text-white/50">{basePay(r.id)}x</div>
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right">
                      <b className="tabular-nums text-amber-300">{fmtMoney(freePay(r.id) * bet)}</b>
                      <div className="text-[12px] text-white/50">{freePay(r.id)}x</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </InfoCard>
        </>
      ),
    },
    {
      tab: "Wilds",
      title: "SHAMROCK WILDS",
      body: (
        <div className="flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <InfoSymbol src={img("SHAMROCK_WILD")} alt="Shamrock Spin wild" size={100} tile />
          </div>
          <InfoList
            items={[
              <>
                The <InfoAccent>Shamrock Spin</InfoAccent> symbol is <InfoAccent>wild</InfoAccent>.
              </>,
              <>A single Wild substitutes for any Seven or BAR to complete a winning line.</>,
              <>The plain Shamrock Spin wild never awards free spins — only the numbered Shamrocks (1-4) do.</>,
              <>
                Wilds also pay on their own: 1 Wild on the line pays <InfoMoney>{basePay("ONE_WILD")}x</InfoMoney>, 2 Wilds pay{" "}
                <InfoMoney>{basePay("TWO_WILDS")}x</InfoMoney>.
              </>,
              <>
                Line up <InfoAccent>3 Shamrock Spin</InfoAccent> symbols for the top prize: <InfoMoney>{basePay("WILD_JACKPOT")}x</InfoMoney> your bet,
                or <InfoMoney>{freePay("WILD_JACKPOT")}x</InfoMoney> during free spins.
              </>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Free Spins",
      title: "FREE SPINS",
      body: (
        <div className="flex flex-col items-center">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2 rounded-2xl border-2 px-2 sm:px-5 py-3" style={{ borderColor: THEME.accent }}>
            <InfoSymbol src={img("SHAMROCK_1")} alt="Shamrock 1" size={50} tile />
            <InfoSymbol src={img("SHAMROCK_2")} alt="Shamrock 2" size={50} tile />
            <InfoSymbol src={img("SHAMROCK_3")} alt="Shamrock 3" size={50} tile />
            <InfoSymbol src={img("SHAMROCK_4")} alt="Shamrock 4" size={50} tile />
            <InfoGradient className="text-[18px] sm:text-[24px]">FREE SPINS FEATURE</InfoGradient>
          </div>
          <InfoList
            items={[
              <>
                <InfoAccent>Shamrock Spin</InfoAccent> images containing numbers <InfoAccent>1, 2, 3, or 4</InfoAccent> award Free Spins when they land on the <InfoAccent>payline</InfoAccent>!
              </>,
              <>
                Each numbered Shamrock Spin symbol awards free spins equal to its number (<InfoAccent>1, 2, 3, or 4</InfoAccent>).
              </>,
              <>
                When multiple Shamrock Spin symbols land on the payline, their numbers are added together to award your total free spins. Shamrocks above or below the payline don't count.
              </>,
              <>
                Shamrock Spin symbols also act as <InfoAccent>Wilds</InfoAccent> and substitute for Sevens and BARs to complete winning lines!
              </>,
              <>Tap the screen or SPIN to start the free spins — they then play automatically at your current bet and cost nothing.</>,
              <>
                Wins during free spins use the enhanced <InfoAccent>Free spins</InfoAccent> column of the paytable.
              </>,
              ...(getFreeSpinMinWin(config) > 0
                ? [
                    <>
                      Every free spins round wins at least once — at least <InfoMoney>{getFreeSpinMinWin(config)}x</InfoMoney> your bet in total (
                      <InfoMoney>{fmtMoney(getFreeSpinMinWin(config) * bet)}</InfoMoney>).
                    </>,
                  ]
                : []),
              <>
                Free spins can be retriggered during the round, up to <InfoAccent>{maxTotalFreeSpins} total free spins</InfoAccent>.
              </>,
              <>Your round total builds up in the WIN box; when the round ends it is shown on screen and added to your balance when you tap to continue. Auto play stops when the round ends.</>,
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
            ["?", "Opens this screen."],
            ["Sound", "Mutes or unmutes the game."],
            ["Home", "Back to the lobby."],
          ]}
        />
      ),
    },
  ];

  return <GameInfoPopup label="Shamrock Spin rules" theme={THEME} steps={steps} onClose={onClose} />;
}
