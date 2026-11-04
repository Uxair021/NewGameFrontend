import { motion, useReducedMotion } from "motion/react";
import { HOME_IMAGES } from "../shared/images";
import { PromoAccent, PromoCardData } from "./data";

const BACKGROUNDS: Record<PromoCardData["id"], string> = {
  "daily-bonus": HOME_IMAGES.promo1Bg,
  "vip-club": HOME_IMAGES.promo2Bg,
  "lucky-wheel": HOME_IMAGES.promo3Bg,
};

const ACCENTS: Record<PromoAccent, { scrim: string; title: string; btn: string }> = {
  violet: {
    scrim: "from-[color:var(--color-nx-purple)]/90 via-black/40 to-black/10",
    title: "text-fuchsia-200",
    btn: "bg-[color:var(--color-nx-violet)] text-white hover:brightness-110",
  },
  gold: {
    scrim: "from-amber-800/90 via-black/40 to-black/10",
    title: "text-amber-200",
    btn: "bg-[color:var(--color-nx-gold)] text-slate-900 hover:brightness-110",
  },
  green: {
    scrim: "from-emerald-800/90 via-black/40 to-black/10",
    title: "text-emerald-200",
    btn: "bg-[color:var(--color-nx-green)] text-slate-900 hover:brightness-110",
  },
};

export function PromoCard({ id, title, description, cta, accent, onAction }: PromoCardData & { onAction: () => void }) {
  const bg = BACKGROUNDS[id];
  const a = ACCENTS[accent];
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="relative flex-1 cursor-pointer overflow-hidden rounded border border-white/10 bg-cover bg-center p-4 shadow-[0_4px_10px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-3px_6px_rgba(0,0,0,0.35)]"
      style={{ backgroundImage: `url(${bg})` }}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-t ${a.scrim}`} />

      <div className="relative flex h-full flex-col justify-between">
        <div>
          <h3 className={`font-title text-base font-bold ${a.title}`}>{title}</h3>
          <p className="mt-1 max-w-[9rem] text-xs text-slate-200">{description}</p>
        </div>
        <button
          type="button"
          onClick={onAction}
          className={`mt-3 w-fit cursor-pointer rounded-full px-4 py-1.5 text-xs font-title font-bold transition-transform active:scale-95 ${a.btn}`}
        >
          {cta}
        </button>
      </div>
    </motion.div>
  );
}
