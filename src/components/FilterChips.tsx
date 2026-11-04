const FILTERS: { id: "all" | "HOT" | "NEW"; label: string }[] = [
  { id: "all", label: "All Games" },
  { id: "HOT", label: "🔥 Popular" },
  { id: "NEW", label: "✨ New" },
];

interface FilterChipsProps {
  active: "all" | "HOT" | "NEW";
  onSelect: (filter: "all" | "HOT" | "NEW") => void;
}

export function FilterChips({ active, onSelect }: FilterChipsProps) {
  return (
    <div className="flex gap-2">
      {FILTERS.map((f) => {
        const isActive = active === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-indigo-500 text-white"
                : "bg-slate-900 text-slate-400 ring-1 ring-slate-700 hover:text-slate-100"
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
