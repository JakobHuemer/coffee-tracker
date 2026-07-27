---
topics: [issue35, issue39, cross-group-matches, global-matches, competitions, migration-013, matches-group-nullable, log-photo-buttons]
---

# Cross-group/global matches + photo-button sizing (issues #35, #39)

Stacked on the issues-6-7-11 branch.

## #35 Global (cross-group) matches
- The ELO settlement is **already group-agnostic**: `competition-core.js` and
  `settleMatch`/`lockDueLobbies` in `competitions.js` read only participants +
  window + ratings, never `group_id`. So a group-less match settles through the
  existing code with **zero math changes** — the whole feature is creation,
  join/read gating, and listing.
- Rating is one global value per user (`user_ratings`), already not scoped to a
  group — so **no schema change to the rating cache**.
- The one hard blocker was `matches.group_id NOT NULL` (011). SQLite can't relax
  NOT NULL in place → migration **013** rebuilds the `matches` table (manual
  transaction, FKs off, same pattern as 003). `UNIQUE(group_id, mode,
  period_key)` still works for global rows: group_id NULL + period_key NULL, and
  SQLite treats NULLs as distinct, so any number of global user-created matches
  coexist. Recurring modes (daily/weekly) stay group-bound; only user-created
  (1v1/ondemand/team) can be global.
- Route model (`routes/competitions.js`): `POST /` takes `global: true` →
  group_id NULL, skips the group requirement. `join`/`GET /:id` bypass the
  group-equality gate when `group_id IS NULL` (open to anyone). `GET /` gained a
  `global` bucket: `open` = all open global lobbies (browsable), `live`/`settled`
  = only the caller's own. `leave` already cancels an emptied user-created lobby
  (period_key null), so global lobbies cancel on last-out for free.
- Client: `Compete.tsx` was fully group-gated. Now tabs always render; **Global**
  and **Group** are always present, Matches/Ranking only with a group; the group
  tab hosts `GroupGate` when the user has none. Extracted `MatchList`/`RatingCard`
  so the group and global tabs share join/leave + rendering. `Match.group_id` is
  now `string | null`.
- Verified end to end on a running server: two group-less users (tester vs rival)
  created and joined the same global match.

## #39 Photo buttons wrong size on desktop
- `.log-form` is `max-width:640px; margin:0 auto`, but `.log-photo-actions` and
  `.log-details-thumb-wrap` were unconstrained → the buttons stretched the full
  viewport on desktop. Capped both to 640px centered; photo-actions uses side
  **padding** (not margin) so the mobile gutter survives centering. Measured at
  1873px: photo row now 640px, left/right identical to the form (609→1249).
