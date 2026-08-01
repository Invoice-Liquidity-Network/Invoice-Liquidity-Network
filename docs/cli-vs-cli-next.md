# `cli/` vs `packages/cli`

The repo currently ships two separate CLI packages that both describe
themselves as "Command-line interface for the Invoice Liquidity Network":

| | `cli/` | `packages/cli` |
|---|---|---|
| Published name | `@invoice-liquidity/cli` | `@iln/cli` |
| SDK dependency | `@iln/sdk` (`sdk/`) | `@iln/sdk` (`sdk/`) |
| Documented in root `README.md` | Yes ([`cli/README.md`](../cli/README.md)) | No |
| Command surface | `submit`, `fund`, `pay`, `status`, `list`, `history`, `compat`, `config`, `xdr`, `dashboard`, `generate`, `dev`, `wallet`, `interactive`, `tutorial`, `man`, `alias` | `invoice submit/fund/pay/get/list/watch/export/stats`, `reputation get`, `network switch` |

## Decision: `cli/` is canonical

`cli/` (`@invoice-liquidity/cli`) is the canonical, documented CLI:

- It is the one linked from the root `README.md` install instructions and
  repo layout.
- It has by far the larger command surface, including operational tooling
  (`dev`, `wallet`, `interactive`, `tutorial`, `man`) that `packages/cli`
  does not have.
- Both packages depend on the same SDK (`@iln/sdk` in `sdk/`), so this is
  independent of the `sdk` vs `sdk-next` positioning tracked separately.

`packages/cli` (`@iln/cli`) is an experimental, undocumented CLI with a
smaller, partially-overlapping command set (`invoice`, `reputation`,
`network`). It has been marked experimental in its `package.json`
description and `README.md` pending a decision on whether its unique
commands (`watch`, `export`, `stats`, `reputation`, `network switch`) get
folded into `cli/` or the package is removed outright.

## For contributors

- Install `@invoice-liquidity/cli` (`cli/`) unless you specifically need one
  of `packages/cli`'s `network`/`reputation`/`watch`/`export`/`stats`
  commands, which `cli/` does not yet have.
- New CLI commands should be added to `cli/` going forward.
