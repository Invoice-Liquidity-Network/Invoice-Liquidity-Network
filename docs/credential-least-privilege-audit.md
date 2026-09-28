# Service-to-Service Credential & IAM Least-Privilege Audit — Issue #1083

**Date:** 2026-09-25
**Scope:** `indexer`, `oracle-service`, `notifications` services
**Status:** Initial audit — tighten before mainnet

## Overview

This document enumerates every service-to-service credential and cloud IAM role
in use across the three backend services, identifies the minimum required
permission set, and documents the tightened configuration. Future credential
additions must default to least-privilege and be recorded here.

## Credential Inventory

### 1. Indexer

| Credential | Purpose | Current Access | Minimum Required | Status |
|---|---|---|---|---|
| Stellar RPC key | Read-only ledger queries | `soroban_testnet` full access | Read-only RPC (simulate, getEvents, getLedgerEntry) | ✅ Already minimal |
| SQLite DB path | Local event store | Filesystem read/write | Read/write to `indexer.db` only | ✅ Already minimal |
| Redis URL (optional) | API response caching | Full Redis instance | `GET`/`SET` on `indexer:*` keys only | ⚠️ Tighten: restrict to key prefix |
| Railway deployment token | CI/CD deployment | Full project access | Deploy only (no env var read) | ⚠️ Tighten: restrict scope |

### 2. Oracle Service

| Credential | Purpose | Current Access | Minimum Required | Status |
|---|---|---|---|---|
| Stellar RPC URL | On-chain reputation reads | `soroban_testnet` full access | Read-only RPC (simulate invoke) | ✅ Already minimal |
| Redis URL (optional) | Verdict caching | Full Redis instance | `GET`/`SET` on `oracle:*` keys only | ⚠️ Tighten: restrict to key prefix |
| Indexer internal URL | Invoice history lookup | HTTP GET to indexer | `GET /v1/history/:payer` only | ✅ Already minimal |
| Railway deployment token | CI/CD deployment | Full project access | Deploy only | ⚠️ Tighten: restrict scope |

### 3. Notifications

| Credential | Purpose | Current Access | Minimum Required | Status |
|---|---|---|---|---|
| Webhook signing secret | Sign outbound webhooks | HMAC-SHA256 signing | Signing only (no encryption) | ✅ Already minimal |
| Redis URL (optional) | Webhook delivery queue | Full Redis instance | `LPUSH`/`BRPOP` on `notifications:*` only | ⚠️ Tighten: restrict to key prefix |
| Railway deployment token | CI/CD deployment | Full project access | Deploy only | ⚠️ Tighten: restrict scope |

## Recommended Actions

### Redis Key Prefix Isolation

All three services share Redis in production. Add connection-level key
prefixing so each service can only access its own namespace:

```bash
# Indexer
REDIS_URL=redis://localhost:6379/0
# Prefix all keys with "indexer:" in code

# Oracle
REDIS_URL=redis://localhost:6379/1
# Prefix all keys with "oracle:" in code

# Notifications
REDIS_URL=redis://localhost:6379/2
# Prefix all keys with "notif:" in code
```

### Railway Deployment Tokens

Restrict each service's Railway token to deploy-only scope:
- Remove "Environment Variables" read permission
- Remove "Metrics" read permission
- Keep only "Deployments" create/read

### Environment Variable Access

No service should read another service's environment variables. Verify
that each service's `.env.example` only lists its own required variables.

## Audit Checklist

- [ ] Redis key prefix isolation implemented
- [ ] Railway tokens scoped to deploy-only
- [ ] No cross-service env var access
- [ ] Stellar RPC keys are read-only (no submitTransaction)
- [ ] Webhook signing secrets are not logged
- [ ] All credentials rotated within 90 days of this audit
- [ ] `SECURITY.md` updated with credential handling guidelines

## Maintenance

This document must be updated whenever:
1. A new service-to-service credential is added
2. A credential's scope is changed
3. A credential is rotated
4. A new service is onboarded

Review this audit quarterly or before any mainnet deployment milestone.
