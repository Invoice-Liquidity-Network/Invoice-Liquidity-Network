import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createDb,
  setDb,
  getBackfillCheckpoint,
  saveBackfillCheckpoint,
  clearBackfillCheckpoint,
  insertEvent,
  setCursorLedger,
  countEvents,
} from '../src/db';
import { advanceBackfillCheckpoint, resumeFromCheckpoint } from '../src/checkpoint';

beforeEach(() => {
  setDb(createDb(':memory:'));
});

afterEach(() => {
  clearBackfillCheckpoint();
});

describe('resumeFromCheckpoint', () => {
  it('returns the cursor when no checkpoint exists', async () => {
    setCursorLedger(42);
    const result = await resumeFromCheckpoint(() => 'hash-x', 42);
    expect(result).toEqual({ startLedger: 42, verified: false, reason: 'none' });
  });

  it('resumes from a verified checkpoint', async () => {
    saveBackfillCheckpoint(1000, 'checkpoint-hash', 500);
    const result = await resumeFromCheckpoint((ledger) =>
      ledger === 1000 ? 'checkpoint-hash' : null
    );
    expect(result).toEqual({ startLedger: 1000, verified: true, reason: 'verified' });
  });

  it('discards a checkpoint whose block hash was reorged', async () => {
    saveBackfillCheckpoint(1000, 'stale-hash', 500);
    const result = await resumeFromCheckpoint(() => 'canonical-hash');
    expect(result).toEqual({ startLedger: 0, verified: false, reason: 'hash-mismatch' });
    expect(getBackfillCheckpoint()).toBeNull();
  });

  it('trusts the cursor when it is ahead of the checkpoint', async () => {
    saveBackfillCheckpoint(100, 'hash', 50);
    const result = await resumeFromCheckpoint(() => 'hash', 400);
    expect(result).toEqual({ startLedger: 400, verified: false, reason: 'below-cursor' });
  });
});

describe('advanceBackfillCheckpoint', () => {
  it('persists a checkpoint only after `interval` ledgers have elapsed', async () => {
    expect((await advanceBackfillCheckpoint(100, 500, () => 'h100')).updated).toBe(true);
    expect((await advanceBackfillCheckpoint(400, 500, () => 'h400')).updated).toBe(false);
    expect((await advanceBackfillCheckpoint(900, 500, () => 'h900')).updated).toBe(true);

    expect(getBackfillCheckpoint()).toMatchObject({ ledger: 900, block_hash: 'h900' });
  });

  it('records the event count in the checkpoint', async () => {
    insertEvent({
      event_id: 'c-1',
      event_type: 'submitted',
      invoice_id: 1,
      ledger: 501,
      ledger_closed_at: '2024-01-01T00:00:00Z',
      created_at: 1700000000000,
      confirmed: true,
    });
    insertEvent({
      event_id: 'c-2',
      event_type: 'submitted',
      invoice_id: 2,
      ledger: 502,
      ledger_closed_at: '2024-01-01T00:00:00Z',
      created_at: 1700000000000,
      confirmed: true,
    });

    await advanceBackfillCheckpoint(502, 1, (l) => `hash-${l}`);
    expect(countEvents()).toBe(2);
    expect(getBackfillCheckpoint()).toMatchObject({ ledger: 502, event_count: 2 });
  });

  it('does nothing when the ledger hash is unavailable', async () => {
    await advanceBackfillCheckpoint(100, 1, () => null);
    expect(getBackfillCheckpoint()).toBeNull();
  });
});

describe('checkpoint durability', () => {
  it('survives a database reopen', () => {
    const dbPath = path.join(os.tmpdir(), `iln-checkpoint-${Date.now()}.db`);
    try {
      const first = createDb(dbPath);
      setDb(first);
      saveBackfillCheckpoint(777, 'durable-hash', 123);
      first.close();

      const reopened = createDb(dbPath);
      setDb(reopened);
      expect(getBackfillCheckpoint()).toMatchObject({
        ledger: 777,
        block_hash: 'durable-hash',
        event_count: 123,
      });
    } finally {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  });
});
