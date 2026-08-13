# Upstream policy — DO NOT take code from openswarm-ai/openswarm

**This fork no longer syncs with upstream. Taking their code is a licensing violation.**

## Why

- Our fork base is `e7aa032b` (upstream **v1.5.7**, 2026-07-13), which was **MIT**. Our `LICENSE`
  is MIT and correct for that code, and the `NOTICE` attribution for it stays required.
- Upstream relicensed **MIT → AGPL-3.0 on 2026-07-23** (their commit `e37be2f9`).
- AGPL-3.0 is copyleft. Code authored upstream **on or after 2026-07-23** cannot be redistributed
  under MIT. Cherry-picking it makes our stated license wrong.

Decision (product owner, 2026-08-13): **keep MIT, drop upstream.** The `upstream` remote is
removed. Do not re-add it. Do not cherry-pick, merge, rebase onto, or copy from any
openswarm-ai repository.

This already happened once. Eight commits taken on 2026-08-13 were all authored upstream between
07-31 and 08-07 — post-relicense — and were reverted in `27a9e623`, with the modules they
introduced deleted outright.

**A PR to upstream is also off the table.** Contributing to an AGPL project while shipping MIT
invites exactly the confusion we just removed. A prepared pt-BR contribution branch was deleted
unpushed for that reason.

## What this means in practice

- **Bugs upstream fixes are still our bugs.** Re-implement them from the observable behaviour — the
  symptom, not their diff. Facts and ideas are not copyrightable; their expression is. Whoever
  implements must not read the upstream patch.
- **No `upstream/*` refs anywhere.** If you find one in a script, doc, or CI job, remove it.
- Pre-relicense upstream history (everything at or before our fork base) is MIT and is the code
  this fork is built on. That is fine and stays.

## Independent re-implementation log

The eight reverted fixes, described by **behaviour only**, so this file is usable as a spec without
touching AGPL source.

| Bug (observable behaviour) | Why it matters | Status |
|---|---|---|
| 9Router's state dir is world-readable; the `db.json` inside it holds live provider tokens at `0644` | credential exposure to any local user | to re-implement |
| The browser sub-agent relays raw element indices into text a human reads | leaks internal handles into user-visible output | to re-implement |
| An app runtime orphaned by a crash keeps running indefinitely — `stop_all` only runs on a clean shutdown, and port-collision routes around a squatter instead of killing it | processes seen alive for days holding ports and memory | to re-implement |
| An app whose record is lost still has its work on disk with no way for the user to reach it | silent data loss from the user's point of view | to re-implement |
| A wedged `capturePage` hangs the command instead of failing | UI hang with no recovery | to re-implement |
| Agent launch silently drops its prompt, so the turn starts with nothing | run appears to hang for no reason | to re-implement |
| The backend does not restart after an unexpected exit, leaving a dead shell and orphaned runtimes | app looks alive but answers nothing | to re-implement |

## Guardrails

`scripts/check-fork-drift.mjs` runs inside `npm run verify` and fails on:

1. **Legacy identifiers** — `openswarm`, `self-swarm`, `Open Swarm` (note the space: it hid in
   user-facing onboarding copy through several sweeps), `OPENSWARM_*` env vars.
2. **Deleted subsystems** — cloud auth, subscription, publish-to-web, the edge app, affiliate
   attribution.
3. **Call-home hosts** — `api.openswarm.com` and any `*.openswarm.{com,ai,io,net}`.
   `scripts/check-callhome.mjs` guards built output; this one guards source.
4. **i18n regressions** — a hardcoded English literal in a JSX text node or a
   `label=`/`placeholder=`/`aria-label=` attribute, in a file that imports `useTranslation`.
   Upstream is English-only, so this is what a careless merge used to reintroduce; pt-BR is the
   default language, so a reverted `t()` call ships English to every user.
5. **AGPL cherry-picks** — any commit trailer claiming a cherry-pick from an upstream commit
   authored on or after 2026-07-23, or from a source commit no longer resolvable locally.
   The eight already-reverted shas are exempted by sha in `REVERTED_PICKS`. **Never add to that
   list to silence a new pick — re-implement instead.**

The guards deliberately contain the forbidden literals. **Do not "clean them up".** If a finding is
genuinely legitimate — a migration table needing old key names, or a brand name kept literal in both
locales — add it to `ALLOW` / `ALLOW_STRINGS` *with a reason*, rather than deleting the check.
