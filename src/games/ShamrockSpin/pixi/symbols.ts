import { Assets, Texture } from "pixi.js";
import { SlotSymbol } from "../api";

const ASSET_BASE = "/symbols/shamrockSpin";

const SYMBOL_FILES: Record<SlotSymbol, string> = {
  SHAMROCK_WILD: "Shamrock Spin.webp",
  SHAMROCK_1: "Shamrock Spin 1.webp",
  SHAMROCK_2: "Shamrock Spin 2.webp",
  SHAMROCK_3: "Shamrock Spin 3.webp",
  SHAMROCK_4: "Shamrock Spin 4.webp",
  GREEN_SEVEN: "Green 7.webp",
  ORANGE_SEVEN: "Orange 7.webp",
  YELLOW_SEVEN: "Yellow 7.webp",
  TRIPLE_BAR: "BAR BAR BAR.webp",
  DOUBLE_BAR: "BAR BAR.webp",
  SINGLE_BAR: "BAR.webp",
};


export async function loadSymbolTextures(): Promise<Record<SlotSymbol, Texture>> {
  const entries = await Promise.all(
    (Object.entries(SYMBOL_FILES) as [SlotSymbol, string][]).map(async ([symbol, file]) => {
      const url = `${ASSET_BASE}/${encodeURIComponent(file)}`;
      return [symbol, await Assets.load<Texture>(url)] as const;
    })
  );
  return Object.fromEntries(entries) as Record<SlotSymbol, Texture>;
}

export async function loadBackgroundTexture(): Promise<Texture> {
  return Assets.load<Texture>(`${ASSET_BASE}/bg.webp`);
}

export async function loadFreeSpinBackgroundTexture(): Promise<Texture> {
  return Assets.load<Texture>(`${ASSET_BASE}/bg_freespin.webp`);
}

export async function loadCharacterTexture(): Promise<Texture> {
  return Assets.load<Texture>(`${ASSET_BASE}/character.webp`);
}

