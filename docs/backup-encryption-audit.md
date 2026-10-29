# Backup Retention and Encryption-at-Rest Audit

**Audit Date:** 2026-09-28  
**Scope:** Indexer service and Oracle service persisted data  
**Compliance Context:** Mainnet readiness, external audit preparation, privacy.md alignment

---

## Executive Summary

This audit systematically enumerates every persisted data store in the indexer and oracle-service, verifies encryption-at-rest configuration, confirms backup retention duration, and documents findings against documented policy in `docs/privacy.md`.

**Key Findings:**
- ✅ Indexer database backup mechanism is comprehensive (local + cloud, manifest verification)
- ✅ Archival strategy documented (90-day active, archive to separate database)
- ⚠️ **CRITICAL GAP:** No encryption-at-rest specified for SQLite databases (local or cloud backups)
- ⚠️ **CRITICAL GAP:** Redis cache in oracle-service has no documented backup or persistence strategy
- ⚠️ **MODERATE GAP:** Cloud backup encryption depends on cloud provider defaults (not explicitly enforced)
- ✅ Data retention policy documented and aligned across services

**Remediation:** See section 5 below.

---

## 1. Indexer Service Persisted Data Stores

### 1.1 Main SQLite Database (`indexer.db`)

| Property | Current State |
|----------|---|
| **Storage Type** | SQLite (better-sqlite3) |
| **Location** | Configurable via `DB_PATH` env var (default: `./indexer.db`) |
| **Data Contained** | Indexed invoices, events, protocol state snapshots |
| **Encryption-at-Rest** | ❌ **NOT CONFIGURED** — SQLite supports encryption via SEE (SQLite Encryption Extension, proprietary) or WAL mode, but none are configured by default |
| **Backup Strategy** | Automated via `BackupManager` (enabled via `BACKUP_ENABLED=true`) |
| **Backup Interval** | Configurable via `BACKUP_INTERVAL_MS` (default: 24 hours) |
| **Local Retention** | Configurable via `BACKUP_MAX_LOCAL` (default: 30 backups = ~30 days at daily cadence) |
| **Cloud Backup** | Supported via S3, GCS, or Azure (`BACKUP_CLOUD_PROVIDER`, `BACKUP_CLOUD_BUCKET`) |
| **Cloud Encryption** | ❌ **NOT ENFORCED** — Relies on cloud provider defaults (S3: SSE-S3 by default, GCS: Google-managed keys by default, Azure: Storage Service Encryption by default). No mechanism to enforce customer-managed key (CMK) encryption or key rotation. |
| **Backup Verification** | ✅ Manifest includes SHA-256 checksum and SQLite `PRAGMA integrity_check` |

**Files:**
- `indexer/src/backup.ts` — Backup manager implementation
- `indexer/src/config.ts` — Backup configuration and environment variables
- `.github/workflows/indexer-backup.yml` — Automated backup GitHub Actions workflow

### 1.2 Archive Database (Secondary SQLite)

| Property | Current State |
|----------|---|
| **Storage Type** | SQLite (attached database in `archive.ts`) |
| **Location** | Configurable via `BACKUP_DIR` (default: `./backups/`) but stored alongside active database |
| **Data Contained** | Archived invoices older than `ARCHIVE_OLDER_THAN_DAYS` (default: 90 days) |
| **Encryption-at-Rest** | ❌ **NOT CONFIGURED** — Same as main database |
| **Archival Schedule** | Configurable via `ARCHIVE_INTERVAL_MS` (default: 24 hours) |
| **Archival Trigger** | Automated if `ARCHIVE_ENABLED=true` (default) |
| **Retention Policy** | Invoices/events older than 90 days are moved to archive; no automatic purge of archive itself |
| **Backup** | Archive database is backed up as part of the main backup cycle |

**Files:**
- `indexer/src/archive.ts` — Archive and restore logic
- `docs/privacy.md` section 2 — Retention policy documentation

### 1.3 Backup Manifests (JSON)

