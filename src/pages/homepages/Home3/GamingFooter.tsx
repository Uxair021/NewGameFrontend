import { useHomeAuthActions } from "../shared/useHomeAuthActions";
import { HOME_IMAGES } from "../shared/images";

const NAV_ITEMS = [
  { key: "fav", label: "Fav", icon: HOME_IMAGES.fav, size: "w-14 h-14" },
  { key: "all", label: "ALL", icon: HOME_IMAGES.all, size: "w-14 h-14" },
  { key: "reels", label: "Reels", icon: HOME_IMAGES.reels, size: "w-14 h-14" },
  { key: "share", label: "Share", icon: HOME_IMAGES.share, size: "w-18 h-18", big: true },
  { key: "fish", label: "Fish", icon: HOME_IMAGES.fish, size: "w-14 h-14" },
  { key: "other", label: "Other", icon: HOME_IMAGES.others, size: "w-14 h-14" },
  { key: "daily-bonus", label: "Daily Bonus", icon: HOME_IMAGES.dailyBonus, size: "w-14 h-14" },
];

function NavButton({
  label,
  icon,
  size,
  big,
  onClick,
}: {
  label: string;
  icon: string;
  size: string;
  big?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 cursor-pointer flex-col items-center transition-transform duration-150 hover:scale-110 active:scale-90"
    >
      <img src={icon} alt={label} className={`${size} object-contain drop-shadow-[0_3px_5px_rgba(0,0,0,0.6)]`} />
      <span className={`mt-1 whitespace-nowrap font-bold drop-shadow ${big ? "text-sm text-white" : "text-[12px] text-slate-200"}`}>
        {label}
      </span>
    </button>
  );
}

export function GamingFooter() {
  const { requireAuth } = useHomeAuthActions();

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-80">
      <footer className="relative w-full rounded-t-[2.5rem] border border-[color:var(--color-nx-gold)]/20 bg-gradient-to-b from-[color:var(--color-nx-bg)] via-[color:var(--color-nx-surface)] to-[color:var(--color-nx-bg)] shadow-[0_-4px_16px_rgba(0,0,0,0.4)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(147,51,234,0.3),transparent_65%)]" />
        <div className="relative flex items-end justify-around px-4 pb-2">
          {NAV_ITEMS.map(({ key, ...item }) => (
            <NavButton key={key} {...item} onClick={requireAuth()} />
          ))}
        </div>
      </footer>
    </div>
  );
}
