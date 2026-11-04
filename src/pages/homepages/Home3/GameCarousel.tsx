import { useCallback, useEffect, useState, MutableRefObject, ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { EmblaCarouselType } from "embla-carousel";
import { PopularGame } from "./data";

interface GameCarouselProps {
  items: PopularGame[];
  renderItem: (item: PopularGame) => ReactNode;
  navRef?: MutableRefObject<EmblaCarouselType | null>;
}

export function GameCarousel({ items, renderItem, navRef }: GameCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", dragFree: true, containScroll: "trimSnaps" }, [
    Autoplay({ delay: 4500, stopOnInteraction: true, stopOnMouseEnter: true }),
  ]);

  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const onSelect = useCallback((api: EmblaCarouselType) => {
    setCanPrev(api.canScrollPrev());
    setCanNext(api.canScrollNext());
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    if (navRef) navRef.current = emblaApi;
  }, [emblaApi, onSelect, navRef]);

  // Let a mouse wheel anywhere on the page drive this carousel, same as /home1's own carousel —
  // the page itself never scrolls. Mouse-drag and touch swipe are already handled natively by
  // Embla's drag engine.
  useEffect(() => {
    if (!emblaApi) return;
    let locked = false;
    const handleWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 2) return;
      e.preventDefault();
      if (locked) return;
      locked = true;
      if (delta > 0) emblaApi.scrollNext();
      else emblaApi.scrollPrev();
      window.setTimeout(() => {
        locked = false;
      }, 300);
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [emblaApi]);

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-4 px-1">
          {items.map((item) => (
            <div key={item.id} className="flex">
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>

      {!navRef && (
        <>
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => emblaApi?.scrollPrev()}
            disabled={!canPrev}
            className="absolute -left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-[color:var(--color-nx-surface-2)]/90 text-slate-200 shadow-lg backdrop-blur-sm transition-opacity hover:text-white disabled:opacity-0 sm:flex"
          >
            <FaChevronLeft className="text-xs" />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => emblaApi?.scrollNext()}
            disabled={!canNext}
            className="absolute -right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-[color:var(--color-nx-surface-2)]/90 text-slate-200 shadow-lg backdrop-blur-sm transition-opacity hover:text-white disabled:opacity-0 sm:flex"
          >
            <FaChevronRight className="text-xs" />
          </button>
        </>
      )}
    </div>
  );
}
