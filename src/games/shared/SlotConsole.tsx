import { CSSProperties, ReactNode } from "react";
import { Menu } from "lucide-react";
import { useBalanceCountUp } from "./useCountUp";

/**
 * The 3D slot control console first built for 777 Fruity — a tilted deck with chunky lit keys
 * (Menu, Bet −/+, FAST, AUTO, a big SPIN in its own socket) and LCD readouts (Credit, Bet, Win).
 * Shared so every game that uses it looks and behaves the same; each game passes its own state
 * and handlers. Sized in the game card's 1920px design space; the parent positions it (typically
 * absolute, bottom-0, full width). FAST is optional — games without a fast-spin mode omit it.
 */
export interface SlotConsoleProps {
  credit: number;
  bet: number;
  win: number;
  onBetDecrease: () => void;
  onBetIncrease: () => void;
  betDecreaseDisabled: boolean;
  betIncreaseDisabled: boolean;
  /** Fast spin toggle — omit for games that don't have one. */
  fast?: { on: boolean; onToggle: () => void };
  auto: { on: boolean; disabled?: boolean; onToggle: () => void };
  /** Shows the spinning icon on the SPIN key. */
  spinning: boolean;
  spinDisabled: boolean;
  /** SPIN key text while not spinning (e.g. "FREE" during a free-spins round). */
  spinLabel?: string;
  onSpin: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  /** Extra classes on the wrapper — e.g. the z-index, raised above a banner that SPIN can start. */
  className?: string;
  /** Recolours the console to match a game's art. Omit for the default (777 Fruity's purple deck). */
  theme?: SlotConsoleTheme;
  /** Draws the deck flat instead of tilted back in 3D. A 3D transform always gets its own GPU
   * layer; flat, the console is painted into the page's base layer — for games on a tight
   * GPU-memory budget. */
  flat?: boolean;
}

/** One key colour: radial face (hi → mid → lo), the ledge under it, and its "on" glow / LED. */
export interface KeyToneColors {
  hi: string;
  mid: string;
  lo: string;
  ledge: string;
  glow: string;
  led: string;
}

/** A game's console colours. Every field is optional — anything left out keeps the default look. */
export interface SlotConsoleTheme {
  /** Deck body gradient, top → middle → bottom. */
  deck?: [string, string, string];
  /** Deck outline. */
  deckEdge?: string;
  /** The thin lit trim along the deck's top edge. */
  trim?: string;
  /** The deck's front lip gradient, top → bottom. */
  deckFront?: [string, string];
  /** Ring around each LCD readout. */
  lcdRing?: string;
  /** Digit colours of the three readouts. */
  lcd?: { credit?: string; bet?: string; win?: string };
  /** Key colours: menu, bet −/+ ("chrome"), FAST, AUTO and SPIN. */
  keys?: Partial<Record<"menu" | "chrome" | "fast" | "auto" | "spin", KeyToneColors>>;
  /** Text shadow colour under the SPIN label. */
  spinLabelShadow?: string;
  /** Strength (0-1) of the white gloss on the keys' top half — default .7. Lower it on bright
   * key colours, where a strong gloss washes out the icons. */
  gloss?: number;
  /** Dark outline behind the keys' icons and labels so they read on any key colour — default none. */
  iconOutline?: boolean;
}

