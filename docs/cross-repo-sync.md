# Cross-Repo Issue Sync

## Overview

The Invoice Liquidity Network spans three repositories:

- 🏠 [Invoice-Liquidity-Network](https://github.com/Invoice-Liquidity-Network/Invoice-Liquidity-Network) (main repo)
- ⚙️ [ILN-Smart-Contract](https://github.com/Invoice-Liquidity-Network/ILN-Smart-Contract) (Soroban contracts in Rust)
- 🖥️ [ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) (Next.js dApp)

Some issues affect multiple repositories simultaneously (security fixes, shared type changes, protocol updates). The **Cross-Repo Issue Sync** system automatically mirrors labeled issues across repos, reducing manual work and keeping all teams aligned.

## How It Works

### Sync Labels

Add one of these labels to an issue in the **main repo** to trigger automatic sync:

| Label                 | Target             | Purpose                                               |
| --------------------- | ------------------ | ----------------------------------------------------- |
| `sync:smart-contract` | ILN-Smart-Contract | Issue impacts Soroban contract logic or types         |
| `sync:frontend`       | ILN-Frontend       | Issue impacts frontend UI, SDK integration, or dApp   |
| `sync:all`            | Both repos         | Issue affects all three repos (protocol-wide changes) |

### Sync Process

1. **You label an issue** in the main repo with `sync:*`
2. **GitHub Action triggers** on the label event
3. **Linked issues are created** in target repos with:
   - Same title
   - Original issue link in a header
   - Body prepended with sync reference
   - All labels except `sync:*` labels (which are metadata-only)
4. **Comment posted** listing all synced destinations

### Example Workflow

#### Issue: "Security fix — validate invoice amounts"

1. Create issue in main repo: "Security fix — validate invoice amounts"
2. Add label: `sync:all`
3. GitHub Action automatically:
   - Creates issue in ILN-Smart-Contract with link to original
   - Creates issue in ILN-Frontend with link to original
   - Posts a comment with sync destinations

#### Result in ILN-Smart-Contract:

```
> 🔗 This is a synced issue from the main ILN repo. Original: #42

## Security fix — validate invoice amounts

[description...]
```

---

## Usage Guide

### For Maintainers

#### Syncing a single issue

1. Create or edit an issue in the main repo
2. Add the appropriate `sync:*` label
3. The GitHub Action runs automatically within seconds
4. Check the issue thread for the sync confirmation comment

#### Common Scenarios

**New feature requiring contract + frontend changes:**

```
Title: "Add multi-token liquidity pools"
Labels: sync:all, feature
```

**Bug fix in contract only:**

```
Title: "Fix precision loss in discount calculations"
Labels: sync:smart-contract, bug
```

**Frontend-only UI enhancement:**

```
Title: "Improve LP dashboard layout"
Labels: enhancement
(No sync needed — stays in frontend repo)
```

#### Preventing unintended syncs

- Never manually add `sync:*` labels to sibling repos
- `sync:*` labels are automatically stripped from synced issues
- Sync labels are metadata only — they don't propagate downstream

---

## Technical Details

### GitHub Action: `sync-issues.yml`

**Location:** `.github/workflows/sync-issues.yml`

**Trigger:** Issue labeled event in main repo

**Steps:**

1. **Smart-Contract Sync** (if `sync:smart-contract` or `sync:all`)
   - Uses octokit to call GitHub API
   - Creates issue in `ILN-Smart-Contract` repo
   - Adds synced issue body with link back

2. **Frontend Sync** (if `sync:frontend` or `sync:all`)
   - Uses octokit to call GitHub API
   - Creates issue in `ILN-Frontend` repo
   - Adds synced issue body with link back

3. **Comment with Links**
   - Posts comment on original issue
   - Lists all destinations where issue was synced

### Permissions

The workflow requires `GITHUB_TOKEN` with these permissions:

- `issues: read` — Read issue data
- `contents: read` — Read repo content

**Note:** The default `GITHUB_TOKEN` has sufficient permissions for this workflow.

### Skipped Labels

The following labels are **not synced** to avoid noise:

- `sync:smart-contract`
- `sync:frontend`
- `sync:all`

All other labels (e.g., `bug`, `feature`, `priority:high`) are preserved on synced issues.

---

## Workflow Example

### Step 1: Create Issue

```
Title: "Add payer verification oracle"
Description: Implement off-chain oracle to verify payer identity
Labels: feature, priority:high
```

### Step 2: Add Sync Label

You realize this affects both contract and frontend:

- Smart contract: New endpoint in `verify_payer()`
- Frontend: New UI to display verification status

Add label: `sync:all`

### Step 3: Automation Runs

GitHub Action triggers immediately:

- ✅ Creates issue in ILN-Smart-Contract
- ✅ Creates issue in ILN-Frontend
- ✅ Posts comment with links

### Step 4: Teams Receive Notification

Smart contract team sees new issue:

```
> 🔗 This is a synced issue from the main ILN repo. Original: #51

Add payer verification oracle
```

Frontend team sees same, synced issue:

```
> 🔗 This is a synced issue from the main ILN repo. Original: #51

Add payer verification oracle
```

Both teams can now independently track work, comment, and update progress.

---

## Troubleshooting

### Issue didn't sync

**Check:**

1. Did you add the label **after** creating the issue?
   - Labels added during creation may not trigger the action
   - **Solution:** Add/re-add the label to the issue after creation

2. Is the `GITHUB_TOKEN` valid?
   - The action requires write access to sibling repos
   - **Solution:** Check the repository settings under **Settings > Actions > General > Workflow permissions**

3. Are you syncing from the **main repo only**?
   - Cross-repo sync only works one-way: main repo → sibling repos
   - **Solution:** If you need to raise an issue in a sibling repo, go to that repo directly

### Synced issue has wrong content

The action copies:

- Title (exact)
- Body (with sync header prepended)
- Labels (except `sync:*` labels)

**Common issues:**

- If title was edited after sync, manually update the synced issue
- Formatting issues are usually markdown rendering — check raw body

### Too many syncs

Use `sync:smart-contract` **or** `sync:frontend` for targeted syncing:

```
sync:smart-contract   # Only contract repo
sync:frontend         # Only frontend repo
sync:all              # Both repos (use sparingly)
```

---

## Best Practices

### ✅ Do:

- Use **descriptive titles** — synced issues should make sense in any repo
- Add **context** in the description about why the issue affects multiple repos
- Use `sync:all` for **protocol-wide changes** (type updates, security fixes)
- Leave **comments on the original issue** linking to specific changes in sibling repos
- Assign the issue to a team member who can coordinate across repos

### ❌ Don't:

- Don't add `sync:*` labels to **sibling repo issues** (won't re-sync back)
- Don't manually edit synced issue bodies — update the original and let automation handle it
- Don't use sync labels for **repo-specific bugs** (defeats the purpose)
- Don't sync **duplicate or test issues** — keep the system clean

---

## Maintenance

### Adding a new repository to the sync network

To sync issues to a 4th repo (e.g., `ILN-Analytics`):

1. Edit `.github/workflows/sync-issues.yml`
2. Add a new job step following the existing pattern:
   ```yaml
   - name: Sync issue to analytics repo
     if: contains(github.event.issue.labels.*.name, 'sync:analytics') || contains(github.event.issue.labels.*.name, 'sync:all')
     uses: actions/github-script@v7
     with:
       github-token: ${{ secrets.GITHUB_TOKEN }}
       script: |
         const sourceIssue = context.issue;
         const sourceRepo = context.repo;
         const targetRepo = 'ILN-Analytics';
         # ... (continue as per existing steps)
   ```
3. Update this documentation with the new label

### Monitoring

Check workflow runs at: `.github/workflows/sync-issues.yml` in Actions tab

- 🟢 Green checks = successful syncs
- 🔴 Red X = sync failed (check logs for details)

---

## FAQ

**Q: Can issues sync back from sibling repos to main?**  
A: No, sync is one-way only (main → sibling repos). This prevents feedback loops and keeps the main repo as the source of truth.

**Q: What if an issue should be synced but wasn't?**  
A: Manually add the `sync:*` label to the main repo issue. The action will run on the next label event.

**Q: Do synced issues need to be tracked separately?**  
A: No. Each team works independently on their synced issue. The original issue in the main repo is the reference point.

**Q: Can I unsync an issue?**  
A: Not automatically. If you remove a `sync:*` label, future syncs don't happen, but already-created issues remain. Close them manually or link them if they become irrelevant.

**Q: What happens if I sync the same issue twice?**  
A: Each label event creates a new issue. Avoid re-adding the same label to prevent duplicates. If this happens, close the duplicate and add a comment linking the issues.

---

## Hardening Batch Coordination

During concurrent 125-issue hardening batches across the main repo, `ILN-Smart-Contract`, and `ILN-Frontend`, duplicate or overlapping work is governed by [docs/hardening-batch-coordination.md](hardening-batch-coordination.md).

Key guidelines:
- **Indexer Work**: `Invoice-Liquidity-Network` is authoritative for indexer implementation, RPC polling loop, and schema. Frontend indexer issues must consume the canonical indexer API.
- **Notifications Work**: `Invoice-Liquidity-Network` is authoritative for notification service dispatch and webhook HMAC signatures.
- **Oracle Work**: `ILN-Smart-Contract` is authoritative for Soroban oracle storage & on-chain verification, while `Invoice-Liquidity-Network` is authoritative for off-chain `oracle-service/` price fetchers.
- **De-duplication**: Use `sync:*` labels on authoritative issues in the main repo to mirror and link duplicate items across repos rather than maintaining independent diverging copies.

