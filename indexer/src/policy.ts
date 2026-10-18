import { CONFIG } from './config';
import { confirmationDepthGauge, confirmedTipLedger } from './metrics';

export interface ConfirmationDepthPolicy {
  /** Return the configured confirmation depth in ledgers. */
  getDepth(): number;
  /** Set a new confirmation depth, validating bounds. */
  setDepth(depth: number): void;
  /** Check if an event ledger sequence is confirmed given the current latest ledger. */
  isConfirmed(eventLedger: number, latestKnownLedger: number): boolean;
  /** Return the highest confirmed canonical ledger tip (latestKnownLedger - depth). */
  getConfirmedTip(latestKnownLedger: number): number;
  /** Validate that a depth value is a valid non-negative integer within bounds. */
  validateDepth(depth: number): void;
}

export class CanonicalConfirmationPolicy implements ConfirmationDepthPolicy {
  private depth: number;

  constructor(depth?: number) {
    const raw = depth ?? CONFIG.confirmationDepth;
    this.validateDepth(raw);
    this.depth = raw;
    try {
      confirmationDepthGauge.set(this.depth);
    } catch {
      /* metrics failure is non-fatal */
    }
  }

  public validateDepth(depth: number): void {
    if (!Number.isFinite(depth) || !Number.isInteger(depth) || depth < 0) {
      throw new Error(`[policy] Invalid confirmation depth: ${depth}. Depth must be a non-negative integer.`);
    }
    if (depth > 1000) {
      throw new Error(`[policy] Confirmation depth exceeds maximum threshold (1000): ${depth}`);
    }
  }

  public getDepth(): number {
    return this.depth;
  }

  public setDepth(depth: number): void {
    this.validateDepth(depth);
    this.depth = depth;
    try {
      confirmationDepthGauge.set(this.depth);
    } catch {
      /* metrics failure is non-fatal */
    }
  }

  public isConfirmed(eventLedger: number, latestKnownLedger: number): boolean {
    return latestKnownLedger - eventLedger >= this.depth;
  }

  public getConfirmedTip(latestKnownLedger: number): number {
    const confirmed = Math.max(0, latestKnownLedger - this.depth);
    try {
      confirmedTipLedger.set(confirmed);
    } catch {
      /* metrics failure is non-fatal */
    }
    return confirmed;
  }
}

/** Default singleton canonical confirmation depth policy instance. */
export const confirmationPolicy = new CanonicalConfirmationPolicy();
