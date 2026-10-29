# Release Audit Log

`log.jsonl` is an append-only, git-tracked record of every automated release
action taken by this repository's release workflows — who (`actor`), what
(`action`, `outcome`), and when (`timestamp`) — for post-release review.
Introduced by issue #1096 to close the last unscripted piece of
[docs/release-runbook.md](../docs/release-runbook.md): previously, whether a
release attempt happened and how it went was only visible by reading Actions
run history.

## Format

One JSON object per line, oldest first:

```json
{"timestamp":"2026-09-26T12:00:00.000Z","actor":"github-actions[bot]","action":"semantic-release","outcome":"success","ref":"abc1234","version":"1.3.0"}
```

| Field | Meaning |
|---|---|
| `timestamp` | ISO-8601 UTC, when the entry was recorded |
| `actor` | `GITHUB_ACTOR` in CI, or the triggering workflow_run's actor |
| `action` | Which release mechanism ran: `semantic-release`, `changesets-publish`, `changesets-version-pr`, or `manual-recovery` for a documented human-judgment step (see the runbook) |
| `outcome` | `success`, `failure`, or `no-op` (ran, nothing to do) |
| `ref` | Git SHA the action ran against |
| `version` | Present when a version was actually released |
| `notes` | Free-text detail (e.g. which packages published) |

## Producing entries

Entries are written by `scripts/release-audit-log.mjs` (see that file's own
usage comment), called from `.github/workflows/semantic-release.yml` and
`.github/workflows/release.yml` after every run, success or failure. It is
also the mechanism for logging one of the release-runbook's explicit
human-judgment steps — run it manually:

```bash
node scripts/release-audit-log.mjs \
  --action manual-recovery \
  --actor <you> \
  --ref <sha> \
  --outcome success \
  --notes "describe what you did and why"
```

## Reading entries

```bash
node --input-type=module -e "
  import { readEntries } from './scripts/release-audit-log.mjs';
  readEntries('release-audit/log.jsonl').forEach((e) => console.log(e));
"
# or, for a quick human-readable tail:
tail -n 20 release-audit/log.jsonl | jq .
```
