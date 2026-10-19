#!/usr/bin/env node

/**
 * Withdrawal Notice & Queue State Model (#1304)
 *
 * Implements the lifecycle state machine for LP capital withdrawal notices
 * and queue fulfillment in compliance with docs/trust-liquidity-model.md Section 6:
 *
 * States:
 * - NOTICE_PENDING: Cooldown window active (shares locked, accruing yield)
 * - NOTICE_MATURED: Cooldown elapsed, ready for liquidation/fulfillment
 * - QUEUED: Waiting in FIFO queue for incoming debtor repayments
 * - PARTIALLY_FULFILLED: Pro-rata or sequential partial payout completed
 * - FULFILLED: 100% of redemption value disbursed, shares burned
 * - CANCELLED: Revoked by caller prior to terminal fulfillment
 */

import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const NOTICE_STATES = {
  NOTICE_PENDING: 'NOTICE_PENDING',
  NOTICE_MATURED: 'NOTICE_MATURED',
  QUEUED: 'QUEUED',
  PARTIALLY_FULFILLED: 'PARTIALLY_FULFILLED',
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED',
};

export const DEFAULT_QUEUE_CONFIG = {
  noticePeriodSeconds: 3 * 86400, // 3 days notice
};

export class WithdrawalQueueStateMachine {
  constructor(config = DEFAULT_QUEUE_CONFIG) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    this.notices = new Map();
    this.fifoQueue = [];
    this.nextNoticeId = 1;
  }

  submitNotice(caller, shares, currentTimestampMs = Date.now()) {
    if (!shares || shares <= 0) throw new Error('Shares must be positive');

    const noticeId = `NOTICE-${this.nextNoticeId++}`;
    const maturesAtMs = currentTimestampMs + this.config.noticePeriodSeconds * 1000;

    const notice = {
      noticeId,
      caller,
      shares,
      state: NOTICE_STATES.NOTICE_PENDING,
      submittedAtMs: currentTimestampMs,
      maturesAtMs,
      disbursedAmount: 0,
      remainingAmount: shares, // 1:1 par baseline
    };
    notice.sha256 = createHash('sha256').update(JSON.stringify(notice)).digest('hex');

    this.notices.set(noticeId, notice);
    return notice;
  }

  matureNotice(noticeId, currentTimestampMs = Date.now()) {
    const notice = this.notices.get(noticeId);
    if (!notice) throw new Error(`Notice ${noticeId} not found`);
    if (notice.state !== NOTICE_STATES.NOTICE_PENDING) {
      throw new Error(`Invalid state transition: Cannot mature notice in ${notice.state}`);
    }

    if (currentTimestampMs < notice.maturesAtMs) {
      const remainingSeconds = Math.round((notice.maturesAtMs - currentTimestampMs) / 1000);
      throw new Error(`NOTICE_NOT_MATURED: Cooldown active (${remainingSeconds}s remaining)`);
    }

    notice.state = NOTICE_STATES.NOTICE_MATURED;
    return notice;
  }

  enqueueMaturedNotice(noticeId) {
    const notice = this.notices.get(noticeId);
    if (!notice) throw new Error(`Notice ${noticeId} not found`);
    if (notice.state !== NOTICE_STATES.NOTICE_MATURED) {
      throw new Error(`Cannot enqueue notice in state ${notice.state}`);
    }

    notice.state = NOTICE_STATES.QUEUED;
    this.fifoQueue.push(notice);
    return {
      noticeId,
      queuePosition: this.fifoQueue.length,
      state: notice.state,
    };
  }

  cancelNotice(noticeId) {
    const notice = this.notices.get(noticeId);
    if (!notice) throw new Error(`Notice ${noticeId} not found`);
    if (notice.state === NOTICE_STATES.FULFILLED) {
      throw new Error('Cannot cancel already fulfilled notice');
    }

    notice.state = NOTICE_STATES.CANCELLED;
    this.fifoQueue = this.fifoQueue.filter((n) => n.noticeId !== noticeId);
    return notice;
  }

  processQueueRepayment(incomingRepayment) {
    if (incomingRepayment <= 0) throw new Error('Repayment must be positive');
    let remaining = incomingRepayment;
    const settlements = [];

    while (this.fifoQueue.length > 0 && remaining > 0) {
      const top = this.fifoQueue[0];
      const needed = top.remainingAmount;

      if (remaining >= needed) {
        remaining -= needed;
        top.disbursedAmount += needed;
        top.remainingAmount = 0;
        top.state = NOTICE_STATES.FULFILLED;
        settlements.push(this.fifoQueue.shift());
      } else {
        top.disbursedAmount += remaining;
        top.remainingAmount -= remaining;
        top.state = NOTICE_STATES.PARTIALLY_FULFILLED;
        remaining = 0;
      }
    }

    return {
      incomingRepayment,
      surplusCash: remaining,
      settlementsCount: settlements.length,
      remainingQueueLength: this.fifoQueue.length,
    };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Testing Withdrawal Notice & Queue State Model (#1304)...');
  const sm = new WithdrawalQueueStateMachine({ noticePeriodSeconds: 10 });
  const n = sm.submitNotice('LP_ALICE', 100_000);
  console.log('Submitted notice:', n);
}
