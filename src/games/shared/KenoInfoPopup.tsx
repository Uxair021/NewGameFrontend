import { ReactNode, useState } from "react";
import {
  GameInfoPopup,
  InfoAccent,
  InfoCard,
  InfoControls,
  InfoGradient,
  InfoLead,
  InfoList,
  InfoMoney,
  InfoStep,
  InfoTheme,
  fmtMoney,
} from "./GameInfoPopup";

/**
 * Rules popup shared by the keno games (Hexa Keno, Super Keno Balls) — same stepped shell as the
 * slot games' info screens. Super Keno Balls passes `bonusMultiplier` to get its extra Bonus Ball
 * page and column; everything else (how to play, an interactive paytable for any number of spots,
 * controls) is common.
 */
export function KenoInfoPopup({
  name,
  theme,
  paytable,
  bet,
  picksCount,
  poolSize,
  drawnCount,
  maxPicks,
  bonusMultiplier,
  controls,
  onClose,
}: {
  name: string;
  theme: InfoTheme;
  /** paytable[spotsPicked][matches] = multiplier of the bet. */
  paytable: number[][];
  bet: number;
  /** Spots currently picked on the card — preselects that row of the paytable. */
  picksCount: number;
  poolSize: number;
  drawnCount: number;
  maxPicks: number;
  /** Super Keno Balls only: payout multiplier when the Bonus Ball is one of your matches. */
  bonusMultiplier?: number;
  controls: [ReactNode, ReactNode][];
  onClose: () => void;
}) {
  const spotOptions = Array.from({ length: maxPicks }, (_, i) => i + 1).filter((n) => (paytable[n] ?? []).some((m) => m > 0));
  const [spots, setSpots] = useState(() =>
    picksCount > 0 && spotOptions.includes(picksCount) ? picksCount : (spotOptions[spotOptions.length - 1] ?? maxPicks)
  );
  const rows = (paytable[spots] ?? [])
    .map((mult, hits) => ({ hits, mult }))
    .filter((r) => r.mult > 0)
    .sort((a, b) => b.hits - a.hits);

  const steps: InfoStep[] = [
    {
      tab: "How to play",
      title: "HOW TO PLAY",
      body: (
        <div className="flex flex-col items-center gap-5">
          <div className="grid w-full max-w-[860px] grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["1", "PICK", `Choose 1 to ${maxPicks} numbers from 1–${poolSize}.`],
              ["2", "PLAY", `${drawnCount} numbers are drawn at random.`],
              ["3", "WIN", "The more of your numbers that are drawn, the more you win."],
            ].map(([n, title, text]) => (
              <InfoCard key={n} className="flex flex-col items-center text-center">
                <span
                  className="mb-2 flex h-[44px] w-[44px] items-center justify-center rounded-full text-[17px] sm:text-[22px] font-black text-black"
                  style={{ background: theme.titleGradient }}
                >
                  {n}
                </span>
                <InfoGradient className="text-[17px] sm:text-[22px]">{title}</InfoGradient>
                <span className="mt-1">{text}</span>
              </InfoCard>
            ))}
          </div>
          <InfoList
            items={[
              <>
                Tap numbers on the card to pick them (tap again to remove), or use <InfoAccent>Quick Pick</InfoAccent> for a random set.
              </>,
              <>
                Each number you pick is a <InfoAccent>spot</InfoAccent>. Every number of drawn spots that matches yours is a{" "}
                <InfoAccent>hit</InfoAccent>.
              </>,
              <>
                What you win depends on how many spots you picked and how many you hit. The <InfoAccent>Hits / Pays</InfoAccent> table beside
                the card always shows the prizes for your current picks and bet.
              </>,
              <>Win = paytable multiplier × your bet. Your picks stay on the card between games, so you can replay them.</>,
            ]}
          />
        </div>
      ),
    },
    {
      tab: "Paytable",
      title: "PAYTABLE",
      body: (
        <>
          <InfoLead>
            Choose how many spots you pick to see what each number of hits pays at your bet of <InfoMoney>{fmtMoney(bet)}</InfoMoney>.
          </InfoLead>
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-[14px] font-bold uppercase tracking-wide text-white/60">Spots:</span>
            {spotOptions.map((n) => (
              <button
                key={n}
                onClick={() => setSpots(n)}
                className="h-[38px] w-[38px] rounded-full border-2 text-[16px] font-black transition-colors"
                style={
                  n === spots
                    ? { background: theme.titleGradient, borderColor: theme.accent, color: "#111" }
                    : { background: "rgba(0,0,0,.3)", borderColor: "rgba(255,255,255,.2)", color: "#fff" }
                }
                aria-pressed={n === spots}
              >
                {n}
              </button>
            ))}
          </div>
          <InfoCard className="mx-auto max-w-[680px] !p-0">
            <table className="w-full text-[16px]">
              <thead>
                <tr className="text-left text-[13px] uppercase tracking-wide" style={{ color: theme.accent }}>
                  <th className="px-2 sm:px-4 py-2">Hits</th>
                  <th className="px-2 sm:px-4 py-2 text-right">Pays</th>
                  {bonusMultiplier !== undefined && <th className="px-2 sm:px-4 py-2 text-right">With Bonus Ball</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.hits} className="border-t border-white/10">
                    <td className="px-2 sm:px-4 py-2 font-bold">
                      {r.hits} of {spots}
                    </td>
                    <td className="px-2 sm:px-4 py-2 text-right">
                      <InfoMoney>{fmtMoney(r.mult * bet)}</InfoMoney>
                      <span className="ml-2 text-[12px] text-white/50">{r.mult}x</span>
                    </td>
                    {bonusMultiplier !== undefined && (
                      <td className="px-2 sm:px-4 py-2 text-right">
                        <b className="tabular-nums text-amber-300">{fmtMoney(r.mult * bonusMultiplier * bet)}</b>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </InfoCard>
          <p className="mt-3 text-center text-[14px] text-white/55">Any number of hits not listed pays nothing.</p>
        </>
      ),
    },
  ];

  if (bonusMultiplier !== undefined) {
    steps.push({
      tab: "Bonus Ball",
      title: "THE BONUS BALL",
      body: (
        <div className="flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-center justify-center gap-4 rounded-2xl border-2 px-2 sm:px-6 py-3" style={{ borderColor: theme.accent }}>
            <span
              className="flex h-[84px] w-[84px] items-center justify-center rounded-full text-[21px] sm:text-[30px] font-black text-black shadow-[0_0_24px_rgba(56,189,248,.6)]"
              style={{ background: "radial-gradient(circle at 35% 30%, #fff 0%, #fde047 35%, #f59e0b 100%)" }}
            >
              {drawnCount}
            </span>
            <InfoGradient className="text-[21px] sm:text-[30px]">= {bonusMultiplier}× YOUR WIN</InfoGradient>
          </div>
          <InfoList
            items={[
              <>
                The <InfoAccent>last ball</InfoAccent> of every draw is the <InfoAccent>Bonus Ball</InfoAccent>.
              </>,
              <>
                If the Bonus Ball is one of your hits, that game's payout is multiplied <InfoMoney>{bonusMultiplier}×</InfoMoney>.
              </>,
              <>The Bonus Ball only multiplies a win: if your hits don't pay anything, the Bonus Ball can't add a prize.</>,
            ]}
          />
        </div>
      ),
    });
  }

  steps.push({
    tab: "Controls",
    title: "CONTROLS",
    body: <InfoControls rows={controls} />,
  });

  return <GameInfoPopup label={`${name} rules`} theme={theme} steps={steps} onClose={onClose} />;
}
