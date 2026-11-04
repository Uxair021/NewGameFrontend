import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, TrendingUp, Users, ReceiptText, Zap, Sliders, Radio, ArrowLeft, LogOut, Gauge, Fish, Trophy, LayoutGrid, type LucideIcon } from "lucide-react";
import { GAME_THUMBNAILS } from "../games/thumbnails";
import { useAuth } from "../context/AuthContext";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Game(s) the page controls — their thumbnails replace the icon. */
  games?: string[];
};

const NAV: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/earnings", label: "Earnings", icon: TrendingUp },
  { to: "/admin/users", label: "Players", icon: Users },
  { to: "/admin/balance-report", label: "Balance Report", icon: ReceiptText },
  { to: "/admin/force-outcome", label: "Force Outcome", icon: Zap },
  { to: "/admin/jackpot", label: "Jackpot", icon: Trophy },
  { to: "/admin/lobby-games", label: "Lobby Games", icon: LayoutGrid },
  { to: "/admin/rtp", label: "RTP Control", icon: Sliders },
  { to: "/admin/buffalo-rtp", label: "Buffalo 777 RTP", icon: Gauge, games: ["buffalo-777"] },
  { to: "/admin/fish-game", label: "Fish Game", icon: Fish, games: ["fish-game"] },
  { to: "/admin/sizzling-rtp", label: "Sizzling 7s RTP", icon: Gauge, games: ["sizzling-7s"] },
  { to: "/admin/life-of-luxury-rtp", label: "Life of Luxury RTP", icon: Gauge, games: ["life-of-luxury"] },
  { to: "/admin/the-finer-thing-rtp", label: "Final Thing RTP", icon: Gauge, games: ["the-finer-thing"] },
  { to: "/admin/shamrock-rtp", label: "Shamrock Spin RTP", icon: Gauge, games: ["shamrock-spin"] },
  { to: "/admin/crazy777-rtp", label: "Crazy 777 RTP", icon: Gauge, games: ["crazy-777"] },
  { to: "/admin/5x-rewind-rtp", label: "5x Rewind RTP", icon: Gauge, games: ["5x-rewind"] },
  { to: "/admin/cash-machine-rtp", label: "Cash Machine RTP", icon: Gauge, games: ["cash-machine"] },
  { to: "/admin/crystal-clover-rtp", label: "7 Crystal Clover RTP", icon: Gauge, games: ["crystal-clover"] },
  { to: "/admin/fruity-777-rtp", label: "777 Fruity RTP", icon: Gauge, games: ["fruity-777"] },
  { to: "/admin/gems-deluxe-rtp", label: "Gems Deluxe RTP", icon: Gauge, games: ["gems-deluxe"] },
  { to: "/admin/mega-10x-pay-rtp", label: "Mega 10X Pay RTP", icon: Gauge, games: ["mega-10x-pay"] },
  { to: "/admin/rubber-duck-rtp", label: "Rubber Duck RTP", icon: Gauge, games: ["rubber-duck"] },
  { to: "/admin/vegas-hits-rtp", label: "Vegas Hits RTP", icon: Gauge, games: ["vegas-hits"] },
  { to: "/admin/top-dollar-rtp", label: "Top Dollar RTP", icon: Gauge, games: ["top-dollar"] },
  { to: "/admin/zeus-vs-hades-rtp", label: "Zeus vs Hades RTP", icon: Gauge, games: ["zeus-vs-hades"] },
  { to: "/admin/keno-rtp", label: "Keno RTP", icon: Gauge, games: ["hexa-keno", "super-keno-balls"] },
  { to: "/admin/live-feed", label: "Live Feed", icon: Radio },
];

/** Longest-`to`-first match against the current path, so e.g. "/admin/users/123" still
 * resolves to the "Players" nav entry rather than falling through to nothing. */
function currentSectionLabel(pathname: string): string {
  const match = [...NAV].sort((a, b) => b.to.length - a.to.length).find((item) => pathname.startsWith(item.to));
  return match?.label ?? "Overview";
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col bg-slate-100">
      <div className="flex-shrink-0 border-b border-slate-300 bg-[#D9D9D9] px-6 py-2 text-sm font-medium text-slate-700">
        Admin / {currentSectionLabel(location.pathname)}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-56 flex-shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-sky-50 py-4">
          <nav className="flex flex-1 flex-col gap-1 px-3">
            {NAV.map(({ to, label, icon: Icon, end, games }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    isActive
                      ? "bg-sky-200 font-medium text-sky-800"
                      : "text-slate-600 hover:bg-sky-100 hover:text-slate-800"
                  }`
                }
              >
                {games ? (
                  <span className="flex flex-shrink-0 -space-x-1.5">
                    {games.map((slug) => (
                      <img
                        key={slug}
                        src={GAME_THUMBNAILS[slug]}
                        alt=""
                        className="h-6 w-6 rounded-md border border-white bg-slate-800 object-cover"
                      />
                    ))}
                  </span>
                ) : (
                  <Icon size={16} />
                )}
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-4 flex flex-col gap-1 border-t border-slate-200 px-3 pt-4">
            <Link
              to="/"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-sky-100 hover:text-slate-800"
            >
              <ArrowLeft size={16} />
              Back to lobby
            </Link>
            <div className="px-3 py-1 text-xs text-slate-500">{user?.username}</div>
            <button
              onClick={logout}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-sky-100 hover:text-slate-800"
            >
              <LogOut size={16} />
              Log out
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto overflow-x-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
