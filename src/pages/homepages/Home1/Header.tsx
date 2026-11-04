import { useState } from "react";
import { useHomeAuthActions } from "../shared/useHomeAuthActions";
import { initialsOf } from "../shared/initials";
import { HOME_IMAGES } from "../shared/images";

const PILL_SHADOW =
  "shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.12),inset_0_-3px_6px_rgba(0,0,0,0.6)]";
const PILL_TEXTURE = {
  backgroundColor: "#0b0b0f",
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 8px)",
};

function StatValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="font-stats cursor-pointer select-none whitespace-nowrap text-2xl font-bold text-white"
      onClick={() => setVisible((v) => !v)}
    >
      {visible ? value : "*****"}
    </span>
  );
}

function StatPill({ icon, value, alt, onClick }: { icon: string; value: string; alt: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex h-14 w-40 cursor-pointer items-center gap-2 rounded-lg border-2 border-amber-400 ps-2 pe-5 py-1 ${PILL_SHADOW}`}
      style={PILL_TEXTURE}
    >
      <img src={icon} alt={alt} className="h-10 w-10 shrink-0 object-contain" />
      <StatValue value={value} />
    </div>
  );
}

function IconTile({
  src,
  alt,
  size = "w-18 h-18",
  onClick,
}: {
  src: string;
  alt: string;
  size?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex shrink-0 cursor-pointer flex-col items-center transition-transform active:scale-90">
      <img src={src} alt={alt} className={`${size} object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]`} />
    </button>
  );
}

export function Header() {
  const { user, requireAuth, goToDashboard } = useHomeAuthActions();

  return (
    <header className="sticky top-0 z-40 w-full overflow-hidden border-y-2 border-amber-500/80 bg-gradient-to-r from-indigo-950 via-fuchsia-800 to-indigo-950 px-24 shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_35%_50%,rgba(217,70,239,0.35),transparent_65%)]" />

      <div className="homepages-scrollbar-thin relative flex items-center gap-6 overflow-x-auto px-4">
        {/* Avatar */}
        <div
          onClick={requireAuth(goToDashboard)}
          className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded border border-amber-400 bg-gradient-to-b from-violet-800 via-purple-800 to-indigo-900 shadow-lg"
        >
          {user ? (
            <div className="flex h-full w-full items-center justify-center font-title text-lg font-bold text-white">
              {initialsOf(user.username)}
            </div>
          ) : (
            <img src={HOME_IMAGES.gameUserAvatar} alt="Game user avatar" className="h-full w-full object-cover" />
          )}
        </div>

        {/* Stats */}
        <div className="ms-3 flex shrink-0 items-center gap-10">
          <StatPill
            icon={HOME_IMAGES.amount}
            alt="Amount"
            value={user ? user.balance.toFixed(2) : "45,230"}
            onClick={requireAuth()}
          />
          <StatPill icon={HOME_IMAGES.level} alt="Level" value="Lv 25" onClick={requireAuth()} />
        </div>

        {/* Buy / Deal buttons */}
        <div className="absolute left-1/2 ms-3 flex -translate-x-1/2 items-center gap-8">
          <button
            type="button"
            onClick={requireAuth()}
            className="relative cursor-pointer overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-orange-400 via-orange-500 to-red-600 px-12 py-3 font-title text-2xl font-extrabold text-white shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-3px_6px_rgba(0,0,0,0.35)] transition-transform active:scale-95"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
            <span className="relative">BUY</span>
          </button>
          <button
            type="button"
            onClick={requireAuth()}
            className="relative cursor-pointer overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-b from-sky-400 to-blue-600 px-12 py-3 font-title text-2xl font-extrabold text-white shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-3px_6px_rgba(0,0,0,0.35)] transition-transform active:scale-95"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
            <span className="relative">DEAL</span>
          </button>
        </div>

        {/* Right-side icon actions */}
        <div className="ml-auto flex cursor-pointer items-center gap-7">
          <IconTile src={HOME_IMAGES.bonusReward} alt="Bonus reward" size="w-17 h-17" onClick={requireAuth()} />
          <IconTile src={HOME_IMAGES.cashPrize} alt="Cash prize" size="w-21 h-21" onClick={requireAuth()} />
          <IconTile src={HOME_IMAGES.settings} alt="Settings" size="w-14 h-14" onClick={requireAuth()} />
          <IconTile src={HOME_IMAGES.trophy} alt="Trophy" size="w-16 h-16" onClick={requireAuth()} />
          <IconTile src={HOME_IMAGES.notification} alt="Notification" size="w-14 h-14" onClick={requireAuth()} />
        </div>
      </div>
    </header>
  );
}