| Property | Current State |
|----------|---|
| **Storage Type** | JSON files (`.manifest.json`) alongside backup files |
| **Location** | `BACKUP_DIR` (default: `./backups/`) |
| **Data Contained** | Timestamp, filename, size, SHA-256 checksum, ledger sequence, verification status |
| **Encryption-at-Rest** | ❌ **NOT CONFIGURED** |
| **Retention** | Follows backup retention (pruned alongside old backups) |
| **Risk** | Low — manifests contain no sensitive user data, only backup metadata |

---

## 2. Oracle-Service Persisted Data Stores

### 2.1 Redis Cache

| Property | Current State |
|----------|---|
| **Storage Type** | Redis (in-memory with optional persistence) |
| **Location** | Configurable via `REDIS_URL` env var (e.g. `redis://localhost:6379`) |
| **Data Contained** | Payer verification results, fraud detection signals, cache TTLs (30–300s) |
| **Persistence Strategy** | ❌ **NOT EXPLICITLY DEFINED** — Redis is configured as a cache with TTLs but no documentation on whether RDB snapshots or AOF persistence is enabled |
| **Encryption-at-Rest** | ❌ **NOT CONFIGURED** — Redis does not encrypt at rest by default; requires either managed Redis (e.g. AWS ElastiCache with encryption) or Redis Enterprise with encryption module |
| **Backup Strategy** | ❌ **NOT DEFINED** — No backup mechanism documented for Redis cache |
| **TTL Strategy** | ✅ Asymmetric TTLs: clean verdicts (30s for active payers, 300s otherwise), flagged verdicts (300s full). Documented in `oracle-service/src/cache.ts` |
| **Fallback Mode** | ✅ Last-known-good store preserved in degraded mode (when external verification provider is unreachable) |

**Files:**
- `oracle-service/src/cache.ts` — Cache implementation with TTL logic
- `oracle-service/src/cacheRedis.test.ts` — Redis cache tests
- `oracle-service/package.json` — Lists redis as dependency

### 2.2 Last-Known-Good Degraded-Mode Store

| Property | Current State |
|----------|---|
| **Storage Type** | In-memory Map (JavaScript) or potentially persisted in future iterations |
| **Location** | Oracle-service process memory; not persisted to disk |
| **Data Contained** | Most recent verification result for each payer (regardless of verdict) |
| **Encryption-at-Rest** | N/A — in-memory only |
| **Retention** | Lives for the process lifetime; cleared on restart |
| **Purpose** | Enables degraded-mode operation when external verification provider is unavailable |
| **Risk** | Loss of state on service restart; mitigated by short TTLs (cache will re-populate on next requests) |

**Files:**
- `oracle-service/src/composition.ts` — Degraded-mode logic
- `oracle-service/src/degraded-mode.test.ts` — Degraded-mode tests

---

## 3. Notifications Service Persisted Data (Reference)

For completeness, the notifications service data stores are documented in `docs/privacy.md` and are **out of scope for this audit** (separate service, separate audit trail).

| Component | Retention |
|-----------|-----------|
| Notification preferences | Until user updates or deletes |
| Subscriptions | Until `DELETE /unsubscribe` |
| Delivery logs | 30–90 days per type |

---

## 4. Compliance Against `docs/privacy.md`

### Policy Claims

`docs/privacy.md` states:

> "All indexed data is strictly derived from public on-chain ledgers. Historical indexed data is retained indefinitely to support network analytics and query resolution, but contains no off-chain Personally Identifiable Information (PII)."

**Audit Finding:** ✅ **ALIGNED** — Indexer archive strategy (90-day active, perpetual archive) matches this claim. Archive database is retained indefinitely.

### Encryption Claims

`docs/privacy.md` makes **no explicit claims** about encryption-at-rest for indexer or oracle-service databases. This is a documentation gap.

---

## 5. Critical Gaps and Remediation

### GAP 1: SQLite Database Encryption (CRITICAL)

