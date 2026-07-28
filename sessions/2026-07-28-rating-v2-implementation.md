---
topics: [rating-v2, rating-v2.1, competitions, elo, migration-015, public-entry-filter, team-mode-removal, fixtures, margin-scale, duration-scaling]
---

# Implementing docs/competitions-rating-v2.md (+ v2.1 amendment)

## v2.1: duration-scaled margin + flat K

Spec: `docs/competitions-rating-v2.1.md`. Committed on top of the v2 impl.

- `MARGIN_SCALE` constant is gone. Scale is now derived per match:
  `marginScaleFor(scope_start, scope_end) = max(150, 500 * durationDays)`.
  `actualFromMargin` and `settleFfa` take it as a parameter; `settleMatch`
  derives it from the match's own window. No new column — it's a pure function
  of the two immutable scope fields already on the row.
- **Why it was needed:** at a fixed 150, every realistic daily gap graded
  98–100% and every weekly gap 100/0 — i.e. v1's rank-only defect, reinstated
  for any window longer than a couple of drinks. Verified against the group's
  real logging (weak/avg/heavy day = 350/420/665 pts).
- `K_BY_MODE` collapsed to `K = 80` for all modes (daily/weekly no longer
  dampened, since the scale already grades their closeness). `K_BY_MODE` kept as
  a map so callers still index by `match.mode`. Worked daily now +14/+7/-21.
- Fixtures: `scoring.json` untouched. `rating.json` — only the `worked daily`
  case regenerated (k 24→80, scale 150→500); the other 13 keep their explicit
  `(k, marginScale)` as pure-math inputs. Header gained `marginPerDay`/
  `marginFloor`, dropped the single `marginScale`.
- The K-per-mode differences in v1 are preserved in `settle-v1.js` (daily 8,
  weekly 20, team 24, 1v1/ondemand 32) — migration 015 unaffected.

# Implementing docs/competitions-rating-v2.md

## The one spec conflict, and how it was resolved

The Removals table says delete `settleTeams` / `actualFromRank`, and also says
"leave the shipped migration alone". Both cannot hold: `015_resettle_whole_point_elo.js`
imports exactly those from `competition-core.js`.

Resolution (developer's call, asked before writing code): a frozen verbatim copy
of the v1 math now lives at `server/src/migrations/lib/settle-v1.js`, and 015's
import line points at it. 015's behaviour is unchanged bit-for-bit.

**Nothing but a migration may import that file, and it must never change.** If
it drifts, a from-scratch DB replay re-scores history under whichever rules the
file has drifted to. `migrate.js` filters on `/^\d+_.*\.js$/`, so the `lib/`
directory is not picked up as a migration — that filter is load-bearing now.

## Gotchas found while implementing

- **`coffee_entries.is_public` defaults to 0** (migration 004). Every test helper
  that inserts an entry had to start passing `is_public = 1`, or every
  competition score silently becomes zero. This is also the production risk of
  the new filter: entries predating the log form's toggle are private.
- **The spec's 76/24 prose is off by a factor of two**, in both places it appears
  (`MARGIN_SCALE` and `ELO_SCALE`). 76/24 lands at *half* a scale of gap
  (10^-0.5 = 0.316); a full scale is 91/9. The D=150 table in the spec is
  correct — it is only the one-line glosses that are loose. The fixtures and the
  implementation agree with the table. Not changed; flagged to the developer.
  The same looseness is inherited from the classic "Elo 400 = 76%" gloss.
- **`K/2` is not a cap.** The tuning table's "max 1v1 swing" column (±12/±24/±40)
  is the *equal-ratings* swing. `delta = K*(A - E)` and `E` is only 0.5 when the
  ratings match, so the real bound is `|delta| < K`. The spec's own frozen
  `favourite underperforms` fixture settles **±64 on K=80** — past the ±40 the
  table advertises. Verified by independent re-derivation over 100k randomized
  settlements. Nothing was changed; the tests now state the correct bound.
- The fixtures in `docs/fixtures/rating-v2/` already existed and were **not**
  edited. All 32 cases pass against the reference implementation as written.
- `competition-core.test.js` asserts the fixtures' `pointWeights` / `marginScale`
  match the shipped constants. That is the tripwire for the spec's "if you change
  a weight, re-derive MARGIN_SCALE in the same commit" rule — without it, moving
  a weight fails eighteen unrelated cases instead of saying what happened.

## Deliberately NOT done

- No back-fill of settled matches. There is no migration and none may be written.
- `matches.team_size` and `match_participants.side` / `contribution_share` stay
  in the schema (settled team matches hold real data). New rows leave them null.
- `docs/competitions-elo.md` left untouched — it describes history, on purpose.
