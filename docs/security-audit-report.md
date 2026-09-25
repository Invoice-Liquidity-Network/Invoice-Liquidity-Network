
---

# Security Audit Findings & CI Blocking Configuration — Issue #891

## Overview & Scope

Per Issue #891, the repository tooling (`scripts/dependency-audit.js`, `pnpm audit`, `license-checker-rseidelsohn`, and `.github/workflows/snyk.yml` / `codeql.yml`) has been reviewed to ensure that security reports are actively audited, findings are acted upon or explicitly documented/accepted, and CI automated checks gate PRs against high/critical vulnerabilities.

---

## 1. Local Security Scan & Dependency Audit Findings

### Summary of Component Scans

1. **pnpm Workspace Root (`package.json`, `pnpm-lock.yaml`)**:
   - Analyzed 0 high or critical vulnerabilities in production dependencies.
   - All shared packages conform to standard MIT/Apache-2.0/BSD license constraints.
2. **Indexer Service (`indexer/package.json`, `packages/indexer`)**:
   - SQLite, Prisma, and Fastify dependencies evaluated.
   - All transitive dependencies verified against known CVEs matching `>= high` threshold.
3. **Notifications Service (`notifications/package.json`)**:
   - Webhook signing and HTTP client dependencies reviewed.
   - HMAC payload processors adhere to constant-time timing safe standards.
4. **SDK & CLI (`sdk/package.json`, `cli/package.json`)**:
   - `@stellar/stellar-sdk` v15+ compatibility validated with zero high-severity advisories.
   - Crypto primitives rely on native Node/browser subtle crypto and audited ed25519 libraries.

### Accepted Risk & Mitigation Notes
- **Dev-only tooling dependencies**: Any low/moderate warnings in local dev test runners (such as legacy mocha/vitest dev-only fixtures) are isolated from production builds (`--omit=dev` enforced on production audits).

---

## 2. CI Workflow Blocking Behaviors

### Snyk Security Scanning (`.github/workflows/snyk.yml`)
- Configured with `snyk test --all-projects --severity-threshold=high`.
- When `SNYK_TOKEN` is present, the action executes against all workspace packages and **fails the CI build** if any vulnerability at or above `high` severity is detected.

### CodeQL Static Analysis (`.github/workflows/codeql.yml`)
- Executes automated semantic code scanning across JavaScript/TypeScript and Rust codebases on every PR to `main`.
- Queries enforce `security-extended` rule packs, blocking merges on SQL injection, untrusted input deserialization, or hardcoded secret exposures.
---

## 3. Third-Party Penetration Test Scoping and Remediation Process

### Overview

Ahead of mainnet launch, the Invoice Liquidity Network services require external penetration testing to identify security vulnerabilities that internal reviews and automated tooling may miss. This section defines the scope, vendor selection criteria, and remediation tracking process.

### Penetration Test Scope

#### In-Scope Services

1. **Indexer Public API** (`indexer/`)
   - HTTP REST endpoints (`/v1/invoice/:id`, `/v1/invoices`, `/v1/stats`, etc.)
   - GraphQL endpoint (`/graphql`)
   - WebSocket streaming (`/ws`)
   - Authentication and authorization mechanisms
   - Rate limiting and abuse prevention
   - Database query injection vectors

2. **Oracle Service** (`oracle-service/`)
   - Trust verification endpoints (`POST /v1/verify`)
   - Cache poisoning attack vectors
   - Stale data injection
   - Upstream API key exposure
   - Rate limiting bypass attempts

3. **Notifications Service** (`notifications/`)
   - Subscription management endpoints
   - Webhook delivery system
   - SSRF prevention in webhook URLs
   - Email/SMS provider integration security
   - WebSocket authentication and authorization

4. **TypeScript SDK** (`sdk/`, `packages/sdk/`)
   - Transaction construction vulnerabilities
   - XDR manipulation attack vectors
   - Dependency chain security
   - API client authentication handling

#### In-Scope Attack Classes

Based on `docs/threat-model.md`, the following attack classes are prioritized:

1. **Authentication and Authorization**
   - Broken access controls
   - Privilege escalation
   - Session management weaknesses
   - API key exposure or theft

2. **Injection Attacks**
   - SQL injection (Prisma/SQLite)
   - NoSQL injection (if applicable)
   - Command injection in system calls
   - GraphQL injection
   - Header injection

3. **API Security**
   - Rate limiting bypass
   - Mass assignment vulnerabilities
   - Insecure direct object references (IDOR)
   - API key leakage in responses or logs

4. **Data Integrity**
   - Transaction manipulation between simulation and signing
   - XDR tampering
   - Cache poisoning (Oracle service)
   - Stale data injection

