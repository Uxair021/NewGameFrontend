import { CSSProperties, ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { House, Info, Volume2, VolumeX } from "lucide-react";
import { GAME_EXIT_PATH } from "./gameExit";
import { SoundSettingsPopup, isSilent, useSoundSettings } from "./SoundSettings";

/** Colours for one game's menu, so it matches that game's own art. */
export interface GameMenuTheme {
  panel: string;
  panelBorder: string;
  /** Rim around each round button. */
  faceBorder: string;
  /** Dark outline behind the white icons. */
  iconShadow: string;
  faces: { home: string; sound: string; info: string };
}

/** Buffalo 777 — desert palette: dark wood panel, gold rim, gold / copper / red-brown buttons. */
export const BUFFALO_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(122,72,24,0.96), rgba(52,27,8,0.97))",
  panelBorder: "rgba(255,205,110,0.75)",
  faceBorder: "rgba(255,225,150,0.85)",
  iconShadow: "rgba(60,20,0,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #fff1b0 0%, #ffc93c 30%, #e08a00 65%, #8a4b00 100%)",
    sound: "radial-gradient(circle at 50% 28%, #ffd2a8 0%, #f6893a 30%, #c4501a 65%, #6e2508 100%)",
    info: "radial-gradient(circle at 50% 28%, #f3b39a 0%, #c0502d 32%, #8a2a12 65%, #4a1206 100%)",
  },
};

/** 777 Fruity — its console's palette: dark purple deck with a gold trim, chrome rims, and the
 * console keys' orange (spin), cyan (fast) and violet (auto). */
export const FRUITY_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(58,47,82,0.97) 0%, rgba(36,27,56,0.97) 45%, rgba(20,14,34,0.98) 100%)",
  panelBorder: "rgba(255,214,120,0.8)",
  faceBorder: "rgba(230,229,238,0.9)",
  iconShadow: "rgba(20,10,40,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #ffe0b8 0%, #fb923c 30%, #ea580c 65%, #7c2d12 100%)",
    sound: "radial-gradient(circle at 50% 28%, #cffafe 0%, #22d3ee 30%, #0891b2 65%, #123c4a 100%)",
    info: "radial-gradient(circle at 50% 28%, #ede9fe 0%, #a78bfa 30%, #7c3aed 65%, #2e1065 100%)",
  },
};

/** Cash Machine — its control bar's deep maroon with pink-gold trim, plus the reels' money green. */
export const CASH_MACHINE_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(110,10,48,0.97) 0%, rgba(65,1,23,0.97) 50%, rgba(30,0,10,0.98) 100%)",
  panelBorder: "rgba(255,210,234,0.8)",
  faceBorder: "rgba(255,226,240,0.9)",
  iconShadow: "rgba(40,0,15,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #fff1b0 0%, #ffc93c 30%, #e08a00 65%, #8a4b00 100%)",
    sound: "radial-gradient(circle at 50% 28%, #d1fae5 0%, #34d399 30%, #059669 65%, #064e3b 100%)",
    info: "radial-gradient(circle at 50% 28%, #ffd2ea 0%, #f472b6 30%, #be185d 65%, #500724 100%)",
  },
};

/** 5x Rewind — the reels' magenta-to-gold frame colours on the control bar's deep maroon. */
export const FIVE_X_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(110,15,70,0.97) 0%, rgba(65,1,23,0.97) 50%, rgba(25,0,10,0.98) 100%)",
  panelBorder: "rgba(252,211,77,0.8)",
  faceBorder: "rgba(255,226,240,0.9)",
  iconShadow: "rgba(40,0,15,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #fff1c2 0%, #fcd34d 30%, #ea580c 65%, #7c2d12 100%)",
    sound: "radial-gradient(circle at 50% 28%, #fce7f3 0%, #f472b6 30%, #be185d 65%, #500724 100%)",
    info: "radial-gradient(circle at 50% 28%, #ede9fe 0%, #a78bfa 30%, #7c3aed 65%, #2e1065 100%)",
  },
};

/** 7 Crystal Clover — the cabinet's emerald glass and gold frame trim. */
export const CRYSTAL_CLOVER_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(6,78,59,0.97) 0%, rgba(2,44,34,0.97) 50%, rgba(1,20,15,0.98) 100%)",
  panelBorder: "rgba(252,211,77,0.8)",
  faceBorder: "rgba(236,253,245,0.9)",
  iconShadow: "rgba(2,30,20,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #fff1b0 0%, #fcd34d 30%, #d97706 65%, #78350f 100%)",
    sound: "radial-gradient(circle at 50% 28%, #d1fae5 0%, #34d399 30%, #059669 65%, #064e3b 100%)",
    info: "radial-gradient(circle at 50% 28%, #cffafe 0%, #22d3ee 30%, #0891b2 65%, #123c4a 100%)",
  },
};

