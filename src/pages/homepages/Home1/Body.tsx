import { GameCarousel } from "./GameCarousel";
import { Footer } from "./Footer";
import { HOME_IMAGES } from "../shared/images";

export function Body() {
  return (
    <main
      className="relative w-full flex-1 overflow-hidden bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${HOME_IMAGES.backgroundBody})` }}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/80" />
      <div className="relative pb-32">
        <GameCarousel />
        <Footer />
      </div>
    </main>
  );
}
