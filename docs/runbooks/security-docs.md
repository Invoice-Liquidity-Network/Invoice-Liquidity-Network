# Runbook: Security Documentation and API Security Headers (Issue #1287)

Two controls keep the [Security Guide](../security-guide.md) and the
[Threat Model](../threat-model.md) true, and one of them is a runtime control in
the services themselves.

| | Security docs check | API security headers |
|---|---|---|
| **What** | Fails CI when a documented control is not backed by the repository | Every indexer and oracle response refuses framing and MIME sniffing, sends no referrer and no cross-origin grant |
| **Where** | `scripts/check-security-docs.mjs` (`scripts/lib/security-docs.mjs`) | `indexer/src/securityHeaders.ts`, `oracle-service/src/securityHeaders.ts` (identical copies) |
| **Runs** | Every PR and push to `main`/`dev` that touches the docs, the services or the check, and weekly — [Security Docs workflow](../../.github/workflows/security-docs.yml) | Every response, from the first middleware of `createApp` / `createOracleApp` |
| **Owner** | `@Invoice-Liquidity-Network/security-lead` | `@Invoice-Liquidity-Network/security-lead`, with each service team |
| **Proof it is active** | `security-docs-report` artifact (JSON) and the job summary on every run | `curl -sI <service>/v1/health` shows the headers; the workflow's header tests |

## What the docs check enforces

| Rule | Fails when |
|---|---|
| `table-format` | The mitigation or claims table is missing or a row is malformed |
| `evidence-missing` | An evidence path does not exist, or an `enforced` row cites none |
| `anchor-missing` | A cited `path#text` no longer contains that text |
| `no-test-or-workflow` | An `enforced` row cites no test or CI workflow |
| `external-without-link` | An `external` row does not link to where the control lives |
| `gap-without-owner` | A row has no owning team, or a `gap` claims evidence |
| `threat-uncovered` | A `### N.M` threat section has no mitigation row |
| `dead-path` | Either document mentions a repository path that does not exist |
| `headers-drift` | A service's security-headers module is missing or differs from the others |
| `headers-not-first` | A service registers middleware or a route before `applySecurityHeaders(app)` |
| `port-drift` | The canonical-site copy under `packages/docs/content/security/` is missing or its tables differ |

Baseline when introduced (#1287): **10 findings** on `dev` (three cited
implementation files that never existed, a missing `contracts/audits/`, no
evidence or claims tables, no security headers in any service, no canonical
port); **0** after.

## Run it

```bash
node scripts/check-security-docs.mjs
node scripts/check-security-docs.mjs --json=security-docs-report.json
node --test scripts/__tests__/security-docs.test.mjs
```

## Recovery

Each finding prints `[rule] file:line message`. Decide which side is wrong:

- **The code moved** (renamed a file or symbol): update the evidence path or
  anchor in the table, and re-read the claim while you are there — a moved
  line is how a claim goes stale.
- **A control was removed or never existed**: do not delete the row. Change it
  to `gap` with the owning team, so the risk stays visible.
- **A control lives elsewhere** (frontend repository, GitHub settings): mark it
  `external` and link to it.
- **`headers-drift`**: copy the canonical `indexer/src/securityHeaders.ts` over
  the other copy (or update both together) — the services must send one policy.
- **`headers-not-first`**: move `applySecurityHeaders(app)` to directly after
  `express()` (and `app.set('trust proxy', …)`), so 404s, 429s and errors carry
  the headers too.
- **`port-drift`**: re-port the edited document into
  `packages/docs/content/security/` (MDX: table markers become `{/* … */}`).

Never weaken the check, or a header, to make CI pass.

## Verifying headers on a running service

```bash
curl -sI http://localhost:3001/v1/health   # indexer
curl -sI http://localhost:3010/health      # oracle
```

Expect `X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Resource-Policy: same-site`, no `X-Powered-By`, and — only behind
the HTTPS proxy — `Strict-Transport-Security`. A missing header after a deploy
means the deployed build predates #1287 or `applySecurityHeaders` was removed;
the check fails the PR in the second case.

## Compatibility

- No route, response body, status code or environment variable changed.
- New response headers only. The CSP does not restrict scripts, so the
  indexer's Swagger UI (`/docs`) and GraphiQL (`/graphql`) are unaffected.
  Embedding an API response in an `<iframe>` from another site is now refused,
  which is the intent; no in-repository client does this.
- `oracle-service` callers (the frontend, `INDEXER_BASE_URL` consumers) read
  JSON and are unaffected by framing and referrer policy.
- Cross-repository: the frontend's CSP (TM-2.1) belongs to
  [ILN-Frontend](https://github.com/Invoice-Liquidity-Network/ILN-Frontend) and
  is not changed here. The notifications service is gap TM-2.3b: it adopts the
  same `securityHeaders.ts` once its source compiles on `dev` again.
