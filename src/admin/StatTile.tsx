import { LucideIcon } from "lucide-react";

interface StatTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: "amber" | "indigo" | "emerald" | "rose";
}

const ACCENT_CLASSES: Record<NonNullable<StatTileProps["accent"]>, string> = {
  amber: "text-amber-400 bg-amber-400/10",
  indigo: "text-indigo-400 bg-indigo-400/10",
  emerald: "text-emerald-400 bg-emerald-400/10",
  rose: "text-rose-400 bg-rose-400/10",
};

export function StatTile({ label, value, icon: Icon, accent = "indigo" }: StatTileProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${ACCENT_CLASSES[accent]}`}>
        <Icon size={20} />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-lg font-bold text-slate-800">{value}</div>
      </div>
    </div>
  );
}
