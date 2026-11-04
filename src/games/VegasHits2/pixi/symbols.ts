import { Assets, Texture } from "pixi.js";
import { VegasHitsSymbol } from "../api";

const SYMBOL_PATHS: Record<VegasHitsSymbol, string> = {
  GREEN_7: "/symbols/vegasHit/Green7.webp",
  DOUBLE_GREEN_7: "/symbols/vegasHit/DoubleGreen7.webp",
  TRIPLE_GREEN_7: "/symbols/vegasHit/TripleGreen7.webp",
  RED_7: "/symbols/vegasHit/Red7.webp",
  BLUE_7: "/symbols/vegasHit/Blue7.webp",
  WILD: "/symbols/vegasHit/redHot.webp",
  BONUS: "/symbols/vegasHit/Bonus.webp",
};

export async function loadSymbolTextures(): Promise<Record<VegasHitsSymbol, Texture>> {
  const entries = Object.entries(SYMBOL_PATHS) as [VegasHitsSymbol, string][];
  const textures = await Promise.all(entries.map(([, path]) => Assets.load<Texture>(path)));
  const result = {} as Record<VegasHitsSymbol, Texture>;
  entries.forEach(([symbol], i) => (result[symbol] = textures[i]));
  return result;
}