5. **Denial of Service**
   - Resource exhaustion attacks
   - Algorithmic complexity attacks
   - Stream/pagination abuse
   - Database query performance attacks

6. **Supply Chain**
   - Dependency confusion (covered in separate audit)
   - Prototype pollution in Node.js dependencies
   - Malicious package detection

7. **Infrastructure**
   - Container escape (if Docker/Kubernetes used)
   - Secrets exposure in environment variables or logs
   - Network segmentation issues

#### Out of Scope

The following are explicitly excluded from penetration testing:

1. **Stellar Network Infrastructure**
   - Stellar consensus layer
   - Horizon servers operated by SDF
   - Soroban RPC infrastructure (unless self-hosted)

2. **Physical Security**
   - Data center physical access
   - Hardware tampering

3. **Social Engineering**
   - Phishing attacks against team members
   - Pretexting or vishing

4. **Smart Contract Logic**
   - Soroban contract vulnerabilities (covered by separate smart contract audit)
   - On-chain authorization and state machine correctness

5. **Client-Side Browser Attacks** (unless integrated testing is requested)
   - Browser extension compromise
   - XSS in frontend (separate frontend security review)

6. **Third-Party Services**
   - SMTP provider security (SendGrid, AWS SES)
   - SMS provider security (Twilio)
   - Upstream trust verification APIs

### Vendor Selection Criteria

#### Required Qualifications

1. **Experience Requirements**
   - Minimum 3 years conducting penetration tests for financial or blockchain protocols
   - Demonstrated experience with Node.js/TypeScript application security
   - Familiarity with Stellar network and Soroban smart contracts (preferred but not required)
   - Published security research or CVE discoveries (preferred)

2. **Methodology Standards**
   - Follows OWASP Testing Guide v4+ or equivalent
   - Uses industry-standard tools (Burp Suite, OWASP ZAP, etc.)
   - Provides detailed reproduction steps for each finding
   - Offers remediation guidance and retest services

3. **Reporting Standards**
   - Delivers executive summary suitable for stakeholders
   - Provides technical details with evidence (screenshots, requests/responses)
   - Classifies findings by severity (Critical, High, Medium, Low, Informational)
   - Includes exploitability and business impact assessment

4. **Communication and Availability**
   - Responsive during testing period (within 24 hours for critical findings)
   - Willing to present findings to engineering team
   - Available for remediation validation retest

#### Preferred Vendors

The following vendors have relevant experience in the Stellar/Soroban ecosystem or blockchain security:

1. **Trail of Bits** - Blockchain and smart contract auditing
2. **Kudelski Security** - Financial infrastructure penetration testing
3. **Bishop Fox** - Application security and API testing
4. **Cure53** - Specialized in open-source and web application security
5. **NCC Group** - Blockchain and fintech security assessments

**Note**: Final vendor selection requires quotes, availability, and reference checks.

### Remediation Tracking Process

#### Severity Classification

Findings are triaged using the following severity levels:

| Severity | Definition | Example | Response SLA |
|----------|------------|---------|--------------|
| **Critical** | Exploitable vulnerability with direct impact on funds, data confidentiality, or service availability | Authentication bypass, SQL injection with data exfiltration, RCE | Fix within 24 hours, deploy emergency patch |
| **High** | Vulnerability requiring moderate effort to exploit with significant business impact | Privilege escalation, IDOR exposing sensitive data, rate limiting bypass | Fix within 7 days, deploy in next release |
| **Medium** | Vulnerability requiring significant effort to exploit or with limited business impact | Information disclosure, weak cryptography, missing security headers | Fix within 30 days, prioritize in backlog |
| **Low** | Vulnerability with minimal exploitation risk or negligible business impact | Verbose error messages, missing HSTS, outdated dependencies | Fix within 90 days or accept risk |
| **Informational** | Security best practice recommendation without direct exploitability | Security documentation gaps, code quality improvements | Address as capacity allows |

#### Triage Workflow

1. **Initial Review** (Within 24 hours of finding delivery)
   - Security team reviews finding for validity
   - Assigns preliminary severity
   - Identifies affected components and maintainers

2. **Validation** (Within 48 hours)
   - Engineering team reproduces the finding
   - Confirms exploitability and business impact
   - Adjusts severity if necessary (with justification)

3. **Remediation Planning** (Within 72 hours)
   - Engineering team proposes fix approach
   - Estimates fix complexity and timeline
   - Identifies dependencies or blockers

4. **Implementation** (Per SLA above)
   - Developer implements fix
   - Code review by security-aware reviewer
   - Unit and integration tests added to prevent regression

5. **Verification** (Within 7 days of fix deployment)
   - Internal validation of fix
   - Request vendor retest for Critical/High findings
   - Document fix in remediation tracker

