# Withdrawal Notice & Queue State Model Runbook (#1304)

This operational specification defines the state transitions and cooldown invariants for LP withdrawal notices and queue clearing.

## 1. Lifecycle State Machine

```text
[NOTICE_PENDING] (3-day cooldown)
       │
       ▼
[NOTICE_MATURED] ──(Enqueue)──► [QUEUED] ──(Incoming Repayment)──► [FULFILLED]
       │                            │
   (Cancel)                     (Partial)
       ▼                            ▼
  [CANCELLED]             [PARTIALLY_FULFILLED]
```

## 2. Invariants

- **Cooldown Enforcement**: `matureNotice()` fails closed if invoked before `maturesAtMs`.
- **FIFO Priority**: Repayments strictly clear older queue entries before servicing subsequent tickets.
- **Cancellation Restores Shares**: Revoking a notice removes it from the queue and unlocks shares.

## 3. Verification

```bash
pnpm test:withdrawal-queue
```
