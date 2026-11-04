import { useCallback, useEffect, useState, CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Stepped rules / info popup shared by the slot games — the same layout as Fruity 777's and
 * Final Thing's info screens (numbered stepper, gold title, Back / Next footer, Esc + arrow keys),
 * with every colour supplied by the game's own `InfoTheme` so each one stays in its own look.
 *
 * Rendered `fixed` over the whole viewport (not inside the scaled game card) and sized in plain
 * CSS px / viewport units, so it reads the same regardless of each game's design-space scale —
 * and stays readable on a phone (tighter padding, smaller title/buttons and symbols below `sm`).
 * Mounted on document.body through a portal: games render it from inside their CSS-scaled card,
 * and `fixed` inside a transformed parent would otherwise shrink with the card.
 * Bodies can use the small helpers below; they pick up the theme through CSS variables
 * (`--info-accent`, `--info-title`) set on the panel, so no theme prop needs threading through.
 */

export interface InfoTheme {
  /** Panel background (any CSS background value). */
  background: string;
  /** Main accent colour — border, stepper, headings underline, highlighted words. */
  accent: string;
  /** Gradient painted into the page titles (CSS gradient). */
  titleGradient: string;
  /** Next / Got it! button face (CSS background) and the darker ledge under it. */
  buttonBackground: string;
  buttonEdge: string;
  /** Text colour on the Next button. Defaults to white. */
  buttonText?: string;
  /** Font for the page titles. Defaults to the body font. */
  titleFont?: string;
}

export interface InfoStep {
  tab: string;
  title: string;
  body: ReactNode;
}

const STYLES = `
@keyframes game-info-pop { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
.game-info-panel { animation: game-info-pop .18s ease-out both; }
`;

export function GameInfoPopup({
  label,
  theme,
  steps,
  onClose,
}: {
  /** Accessible name, e.g. "Buffalo 777 rules". */
  label: string;
  theme: InfoTheme;
  steps: InfoStep[];
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const go = useCallback((delta: number) => setStep((p) => Math.min(Math.max(p + delta, 0), steps.length - 1)), [steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const titleStyle: CSSProperties = { ...GRADIENT_TEXT, fontFamily: theme.titleFont };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-3" onClick={onClose}>
      <style>{STYLES}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="game-info-panel relative flex flex-col rounded-[18px] border-[3px] px-3 pb-3 pt-3 text-white sm:rounded-[24px] sm:px-9 sm:pb-5 sm:pt-5"
        style={
          {
            width: "min(1100px, 96vw)",
            height: "min(760px, 94dvh)",
            background: theme.background,
            borderColor: theme.accent,
            boxShadow: `0 0 0 5px rgba(0,0,0,.55), 0 0 50px ${withAlpha(theme.accent, 0.25)}, 0 24px 70px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.2)`,
            fontFamily: "Arial, Helvetica, sans-serif",
            "--info-accent": theme.accent,
            "--info-title": theme.titleGradient,
          } as CSSProperties
        }
      >
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border-2 bg-black/40 text-[24px] leading-none text-white/85 hover:bg-black/60 hover:text-white sm:right-4 sm:top-4 sm:h-11 sm:w-11 sm:text-[28px]"
          style={{ borderColor: withAlpha(theme.accent, 0.6) }}
        >
          ×
        </button>

        {/* Stepper */}
        <div className="mx-auto flex max-w-[calc(100%-84px)] flex-wrap items-center justify-center gap-y-2 sm:max-w-[calc(100%-56px)]">
          {steps.map((s, i) => (
            <div key={s.tab} className="flex items-center">
              {i > 0 && (
                <div
                  className="mx-1 h-[3px] w-[10px] rounded-full sm:mx-2 sm:w-[40px]"
                  style={{ background: i <= step ? theme.accent : "rgba(255,255,255,.15)" }}
                />
              )}
              <button onClick={() => setStep(i)} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
                <span
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-full text-[14px] font-black transition-colors sm:h-[34px] sm:w-[34px] sm:text-[16px]"
                  style={
                    i === step
                      ? { background: theme.titleGradient, color: "#111", boxShadow: `0 0 14px ${withAlpha(theme.accent, 0.7)}` }
                      : i < step
                        ? { background: withAlpha(theme.accent, 0.4), color: "#fff" }
                        : { background: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.6)" }
                  }
                >
                  {i + 1}
                </span>
                <span
                  className="hidden text-[14px] font-bold uppercase tracking-wider md:inline"
                  style={{ color: i === step ? theme.accent : "rgba(255,255,255,.5)" }}
                >
                  {s.tab}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 text-center text-[20px] font-black leading-tight tracking-wide sm:mt-4 sm:text-[32px]" style={titleStyle}>
          {current.title}
        </div>
        <div
          className="mx-auto mb-3 mt-1 h-[2px] w-[min(380px,70%)] sm:mb-4"
          style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }}
        />

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 text-[14px] leading-[21px] text-white/85 sm:text-[16px] sm:leading-[24px]">
          {current.body}
        </div>

        {/* Footer nav */}
        <div className="mt-3 flex items-center justify-between gap-2 sm:mt-4">
          <button
            onClick={() => go(-1)}
            disabled={step === 0}
            className="rounded-full border-2 bg-black/30 px-4 py-1.5 text-[15px] font-bold text-white/90 hover:bg-black/50 disabled:invisible sm:px-6 sm:py-2 sm:text-[17px]"
            style={{ borderColor: withAlpha(theme.accent, 0.6) }}
          >
            ‹ Back
          </button>
          <span className="hidden text-[13px] tracking-widest text-white/50 min-[400px]:inline">
            STEP {step + 1} / {steps.length}
          </span>
          <button
            onClick={() => (isLast ? onClose() : go(1))}
            className="rounded-full px-5 py-1.5 text-[15px] font-black active:translate-y-[3px] sm:px-8 sm:py-2 sm:text-[17px]"
            style={{
              background: theme.buttonBackground,
              color: theme.buttonText ?? "#fff",
              boxShadow: `0 4px 0 ${theme.buttonEdge}, 0 8px 14px rgba(0,0,0,.5)`,
              textShadow: theme.buttonText ? undefined : `0 2px 0 ${theme.buttonEdge}`,
            }}
          >
            {isLast ? "Got it!" : "Next ›"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------------------------------
// Body helpers — themed through the panel's CSS variables
// ------------------------------------------------------------------------------------------

const GRADIENT_TEXT: CSSProperties = {
  backgroundImage: "var(--info-title)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/** Text painted with the theme's title gradient. */
export function InfoGradient({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-black ${className}`} style={GRADIENT_TEXT}>
      {children}
    </span>
  );
}

/** Bold word in the theme's accent colour. */
export function InfoAccent({ children }: { children: ReactNode }) {
  return <b style={{ color: "var(--info-accent)" }}>{children}</b>;
}

/** Bold money / win amount. */
export function InfoMoney({ children }: { children: ReactNode }) {
  return <b className="tabular-nums text-lime-300">{children}</b>;
}

/** Centered intro line at the top of a page. */
export function InfoLead({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-center text-[14px] text-white/80 sm:mb-4 sm:text-[17px]">{children}</p>;
}

/** Soft glassy card used for paytable rows / feature callouts. */
export function InfoCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/15 bg-gradient-to-b from-white/[0.09] to-white/[0.02] px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), 0 6px 14px rgba(0,0,0,.35)" }}
    >
      {children}
    </div>
  );
}

/** A symbol image. `tile` puts it on a white rounded card — for art with a baked-in white
 * background that would look like a hole on the dark panel. Shrinks with the screen on phones
 * (never above `size`, about 60% of it on a ~390px-wide phone). */
export function InfoSymbol({ src, alt = "", size = 56, tile = false }: { src: string; alt?: string; size?: number; tile?: boolean }) {
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={`flex-none select-none object-contain ${tile ? "rounded-lg bg-white p-1 shadow" : "drop-shadow-[0_4px_6px_rgba(0,0,0,.6)]"}`}
      style={{ width: `min(${size}px, ${(size * 0.15).toFixed(2)}vw)`, height: `min(${size}px, ${(size * 0.15).toFixed(2)}vw)` }}
    />
  );
}

/** Bulleted rules list. */
export function InfoList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mx-auto max-w-[900px] list-disc space-y-2 pl-5 sm:pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** "Button name — what it does" rows for a Controls page. */
export function InfoControls({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <ul className="mx-auto max-w-[820px] space-y-2.5">
      {rows.map(([key, text], i) => (
        <li key={i} className="flex items-start gap-2 sm:gap-3">
          <span
            className="flex min-w-[84px] flex-none items-center justify-center rounded-lg border bg-black/35 px-2 py-1 text-center text-[12px] font-bold uppercase tracking-wide text-white sm:min-w-[120px] sm:text-[14px]"
            style={{ borderColor: "var(--info-accent)" }}
          >
            {key}
          </span>
          <span className="pt-1">{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Celebration cutoffs, shared wording across games. */
export function InfoBigWins({ rows }: { rows: { name: "BIG WIN" | "MEGA WIN" | "JACKPOT"; text: ReactNode }[] }) {
  const color = { "BIG WIN": "text-amber-300", "MEGA WIN": "text-fuchsia-300", JACKPOT: "text-yellow-300" } as const;
  return (
    <InfoCard className="mx-auto mt-5 max-w-[820px]">
      <InfoGradient className="text-[20px]">BIG WINS</InfoGradient>
      <div className="mt-1 space-y-1">
        {rows.map((r) => (
          <div key={r.name} className="flex justify-between gap-4">
            <b className={color[r.name]}>{r.name}</b>
            <span className="text-right">{r.text}</span>
          </div>
        ))}
      </div>
    </InfoCard>
  );
}

/** Mini 3x3 / 5x3 grid with one payline traced through it. `line[reel]` = row index. */
export function InfoPaylineDiagram({ number, line, rows = 3, color }: { number?: number; line: readonly number[]; rows?: number; color?: string }) {
  const CELL = 28;
  const GAP = 3;
  const reels = line.length;
  const width = reels * CELL + (reels - 1) * GAP;
  const height = rows * CELL + (rows - 1) * GAP;
  const center = (i: number) => i * (CELL + GAP) + CELL / 2;
  const points = line.map((row, reel) => `${center(reel)},${center(row)}`).join(" ");
  const stroke = color ?? "var(--info-accent)";
  return (
    <div className="flex flex-col items-center rounded-xl border border-white/10 bg-black/25 px-2 pb-2 pt-1">
      {number !== undefined && <div className="mb-1 text-[13px] font-bold text-white/80">LINE {number}</div>}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: reels * rows }, (_, k) => {
          const reel = k % reels;
          const row = Math.floor(k / reels);
          const lit = line[reel] === row;
          return (
            <rect
              key={k}
              x={reel * (CELL + GAP)}
              y={row * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={5}
              style={{ fill: lit ? stroke : "rgba(255,255,255,0.07)", fillOpacity: lit ? 0.5 : 1 }}
            />
          );
        })}
        <polyline points={points} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      </svg>
    </div>
  );
}

export const fmtMoney = (n: number) => n.toFixed(2);
export const fmtMult = (n: number) => `${Number(n.toFixed(4))}x`;

/** `#rrggbb` -> `rgba(r,g,b,a)`; anything else is returned unchanged. */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return color;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}
