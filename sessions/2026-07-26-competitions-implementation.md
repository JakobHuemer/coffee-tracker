---
topics: [issue21, issue4, issue27, competitions, groups, elo-settlement, migration-011, ticker, nav-restructure, cdp-browser-verification]
---

# 2026-07-26 — Competitions implemented (issue #21)

Spec was already written (`docs/competitions-elo.md`, session
`2026-07-25-competitions-elo-spec.md`). This session implemented it. The spec
now carries an "Implementation notes" section for every deviation — read that,
not this file, for the design. Only what is nowhere else is below.

## Traps hit

- **The spec's "next migration is 010" was already stale.** main shipped
  `010_add_caffeine_half_life.js` after the spec was written, and the migration
  runner rejects duplicate versions — the whole test suite died on
  `Duplicate migration version 10` before a single test ran. Check the actual
  directory, never a doc's prediction, when numbering a migration.
- **Table named `groups` was avoided on purpose**: GROUPS is a SQLite keyword
  (window frame clause). It is `competition_groups`.
- **`bun:sqlite`'s `.get()` returns `null` on a miss, not `undefined`.** A test
  asserting `toBeUndefined()` fails. Route code uses `if (!group)` so it never
  mattered outside tests.
- **A worktree without `node_modules` silently gets different dependency
  versions.** Bun auto-installed express 5 from cache, and express 5's
  path-to-regexp rejects the SPA fallback `app.get('*')` that works fine on the
  pinned express 4 — the server crashed at boot as soon as a built client was
  present. `bun install` in the worktree first; the crash is not a real bug.
- 2026-07-26 is a **Sunday**, so that day's daily and weekly windows close at
  the same instant. A test asserting "only one match was due" has to pick a
  mid-week date or it passes for the wrong reason.

## Design decisions taken during implementation (all confirmed with the user)

- Group carries one timezone; timezone shards from the spec are dropped. See
  the spec's implementation notes for the argument.
- One group per user (clan-style). Joining another leaves the current one —
  server-side, in one transaction. The UI's only join path is from the
  no-group gate, so the auto-leave cannot surprise anyone mid-flow; the Group
  tab states the rule anyway.
- Leaving a group does **not** drop the leaver from matches already running.
  Otherwise leaving is a dodge button for a bad day.
- Team sides are picked by the players (creator sets the size, joiners choose
  A or B), not assigned or auto-balanced.
- Nav: Compete takes the Stats slot, Stats moves under Profile exactly like
  Saved posts. This is the part of #27 that #21 needs; the rest of #27
  (achievements/badges/challenges relocation) was deliberately left alone —
  that issue is still `status:needs-discussion`.

## Verification worth repeating

Driving the built client through headless Chromium over CDP catches what
`tsc`/`vite build` cannot: a page that renders blank, a missing CSS token, a
404 on an endpoint the UI calls. Recipe: launch
`chromium --headless=new --remote-debugging-port=<high port>`, plant the JWT
with `Runtime.evaluate` on `localStorage.setItem('token', …)`, navigate, then
read `document.body.innerText` plus `Runtime.exceptionThrown` /
`Network.responseReceived` ≥400. Found a real layout bug (team sides wrapping
mid-cell at 430px) that no test would have.

Also verified live, not just in unit tests: ticker open→pending→settled; a 3-way
FFA settling to exactly +16/0/−16 at K=32, N=3; a 2v2 where the carry earned
more than their partner and the idle player lost more than theirs, summing to
0 within float noise; `integrity_check` = ok with zero row loss after
`kill -9`; and a match whose entire window elapsed while the process was down
being locked and settled by the boot catch-up pass.
