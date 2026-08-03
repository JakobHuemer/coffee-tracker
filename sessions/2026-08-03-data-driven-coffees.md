---
topics: [issue-77, data-driven-coffees, coffee-catalog, migration-020, score-caffeine, admin-coffees, scoreMgSql]
---

# Issue #77 — data-driven coffee catalog (coffee scope only)

Scoped to coffee only per the user; achievements/badges/challenges deferred.

## What moved

- Catalog left `server/src/data/coffees.js` and `data/coffee-scores.js` (both
  DELETED) for the `coffees` table, seeded by migration `020`. Runtime reader is
  `server/src/coffees.js` (`listCoffees`/`getCoffee`/`coffeeCount`/`scoreMgSql`).
- `SCORE_CAFFEINE` → nullable `score_caffeine` column. `scoreMgSql()` now builds
  its CASE live from the DB, so an admin edit takes effect with no restart.

## Gotchas / decisions

- **Migration seed is inlined, not imported** from the (now-deleted) data file:
  a migration must stay frozen, so later catalog edits can't retroactively
  change what a fresh DB seeds.
- **`coffee_id` is interpolated into SQL** by `scoreMgSql`, so admin-entered ids
  are hard-constrained to `ID_RE = /^[a-z0-9_]+$/` on write and re-checked in
  `scoreMgSql` defensively. This is the injection guard — do not loosen it.
- **`data/achievements.js` calls `coffeeCount()` at module load** for the
  `variety_all` target (was `COFFEES.length`). Safe because that module is only
  required through a route/engine, i.e. after `migrate()` — same ordering
  `challenges.js` already relies on for its top-level seed query. Target is fixed
  for the process lifetime (reflects new coffees on restart), matching the old
  static behaviour.
- Entries are self-contained (copy `caffeine_mg`, store `coffee_id` as bare TEXT,
  no FK), so editing/deleting a coffee never rewrites or breaks history. Delete
  is allowed freely for that reason.
- **Admin-page guard bug caught in browser verify:** a hard load of
  `/admin/coffees` bounced admins to `/profile` because the guard fired while
  `user` was still null (App fetches `/auth/me` async). Fixed: only redirect once
  `user` is loaded AND not admin.

## Verify server recipe (single container, isolated)

`cp -r client/dist server/public` then `PORT=3999 DB_DIR=<scratch> JWT_SECRET=…
ADMIN_USERNAME=admin bun src/index.js`. Bootstrap only promotes at startup, so
register the admin then flip `is_admin`/`is_super_admin` via a second bun
connection on the same DB_DIR. `server/public` is NOT gitignored — remove it
after.