**Scope:** Indexer main database, archive database, backup files  
**Risk:** At-rest data exposure if disk/storage is compromised  
**Remediation Options:**

1. **Option A (Recommended for mainnet): SQLite SEE (Encryption Extension)**
   - Requires purchasing SQLite SEE license (~$2000/year per server)
   - Native encryption integrated into SQLite
   - Transparent to application code
   - Implementation: Add `PRAGMA key = 'your-encryption-key'` at connection time
   - Key rotation: Documented via `PRAGMA rekey` (requires key management infrastructure)

2. **Option B: WAL Mode with Full-Disk Encryption**
   - Rely on OS-level encryption (LUKS, BitLocker, etc.)
   - Simpler for on-premises; requires infrastructure setup
   - No per-database key management
   - Acceptable for single-operator deployments

3. **Option C: Application-Level Encryption**
   - Encrypt sensitive columns before SQLite storage
   - Complex; only indexer data is public on-chain so limited value
   - Not recommended for this use case

**Recommendation:** Adopt **Option A (SQLite SEE)** for mainnet; **Option B** for testnet during development.

**Action Items:**
- [ ] Evaluate SQLite SEE licensing for deployment targets
- [ ] Add `PRAGMA key` initialization in `indexer/src/db.ts`
- [ ] Update config to support `DB_ENCRYPTION_KEY` environment variable
- [ ] Test backup/restore cycle with encrypted database
- [ ] Add key rotation procedure to runbooks
- [ ] Document in `DEPLOYMENT_GUIDE.md`

### GAP 2: Cloud Backup Encryption Policy (CRITICAL)

**Scope:** S3, GCS, and Azure backups  
**Risk:** Cloud provider default encryption is not customer-managed; key rotation and key ownership unclear  
**Remediation:**

1. **S3:** Enforce customer-managed key (CMK) encryption via AWS KMS
   - Update backup.ts `uploadToS3()` to pass `--sse aws:kms --sse-kms-key-id <KEY_ARN>`
   - Require `BACKUP_S3_KMS_KEY_ID` environment variable
   - Document key rotation policy

2. **GCS:** Enforce customer-managed encryption key (CMEK)
   - Update backup.ts `uploadToGcs()` to use `gsutil -m cp` with `--encryption-key` flag
   - Require `BACKUP_GCS_ENCRYPTION_KEY` environment variable

3. **Azure:** Enforce customer-managed key (CMK) encryption
   - Update backup.ts `uploadToAzure()` to use `az storage blob upload --encryption-scope <SCOPE>`
   - Require `BACKUP_AZURE_ENCRYPTION_SCOPE` environment variable

**Action Items:**
- [ ] Update `backup.ts` to support customer-managed encryption for all three cloud providers
- [ ] Add encryption key configuration environment variables
- [ ] Update `config.ts` to include encryption key references
- [ ] Test encrypted backup upload and restore
- [ ] Document key management procedures in `DEPLOYMENT_GUIDE.md`
- [ ] Update `privacy.md` to include encryption claims

### GAP 3: Oracle-Service Redis Persistence & Encryption (MODERATE)

**Scope:** Redis cache used by oracle-service  
**Risk:** Cache data loss on restart; no backup strategy; no encryption  
**Current Behavior:** Redis cache has short TTLs (30–300s), so loss on restart is low-impact (cache will re-populate on next requests). Last-known-good store is in-memory only.

**Remediation Options:**

1. **Option A (Recommended): Use Managed Redis with Encryption**
   - AWS ElastiCache, Google Cloud Memorystore, Azure Cache for Redis all support encryption at rest and in transit
   - No application code changes required
   - Automatic backup/restore handling
   - Implementation: Update `REDIS_URL` to point to managed service

2. **Option B: Redis Enterprise with Encryption**
   - Self-managed Redis with encryption module
   - Requires operational overhead for key management
   - Acceptable if cloud provider constraints exist

3. **Option C: No Encryption (Testnet Only)**
   - Accept cache loss on restart as acceptable for cache-only data
   - Update documentation to clarify this is testnet-only

