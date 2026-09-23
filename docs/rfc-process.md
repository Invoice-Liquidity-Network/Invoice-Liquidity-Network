# RFC Process

Significant changes to ILN — new token types, fee model changes, governance redesigns, new contract mechanics — require community discussion before engineering begins. The RFC (Request for Comments) process provides a consistent, transparent path for proposing and deciding on those changes.

Minor changes (bug fixes, documentation, small SDK improvements) do not need an RFC. Use the normal issue and PR flow described in [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## When to write an RFC

Write an RFC if the change:

- modifies the on-chain contract interface or data model
- introduces or removes a token or fee mechanism
- changes how governance works
- has significant cross-repo impact (contract + SDK + frontend)
- is large enough that reversing it after deployment would be costly

If you are unsure, open a GitHub Discussion first. Maintainers will tell you whether an RFC is needed.

---

## Lifecycle

```
Draft → Open for Comment (≥ 2 weeks) → Final Comment Period (1 week) → Accepted / Rejected
```

| Status | Meaning |
|--------|---------|
| **Draft** | Author is writing. Not yet ready for community review. |
| **Open for Comment** | PR is open. Community feedback is actively collected. Minimum two weeks. |
| **Final Comment Period** | No major open questions remain. One week for last objections before a decision. |
| **Accepted** | Approved by maintainers. Implementation may begin. |
| **Rejected** | Not approved. The RFC is closed with a recorded reason. |

The status is updated in the RFC file itself as it progresses. Maintainers move an RFC into Final Comment Period by updating the status and leaving a comment on the PR.

---

## Submitting an RFC

1. Copy `rfcs/0000-template.md` to `rfcs/0000-your-feature-name.md`. Keep the number `0000` until a maintainer assigns the next available number.
2. Fill in all sections. Placeholders are not acceptable for an Open for Comment submission.
3. Open a PR against `main` with the branch name `rfc/your-feature-name`.
4. A maintainer will assign the RFC number, rename the file (e.g. `0002-your-feature-name.md`), and update the status to **Open for Comment**.
5. Discussion happens in the PR comments. The author is expected to update the RFC in response to significant feedback.
6. After the Final Comment Period, maintainers record a decision in the PR and either merge (Accepted) or close (Rejected) it.

---

## After acceptance

An accepted RFC becomes the source of truth for the implementation. The implementing PR should reference the RFC number and note any deviations that arose during engineering. If a deviation is significant, reopen discussion on the RFC before merging the implementation.

---

## RFC index

| Number | Title | Status | Tracking issues |
|--------|-------|--------|-----------------|
| [0001](../rfcs/0001-dutch-auction-funding.md) | Dutch Auction Funding | Accepted | #6, #7, #8, #10 |
