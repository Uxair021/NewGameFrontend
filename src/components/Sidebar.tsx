import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { CATEGORIES, type GameCategory } from "../games/registry";
import Logo from "../../public/logo/logo.png"

interface SidebarProps {
  active: "all" | GameCategory;
  onSelect: (category: "all" | GameCategory) => void;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ active, onSelect, open, onClose }: SidebarProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950 px-3 py-5 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:w-56 lg:translate-x-0 lg:bg-slate-950/60 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center justify-between px-2">
          <Link to="/" className="flex flex-1 items-center justify-center gap-2 text-lg font-black text-white">
          <img src={Logo} alt="Texas Slots" width={60} />
            <div className="flex flex-col gap-0">
              <span className="text-amber-400 leading-none">Texas</span>Slots
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {CATEGORIES.map((cat) => {
            const isActive = active === cat.id;
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  onSelect(cat.id);
                  onClose();
                }}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-400/40"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                }`}
              >
                <Icon size={20} />
                {cat.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-500">
          Play responsibly. 18+
        </div>
      </aside>
    </>
  );
}