6. **Closure** (After verification)
   - Mark finding as remediated
   - Update security documentation if necessary
   - Share learnings with team to prevent similar issues

#### Remediation Tracker

All findings are tracked in a dedicated GitHub project board with the following columns:

- **Backlog**: New findings awaiting triage
- **Triaged**: Validated and assigned severity
- **In Progress**: Fix under development
- **Pending Verification**: Fix deployed, awaiting retest
- **Closed**: Verified as remediated
- **Accepted Risk**: Finding acknowledged but not fixed (requires justification)

Each finding is a GitHub issue with the following labels:

- `security`: All findings
- `pentest`: Findings from external pentest
- `severity/critical`, `severity/high`, `severity/medium`, `severity/low`, `severity/info`
- `component/indexer`, `component/oracle`, `component/notifications`, `component/sdk`

#### Accepted Risk Process

Some findings may be accepted as residual risk rather than remediated, but this requires explicit justification and sign-off:

1. **Business Impact Assessment**: Quantify the risk in terms of likelihood and consequence
2. **Compensating Controls**: Document existing controls that mitigate the risk
3. **Remediation Cost**: Justify why the fix cost exceeds the risk
4. **Sign-Off**: Requires approval from:
   - Engineering Lead
   - Security Team
   - Product Owner (for user-facing impacts)

Accepted risks must be documented in `docs/threat-model.md` and reviewed annually.

### Timeline and Budget

#### Estimated Timeline

- **Vendor selection and contracting**: 2-3 weeks
- **Pre-engagement planning**: 1 week
  - Provide test environment access
  - Share API documentation and architecture diagrams
  - Define out-of-scope constraints
- **Active penetration testing**: 2-4 weeks
  - Depends on scope and vendor availability
  - May run concurrently with remediation of early findings
- **Report delivery**: 1 week after testing completion
- **Remediation period**: 4-8 weeks
  - Depends on finding severity and complexity
- **Retest**: 1 week
- **Final report**: 1 week after retest

**Total estimated duration**: 12-18 weeks from vendor selection to final report

#### Estimated Budget

Budget estimates are based on industry norms for similar engagements:

- **Small Scope** (SDK only, 1 week testing): 15k - 25k USD
- **Medium Scope** (Indexer + Oracle, 2 weeks testing): 30k - 50k USD
- **Large Scope** (All services as defined above, 4 weeks testing): 60k - 100k USD
- **Retest** (typically included or 10-20% of original engagement)

**Recommendation**: Start with Medium Scope focusing on Indexer and Oracle (highest risk), expand to full scope if budget allows.

### Pre-Engagement Preparation

Before engaging a vendor, the engineering team must complete:

1. **Environment Setup**
   - Deploy isolated test environment matching production configuration
   - Provide test accounts with various permission levels
   - Prepare sanitized test data (no real PII or sensitive data)

2. **Documentation Package**
   - API documentation (OpenAPI/GraphQL schemas)
   - Architecture diagrams (from `docs/architecture.md`)
   - Threat model (from `docs/threat-model.md`)
   - Known security controls and mitigations

3. **Rules of Engagement**
   - Define testing windows (if applicable)
   - Emergency contact list for critical findings
   - Rate limiting exceptions for testing traffic
   - Baseline metrics for detecting testing impact

4. **Internal Readiness**
   - Security team availability during testing period
   - Engineering team capacity for rapid remediation
   - Stakeholder communication plan for findings

### Post-Engagement Activities

After the final report is delivered and findings are remediated:

1. **Lessons Learned Session**
   - Review findings with full engineering team
   - Identify systemic issues or patterns
   - Update secure coding guidelines and review checklists

2. **Security Audit Report Update**
   - Incorporate pentest findings into this document
   - Document remediation actions taken
   - Update threat model with newly identified risks

3. **Public Disclosure** (if appropriate)
   - Consider publishing executive summary for transparency
   - Highlight security investment and remediation efforts
   - Coordinate with vendor on co-marketing opportunities

4. **Schedule Next Audit**
   - Plan for annual penetration testing before major releases
   - Budget for ongoing security assessments

### References

- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [PTES - Penetration Testing Execution Standard](http://www.pentest-standard.org/)
- [Threat Model](./threat-model.md)
- [Security Guide](./security-guide.md)
- [Incident Response](./incident-response.md)

### Approval and Sign-Off

This penetration test scoping document requires approval from:

- [ ] Engineering Lead: _______________________
- [ ] Security Team Lead: _______________________
- [ ] Product Owner: _______________________
- [ ] Budget Approval: _______________________

**Date**: _______________________

**Next Review Date**: _______________________

