# RFC 0003 — RFC Process Retrospective Audit

- **Status:** Accepted
- **Author(s):** Repository maintainers, docs + governance review
- **Created:** 2026-10-03
- **PR:** retrospective audit / docs update
- **Tracking issues:** #1119

---

## Summary

This RFC records the retrospective review of major recent ILN decisions that were made or effectively ratified without a formal RFC in the sense described by [docs/rfc-process.md](../docs/rfc-process.md). It does not attempt to undo those decisions; instead, it documents what happened, why the process bypass occurred, and which process controls are being added to prevent recurrence.

The purposes are threefold:

1. create a historical record for reviewers and auditors;
2. distinguish between true operational fixes and policy-level decisions; and
3. make the RFC process enforceable rather than aspirational.

---

## Motivation

The repo's RFC process is explicit: significant changes to governance, token mechanics, on-chain interfaces, or cross-repo architecture should go through a documented design-review path before engineering begins.

The recent hardening and coordination work created several decisions with repo-wide reach — cross-repo authority mappings, operational rate-limit/circuit-breaker policy, governance default interpretation, and docs/source-of-truth changes — that were landed as implementation or coordination work, not as RFC-backed protocol decisions.

That creates governance debt: reviewers cannot tell which changes were policy decisions requiring broad consent, and implementers are left without a clear record of trade-offs and exceptions.

---

## Findings from the audit

The audit identified the following major decisions or policy-like changes that should have been treated as RFC material if they were intended to persist beyond immediate execution:

### 1. Cross-repo hardening coordination as a de facto governance policy

The coordination rules in [docs/hardening-batch-coordination.md](../docs/hardening-batch-coordination.md) define authoritative repositories, de-duplication rules, and issue sync policy across the main repo, smart-contract repo, and frontend repo.

These rules are process-level, not mere operational housekeeping. They affect engineering authority, issue ownership, and release sequencing across repositories. They were implemented as repo process documentation, not as an RFC.

**Why it bypassed the RFC process:** the change was treated as execution coordination during a hardening batch rather than protocol or governance policy.

**Retrospective classification:** process decision with cross-repo authority implications; should have been recorded as an RFC or at minimum a retrospective RFC once the pattern proved durable.

### 2. Operational rate limits and circuit-breaker policy treated as implementation defaults

The notification and indexer services introduced or refined per-recipient rate limiting, dead-letter handling, retry backoff, and circuit-breaker failure thresholds as operational defaults.

These defaults are not merely implementation details when they change user-visible reliability, cost, or failure modes for production traffic. They also influence service availability and operator risk.

**Why it bypassed the RFC process:** they were implemented under service hardening tickets and patched as reliability work rather than policy change leadership.

**Retrospective classification:** operational policy change with significant availability impact; should have been explicitly labeled and recorded if the defaults were meant to remain after the hardening phase.

### 3. Governance interpretation and threshold defaults were treated as self-evident

The governance docs and the repo's coordination docs repeatedly state default quorum / pass thresholds, but the exact decision record for those defaults is not clearly captured in a formal RFC.

This matters because a governance threshold is a policy decision with economic and security consequences. A low quorum floor can materially affect an attacker’s ability to push through an unvetted proposal in a low-turnout environment.

**Why it bypassed the RFC process:** the default parameters were treated as operational config rather than a policy commitment.

**Retrospective classification:** governance policy decision; requires explicit retrospective RFC and a documented risk model.

### 4. Documentation source-of-truth and repo ownership transitions were treated as docs cleanup

The `docs/` vs `packages/docs/` migration, monorepo map, glossary decree, and cross-repo terminology updates are not isolated edits. They alter the canonical source of truth for protocol language and developer onboarding.

**Why it bypassed the RFC process:** they were implemented as docs maintenance while the repo was already in flight across multiple workstreams.

**Retrospective classification:** process / standards decision with authoritativeness implications; should be recorded as formal standards documentation or a retrospective RFC.

---

## Decision record

This retrospective does not reverse past decisions. It records them as follows:

| Decision | Category | RFC status | Outcome |
|---|---|---|---|
| Cross-repo hardening coordination | process / authority | Bypassed | Canonicalized in docs, now subject to explicit process checks |
| Service rate-limit and circuit-breaker defaults | operational policy | Bypassed | Treated as service defaults; future changes must cite a policy note or RFC |
| Governance threshold defaults and risk assumptions | governance | Bypassed | Now explicitly modeled and documented in governance docs |
| Docs/source-of-truth migration and glossary enforcement | standards | Bypassed | Now documented as canonical source-of-truth rules |

---

## Process tightening

The RFC process is strengthened in three ways:

### 1. Decision classification must be explicit

Every significant PR or issue must record whether it is:

- a bug fix,
- a design / protocol change,
- a process / governance change, or
- an operational default.

If it falls into the last two categories, it must either link to an RFC or state that a retrospective RFC is being prepared.

### 2. Retrospective RFCs are allowed and required when governance debt exists

When a major decision was already made, a retrospective RFC can be opened after the fact. It should include:

- the decision that was made,
- why it bypassed the normal process,
- what trade-off was accepted,
- the risk or cost of the decision,
- the process changes adopted to avoid recurrence.

These are accepted in the same way as normal RFCs when maintainers decide the historical decision is now part of the authoritative record.

### 3. Policy changes require a maintainer checklist before merge

Before merging any work touching governance, protocol configuration, auth boundaries, or repo-wide source-of-truth docs, maintainers must confirm:

- the decision is either RFC-backed or explicitly retrospective,
- the change is named in the PR description,
- any cross-repo implications are listed,
- the docs or ADR list the decision under the correct authority.

---

## Alternatives considered

### Alternative A — do nothing and leave the process as a guideline

Rejected because the repo already shows a gap between stated policy and actual decisions. Without a record, future maintainers cannot tell whether a change was a deliberate governance choice or a tactical patch.

### Alternative B — re-open every prior decision for debate

Rejected as too costly and not necessary for archival clarity. The retrospective record is sufficient to close the governance gap while preserving the actual implemented choices.

---

## Unresolved questions

This retrospective does not decide whether every recent operational choice was wrong; it records that the process was inconsistent and codifies the minimum remedy. The remaining open work is operational rather than conceptual:

- whether to add an RFC label check to CI,
- whether to require a `governance` tag for policy changes,
- how long a retrospective RFC may sit before it is deemed accepted or rejected.

---

## Implementation notes

- Tracking issue(s): #1119
- Implementation PR(s): docs + governance update
- Merged: 2026-10-03
