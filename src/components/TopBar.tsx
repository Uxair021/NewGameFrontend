import { Coins, LogOut, Menu, Search, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onMenuClick: () => void;
}

export function TopBar({ search, onSearchChange, onMenuClick }: TopBarProps) {
  const { user, logout } = useAuth();

  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-800 bg-slate-950/80 px-3 py-3 backdrop-blur sm:gap-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="shrink-0 rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search games..."
          className="w-full rounded-full border border-slate-700 bg-slate-900 py-2 pl-9 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1.5 sm:px-3">
          <Coins size={14} className="text-amber-400" />
          <span className="text-sm font-bold text-amber-400">{(user?.balance ?? 0).toFixed(2)}</span>
        </div>

        <Link
          to="/panel"
          className="hidden items-center gap-1.5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 px-4 py-1.5 text-sm font-bold text-slate-900 shadow hover:brightness-105 sm:inline-flex"
        >
          My Account
        </Link>

        {user?.role === "admin" && (
          <Link
            to="/admin"
            className="hidden rounded-full border border-indigo-400/40 bg-indigo-500/15 px-4 py-1.5 text-sm font-semibold text-indigo-300 hover:bg-indigo-500/25 md:inline-block"
          >
            Admin
          </Link>
        )}

        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
            aria-label="User menu"
          >
            {user?.username.charAt(0).toUpperCase()}
          </button>

          {open && (
            <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
              <div className="border-b border-slate-700 px-4 py-2 text-sm font-medium text-slate-200">
                {user?.username}
              </div>
              <Link
                to="/panel"
                onClick={() => setOpen(false)}
                className="block w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 sm:hidden"
              >
                My Account
              </Link>
              {user?.role === "admin" && (
                <Link
                  to="/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-left text-sm text-indigo-300 hover:bg-slate-700 md:hidden"
                >
                  <ShieldCheck size={14} />
                  Admin
                </Link>
              )}
              <button
                onClick={() => {
                  setOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-400 hover:bg-slate-700"
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
