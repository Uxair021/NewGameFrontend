import { Assets, Cache, Texture } from "pixi.js";

/* Destroying the Application frees the GPU side (Pixi drops the WebGL context), but Pixi's global
 * texture Cache keeps every texture a game created alive in RAM:
 *  - Assets.load(url) caches by url, so each visited game's art stays decoded forever;
 *  - Texture.from(img | canvas) caches by that element, and since every mount makes fresh
 *    elements, each visit piles up another full copy of the game's art.
 * trackGameTextures() snapshots the cache on mount; the returned release() frees only what was
 * added since, so other games' (or the lobby's) textures are left alone. */

type CacheInternals = { _cache?: Map<unknown, unknown> };

function cacheKeys(): unknown[] {
  const map = (Cache as unknown as CacheInternals)._cache;
  return map ? [...map.keys()] : [];
}

/** Call when a game mounts (before it loads any art); call the returned function on unmount,
 * after the app/scene are destroyed. */
export function trackGameTextures(): () => void {
  const before = new Set(cacheKeys());
  return function releaseGameTextures() {
    const urls: string[] = [];
    for (const key of cacheKeys()) {
      if (before.has(key) || !Cache.has(key)) continue;
      const value = Cache.get(key);
      if (!(value instanceof Texture)) continue;
      if (typeof key === "string") {
        urls.push(key);
      } else if (!value.destroyed) {
        // Texture.from(element) entries remove themselves from the Cache on destroy.
        value.destroy(true);
      }
    }
    if (urls.length > 0) {
      Assets.unload(urls).catch(() => {
        /* already unloaded / never fully loaded — nothing left to free */
      });
    }
  };
}
