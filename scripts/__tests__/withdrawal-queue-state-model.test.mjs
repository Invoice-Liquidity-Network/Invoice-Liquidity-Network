import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WithdrawalQueueStateMachine,
  NOTICE_STATES,
} from '../operations/withdrawal-queue-state-model.mjs';

describe('Withdrawal Notice & Queue State Model Suite (#1304)', () => {
  it('enforces notice cooldown period and prevents premature maturation', () => {
    const sm = new WithdrawalQueueStateMachine({ noticePeriodSeconds: 60 });
    const now = Date.now();
    const notice = sm.submitNotice('LP_1', 50_000, now);

    assert.equal(notice.state, NOTICE_STATES.NOTICE_PENDING);

    // Premature attempt should throw
    assert.throws(
      () => sm.matureNotice(notice.noticeId, now + 10_000), // only 10s passed
      /NOTICE_NOT_MATURED/
    );

    // After cooldown
    const matured = sm.matureNotice(notice.noticeId, now + 65_000);
    assert.equal(matured.state, NOTICE_STATES.NOTICE_MATURED);
  });

  it('enqueues matured notices and fulfills sequentially via repayment', () => {
    const sm = new WithdrawalQueueStateMachine({ noticePeriodSeconds: 0 });
    const n1 = sm.submitNotice('LP_1', 30_000);
    const n2 = sm.submitNotice('LP_2', 40_000);

    sm.matureNotice(n1.noticeId);
    sm.matureNotice(n2.noticeId);

    sm.enqueueMaturedNotice(n1.noticeId);
    sm.enqueueMaturedNotice(n2.noticeId);
    assert.equal(sm.fifoQueue.length, 2);

    // Process repayment of 50,000: fully settles n1 (30k) and partially settles n2 (20k/40k)
    const res = sm.processQueueRepayment(50_000);
    assert.equal(res.settlementsCount, 1);
    assert.equal(sm.fifoQueue.length, 1);
    assert.equal(sm.fifoQueue[0].state, NOTICE_STATES.PARTIALLY_FULFILLED);
    assert.equal(sm.fifoQueue[0].remainingAmount, 20_000);
  });

  it('allows cancellation of pending notice and removes from queue', () => {
    const sm = new WithdrawalQueueStateMachine({ noticePeriodSeconds: 0 });
    const n = sm.submitNotice('LP_3', 25_000);
    sm.matureNotice(n.noticeId);
    sm.enqueueMaturedNotice(n.noticeId);
    assert.equal(sm.fifoQueue.length, 1);

    const cancelled = sm.cancelNotice(n.noticeId);
    assert.equal(cancelled.state, NOTICE_STATES.CANCELLED);
    assert.equal(sm.fifoQueue.length, 0);
  });
});