/** Hexa Keno — its felt-green table with the cabinet's orange trim and purple rules screen. */
export const HEXA_KENO_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(33,107,17,0.96) 0%, rgba(9,56,9,0.97) 55%, rgba(0,20,0,0.98) 100%)",
  panelBorder: "rgba(255,191,71,0.8)",
  faceBorder: "rgba(255,241,194,0.9)",
  iconShadow: "rgba(10,30,0,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #ffe0b8 0%, #ff9f1c 30%, #e06a00 65%, #7a3200 100%)",
    sound: "radial-gradient(circle at 50% 28%, #ecfccb 0%, #84cc16 30%, #3f8a0c 65%, #1a3d05 100%)",
    info: "radial-gradient(circle at 50% 28%, #ede9fe 0%, #8b5cf6 30%, #5b21b6 65%, #1a1035 100%)",
  },
};

/** Super Keno Balls — dark gold metal cabinet with its sky-blue accents. */
export const SUPER_KENO_MENU_THEME: GameMenuTheme = {
  panel: "linear-gradient(180deg, rgba(60,45,10,0.97) 0%, rgba(36,26,0,0.97) 45%, rgba(10,8,0,0.98) 100%)",
  panelBorder: "rgba(253,224,71,0.8)",
  faceBorder: "rgba(254,249,195,0.9)",
  iconShadow: "rgba(5,10,18,0.9)",
  faces: {
    home: "radial-gradient(circle at 50% 28%, #fef9c3 0%, #fde047 30%, #f59e0b 65%, #78350f 100%)",
    sound: "radial-gradient(circle at 50% 28%, #e0f2fe 0%, #38bdf8 30%, #0369a1 65%, #0c2a4a 100%)",
    info: "radial-gradient(circle at 50% 28%, #fecaca 0%, #f87171 30%, #b91c1c 65%, #450a0a 100%)",
  },
};

interface GameMenuProps {
  theme: GameMenuTheme;
  /** No longer used — the sound button opens the shared sound settings popup (see
   * SoundSettings.tsx) and its icon follows those settings. Kept so existing callers still compile. */
  muted: boolean;
  onToggleSound: () => void;
  onInfo: () => void;
  onClose: () => void;
  /** Position of the menu panel, in the game's design pixels. */
  style: CSSProperties;
  /** Hide the Home button — for games that already have their own EXIT button. */
  hideHome?: boolean;
}

/** Pop-up menu opened from a game's menu button: Home, sound settings and game info, stacked in a
 * tall pill. Tapping anywhere outside it closes it. Render it inside the game's scaled card. */
export function GameMenu({ theme, onInfo, onClose, style, hideHome = false }: GameMenuProps) {
  const muted = isSilent(useSoundSettings());
  const [soundOpen, setSoundOpen] = useState(false);
  return (
    <>
      {soundOpen && <SoundSettingsPopup onClose={() => setSoundOpen(false)} />}
      <div className="absolute inset-0 z-20" onClick={onClose} aria-hidden />
      <div
        className="absolute z-30 flex flex-col items-center gap-5 rounded-full border-[3px] px-3 py-5"
        style={{
          background: theme.panel,
          borderColor: theme.panelBorder,
          boxShadow: "inset 0 2px 4px rgba(255,255,255,0.18), inset 0 -4px 8px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.6)",
          transformOrigin: "bottom center",
          animation: "gameMenuIn 220ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          ...style,
        }}
        role="menu"
      >
        <style>{`@keyframes gameMenuIn { from { transform: scale(0.6) translateY(30px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>

        {!hideHome && (
          <Link to={GAME_EXIT_PATH} aria-label="Home" role="menuitem">
            <MenuFace theme={theme} face={theme.faces.home}>
              <House size={34} strokeWidth={2.6} />
            </MenuFace>
          </Link>
        )}

        <button type="button" onClick={() => setSoundOpen(true)} aria-label="Sound settings" role="menuitem">
          <MenuFace theme={theme} face={theme.faces.sound} dimmed={muted}>
            {muted ? <VolumeX size={34} strokeWidth={2.6} /> : <Volume2 size={34} strokeWidth={2.6} />}
          </MenuFace>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose();
            onInfo();
          }}
          aria-label="Game rules and information"
          role="menuitem"
        >
          <MenuFace theme={theme} face={theme.faces.info}>
            <Info size={34} strokeWidth={2.6} />
          </MenuFace>
        </button>
      </div>
    </>
  );
}

function MenuFace({
  theme,
  face,
  dimmed = false,
  children,
}: {
  theme: GameMenuTheme;
  face: string;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full text-white transition-transform duration-100 ease-out active:scale-90"
      style={{
        background: face,
        border: `2px solid ${theme.faceBorder}`,
        boxShadow: "inset 0 -5px 8px rgba(0,0,0,0.35), 0 3px 6px rgba(0,0,0,0.55)",
        filter: dimmed ? "grayscale(0.7) brightness(0.8)" : undefined,
      }}
    >
      {/* Glossy highlight across the top of the button. */}
      <span
        className="pointer-events-none absolute left-1/2 top-[5px] h-[26px] w-[48px] -translate-x-1/2 rounded-full"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0))" }}
      />
      <span className="relative" style={{ filter: `drop-shadow(0 2px 1px ${theme.iconShadow})` }}>
        {children}
      </span>
    </span>
  );
}
