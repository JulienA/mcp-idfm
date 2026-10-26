import { LRUCache } from "lru-cache";

const REFERENTIAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ReferentialCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
};

export function createReferentialCache<T extends {}>(
  epochMs: () => number,
): ReferentialCache<T> {
  const cache = new LRUCache<string, T>({
    ttl: REFERENTIAL_TTL_MS,
    ttlAutopurge: true,
    ttlResolution: 0,
    perf: { now: epochMs },
  });
  return {
    get: (key) => {
      if (cache.getRemainingTTL(key) <= 0) {
        cache.delete(key);
        return undefined;
      }
      return cache.get(key);
    },
    set: (key, value) => {
      cache.set(key, value);
    },
  };
}
