export interface IdempotencyStore {
  has(id: string): Promise<boolean>;
  add(id: string): Promise<void>;
}

class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly ids = new Set<string>();

  async has(id: string): Promise<boolean> {
    return this.ids.has(id);
  }

  async add(id: string): Promise<void> {
    this.ids.add(id);
  }
}

export class EventDeduplicator {
  private readonly bits: Uint8Array;
  private readonly size: number;
  private readonly hashes: number;
  private readonly store: IdempotencyStore;
  private readonly inFlight = new Set<string>();

  constructor(options: { size?: number; hashes?: number; store?: IdempotencyStore } = {}) {
    this.size = Math.max(8, options.size ?? 1 << 20);
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
    this.hashes = Math.max(1, options.hashes ?? 3);
    this.store = options.store ?? new MemoryIdempotencyStore();
  }

  async isDuplicate(id: string): Promise<boolean> {
    if (this.inFlight.has(id)) return true;
    let maybePresent = true;
    for (let i = 0; i < this.hashes; i++) {
      if (!this.getBit(this.hash(id, i))) {
        maybePresent = false;
        break;
      }
    }
    return maybePresent ? this.store.has(id) : false;
  }

  async mark(id: string): Promise<void> {
    if (await this.store.has(id)) return;
    this.inFlight.add(id);
    try {
      await this.store.add(id);
      for (let i = 0; i < this.hashes; i++) this.setBit(this.hash(id, i));
    } finally {
      this.inFlight.delete(id);
    }
  }

  private hash(value: string, seed: number): number {
    let hash = 2166136261 ^ seed;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % this.size;
  }

  private getBit(index: number): boolean {
    return (this.bits[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
  }

  private setBit(index: number): void {
    this.bits[Math.floor(index / 8)] |= 1 << (index % 8);
  }
}
