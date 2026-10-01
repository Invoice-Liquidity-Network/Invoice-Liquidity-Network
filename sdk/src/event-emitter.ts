import type { ContractEvent } from './types';
export type { ContractEvent };

export type InvoiceEventType = 'submitted' | 'funded' | 'paid' | 'defaulted';
export type WalletEventType = 'connected' | 'disconnected';
export type ErrorEventType = 'simulation_failed' | 'submission_failed' | 'network_error';

export interface InvoiceEventData {
  invoiceId: bigint;
  freelancer?: string;
  payer?: string;
  funder?: string;
  amount?: bigint;
  txHash?: string;
  timestamp: number;
}

export interface WalletEventData {
  address: string;
  network?: string;
  timestamp: number;
}

export interface ErrorEventData {
  code: string;
  message: string;
  operation?: string;
  timestamp: number;
}

export type EventData = InvoiceEventData | WalletEventData | ErrorEventData;

export interface EventEmitterEvent {
  category: 'invoice' | 'wallet' | 'error' | 'contract';
  type: string;
  data: EventData | ContractEvent;
  timestamp: number;
}

export type EventListener<T extends EventData = EventData> = (data: T) => void | Promise<void>;

export interface EventHistoryEntry {
  category: string;
  type: string;
  data: EventData | ContractEvent;
  timestamp: number;
}

export class ILNEventEmitter {
  private listeners: Map<string, Set<EventListener>> = new Map();
  private history: EventHistoryEntry[] = [];
  private maxHistorySize: number;

  constructor(options?: { maxHistorySize?: number }) {
    this.maxHistorySize = options?.maxHistorySize ?? 100;
  }

  on<T extends EventData = EventData>(eventType: string, listener: EventListener<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as EventListener);

    return () => {
      this.off(eventType, listener as EventListener);
    };
  }

  off(eventType: string, listener: EventListener): void {
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  once<T extends EventData = EventData>(eventType: string, listener: EventListener<T>): () => void {
    const wrapper: EventListener<T> = (data) => {
      this.off(eventType, wrapper as EventListener);
      listener(data);
    };
    return this.on(eventType, wrapper);
  }

  emitInvoice(type: InvoiceEventType, data: InvoiceEventData): void {
    this.recordEvent('invoice', type, data);
    this.notifyListeners(`invoice:${type}`, data);
  }

  emitWallet(type: WalletEventType, data: WalletEventData): void {
    this.recordEvent('wallet', type, data);
    this.notifyListeners(`wallet:${type}`, data);
  }

  emitError(type: ErrorEventType, data: ErrorEventData): void {
    this.recordEvent('error', type, data);
    this.notifyListeners(`error:${type}`, data);
    this.notifyListeners('error:*', data);
  }

  emitContract(event: ContractEvent): void {
    this.recordEvent('contract', event.type, event);
    this.notifyListeners(`contract:${event.type}`, event);
  }

  emit(category: string, type: string, data: EventData | ContractEvent): void {
    this.recordEvent(category, type, data);
    this.notifyListeners(`${category}:${type}`, data);
  }

  private notifyListeners(key: string, data: EventData | ContractEvent): void {
    const set = this.listeners.get(key);
    if (set) {
      for (const listener of set) {
        try {
          listener(data as any);
        } catch {
          // swallow listener errors
        }
      }
    }
  }

  private recordEvent(category: string, type: string, data: EventData | ContractEvent): void {
    const entry: EventHistoryEntry = {
      category,
      type,
      data,
      timestamp: Date.now(),
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  getHistory(options?: { category?: string; type?: string; limit?: number }): EventHistoryEntry[] {
    let results = this.history;

    if (options?.category) {
      results = results.filter((e) => e.category === options.category);
    }

    if (options?.type) {
      results = results.filter((e) => e.type === options.type);
    }

    if (options?.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  getHistoryCount(): number {
    return this.history.length;
  }

  clearHistory(): void {
    this.history = [];
  }

  listenerCount(eventType?: string): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size ?? 0;
    }

    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }

  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }
}
