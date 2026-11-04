import { useMemo } from "react";
import { useHomeAuthActions } from "../shared/useHomeAuthActions";
import { ClickGlow } from "../shared/ClickGlow";
import { HOME_IMAGES } from "../shared/images";
import { GamingHeader } from "./GamingHeader";
import { GamingFooter } from "./GamingFooter";
import { HeroSection } from "./HeroSection";
import { PromoGrid } from "./PromoGrid";
import { GameSection } from "./GameSection";
import { PopularGame } from "./data";
import { useVisibleLobbyGames } from "../../../api/lobbyApi";
import { GAME_THUMBNAILS } from "../../../games/thumbnails";

/** Ported from GameFun's /new-home — a modular "premium gaming" dashboard layout (hero +
 * promo cards, a Popular Games carousel, its own purple/gold palette). Wired to this app's own
 * auth (see useHomeAuthActions) instead of the source project's login modal. */
export function Home3Page() {
  const { requireAuth } = useHomeAuthActions();
  const deposit = requireAuth();
  // The live lobby list — the admin's Lobby Games page controls which cards show and their badges.
  const lobbyGames = useVisibleLobbyGames();
  const popularGames = useMemo<PopularGame[]>(
    () =>
      lobbyGames.map(({ game, tag }) => ({
        id: game.slug,
        title: game.name,
        image: GAME_THUMBNAILS[game.slug],
        gradient: game.thumbnailGradient,
        icon: game.icon,
        badge: tag,
        comingSoon: game.status === "coming-soon",
      })),
    [lobbyGames]
  );

  return (
    <div className="flex min-h-screen flex-col font-ui text-slate-100">
      <GamingHeader />

      <main
        className="relative flex-1 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${HOME_IMAGES.gamingBackground})` }}
      >
        <div className="pointer-events-none absolute inset-0 bg-black/85" />

        <div className="relative flex flex-col gap-4 py-3 pb-28 sm:gap-7 sm:py-4">
          {/* Hero + promotional cards share one row, like a dashboard "spotlight" band */}
          <section className="mx-auto w-full max-w-8xl px-3 sm:px-3 lg:px-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2.5fr_2fr]">
              <HeroSection onDeposit={deposit} />
              <PromoGrid onAction={deposit} />
            </div>
          </section>

          <div id="popular-games">
            <GameSection games={popularGames} viewAll />
          </div>
        </div>

        <GamingFooter />
      </main>

      <ClickGlow />
    </div>
  );
}
