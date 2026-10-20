# Launch Exceptions Register

This register tracks all `Launch exception accepted` statuses granted for the mainnet launch checklist. Each exception is linked to its request issue and includes the approval details, risk summary, compensating controls, and post-launch remediation target.

**Owner:** Release lead  
**Review cadence:** Monthly  
**Last reviewed:** 2026-10-19

---

## Exception Format

| Field | Description |
|-------|-------------|
| **Item** | Checklist section and item name |
| **Exception Issue** | Link to the GitHub issue requesting the exception |
| **Approved** | Date the exception was granted |
| **Reviewers** | Checklist item owner, Release lead, and independent domain reviewer(s) |
| **Risk Summary** | Brief impact/likelihood assessment |
| **Compensating Controls** | Controls in place until remediation |
| **Remediation Target** | Date by which the checklist item must be completed |
| **Status** | `Active` or `Resolved` (updated when remediation completes) |

---

## Active Exceptions

*No exceptions granted as of 2026-10-19.*

---

## Resolved Exceptions

*No exceptions resolved yet.*

---

## Process Compliance

This register is verified by the following artifacts:

- Exception request template: `.github/ISSUE_TEMPLATE/launch-exception-request.yml`
- Mainnet launch checklist exception process section: `docs/mainnet-launch-checklist.md#launch-readiness-exception-process`
- Each active exception has a corresponding evidence file in `docs/evidence/launch-exceptions/<item-slug>.md`

The Release lead is responsible for maintaining this register and ensuring exceptions are reviewed monthly. Expired exceptions (past remediation target date without resolution) must be escalated immediately.