import { Link } from "react-router-dom";
import { Coins, Clover, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-800 bg-[#163049] px-3 py-2 sm:flex-nowrap sm:gap-4 sm:px-6 sm:py-3">
      <Link to="/" className="flex shrink-0 items-center gap-1.5 text-base font-bold tracking-wide text-white sm:gap-2 sm:text-lg">
        <Clover size={18} className="shrink-0 text-amber-400 sm:size-5" />
        Texas Slots
      </Link>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 sm:flex-nowrap sm:gap-4">
        {user ? (
          <>
            <span className="flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-xs text-amber-400 sm:px-3 sm:text-sm">
              <Coins size={14} />
              {user.balance.toFixed(2)}
            </span>
            <Link to="/panel" className="text-xs text-slate-300 hover:text-white sm:text-sm">
              {user.username}
            </Link>
            {user.role === "admin" && (
              <Link
                to="/admin"
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 sm:text-sm"
              >
                <ShieldCheck size={14} />
                Admin
              </Link>
            )}
            <button onClick={logout} className="text-xs text-slate-500 hover:text-slate-300 sm:text-sm">
              Log out
            </button>
          </>
        ) : (
          <Link
            to="/login"
            className="rounded-lg bg-gradient-to-b from-amber-400 to-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:brightness-110 sm:px-4 sm:text-sm"
          >
            Log in
          </Link>
        )}
      </div>
    </nav>
  );
}
