# CLI Consolidation and Completeness Audit

> **Status: complete for the historical `packages/cli` migration.** There is
> no `cli-next` package in this repository. The old `packages/cli` package
> (`@iln/cli`) was removed after its unique commands were ported to the
> published, documented canonical CLI in `cli/` (`@invoice-liquidity/cli`).

## Corrected scope and retirement status

Issue #1120 refers to `cli-next`, but the repository history and current
workspace describe a different migration: `packages/cli` was consolidated
into `cli/` and removed. The canonical CLI is not a legacy package awaiting
retirement. It remains the supported CLI, so there is no retirement date for
`cli/`. The duplicate package's retirement is already complete; any future
replacement must be treated as a new migration and must pass command, option,
behavior, documentation, and test parity before retirement is scheduled.

The current command tree is implemented by [`cli/src/cli.ts`](../cli/src/cli.ts)
and supplemented by completion, environment, and inspect commands registered
at runtime. Its surfaces are:

| Command group | Commands and principal options / behavior |
|---|---|
| Invoice lifecycle | `submit` (alias `s`; `--payer`, `--amount`, `--due`, `--rate`, `--token`, `--yes`); `fund` (alias `f`; `--id`, `--amount`, `--yes`); `pay` (alias `p`; `--id`, `--yes`); `status` (`--id`, `--yes`); `list` (`--address`, `--yes`); `history` (`--address`, `--id`, `--action`, `--limit`, `--format` defaulting to `table`, `--yes`); `watch <required --id>` (`--interval`, default `3000` ms); `export` (`--address`, `--output`, default `invoices.csv`) |
| Analytics and protocol | `stats` (`--api-url`); `reputation get [address]` (defaults to configured signer); `protocol-config`; `compat check` |
| Network and local configuration | `network switch <target>` (`testnet`, `mainnet`, `standalone`); `config init` (`--cwd`) and `config show`; `alias list` (`--json`), `alias add <alias> <command>`, `alias remove`/`rm <alias>` |
| Developer and inspection | `xdr decode [base64]`; `dashboard` (`--refresh`, default `5000` ms; `--export`); `generate [template]` (`--list`, `--preview`, `--out` default `.`, repeatable `--var`); `dev start`, `stop`, `reset`, `status` (`--json`), `seed` (`--scenario`, `--count` default `1`, `--token`); `inspect invoice <id>` (`--format`, default `json`); `env list` (`--json`), `use <name>`, `create <name>` (`--contract-id`, `--rpc-url`, `--network-passphrase`, optional `--keypair-path`), `delete <name>` (interactive confirmation), `show <name>` (`--json`); `completion [shell]` (`bash` default; `bash` or `zsh`) |
| Wallet and help | `wallet create` (`--name`, `--password`), `import` (`--name`, `--secret`, `--password`), `list` (`--json`), `fund` (`--name`, `--password`, `--friendbot` defaulting to Stellar Friendbot), `delete` (`--name`); `interactive`; `tutorial`; `man [command]`; `update [version]`; `changelog [version]` |

Global behavior includes `--version`/`-v`, `--json` where supported, and
`--quiet`. Invoice commands resolve configuration and signer state, support
interactive missing-argument prompts unless `--yes` is supplied, and accept
invoice IDs from stdin. Custom aliases are read from `.ilnrc.json`; built-in
aliases are `s` → `submit`, `f` → `fund`, and `p` → `pay`. Output includes
human-readable and command-specific JSON forms, structured errors, progress
indicators, and command help/man/completion. Environment management persists
named network settings; wallets are locally encrypted; developer commands
start/stop/reset a local Stellar environment and seed accounts. Exact output
and side effects remain command-specific. The table includes declared
arguments/options and defaults visible in the parser plus registered `env` and
`inspect` handlers; it does not imply that every option has an individual
execution test.

## Former duplicate-package parity

| Removed `packages/cli` command | Canonical `cli/` equivalent | Verification |
|---|---|---|
| `invoice submit` | `iln submit` | Existing submit test checks arguments and config token fallback |
| `invoice fund` | `iln fund` | Existing fund test checks omitted amount behavior |
| `invoice pay` | `iln pay` | Existing pay test checks transaction behavior |
| `invoice get` | `iln status` | Existing status test checks invoice rendering |
| `invoice list` | `iln list` | Existing list test checks address results |
| `invoice watch` | `iln watch` | `watch` terminal-state test |
| `invoice export` | `iln export` | CSV stdout and unfiltered export tests |
| `stats` | `iln stats` | Protocol analytics test |
| `reputation get` | `iln reputation get` | Reputation output test |
| `network switch` | `iln network switch` | Tests cover successful `.ilnrc.json` mutation and unsupported-target rejection |

The parity tests are in [`cli/tests/cli.test.ts`](../cli/tests/cli.test.ts);
completion coverage is in [`cli/tests/completion.test.ts`](../cli/tests/completion.test.ts).
The related [function-level audit](./cli-function-level-audit.md) confirms
that the ported behavior uses the canonical shared client, formatter, and
configuration helpers. That audit covers the completed historical
consolidation; it is not evidence of parity with a nonexistent `cli-next`.

## Completeness decision and timeline

No command from the removed `packages/cli` surface is documented as stranded:
each maps to a current command, and the unique commands have focused tests.
The available tests do not prove every option and behavior, so this is not a
claim of exhaustive flag-level test coverage. The old duplicate package was
retired on 2026-08-25.
`cli/` has no retirement timeline because it is the sole supported CLI. A
future retirement decision must name a replacement, publish a full
command-and-option matrix, close test gaps, and set a dated migration window
before removing the canonical CLI.

## Contributor guidance

- Install `@invoice-liquidity/cli` from `cli/`; there is no `cli-next` package.
- Add commands and tests to `cli/`.
- Keep this audit and the [function-level audit](./cli-function-level-audit.md)
  aligned if another CLI package is introduced.
