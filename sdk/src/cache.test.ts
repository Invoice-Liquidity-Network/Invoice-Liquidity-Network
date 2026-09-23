import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cache } from './cache';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache({ ttl: 1000, maxSize: 10, enabled: true });
  });

  describe('Basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should delete values', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeNull();
    });

    it('should return false when deleting non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 100);
      expect(cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(cache.get('key1')).toBeNull();
    });

    it('should use default TTL when not specified', async () => {
      const shortCache = new Cache({ ttl: 100, enabled: true });
      shortCache.set('key1', 'value1');
      expect(shortCache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(shortCache.get('key1')).toBeNull();
    });
  });

  describe('Cache options', () => {
    it('should bypass cache when bypass option is true', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1', { bypass: true })).toBeNull();
    });

    it('should force refresh when forceRefresh option is true', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1', { forceRefresh: true })).toBeNull();
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      cache.resetStatistics();
    });

    it('should track hits', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      const stats = cache.getStatistics();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should track misses', () => {
      cache.get('nonexistent');
      const stats = cache.getStatistics();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should track sets', () => {
      cache.set('key1', 'value1');
      const stats = cache.getStatistics();
      expect(stats.sets).toBe(1);
    });

    it('should track deletes', () => {
      cache.set('key1', 'value1');
      cache.delete('key1');
      const stats = cache.getStatistics();
      expect(stats.deletes).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key2'); // miss
      const stats = cache.getStatistics();
      expect(stats.hitRate).toBe(0.5);
    });

    it('should reset statistics', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.resetStatistics();
      const stats = cache.getStatistics();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      const smallCache = new Cache({ ttl: 10000, maxSize: 3, enabled: true });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3');

      // Access key1 to make it recently used
      smallCache.get('key1');

      // Add key4, should evict key2 (least recently used)
      smallCache.set('key4', 'value4');

      expect(smallCache.get('key1')).toBe('value1');
      expect(smallCache.get('key2')).toBeNull();
      expect(smallCache.get('key3')).toBe('value3');
      expect(smallCache.get('key4')).toBe('value4');

      const stats = smallCache.getStatistics();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('Invalidation', () => {
    it('should invalidate all entries when no pattern provided', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const count = cache.invalidate();
      expect(count).toBe(2);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should invalidate entries matching pattern', () => {
      cache.set('invoice:1', 'value1');
      cache.set('invoice:2', 'value2');
      cache.set('user:1', 'value3');

      const count = cache.invalidate('invoice:');
      expect(count).toBe(2);
      expect(cache.get('invoice:1')).toBeNull();
      expect(cache.get('invoice:2')).toBeNull();
      expect(cache.get('user:1')).toBe('value3');
    });
  });

  describe('Disabled cache', () => {
    it('should not store values when disabled', () => {
      const disabledCache = new Cache({ ttl: 1000, enabled: false });
      disabledCache.set('key1', 'value1');
      expect(disabledCache.get('key1')).toBeNull();
    });

    it('should not track statistics when disabled', () => {
      const disabledCache = new Cache({ ttl: 1000, enabled: false });
      disabledCache.set('key1', 'value1');
      disabledCache.get('key1');
      const stats = disabledCache.getStatistics();
      expect(stats.hits).toBe(0);
      expect(stats.sets).toBe(0);
    });
  });

  describe('Utility methods', () => {
    it('should return cache size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.getSize()).toBe(2);
    });

    it('should return all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      const keys = cache.getKeys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys.length).toBe(2);
    });
  });

  describe('localStorage integration', () => {
    beforeEach(() => {
      // Mock localStorage
      const localStorageMock = (() => {
        let store: Record<string, string> = {};
        return {
          getItem: (key: string) => store[key] || null,
          setItem: (key: string, value: string) => {
            store[key] = value;
          },
          removeItem: (key: string) => {
            delete store[key];
          },
          clear: () => {
            store = {};
          },
        };
      })();
      globalThis.localStorage = localStorageMock as any;
    });

    it('should save to localStorage when storage is localStorage', () => {
      const storageCache = new Cache({ ttl: 1000, storage: 'localStorage', enabled: true });
      storageCache.set('key1', 'value1');
      // Should not throw
    });

    it('should load from localStorage on initialization', () => {
      const storageCache = new Cache({ ttl: 1000, storage: 'localStorage', enabled: true });
      storageCache.set('key1', 'value1');

      const newCache = new Cache({ ttl: 1000, storage: 'localStorage', enabled: true });
      expect(newCache.get('key1')).toBe('value1');
    });

    it('should handle localStorage errors gracefully', () => {
      const storageCache = new Cache({ ttl: 1000, storage: 'localStorage', enabled: true });
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw
      storageCache.set('key1', 'value1');
    });
  });
});
