// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { computeBackoffDelay } from '../src/processor';

describe('Issue #1275: Bounded retry and exponential backoff policy', () => {
  it('returns 0 delay for initial attempt (0 prior failures)', () => {
    expect(computeBackoffDelay(0, 500, 30000)).toBe(0);
  });

  it('computes exponential backoff for progressive retry attempts', () => {
    expect(computeBackoffDelay(1, 500, 30000)).toBe(500);
    expect(computeBackoffDelay(2, 500, 30000)).toBe(1000);
    expect(computeBackoffDelay(3, 500, 30000)).toBe(2000);
    expect(computeBackoffDelay(4, 500, 30000)).toBe(4000);
    expect(computeBackoffDelay(5, 500, 30000)).toBe(8000);
    expect(computeBackoffDelay(6, 500, 30000)).toBe(16000);
  });

  it('caps retry delay at configured maximum ceiling', () => {
    expect(computeBackoffDelay(7, 500, 30000)).toBe(30000);
    expect(computeBackoffDelay(10, 500, 30000)).toBe(30000);
  });
});