**Action Items:**
- [ ] Document Redis encryption requirements in `DEPLOYMENT_GUIDE.md`
- [ ] Specify managed Redis service for production deployments
- [ ] Test oracle-service against managed Redis with encryption enabled
- [ ] Document cache re-population behavior on service restart
- [ ] Update `privacy.md` with oracle-service data retention and encryption claims

### GAP 4: Redis Backup Strategy (MODERATE)

**Scope:** Oracle-service last-known-good store  
**Risk:** No explicit backup of degraded-mode fallback cache  
**Impact:** If Redis is unavailable AND external verification provider is unavailable, service returns errors instead of serving stale results  
**Current Mitigation:** Last-known-good store is in-memory; acceptable loss on restart given short cache TTLs

**Remediation (Optional):**
- [ ] Add periodic RDB snapshot export for audit trail (non-blocking)
- [ ] Document degraded-mode recovery procedures

---

## 6. Backup Retention Duration Verification

### Indexer Backups

| Backup Type | Retention Duration | Policy Reference | Status |
|---|---|---|---|
| Local backups | ~30 days (configurable via `BACKUP_MAX_LOCAL=30`) | N/A — operational default | ✅ Aligned |
| Cloud backups | Indefinite (no purge configured) | `docs/privacy.md` — "historical data retained indefinitely" | ✅ Aligned |
| Archive database | Indefinite | `docs/privacy.md` section 2 | ✅ Aligned |

### Notifications Service (Reference)

| Log Type | Retention Duration | Policy Reference | Status |
|---|---|---|---|
| Delivery logs | 30–90 days | `docs/privacy.md` section 1c | ✅ Aligned |
| Delivery audit log | 90 days | `docs/privacy.md` section 1c | ✅ Aligned |

---

## 7. Deployment Checklist

Before mainnet deployment, verify:

- [ ] SQLite SEE license purchased and configured
- [ ] `DB_ENCRYPTION_KEY` environment variable set in all deployment environments
- [ ] Backup cycle tested with encrypted SQLite database
- [ ] Cloud backup encryption keys provisioned (AWS KMS, GCS CMEK, Azure CMK)
- [ ] `BACKUP_S3_KMS_KEY_ID` / `BACKUP_GCS_ENCRYPTION_KEY` / `BACKUP_AZURE_ENCRYPTION_SCOPE` configured
- [ ] Test restore from encrypted backup
- [ ] Managed Redis service provisioned with encryption at rest
- [ ] `REDIS_URL` updated to point to encrypted Redis
- [ ] `docs/privacy.md` updated with encryption claims
- [ ] `DEPLOYMENT_GUIDE.md` updated with key management and backup procedures
- [ ] Incident runbook includes key compromise scenarios
- [ ] External auditor has reviewed backup and encryption configuration

---

## 8. Evidence and References

**Audit Trail:**

- Indexer backup configuration: `indexer/src/backup.ts`, `indexer/src/config.ts`
- Indexer archive logic: `indexer/src/archive.ts`
- Indexer database setup: `indexer/src/db.ts`
- Oracle-service cache: `oracle-service/src/cache.ts`, `oracle-service/src/cacheRedis.test.ts`
- Notifications retention: `notifications/src/db.ts`, `docs/privacy.md`
- Policies: `docs/privacy.md`

**Tested On:**
- Indexer: better-sqlite3 v11.0.0
- Oracle-service: redis v4.7.0
- Node.js: 20+

---

**Audit Sign-Off:**

This audit was completed on 2026-09-28 and covers all persisted data stores in indexer and oracle-service as of commit `ab2b78c`. Findings and remediation actions are documented above. All critical gaps must be addressed before mainnet deployment.

**Next Steps:**
1. Prioritize GAP 1 (SQLite encryption) and GAP 2 (cloud backup encryption)
2. Create GitHub issues for each remediation action
3. Coordinate with infrastructure/DevOps for key management setup
4. Schedule re-audit after remediations are implemented
