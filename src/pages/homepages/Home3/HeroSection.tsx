import { motion, useReducedMotion } from "motion/react";
import { PixiBackground } from "./PixiBackground";
import { HOME_IMAGES } from "../shared/images";

export function HeroSection({ onDeposit }: { onDeposit: () => void }) {
  const reduceMotion = useReducedMotion();

  const fadeUp = (delay = 0) =>
    reduceMotion
      ? {}
      : ({
          initial: { opacity: 0, y: 20 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, delay, ease: "easeOut" },
        } as const);

  return (
    <div
      className="relative h-full cursor-pointer overflow-hidden rounded-md border border-white/10 bg-cover bg-center"
      style={{ backgroundImage: `url(${HOME_IMAGES.heroBg})` }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/20" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_20%,rgba(147,51,234,0.35),transparent_60%)]" />
      <PixiBackground className="opacity-30" />

      <div className="relative flex h-full items-center px-3 py-3 sm:px-5 sm:py-5">
        <div>
          <motion.h1 {...fadeUp(0.08)} className="mt-1 font-title text-3xl font-bold leading-[1.1] text-slate-50 sm:text-4xl lg:text-5xl">
            Ready to Win <span className="text-[color:var(--color-nx-gold)]">Big Today?</span>
          </motion.h1>

          <motion.p {...fadeUp(0.16)} className="mt-1 max-w-sm text-sm text-slate-300 sm:text-base">
            Play your favorite games &amp; win amazing rewards!
          </motion.p>

          <motion.div {...fadeUp(0.24)} className="mt-7 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onDeposit}
              className="flex items-center gap-2 rounded-md bg-gradient-to-r from-[color:var(--color-nx-gold)] to-amber-400 px-6 py-3 font-title text-sm font-bold text-slate-900 shadow-[0_0_20px_rgba(245,185,66,0.35)] transition-transform active:scale-95"
            >
              Play Now
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
