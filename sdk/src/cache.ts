export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export interface CacheStatistics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  hitRate: number;
}

export interface CacheConfig {
  ttl: number;
  maxSize?: number;
  storage?: 'memory' | 'localStorage';
  enabled?: boolean;
}

export interface CacheOptions {
  bypass?: boolean;
  forceRefresh?: boolean;
}

export class Cache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private config: Required<CacheConfig>;
  private stats: CacheStatistics;
  private storageKey = 'iln_cache';

  constructor(config: CacheConfig) {
    this.config = {
      ttl: config.ttl,
      maxSize: config.maxSize ?? 1000,
      storage: config.storage ?? 'memory',
      enabled: config.enabled ?? true,
    };
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      hitRate: 0,
    };

    if (this.config.storage === 'localStorage') {
      this.loadFromStorage();
    }
  }

  get(key: string, options?: CacheOptions): T | null {
    if (!this.config.enabled || options?.bypass) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    const entry = this.cache.get(key);
    const now = Date.now();

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    if (entry.expiresAt < now) {
      this.cache.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    if (!options?.forceRefresh) {
      entry.accessCount++;
      entry.lastAccessedAt = now;
      // Move to the end of the Map's iteration order so it reads as most
      // recently used, independent of Date.now() millisecond resolution.
      this.cache.delete(key);
      this.cache.set(key, entry);
      this.stats.hits++;
      this.updateHitRate();
      return entry.value;
    }

    this.stats.misses++;
    this.updateHitRate();
    return null;
  }

  set(key: string, value: T, ttl?: number): void {
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + (ttl ?? this.config.ttl),
      createdAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    };

    // Evict if over size limit
    if (this.config.maxSize && this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
    this.stats.sets++;

    if (this.config.storage === 'localStorage') {
      this.saveToStorage();
    }
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
      if (this.config.storage === 'localStorage') {
        this.saveToStorage();
      }
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    if (this.config.storage === 'localStorage') {
      localStorage.removeItem(this.storageKey);
    }
  }

  invalidate(pattern?: string): number {
    let count = 0;
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.cache.delete(key);
          count++;
        }
      }
    } else {
      count = this.cache.size;
      this.cache.clear();
    }

    if (count > 0 && this.config.storage === 'localStorage') {
      this.saveToStorage();
    }

    return count;
  }

  getStatistics(): CacheStatistics {
    return { ...this.stats };
  }

  resetStatistics(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      hitRate: 0,
    };
  }

  private evictLRU(): void {
    // Map iteration order tracks recency (get() re-inserts touched entries
    // at the end), so the least recently used entry is simply the first one.
    const lruKey = this.cache.keys().next().value ?? null;

    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  private saveToStorage(): void {
    try {
      const serialized = JSON.stringify(Array.from(this.cache.entries()));
      localStorage.setItem(this.storageKey, serialized);
    } catch (error) {
      // Silently fail if localStorage is not available or quota exceeded
    }
  }

  private loadFromStorage(): void {
    try {
      const serialized = localStorage.getItem(this.storageKey);
      if (serialized) {
        const entries = JSON.parse(serialized) as [string, CacheEntry<T>][];
        const now = Date.now();

        for (const [key, entry] of entries) {
          // Only load non-expired entries
          if (entry.expiresAt > now) {
            this.cache.set(key, entry);
          }
        }
      }
    } catch (error) {
      // Silently fail if localStorage is not available
    }
  }

  getSize(): number {
    return this.cache.size;
  }

  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}
