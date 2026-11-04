/** Each game's card thumbnail, by slug — used by the lobby cards and the admin RTP pages. */
import shamrockSpinThumbnail from "/symbols/shamrockSpin/thumbnail.webp";
import cashMachineThumbnail from "/symbols/moneyMachine/thumbnail.webp";
import buffalo777Thumbnail from "/symbols/buffalo777/thumbnail.png";
import crazy777Thumbnail from "/symbols/carzy777/thumnail.webp";
import fivexRewindThumbnail from "/symbols/5xRewind/thumbnail.webp";
import sizzlingThumbnail from "/symbols/sizzling7s/thumbnail.webp";
import crystalCloverThumbnail from "/symbols/crystalClover/thumbnail.webp";
import fruity777Thumbnail from "/symbols/fruity777/thumbnail.webp";
import mega10xPayThumbnail from "/symbols/mega10x/thumbnail.webp";
import vegasHitsThumbnail from "/symbols/vegasHit/thumbnail.webp";
import lifeOfLuxuryThumbnail from "/symbols/lifeOfLuxury/thumbnail.webp";
import theFinerThingThumbnail from "/symbols/theFinerThing/thumbnail.webp";
import rubberDuckThumbnail from "/symbols/rubberDuck/thumbnail.webp";
// No dedicated thumbnail.png shipped for this game yet — reusing the Top Dollar logo medallion
// as a reasonable stand-in until a real card thumbnail is provided.
import topDollarThumbnail from "/symbols/dollarGame/thumbnail.webp";

// Gems Deluxe is a duplicate of Top Dollar reskinned under a new name — reuses the same
// placeholder thumbnail (frontEnd/public/symbols/gemsDeluxe/) until real gem art is provided.
import gemsDeluxeThumbnail from "/symbols/gemsDeluxe/thumbnail.webp";

import hexaKenoThumbnail from "/symbols/hexaKeno/thumbnail.png";
import superKenoBallsThumbnail from "/symbols/superKenoBall/thumbnail.png";

import fishGameThumbanail from "/symbols/fishGame/thumbnail.png";
import zeusVsHadesThumbnail from "/symbols/zeusVsHades/thumnail.png";

export const GAME_THUMBNAILS: Record<string, string> = {
  "shamrock-spin": shamrockSpinThumbnail,
  "cash-machine": cashMachineThumbnail,
  "buffalo-777": buffalo777Thumbnail,
  "crazy-777": crazy777Thumbnail,
  "5x-rewind": fivexRewindThumbnail,
  "sizzling-7s": sizzlingThumbnail,
  "crystal-clover": crystalCloverThumbnail,
  "fruity-777": fruity777Thumbnail,
  "mega-10x-pay": mega10xPayThumbnail,
  "vegas-hits": vegasHitsThumbnail,
  "life-of-luxury": lifeOfLuxuryThumbnail,
  "the-finer-thing": theFinerThingThumbnail,
  "rubber-duck": rubberDuckThumbnail,
  "top-dollar": topDollarThumbnail,

  "gems-deluxe": gemsDeluxeThumbnail,

  "hexa-keno": hexaKenoThumbnail,
  "super-keno-balls": superKenoBallsThumbnail,
  "fish-game": fishGameThumbanail,
  "zeus-vs-hades": zeusVsHadesThumbnail,
};
