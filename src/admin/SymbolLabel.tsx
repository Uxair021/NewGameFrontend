import type { ReactNode } from "react";

/** An outcome's symbol image(s) followed by its name, for the RTP pages' frequency/payout
 * tables. Pass the same image more than once to show a count (e.g. 2 cherries). */
export function SymbolLabel({ images, children }: { images?: readonly string[]; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {images && images.length > 0 && (
        <span className="flex flex-shrink-0 gap-0.5">
          {images.map((src, i) => (
            <img key={i} src={src} alt="" className="h-8 w-8 rounded bg-slate-100 object-contain" />
          ))}
        </span>
      )}
      <span>{children}</span>
    </div>
  );
}
