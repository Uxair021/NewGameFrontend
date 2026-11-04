import { Texture } from "pixi.js";
import { VegasHitsSymbol } from "../api";
import { makeFittedTexture } from "../../shared/pixi/scaledTexture";

/** Longest side (px) every symbol texture is sized to on load. Reel cells display
 * symbols at ~200-260px on typical screens. 320px keeps them crisp there with
 * supersampling while saving uncompressed GPU and CPU memory and immediately releasing
 * source Image bitmaps from RAM. */
export const SYMBOL_TEXTURE_SIZE = 320;

const SYMBOL_PATHS: Record<VegasHitsSymbol, string> = {
  GREEN_7: "/symbols/vegasHit/Green7.webp",
  DOUBLE_GREEN_7: "/symbols/vegasHit/DoubleGreen7.webp",
  TRIPLE_GREEN_7: "/symbols/vegasHit/TripleGreen7.webp",
  RED_7: "/symbols/vegasHit/Red7.webp",
  BLUE_7: "/symbols/vegasHit/Blue7.webp",
  WILD: "/symbols/vegasHit/redHot.webp",
  BONUS: "/symbols/vegasHit/Bonus.webp",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load symbol image: ${url}`));
    img.src = url;
  });
}

export async function loadSymbolTextures(): Promise<Record<VegasHitsSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_PATHS) as [VegasHitsSymbol, string][]).map(async ([symbol, path]) => {
      const img = await loadImage(path);
      const isScaled = img.naturalWidth > SYMBOL_TEXTURE_SIZE || img.naturalHeight > SYMBOL_TEXTURE_SIZE;
      const texture = makeFittedTexture(img, SYMBOL_TEXTURE_SIZE);
      if (isScaled) {
        // Immediately detach the decoded image from memory
        img.src = "";
      }
      return [symbol, texture] as const;
    })
  );
  return Object.fromEntries(entries) as Record<VegasHitsSymbol, Texture>;
}
