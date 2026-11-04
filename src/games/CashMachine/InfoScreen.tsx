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
import { CashSymbol } from "./api";

const ASSET_BASE = "/symbols/moneyMachine";

const THEME: InfoTheme = {
  background: "radial-gradient(ellipse at 50% 0%, #14532d 0%, #0b2a18 50%, #050c08 100%)",
  accent: "#34d399",
  titleGradient: "linear-gradient(180deg, #ecfccb 0%, #a3e635 45%, #16a34a 100%)",
  buttonBackground: "linear-gradient(180deg, #6ee7b7 0%, #10b981 55%, #047857 100%)",
  buttonEdge: "#064e3b",
};

const SYMBOL_FILES: Record<CashSymbol, string> = {
  null: "null.webp",
  "0": "0.webp",
  "1": "1.webp",
  "2": "2.webp",
  "5": "5.webp",
  "10": "10.webp",
};
const img = (s: CashSymbol) => `${ASSET_BASE}/${SYMBOL_FILES[s]}`;

/** Mirrors api.ts's BET_TIERS: each bet plays a number of reels, and pays the printed number
 * scaled by bet / fullBetForReels. */
const BET_TIERS: { bet: number; reels: number; fullBet: number }[] = [
  { bet: 0.1, reels: 1, fullBet: 1 },
  { bet: 1, reels: 1, fullBet: 1 },
  { bet: 0.5, reels: 2, fullBet: 5 },
  { bet: 5, reels: 2, fullBet: 5 },
  { bet: 0.9, reels: 3, fullBet: 10 },
  { bet: 10, reels: 3, fullBet: 10 },
];

const EXAMPLES: { reels: CashSymbol[]; number: number }[] = [
  { reels: ["null", "2", "5"], number: 25 },
  { reels: ["1", "null", "10"], number: 110 },
  { reels: ["5", "5", "5"], number: 555 },
];

function Reels({ symbols, size = 64 }: { symbols: CashSymbol[]; size?: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-black/50 p-2">
      {symbols.map((s, i) => (
        <div key={i} className="flex items-center justify-center rounded-lg bg-white/[0.06]" style={{ width: size + 8, height: size + 8 }}>
          <InfoSymbol src={img(s)} alt={s === "null" ? "blank" : s} size={size} />
        </div>
      ))}
    </div>
  );
}

export function InfoScreen({ bet, onClose }: { bet: number; onClose: () => void }) {
  const tier = BET_TIERS.find((t) => Math.abs(t.bet - bet) < 1e-9) ?? BET_TIERS[0];
  const scale = tier.bet / tier.fullBet;

  const steps = [
    {
      tab: "How it pays",
      title: "THE NUMBER IS YOUR PRIZE",
      body: (
        <>
          <InfoLead>
            There are no symbols to match — every reel prints a <InfoAccent>digit</InfoAccent> or a blank. Read the reels{" "}
            <InfoAccent>left to right</InfoAccent>, skip the blanks, and the number you get is your prize.
          </InfoLead>
          <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
            {(["0", "1", "2", "5", "10", "null"] as CashSymbol[]).map((s) => (
              <InfoCard key={s} className="flex flex-col items-center !px-3 !py-2">
                <InfoSymbol src={img(s)} alt={s === "null" ? "blank" : s} size={64} />
                <span className="mt-1 text-[13px] font-bold text-white/70">{s === "null" ? "Blank" : s === "0" ? "Zero" : `Prints ${s}`}</span>
              </InfoCard>
            ))}
          </div>
          <div className="flex flex-col items-center gap-3">
            {EXAMPLES.map((ex, i) => (
              <div key={i} className="flex flex-wrap items-center justify-center gap-4">
                <Reels symbols={ex.reels} size={46} />
                <span className="text-[19px] sm:text-[26px] font-black text-emerald-300">→</span>
                <InfoGradient className="w-[90px] text-[21px] sm:text-[30px]">{ex.number}</InfoGradient>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      tab: "Bets & Reels",
      title: "BETS & REELS IN PLAY",
      body: (
        <>
          <InfoLead>
            Your bet decides how many reels the machine puts to work. Reels not in play are dimmed. The lower bet in each pair plays the
            same reels at the same odds, for a smaller share of the prize.
          </InfoLead>
          <InfoCard className="mx-auto max-w-[760px] !p-0">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-left text-[13px] uppercase tracking-wide text-emerald-300/80">
                  <th className="px-2 sm:px-4 py-2">Bet</th>
                  <th className="px-2 sm:px-4 py-2">Reels in play</th>
                  <th className="px-2 sm:px-4 py-2 text-right">You win</th>
                </tr>
              </thead>
              <tbody>
                {BET_TIERS.slice()
                  .sort((a, b) => a.bet - b.bet)
                  .map((t) => {
                    const current = t === tier;
                    const share = t.bet / t.fullBet;
                    return (
                      <tr key={t.bet} className={`border-t border-white/10 ${current ? "bg-emerald-400/15" : ""}`}>
                        <td className="px-2 sm:px-4 py-2 font-bold">
                          {fmtMoney(t.bet)}
                          {current && <span className="ml-2 rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-black text-black">YOUR BET</span>}
                        </td>
                        <td className="px-2 sm:px-4 py-2">
                          {t.reels} reel{t.reels > 1 ? "s" : ""}
                        </td>
                        <td className="px-2 sm:px-4 py-2 text-right">
                          {share === 1 ? "the full number" : `number × ${Number(share.toFixed(2))}`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </InfoCard>
          <p className="mt-4 text-center">
            At your bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>, a printed <InfoAccent>25</InfoAccent> pays{" "}
            <InfoMoney>{fmtMoney(25 * scale)}</InfoMoney>.
          </p>
        </>
      ),
    },
    {
      tab: "Zero Respin",
      title: "THE ZERO RESPIN",
      body: (
        <div className="flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Reels symbols={["null", "0", "null"]} />
            <span className="text-[21px] sm:text-[30px] font-black text-emerald-300">→</span>
            <Reels symbols={["2", "0", "5"]} />
          </div>
          <InfoList
            items={[
              <>
                Land a <InfoAccent>0</InfoAccent> on any reel in play and the machine jolts to life.
              </>,
              <>Every other blank reel in play gets a free bonus respin, cranking in reverse, hunting for real digits.</>,
              <>The 0 itself stays put and counts as a digit, so it can turn a small number into a much bigger one.</>,
              <>Your win locks in once the respin has finished.</>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Controls",
      title: "HOW TO PLAY",
      body: (
        <>
          <InfoControls
            rows={[
              ["Spin", "Spin the reels at the current bet."],
              ["Hold Spin", "Starts auto spin. Press STOP to end it."],
              ["Bet − / +", "Lower or raise your bet (this also changes the reels in play)."],
              ["Max Bet", "Jump straight to the highest bet: all 3 reels, full prize."],
              ["i", "Opens this screen."],
              ["Sound", "Mutes or unmutes the game."],
              ["Home", "Back to the lobby."],
            ]}
          />
          <p className="mt-5 text-center text-white/60">All blanks and no 0 means no win this time.</p>
        </>
      ),
    },
  ];

  return <GameInfoPopup label="Cash Machine rules" theme={THEME} steps={steps} onClose={onClose} />;
}
