---
topics: [issue-77, data-driven-coffees, coffee-catalog, migration-020, migration-021, coffee-classes, categories, score-caffeine, admin-coffees, scoreMgSql]
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

## Data-driven categories (follow-up, migration 021)

Classes had no display name in data — the label lived only in the client's
hardcoded `CLASS_LABEL`, group order was "first appearance in the menu". Made
categories a real entity: `coffee_classes {id, name, sort_order}`, admin CRUD +
`/move` (swap neighbour), public `GET /coffees/classes`. A coffee's `class` must
reference a real category (enforced in the admin routes, no SQL FK — same
"self-contained, no FK" contract as `coffee_entries`). Category delete is blocked
while any coffee uses it. `LogCoffee` and the admin page now read labels/order
from the DB; removed `CLASS_LABEL` and `CLASS_SUGGESTIONS`.

- **Form-clear bug (caught in browser):** both the coffee and category add forms
  reset only via a `useEffect([editing])`; on an *add*, `editing` stays null so
  the effect never fired and the form kept its values. Fixed by clearing in the
  mutation's `onSuccess` when `!editing`.

## Admin catalog UI structure (redesign)

Researched admin-CRUD patterns (LogRocket/NN-g/UXDWorld): search is near-
mandatory; multi-field forms w/ dropdowns+side-effects belong in a modal, not a
permanent inline block; accordion = progressive disclosure for long grouped
lists; split resources into tabs. Applied: `AdminCoffees` now has Coffees /
Categories **tabs**; Coffees = search + **accordion grouped by category**
(collapsed by default → caps height, search auto-expands matches); add/edit in a
**Modal** (`components/Modal.tsx`, reuses `.confirm-backdrop`). Reused existing
`.tab-row`/`.tab-btn`.

## Review findings — 2 left OPEN (touch achievements, scoped out)

Full branch review passed (SQL interp in `scoreMgSql` confirmed safe — ID_RE
re-filter + Number(); migration seed diffed exactly against the deleted files).
Fixed in review: mg cap 0..100000 in the admin validator, dead `.admin-cat-form`,
SuggestInput highlight reset, a stale `coffee-scores.js` comment.

Still open (deliberately not touched — live in `data/achievements.js`, which the
user scoped out of #77):
- `variety_all` target = `coffeeCount()` **at module load**. Safe only because
  that module is always required after `migrate()` (index.js + every test). A
  future require-before-migrate would throw `no such table: coffees` at import.
- Same target is **frozen at boot**, so deleting a coffee via the new admin
  route makes "try every type" unwinnable until restart (adds are fine).
- Fix for both: make it a getter — `get target() { return coffeeCount(); }` —
  evaluated per read (spread/JSON still yields a number). Needs the user's OK to
  edit an achievements file.

## Verify server recipe (single container, isolated)

`cp -r client/dist server/public` then `PORT=3999 DB_DIR=<scratch> JWT_SECRET=…
ADMIN_USERNAME=admin bun src/index.js`. Bootstrap only promotes at startup, so
register the admin then flip `is_admin`/`is_super_admin` via a second bun
connection on the same DB_DIR. `server/public` is NOT gitignored — remove it
after.
