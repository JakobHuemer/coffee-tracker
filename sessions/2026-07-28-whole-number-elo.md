---
topics: [issue49, elo-whole-numbers, apportionment, zero-sum, competition-core, negative-zero]
---

# Whole-number Elo deltas (issue #49)

## Why apportionment, not rounding
Rounding each delta independently breaks zero-sum — the spec's hard
requirement. `apportion(raw, total)` in `competition-core.js` is largest
remainder (Hamilton): floor everything, hand the leftover whole units to the
biggest fractional parts. Key property: the output is derived from `total`
minus the floors, never by re-adding the floats, so **zero-sum is now exact
rather than float-precision** — it got stronger, not weaker.

- `leftover` is provably in `[0, n]`: each floor gives away `< 1`, and
  `sum(raw) == total` up to ~1e-14 of noise, far too small to move an integer.
  A reviewer's fuzz found `leftover == n` really does occur (~0.2% of team
  settlements, e.g. `raw = [-7.000000000000001] x 3, pot = -21`), so the upper
  bound being *inclusive* is load-bearing — off-by-one there would throw.
- Teams round the **pot** first (`P_A = round(K*(A_A - E_A))`), then apportion
  each side to its own whole pot. Rounding the pot last would leave a side
  splitting a fraction.

## Gotchas found
- **`-0` is everywhere** if you don't fold it: `Math.round(x)` returns `-0` for
  any `x` in `[-0.5, 0)`, `Math.floor(-0)` is `-0`, and it then propagates into
  every delta on a drawn team match. Invisible in prod (SQLite REAL reads back
  `+0`, `JSON.stringify(-0)` is `"0"`) but it makes `expect(delta).toBe(0)`
  fail, since bun's `toBe` is `Object.is`. Folded with `+ 0` in `apportion`;
  tests that recompute a pot need the same fold.
- Fractional-tie handling makes settlement **order-dependent**, and
  `ORDER BY joined_at` was not a total order — auto-joined rosters all share one
  `joined_at` instant, so a symmetric roster's extra point landed by SQLite row
  order. Now `ORDER BY joined_at, user_id`.
- Existing tests that asserted `toBeCloseTo(..., 9)` on deltas were tightened to
  `toBe` (VALUES 0.4). They pass only because the values really are exact now.

## Deliberately not done
- **No data migration.** Rows settled before this keep fractional values; the
  ledger is immutable and re-rounding per user would not conserve the pool
  total. A rating that starts at `BASE_RATING = 1000` stays whole from here.
- **Client untouched.** `fmtDelta`'s `Math.round(delta * 10) / 10` still renders
  legacy fractional rows correctly and renders whole deltas whole. Simplifying
  it would regress display of old matches.
- Ties on the leaderboard get more common with whole ratings, and
  `routes/competitions.js` (`b.rating - a.rating`) and `routes/rankings.js` have
  no tiebreak, so they disagree with `groups.js` (`ORDER BY rating DESC,
  username ASC`). Pre-existing — every unrated user already sits at exactly
  1000 — so left alone, but it is now easier to hit.

## Accepted behaviour change
A mismatch lopsided enough that the raw delta is under half a point settles at
0 for everyone (e.g. 2400 vs 5 at K=32 → raw 3.3e-5). Nobody's rating moves.
Same as FIDE. One existing test ("ratingAfter is never floored") had to move to
a closer rating gap to still produce a non-zero delta.
