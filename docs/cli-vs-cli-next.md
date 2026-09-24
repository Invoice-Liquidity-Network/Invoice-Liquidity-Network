# `cli/` vs `packages/cli` (resolved 2026-08-25)

> **Status: Resolved.** `packages/cli` has been removed. `cli/`
> (`@invoice-liquidity/cli`) is the single, canonical CLI. This document is
> kept for historical context and to explain where each of `packages/cli`'s
> unique commands ended up.

## Background

The repo used to ship two separate CLI packages that both described
themselves as "Command-line interface for the Invoice Liquidity Network":

| | `cli/` | `packages/cli` (removed) |
|---|---|---|
| Published name | `@invoice-liquidity/cli` | `@iln/cli` |
| SDK dependency | `@iln/sdk` (`sdk/`) | `@iln/sdk` (`sdk/`) |
| Documented in root `README.md` | Yes ([`cli/README.md`](../cli/README.md)) | No |
| Command surface | `submit`, `fund`, `pay`, `status`, `list`, `history`, `compat`, `config`, `xdr`, `dashboard`, `generate`, `dev`, `wallet`, `interactive`, `tutorial`, `man`, `alias` | `invoice submit/fund/pay/get/list/watch/export/stats`, `reputation get`, `network switch` |

`packages/cli` was never published to npm (`private: true`) and was
undocumented outside its own `package.json` description.

## Decision: fold `packages/cli`'s unique commands into `cli/`, then remove it

`packages/cli` had five commands with no equivalent in `cli/`: `invoice
watch`, `invoice export`, `stats`, `reputation get`, and `network switch`.
Everything else in `packages/cli` (`invoice submit/fund/pay/get/list`) was a
smaller-surface duplicate of commands `cli/` already had.

Because `cli/` was already the canonical, documented, larger-surface CLI —
and both packages depended on the exact same SDK (`@iln/sdk` in `sdk/`),
making this independent of the `sdk` vs `sdk-next` positioning tracked in
[monorepo-map.md](monorepo-map.md) — folding the unique commands into `cli/`
and retiring `packages/cli` outright was the lower-cost, lower-confusion
path versus maintaining command parity across two packages indefinitely.

### Where each command landed in `cli/`

| `packages/cli` command | `cli/` equivalent |
|---|---|
| `invoice submit` | `iln submit` (already existed) |
| `invoice fund` | `iln fund` (already existed) |
| `invoice pay` | `iln pay` (already existed) |
| `invoice get` | `iln status` (already existed) |
| `invoice list` | `iln list` (already existed) |
| `invoice watch` | `iln watch` (new) |
| `invoice export` | `iln export` (new) |
| `stats` | `iln stats` (new) |
| `reputation get` | `iln reputation get` (new) |
| `network switch` | `iln network switch` (new) |

Each new command has parity tests in [`cli/tests/cli.test.ts`](../cli/tests/cli.test.ts).

## For contributors

- Install `@invoice-liquidity/cli` (`cli/`). It is the only CLI in this
  repository.
- New CLI commands are added to `cli/` going forward.
