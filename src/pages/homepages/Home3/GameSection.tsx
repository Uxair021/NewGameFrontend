import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EmblaCarouselType } from "embla-carousel";
import { GameCarousel } from "./GameCarousel";
import { GameCard } from "./GameCard";
import { PopularGame } from "./data";

interface GameSectionProps {
  games: PopularGame[];
  viewAll?: boolean;
}

export function GameSection({ games, viewAll = false }: GameSectionProps) {
  const reduceMotion = useReducedMotion();
  const emblaRef = useRef<EmblaCarouselType | null>(null);

  if (!games?.length) return null;

  return (
    <motion.section
      initial={reduceMotion ? undefined : { opacity: 0, y: 24 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mx-auto w-full max-w-8xl px-3 sm:px-3 lg:px-5"
    >
      <GameCarousel
        items={games}
        navRef={viewAll ? emblaRef : undefined}
        renderItem={(game) => (
          <GameCard game={game} />
        )}
      />
    </motion.section>
  );
}
