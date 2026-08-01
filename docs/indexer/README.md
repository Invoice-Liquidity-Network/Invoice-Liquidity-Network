# ILN Indexer Documentation

> **Two indexer packages exist in this repository. They are not duplicates —
> they serve different purposes and use different data sources. This page
> explains each one and when to use which.**

---

## Which indexer do you need?

| | `indexer/` (`iln-indexer`) | `packages/indexer/` (`@iln/indexer`) |
|---|---|---|
| **What it is** | Full production deployment service | Publishable client-side utility library |
| **Data source** | Stellar **Soroban RPC** (`getEvents`) | Stellar **Horizon REST API** (transaction history + SSE) |
| **Deployed?** | Yes — Railway (`Procfile`, `railway.toml`) | No — imported as an npm package |
| **Storage** | SQLite + optional Redis cache | Stateless (no persistence) |
| **API surface** | REST + GraphQL + metrics + rate limiting | `ILNEventIndexer` class — typed async methods + SSE subscribe |
| **Event type vocab** | `submitted`, `funded`, `paid`, `defaulted` | `InvoiceCreated`, `InvoiceFunded`, `InvoiceRepaid`, `InvoiceDefaulted` |
| **Runtime deps** | Express, Apollo, better-sqlite3, ioredis, prom-client, … | `@stellar/stellar-sdk` only |
| **Test runner** | Vitest | Jest |
| **Consumes the other?** | **No** — developed independently, no shared code | **No** — independent implementation |

### When to use `indexer/`

You are running or developing the **backend indexing service** that powers the
ILN frontend and API. This is the canonical, deployed indexer. It polls the
Soroban RPC node on a configurable interval, persists state to SQLite, and
exposes a REST and GraphQL API for the frontend to query.

### When to use `@iln/indexer`

You are building a **frontend component, external tool, or analytics script**
that needs to query or stream ILN contract events directly from Horizon —
without running the full indexer service. It wraps Horizon's cursor-based
pagination and SSE streaming behind a clean typed API.

### Why they diverged

The two packages were developed independently to solve the same underlying
problem from different angles. `indexer/` targets the Soroban RPC `getEvents`
endpoint (the primary event source for Soroban contracts) and was built as the
production service. `packages/indexer/` targets the Horizon transaction history
API, which is more accessible from browser/client contexts but has a different
event shape. They have never shared code and currently have **no declared
dependency on each other** — `indexer/package.json` does not reference
`@iln/indexer`.

The practical consequence is two separate event-type vocabularies. Any code
that processes events from both sources must map between them. See
[`docs/indexer-data-model.md`](../indexer-data-model.md) for the canonical
on-chain event types and how each package represents them.

---

## `indexer/` — production service

The ILN Indexer is a service that indexes events from the Invoice Liquidity Network Soroban contract and provides a REST API for querying invoice data, protocol statistics, and liquidity provider information.

## Table of Contents

- [Architecture](./architecture.md) - System design and component overview
- [API Reference](./api-reference.md) - Complete REST API documentation
- [Deployment Guide](./deployment.md) - Instructions for deploying the indexer
- [Configuration](./configuration.md) - Environment variables and settings
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start the indexer
npm run start
```

The indexer will start polling for contract events and serve the REST API on port 3001 (configurable).

## Features

- **Event Indexing**: Automatically indexes all ILN contract events (invoice submissions, fundings, payments, defaults)
- **REST API**: Query invoices, protocol stats, LP statistics, and freelancer data
- **Caching**: Optional Redis caching for improved API performance
- **Rate Limiting**: Built-in rate limiting for public API access
- **Pagination**: Cursor-based pagination for large result sets
- **Health Monitoring**: Health check endpoint with database status

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Stellar   │────▶│   Poller    │────▶│  Processor  │
│   RPC Node  │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   Cursor    │     │   SQLite    │
                    │  Management │     │  Database   │
                    └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │  REST API   │
                                       │  (Express)  │
                                       └─────────────┘
```

## Components

### Poller
Continuously polls the Stellar RPC node for new contract events. Uses cursor-based pagination to efficiently fetch events in batches.

### Processor
Processes each event, deduplicates using event IDs, and upserts invoice data into SQLite.

### REST API
Express-based HTTP server providing endpoints for querying indexed data. Includes caching, rate limiting, and health checks.

### Database
SQLite database storing invoices, events, and cursor state. Uses WAL mode for better concurrent read performance.

---

## `packages/indexer/` — Horizon client library

`@iln/indexer` is a separate, publishable utility package. It wraps the
Stellar **Horizon** REST API (not the Soroban RPC) with typed cursor-based
pagination and SSE streaming. It has no persistent storage and is intended
to be imported into frontend apps or analytics tooling.

```
packages/indexer/
├── src/
│   ├── index.ts           # Public exports
│   ├── indexer.ts         # ILNEventIndexer class
│   ├── horizon-client.ts  # HTTP pagination + SSE
│   ├── parse.ts           # parseContractEvent adapter
│   └── types.ts           # Shared TypeScript types
└── __tests__/
    └── indexer.test.ts
```

See [`packages/indexer/README.md`](../../packages/indexer/README.md) for
the full API reference and usage examples.

### Event vocabulary difference

The two packages use different string values for the same on-chain events
because they read from different APIs (Soroban RPC vs Horizon) that expose
different raw payloads:

| On-chain action | `indexer/` (`iln-indexer`) | `@iln/indexer` |
|---|---|---|
| Invoice submitted | `submitted` | `InvoiceCreated` |
| Invoice funded | `funded` | `InvoiceFunded` |
| Invoice paid | `paid` | `InvoiceRepaid` |
| Invoice defaulted | `defaulted` | `InvoiceDefaulted` |

The canonical event names come from the Soroban contract and are used by
`indexer/`. The `@iln/indexer` names reflect the shape of Horizon's
transaction metadata. If you process events from both sources, you must
map between these two vocabularies explicitly.
