import { ReactNode } from "react";
import { GAME_THUMBNAILS } from "../games/thumbnails";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Slugs of the game(s) this page controls — their thumbnails are shown beside the title. */
  gameSlugs?: string[];
}

export function AdminPageHeader({ title, description, actions, gameSlugs }: AdminPageHeaderProps) {
  const thumbs = (gameSlugs ?? []).map((slug) => GAME_THUMBNAILS[slug]).filter(Boolean);
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        {thumbs.length > 0 && (
          <div className="flex flex-shrink-0 gap-2">
            {thumbs.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                className="h-16 w-16 rounded-xl border border-slate-200 bg-slate-800 object-cover shadow-sm"
              />
            ))}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
          {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