export function SlotConsole(props: SlotConsoleProps) {
  const { fast, auto, theme } = props;
  const shownCredit = useBalanceCountUp(props.credit);
  const keys = theme?.keys ?? {};
  // Theme colours reach the CSS below as variables; each var() there falls back to the default look.
  const themeVars = {
    ...(theme?.deck && { "--c-deck-top": theme.deck[0], "--c-deck-mid": theme.deck[1], "--c-deck-bot": theme.deck[2] }),
    ...(theme?.deckEdge && { "--c-deck-edge": theme.deckEdge }),
    ...(theme?.trim && { "--c-trim": theme.trim }),
    ...(theme?.deckFront && { "--c-front-top": theme.deckFront[0], "--c-front-bot": theme.deckFront[1] }),
    ...(theme?.lcdRing && { "--c-lcd-ring": theme.lcdRing }),
    ...(theme?.gloss !== undefined && { "--c-gloss": theme.gloss, "--c-gloss-rim": theme.gloss * 0.85 }),
    ...(theme?.iconOutline && {
      "--c-icon-filter": "drop-shadow(0 2px 1px rgba(0,0,0,.75)) drop-shadow(0 0 3px rgba(0,0,0,.5))",
    }),
  } as CSSProperties;
  return (
    <div className={`f7-console-wrap w-full px-5 ${props.className ?? ""}`} style={themeVars} data-flat={props.flat ? "true" : undefined}>
      <style>{CONSOLE_CSS}</style>
      <div className="f7-deck">
        <div className="flex h-full items-center gap-5 px-7">
          {/* Opens the menu: Home, sound on/off, game info. */}
          <ConsoleKey tone="blue" colors={keys.menu} size={78} on={props.menuOpen} ariaLabel="Menu" onClick={props.onToggleMenu}>
            <Menu size={42} strokeWidth={3} className="text-white" style={{ filter: "drop-shadow(0 2px 1px rgba(0,0,0,.9))" }} />
          </ConsoleKey>

          <LcdDisplay label="Credit" value={shownCredit.toFixed(2)} color={theme?.lcd?.credit ?? "#7dd3fc"} className="w-[270px]" />

          <div className="flex items-center gap-3">
            <ConsoleKey tone="chrome" colors={keys.chrome} size={66} onClick={props.onBetDecrease} disabled={props.betDecreaseDisabled} ariaLabel="Decrease bet">
              <MinusPlusIcon plus={false} />
            </ConsoleKey>
            <LcdDisplay label="Bet" value={props.bet.toFixed(2)} color={theme?.lcd?.bet ?? "#fcd34d"} className="w-[190px]" />
            <ConsoleKey tone="chrome" colors={keys.chrome} size={66} onClick={props.onBetIncrease} disabled={props.betIncreaseDisabled} ariaLabel="Increase bet">
              <MinusPlusIcon plus />
            </ConsoleKey>
          </div>

          <LcdDisplay label="Win" value={props.win.toFixed(2)} color={theme?.lcd?.win ?? "#bef264"} big className="min-w-[260px] flex-1" />

          <div className="flex items-center gap-4">
            {fast && (
              <ConsoleKey tone="cyan" colors={keys.fast} size={92} on={fast.on} ariaLabel={fast.on ? "Fast spin on" : "Fast spin off"} onClick={fast.onToggle}>
                <div className="flex flex-col items-center leading-none text-white" style={{ textShadow: "0 2px 2px rgba(0,0,0,.45)" }}>
                  <BoltIcon />
                  <span className="mt-0.5 text-[17px] font-black tracking-wider">FAST</span>
                </div>
              </ConsoleKey>
            )}
            <ConsoleKey
              tone="violet"
              colors={keys.auto}
              size={92}
              on={auto.on}
              disabled={auto.disabled}
              ariaLabel={auto.on ? "Stop autoplay" : "Start autoplay"}
              onClick={auto.onToggle}
            >
              <div className="flex flex-col items-center leading-none text-white" style={{ textShadow: "0 2px 2px rgba(0,0,0,.45)" }}>
                <AutoIcon spinning={auto.on} />
                <span className="mt-0.5 text-[17px] font-black tracking-wider">{auto.on ? "STOP" : "AUTO"}</span>
              </div>
            </ConsoleKey>
          </div>

          <div className="f7-spin-socket">
            <ConsoleKey tone="spin" colors={keys.spin} size={156} depth={9} disabled={props.spinDisabled} ariaLabel="Spin" onClick={props.onSpin}>
              {props.spinning ? (
                <span className="f7-spin-icon">
                  <AutoIcon spinning size={70} />
                </span>
              ) : (
                <span className="text-[46px] font-black italic tracking-wide text-white" style={{ textShadow: `0 3px 0 ${theme?.spinLabelShadow ?? "#9a3412"}, 0 5px 8px rgba(0,0,0,.5)` }}>
                  {props.spinLabel ?? "SPIN"}
                </span>
              )}
            </ConsoleKey>
          </div>
        </div>
      </div>
      <div className="f7-deck-front" />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// 3D console styling — kept as plain CSS (not Tailwind classes) since the layered bevel /
// ledge / gloss shadows need CSS variables and pseudo-elements.
// ------------------------------------------------------------------------------------------

export const CONSOLE_CSS = `
.f7-console-wrap { perspective: 1400px; perspective-origin: 50% 0%; }
.f7-console-wrap[data-flat="true"] { perspective: none; }
.f7-console-wrap[data-flat="true"] .f7-deck { transform: none; }
.f7-deck {
  position: relative;
  height: 150px;
  border-radius: 34px 34px 10px 10px;
  transform: rotateX(14deg);
  transform-origin: 50% 100%;
  background:
    linear-gradient(180deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 35%),
    repeating-linear-gradient(90deg, rgba(255,255,255,.025) 0 2px, rgba(0,0,0,0) 2px 5px),
    linear-gradient(180deg, var(--c-deck-top, #3a2f52) 0%, var(--c-deck-mid, #241b38) 45%, var(--c-deck-bot, #140e22) 100%);
  border: 2px solid var(--c-deck-edge, #0b0713);
  box-shadow:
    0 -14px 40px rgba(0,0,0,.55),
    inset 0 3px 0 var(--c-trim, rgba(255,214,120,.55)),
    inset 0 -10px 18px rgba(0,0,0,.6),
    inset 0 0 0 4px rgba(255,255,255,.03);
}
.f7-deck::before {
  content: ""; position: absolute; left: 22px; right: 22px; top: 7px; height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--c-trim, rgba(255,214,120,.8)), transparent);
  pointer-events: none;
}
.f7-deck-front {
  height: 16px; margin: 0 6px;
  border-radius: 0 0 14px 14px;
  background: linear-gradient(180deg, var(--c-front-top, #120c1d) 0%, var(--c-front-bot, #07040c) 100%);
  box-shadow: inset 0 2px 0 rgba(255,255,255,.06), 0 6px 10px rgba(0,0,0,.7);
}
.f7-bezel {
  position: relative; flex: none; border-radius: 9999px;
  background: linear-gradient(150deg, #8d8a99 0%, #2a2733 45%, #121018 60%, #5d5a68 100%);
  box-shadow: inset 0 3px 5px rgba(0,0,0,.85), inset 0 -1px 0 rgba(255,255,255,.25), 0 1px 0 rgba(255,255,255,.12);
  transition: box-shadow .2s;
}
.f7-bezel[data-on="true"] {
  box-shadow: inset 0 3px 5px rgba(0,0,0,.85), 0 0 0 2px var(--glow), 0 0 26px 4px var(--glow);
}
.f7-key {
  position: absolute; border-radius: 9999px; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 28%, var(--hi) 0%, var(--mid) 48%, var(--lo) 100%);
  box-shadow:
    0 var(--depth) 0 var(--ledge),
    0 calc(var(--depth) + 5px) 12px rgba(0,0,0,.7),
    inset 0 3px 2px rgb(255 255 255 / var(--c-gloss-rim, .6)),
    inset 0 -6px 10px rgba(0,0,0,.35);
  transition: transform .07s ease-out, box-shadow .07s ease-out, filter .15s;
  cursor: pointer;
}
.f7-key::after {
  content: ""; position: absolute; left: 17%; right: 17%; top: 6%; height: 40%; border-radius: 50%;
  background: linear-gradient(180deg, rgb(255 255 255 / var(--c-gloss, .7)), rgba(255,255,255,0));
  pointer-events: none;
}
.f7-key > * { position: relative; z-index: 1; filter: var(--c-icon-filter, none); }
.f7-key:hover:not(:disabled) { filter: brightness(1.08); }
.f7-key:active:not(:disabled) {
  transform: translateY(calc(var(--depth) - 1px));
  box-shadow: 0 1px 0 var(--ledge), 0 3px 6px rgba(0,0,0,.7), inset 0 3px 2px rgba(255,255,255,.5), inset 0 -3px 8px rgba(0,0,0,.4);
}
.f7-key:disabled { filter: grayscale(.7) brightness(.6); cursor: not-allowed; }
.f7-led {
  position: absolute; top: -13px; left: 50%; width: 12px; height: 12px; margin-left: -6px; border-radius: 9999px;
  background: #2a2633; box-shadow: inset 0 1px 2px rgba(0,0,0,.8);
  transition: background .2s, box-shadow .2s;
}
.f7-bezel[data-on="true"] .f7-led { background: var(--led); box-shadow: 0 0 10px 2px var(--led), inset 0 -1px 2px rgba(0,0,0,.3); }
.f7-spin-socket { margin-top: -54px; }
.f7-lcd {
  position: relative; border-radius: 14px; padding: 6px 18px 8px; overflow: hidden;
  background: linear-gradient(180deg, #04050a 0%, #0d1220 100%);
  border: 2px solid #000;
  box-shadow: inset 0 5px 12px rgba(0,0,0,.95), inset 0 -1px 0 rgba(255,255,255,.08), 0 1px 0 rgba(255,255,255,.14), 0 0 0 3px var(--c-lcd-ring, #1c1628);
}
.f7-lcd::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(170deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 40%);
}
@keyframes f7-rotate { to { transform: rotate(360deg); } }
.f7-rotating { animation: f7-rotate 1.1s linear infinite; }
.f7-spin-icon { display: flex; }
@keyframes f7-pop { from { opacity: 0; transform: translate(-50%, -48%) scale(.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.f7-info-panel { animation: f7-pop .18s ease-out both; }
`;

type KeyTone = "chrome" | "blue" | "cyan" | "violet" | "spin";

const TONES: Record<KeyTone, { hi: string; mid: string; lo: string; ledge: string; glow: string; led: string }> = {
  chrome: { hi: "#ffffff", mid: "#d9d8e0", lo: "#8b8996", ledge: "#3a3844", glow: "rgba(255,255,255,.55)", led: "#f87171" },
  blue: { hi: "#bfdbfe", mid: "#3b82f6", lo: "#1d3fa8", ledge: "#172554", glow: "rgba(59,130,246,.7)", led: "#60a5fa" },
  cyan: { hi: "#cffafe", mid: "#06b6d4", lo: "#0e6a80", ledge: "#123c4a", glow: "rgba(34,211,238,.8)", led: "#67e8f9" },
  violet: { hi: "#ede9fe", mid: "#8b5cf6", lo: "#5b21b6", ledge: "#2e1065", glow: "rgba(167,139,250,.8)", led: "#c4b5fd" },
  spin: { hi: "#fff1b8", mid: "#f59e0b", lo: "#c2410c", ledge: "#6c2108", glow: "rgba(251,191,36,.8)", led: "#fde68a" },
};

function ConsoleKey({
  tone,
  colors,
  size,
  depth = 6,
  on,
  disabled = false,
  ariaLabel,
  onClick,
  children,
}: {
  tone: KeyTone;
  /** Overrides the tone's colours (from a SlotConsoleTheme). */
  colors?: KeyToneColors;
  size: number;
  depth?: number;
  /** Toggle state — undefined for plain push buttons (no LED shown). */
  on?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const t = colors ?? TONES[tone];
  const ring = Math.round(size * 0.075);
  const vars = {
    "--hi": t.hi,
    "--mid": t.mid,
    "--lo": t.lo,
    "--ledge": t.ledge,
    "--glow": t.glow,
    "--led": t.led,
    "--depth": `${depth}px`,
  } as CSSProperties;
  return (
    <div className="f7-bezel" data-on={on ? "true" : "false"} style={{ ...vars, width: size + ring * 2, height: size + ring * 2 + depth }}>
      {on !== undefined && <span className="f7-led" />}
      <button
        type="button"
        className="f7-key"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={on}
        style={{ left: ring, top: ring, width: size, height: size }}
      >
        {children}
      </button>
    </div>
  );
}

function LcdDisplay({ label, value, color, big = false, className = "" }: { label: string; value: string; color: string; big?: boolean; className?: string }) {
  return (
    <div className={`f7-lcd flex flex-col items-center leading-tight ${className}`}>
      <span className="text-[15px] font-bold uppercase tracking-[0.25em] text-white/55">{label}</span>
      <span className={`${big ? "text-[50px]" : "text-[34px]"} font-black tabular-nums leading-none`} style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function MinusPlusIcon({ plus }: { plus: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" stroke="#1f1b2b" strokeWidth="4" strokeLinecap="round">
      <path d="M5 12h14" />
      {plus && <path d="M12 5v14" />}
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24">
      <path d="M13.5 2 4.5 13.5h6L9.5 22l10-12.5h-6.2L13.5 2Z" fill="#fff" stroke="#0e4a5a" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function AutoIcon({ spinning = false, size = 32 }: { spinning?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "f7-rotating" : undefined}
    >
      <path d="M20 11a8 8 0 0 0-14.3-4.9" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}
