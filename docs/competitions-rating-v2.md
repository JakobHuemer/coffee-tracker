# Competitions — rating v2

Status: **implemented.**

This document supersedes [competitions-elo.md](./competitions-elo.md) for every
match settled after v2 ships. That document is left unmodified and remains the
accurate description of how the currently-deployed system works and how every
already-settled match was scored. Two specs, deliberately: one describes
history, one describes the future. Neither is edited to agree with the other.

## Why v2 exists

The shipped system has three defects, all of them reproduced from real match
windows during design:

1. **The score curve front-loads.** `f(x) = x/(x+k)` on three metrics at once
   means the first drink of a window is worth 262 of 1000 points and the twelfth
   is worth 12. Users hit ~500 by mid-morning and finish the day near 650.
2. **Caffeine barely separates anyone.** `k_caf = 200` puts half-credit at
   1.5 espressos. Five doppios (640mg) scored 628 against five teas (25mg) at
   335 — a 25x caffeine difference paying under 2x the points.
3. **The rating layer discards the score entirely.** `actualFromRank` returns
   1/0/0.5, so a 21-point win out of 1000 settles identically to a 900-point
   win. A real settled match had its winner lead by 21 points out of 1000 and
   collect the full +16, the same as a runaway victory would have paid.

v2 fixes all three: points become linear and uncapped, and the rating layer
grades on the score *margin* rather than on rank alone.

## Core values

These are requirements, not preferences. An implementation that violates one is
wrong even if it is otherwise better.

1. **Zero-sum.** Every rating point a participant gains was lost by another
   participant in the same match. The population mean never moves. This must
   hold by construction, provable from the formula, not asserted by a test.
2. **Points accumulate linearly and are never capped.** The Nth cup is worth
   the same as the first. A weekly window and a daily window do not share a
   ceiling, because one covers seven times as much drinking as the other.
3. **The rating delta is driven by the score margin against the rest of the
   field**, not by finishing position. Being 50 points behind the leader and
   200 ahead of third is a materially different result from being 200 behind
   and 50 ahead, and the two must not settle identically.
4. **Ranking is not an input.** Margin alone determines the outcome. Rank is
   derivable from the scores and adds nothing the margin does not already
   carry.
5. **A single match can move a rating by around 40 points.** Matches are
   infrequent — a handful per week, not dozens per day — so each one is allowed
   to matter. 40 is a target for the swing an emphatic 1v1 produces, not a hard
   cap.
6. **Ratings are integers.** A ~40 point swing has enough granularity that
   fractional ratings buy nothing and cost display complexity.
7. **Only public entries count in any competitive context.** An entry with
   `is_public = 0` is invisible to scoring, everywhere, with no exceptions.
8. **Team mode is dropped.** Not deferred behind a flag — removed.
9. **The simplest construction that satisfies the above wins.** No per-user
   uncertainty state, no volatility, no Bayesian machinery.

### Derived, not given

Consequences of the values above. Recorded so an implementor does not
re-litigate them, and so a reviewer can tell a derivation from a decision.

- **Largest-remainder apportionment stays.** Values 1 and 6 together demand
  whole deltas that still sum to exactly zero. `apportion()` already does this
  and is carried over unchanged.
- **Elo's logistic is reused for the margin.** Value 3 needs a bounded,
  saturating, antisymmetric function of the score gap. `1/(1+10^(-Δ/D))` is
  antisymmetric by construction, which is what keeps value 1 structural. It is
  also the same Bradley–Terry logistic the expected-score side already uses, so
  v2 introduces no new mathematics.
- **The maximum delta is `K/2`, not `K`.** Elo's delta is `K·(A−E)`; at equal
  ratings `E = 0.5` and `A ≤ 1`. Value 5 therefore requires `K = 80` for
  a 1v1, not `K = 40`.
- **Larger fields settle more gently.** The `K/(N−1)` divisor in the pairwise
  decomposition is what keeps the total movement bounded as N grows.
- **Bayesian rating systems are excluded.** TrueSkill and Elo-MMR are
  rank-based — they discard margin, violating value 3 — and neither is zero-sum,
  violating value 1.
- **A margin-of-victory K multiplier is excluded.** Scaling K by the margin
  (the FiveThirtyEight NFL approach) makes the two sides' deltas asymmetric and
  breaks value 1.
- **Settled matches are immutable.** See [History](#history-is-immutable).

## Tuning surface

Every constant lives at the top of `server/src/competition-core.js`. Each is
documented below with what it does, what changes when you move it, and what has
to be recalculated afterwards.

```js
// Points per unit of each metric. Linear and uncapped: the Nth cup is worth
// exactly what the first was.
const POINT_WEIGHTS = { caffeine: 1, cups: 15, variety: 15 };

// Score gap, in points, at which a matchup is roughly 76/24 rather than 50/50.
const MARGIN_SCALE = 150;

// Rating gap at which the favourite is expected to score 76/24. Classic Elo.
const ELO_SCALE = 400;

// Starting rating for an unrated user.
const BASE_RATING = 1000;

// Per-mode K. Lives on the match row, copied from here at creation time.
const K_BY_MODE = { daily: 24, weekly: 48, '1v1': 80, ondemand: 80 };
```

### `POINT_WEIGHTS`

`caffeine` is per milligram, `cups` per logged entry, `variety` per distinct
`coffee_id`. At 1/15/15, caffeine carries roughly 78% of a heavy day's points,
and one new kind of drink is worth exactly one extra cup.

**Changing it** re-scales every score. Because `MARGIN_SCALE` is denominated in
the same points, changing a weight silently changes how hard the rating layer
reacts — doubling all three weights doubles every margin and makes `D = 150`
behave like `D = 75`. **If you change a weight, re-derive `MARGIN_SCALE` in the
same commit** and regenerate both fixture files.

Raising `variety` relative to `cups` makes one-of-each farming stronger. At
15/15 a zero-caffeine 8-cup 3-kind day scores 180 against one doppio's 158.
**This is intended** — eight cups is real effort against one — and is pinned by
a named fixture. Do not "fix" it.

No recalculation of settled matches. See [History](#history-is-immutable).

### `MARGIN_SCALE` (D)

How many points of score gap it takes to move a pairwise matchup off even.
Small D approaches the old rank-only behaviour, because the logistic saturates
almost immediately and every win looks like a blowout. Large D flattens
everything toward a draw, and nobody's rating moves.

| gap | D=75 | D=150 | D=400 |
|----:|-----:|------:|------:|
| 25  | 0.68 | 0.60  | 0.54  |
| 50  | 0.82 | 0.68  | 0.57  |
| 200 | 1.00 | 0.96  | 0.76  |

**Changing it** affects future settlements only. Regenerate
`docs/fixtures/rating-v2/rating.json`.

### `K_BY_MODE`

The maximum a participant's rating can move in a two-player match is `K/2`, and
less than that in a larger field. Values are set so an emphatic 1v1 lands near
the 40-point target of value 5.

| mode | K | max 1v1 swing | rationale |
|---|--:|--:|---|
| `daily` | 24 | ±12 | fires ~365x/year on one day of drinking; must stay low-weight |
| `weekly` | 48 | ±24 | aggregates seven days, so it is a far better sample than a daily |
| `1v1` | 80 | ±40 | rare and deliberate; the headline number in value 5 |
| `ondemand` | 80 | ±40 | same — someone chose to start it |

**Changing it** affects future settlements only. K is copied onto `matches.k_factor`
at creation, so a match already created keeps the K it was created with even if
this table changes before it settles. That is deliberate: the K a match will
settle at is visible to participants from the moment they join.

### `ELO_SCALE` and `BASE_RATING`

Standard Elo constants, unchanged from v1. `ELO_SCALE = 400` is the rating gap
at which the favourite is expected to take 76% of the pairwise credit.

**Do not change either.** `BASE_RATING` in particular is baked into every
settled `rating_before` in the database; moving it would make historical rows
incomparable to new ones, and there is no migration that can fix that without
rewriting immutable history.

## Layer 1 — points

Per user, per match window, from `coffee_entries`.

```
points = POINT_WEIGHTS.caffeine * caffeine_mg_sum
       + POINT_WEIGHTS.cups     * cup_count
       + POINT_WEIGHTS.variety  * distinct_coffee_count
```

Rounded to an integer with `Math.round` at the end, once — not per term.

Linear, uncapped, zero for a user who logged nothing. There is no saturating
curve and no display transform: the number the formula produces is the number
the UI shows, raw. `scorePoints()` and its `× 1000` disappear, and so does the
0..1000 range they implied.

This is a UI change, not just a code deletion. Points no longer have a maximum,
so anything that rendered a score as a fraction of a whole — a progress bar, a
percentage, a `/1000` label, a filled ring — has no denominator any more and
must be replaced with a plain number. A weekly score is legitimately several
times a daily score; nothing may assume otherwise.

### Which entries count

An entry contributes if and only if **all** of the following hold:

- `is_public = 1`
- `logged_at >= matches.scope_start`
- `logged_at <= matches.scope_end`
- `user_id` is the participant's

`logged_at` is the user-stated drinking time, not `created_at`. Window bounds
are the stored `scope_start`/`scope_end` on the match row, which were computed
in the group's timezone at creation — never recompute them from a date string.

The `is_public = 1` filter is new in v2. It is a requirement (value 7), and it
is load-bearing, not cosmetic. Private logging is common enough that a
participant can have the large majority of a window's entries hidden; applying
the filter can move that participant from first place to last in the same match.
Expect the rule to change outcomes, not merely tidy them.

A user must be able to see this coming at the moment they log, not discover it
when a match settles. **The log form shows a one-line hint whenever the entry
being created is not public**, e.g. `Private logs don't count toward rating.`
It appears only in the non-public state — there is no matching hint on a public
entry, which would just be noise. Copy stays inside VALUES.md 0.6: one short
line, states the constraint, does not restate the control and does not explain
itself.

Note the coupling this creates: `routes/coffees.js` requires a photo or a
description before an entry may be marked public, so "counts for competition"
and "has a photo or caption" are currently the same condition. Changing that is
outside this spec, but it is why a user can drink all day and score zero, and it
is what the hint exists to make legible.

### Caffeine milligrams

Caffeine is summed through `scoreMgSql()`, which applies the per-drink
competition overrides in `server/src/data/coffee-scores.js`. **This is
deliberate and stays exactly as it is.** The scoring layer asks that function
for the milligrams a drink is worth in a competition and uses whatever it
returns; which drinks diverge from their displayed value, and by how much, is
that file's business and not this spec's.

Do not "simplify" it away by summing `caffeine_mg` directly. The divergence is
intentional — see the file's own header — and it is confined to the two
competition queries precisely so the rest of the app can keep agreeing with what
the user sees.

One consequence to be aware of, not a reason to change anything: under linear
points the override bites harder than it used to. A latte is a flat 38-point
gap against its displayed 63mg, where the old saturating curve absorbed most of
it.

## Layer 2 — rating

One global integer rating per user, `BASE_RATING` for the unrated.

```
A_ij = 1 / (1 + 10^((P_j - P_i) / MARGIN_SCALE))   # margin, not rank
E_ij = 1 / (1 + 10^((R_j - R_i) / ELO_SCALE))      # unchanged from v1

delta_i = K/(N-1) * sum_{j != i} (A_ij - E_ij)
```

Then `apportion(raw, 0)` makes the deltas whole while keeping their sum at
exactly zero.

The only change from v1 is `A_ij`. v1 computed it from rank
(`1`, `0`, or `0.5`); v2 computes it from the score gap. Everything else —
the pairwise decomposition, the `K/(N−1)` divisor, `apportion`, the absence of
a rating floor — carries over unchanged.

### Zero-sum

Structural, for any N, any K, any rating spread, any score spread:

- `E_ij + E_ji = 1` — the logistic is antisymmetric about the rating gap.
- `A_ij + A_ji = 1` — **the same logistic, so the same property.** This is why
  the margin function is a logistic and not, say, a normalised score share.

Every pair contributes `(A_ij − E_ij) + (A_ji − E_ji) = 0` to the total, so the
raw deltas sum to zero before rounding. `apportion` builds the whole-number
result from `0 − sum(floors)` rather than by re-adding floats, so float error
cannot leak into the ledger either.

There is deliberately no floor on the resulting rating. A clamp would break
zero-sum the moment a participant hit it — the clamped amount would vanish from
the ledger instead of landing on the other side of the match. If a display
floor is ever wanted it must never feed back into `rating_before`.

### Consequences worth knowing

- **Nobody moves when all scores are equal**, including when everyone scored
  zero. `A_ij = 0.5` for every pair, so at equal ratings every delta is zero.
  No special case is needed for an empty match.
- **The margin saturates.** Past roughly `4 × MARGIN_SCALE` the logistic is
  within a rounding error of 1, so running up the score stops paying. This is
  the standard defence against margin-aware ratings incentivising blowouts.
- **A favourite who underperforms loses more than an equal would.** `E_ij`
  is still the rating-based expectation, so the delta is always "how you did
  against what your rating predicted".

## Removals

Delete, do not deprecate. Leaving these alive is how the codebase ends up
telling two stories.

| symbol | file | note |
|---|---|---|
| `SATURATION` | `competition-core.js` | the `x/(x+k)` half-credit points |
| `saturate()` | `competition-core.js` | |
| `performanceScore()` | `competition-core.js` | replaced by the linear points function |
| `scorePoints()` | `competition-core.js` | no `× 1000` display transform survives |
| `WEIGHTS` | `competition-core.js` | replaced by `POINT_WEIGHTS` |
| `actualFromRank()` | `competition-core.js` | replaced by the margin form |
| `settleTeams()` | `competition-core.js` | team mode is dropped |
| `contributionShares()` | `competition-core.js` | softmax pot split, team-only |
| `SHARE_TEMPERATURE` | `competition-core.js` | team-only |
| `'team'` in `K_BY_MODE` / `MODES` | `competition-core.js` | |
| team branch, `team_size`/`side` validation | `routes/competitions.js` | around the mode dispatch |
| team branch | `migrations/015_...` | leave the shipped migration alone; only new code drops the mode |

Callers that must be updated in the same change (value 0.4 in VALUES.md — a
refactor is not done until every dependent matches):

- `server/src/competitions.js` — `scoreFor`, `scoresForMany`, `metricsStmt`;
  the `is_public = 1` predicate goes in the two scoring queries, and **only**
  those. Buzz, stats, streaks, achievements, casualties, rankings and community
  challenges keep counting every entry.
- `server/src/routes/competitions.js` — mode list, team validation, any
  response field that assumed a 0..1000 score.
- `client/src/pages/Compete.tsx`, `client/src/pages/Compare.tsx`,
  `client/src/types/index.ts` — score is now an unbounded integer, not a
  fraction of 1000. Any progress bar, percentage, or "/1000" label is wrong.
  Team-mode UI and its copy go with the mode.
- `client/src/pages/LogCoffee.tsx` — the non-public hint described under
  [Which entries count](#which-entries-count).
- Existing tests in `competition-core.test.js`, `competitions.test.js`,
  `routes.competitions.test.js`.

The `matches.team_size` and `match_participants.side` / `contribution_share`
columns stay in the schema. They hold real data for settled team matches and
dropping them would destroy history. New matches leave them null.

## History is immutable

**Every match settled before v2 ships keeps its stored scores, deltas and
ratings, forever. v2 applies only to matches settled after it ships. There is
no back-fill migration and none may be written.**

`match_participants.score` is the immutable record of what a window was worth at
the moment it settled. It cannot be recomputed from `coffee_entries`, because
the entries are mutable and have already been mutated. This is not hypothetical:

- `migrations/014_latte_caffeine_63.js` rewrote the stored `caffeine_mg` of
  every historical latte row, including rows inside already-settled windows.
- `data/coffee-scores.js` was added later still, pinning what a latte is worth
  inside a competition to a third value.

A settled match therefore has stored scores that no longer correspond to any sum
you can compute from today's rows. A v2 back-fill would not "recompute history
correctly" — it would re-score old matches with a drink catalog that did not
exist when they were played, and change what happened. It would also apply value
7 retroactively, stripping every private entry from matches played under rules
where private entries counted.

This is the same reasoning `migrations/015_resettle_whole_point_elo.js` already
records: settlement may be replayed from stored scores when only the rating
layer changes, but scores are never re-derived from raw entries. v2 changes both
layers, so not even that replay is available.

Consequence to accept knowingly: ratings before and after the cutover are
denominated in the same units but produced by different rules. A rating is a
running total, not a measurement, and it was already that.

## Tests

Fixture-driven. Two JSON files, two loops, no per-case test bodies.

```
docs/fixtures/rating-v2/scoring.json   18 cases
docs/fixtures/rating-v2/rating.json    14 cases
```

The expected values in those files **are** the specification — they were
generated from the reference implementation in this document and reviewed
before being frozen. A test that fails against them means the implementation is
wrong. Never edit a fixture to make a test pass; changing an expected value is a
spec change and needs the same review this document got.

### Scoring loop

Each case is `{ name, metrics: {caffeine, cups, variety}, expect: {points} }`.
One `test.each` over `cases`, asserting the points function returns
`expect.points`.

Metrics are given directly rather than as lists of drinks. That is deliberate:
the drink catalog is mutable (see [History](#history-is-immutable)), so a
fixture built from `coffee_id`s would silently change meaning the next time a
caffeine value moves. The mapping from entries to metrics is covered separately
by the query tests below.

Cases cover: the empty window; single drinks; linearity at 1, 5 and 12 cups;
caffeine separation at equal cup counts; the variety/cups trade-off; the
zero-caffeine variety farm that intentionally beats one doppio; and the six
per-participant windows of the two worked examples below.

### Rating loop

Each case is `{ name, k, marginScale, participants: [{name, points, rating}],
expect: [{name, delta, ratingAfter}] }`. One `test.each` asserting the settle
function reproduces every delta exactly.

Plus three invariants asserted over **every** case in the file, not per-case:

1. `sum(deltas) === 0`
2. every delta is an integer (`Number.isInteger`)
3. ordering is respected — a participant with strictly more points than another
   never receives a smaller delta, when both start from the same rating

Cases cover: identical points; margins of 50, 200 and 800 points; the K/2
ceiling; a favourite underperforming and performing to expectation; a runner-up
near the lead versus near the tail (the defect that motivated v2); an all-zero
field; eight identical participants; seven-player fields at equal and spread
ratings; and the two worked examples below.

### Query-level tests

Not fixture-driven; these need a database.

- An entry with `is_public = 0` inside the window does not contribute to
  caffeine, cups or variety.
- An entry with `is_public = 0` **does** still contribute to Buzz, stats,
  streaks and the rankings page's caffeine total. The public filter is
  competition-only.
- `logged_at` decides window membership, not `created_at`. An entry created
  after a window closed but logged inside it counts.
- Window bounds are inclusive at both ends.
- `scoresForMany()` and `scoreFor()` return identical results for the same
  roster and window.

### Worked examples

Two full matches end to end, both layers, all participants starting unrated at
`BASE_RATING`. Every participant is fictional. These are the
`worked ...` fixtures.

**An ondemand match, K=80, public entries only**

| user | mg | cups | variety | points | delta | rating |
|---|--:|--:|--:|--:|--:|--:|
| Max Mustermann | 180 | 5 | 3 | 300 | +18 | 1018 |
| Erika Mustermann | 130 | 4 | 4 | 250 | −2 | 998 |
| John Doe | 128 | 4 | 2 | 218 | −16 | 984 |

Note Erika placing second on four cups by drinking four different things, and
losing almost nothing for it — 32 points behind the leader is a near-miss, and
v2 prices it as one. Under v1's rank-only settlement she would have taken the
same loss as a distant last.

**A daily match, K=24, public entries only**

| user | mg | cups | variety | points | delta | rating |
|---|--:|--:|--:|--:|--:|--:|
| Max Mustermann | 400 | 8 | 5 | 595 | +8 | 1008 |
| Erika Mustermann | 310 | 8 | 7 | 535 | +3 | 1003 |
| John Doe | 245 | 2 | 2 | 305 | −11 | 989 |

Same three players, a whole day instead of a working afternoon, and a third of
the K. Scores roughly double against the ondemand window because points are
uncapped and the window is longer — which is the point of removing the ceiling.
Both examples sum to zero.

## Reference implementation

Normative. The shipped code must produce identical output.

```js
function points({ caffeine = 0, cups = 0, variety = 0 } = {}) {
  return Math.round(
    POINT_WEIGHTS.caffeine * Math.max(0, Number(caffeine) || 0)
    + POINT_WEIGHTS.cups * Math.max(0, Number(cups) || 0)
    + POINT_WEIGHTS.variety * Math.max(0, Number(variety) || 0)
  );
}

function actualFromMargin(score, opponentScore) {
  return 1 / (1 + Math.pow(10, (opponentScore - score) / MARGIN_SCALE));
}

function expectedScore(rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / ELO_SCALE));
}

// participants: [{ userId, rating, score }] -> [{ userId, delta, ratingAfter }]
function settleFfa(participants, k) {
  const n = participants.length;
  if (n < 2) throw new Error('settleFfa needs at least 2 participants');

  const raw = participants.map((p) => {
    let sum = 0;
    for (const q of participants) {
      if (q === p) continue;
      sum += actualFromMargin(p.score, q.score) - expectedScore(p.rating, q.rating);
    }
    return (k / (n - 1)) * sum;
  });

  const deltas = apportion(raw, 0);   // unchanged from v1

  return participants.map((p, i) => ({
    userId: p.userId,
    delta: deltas[i],
    ratingBefore: p.rating,
    ratingAfter: p.rating + deltas[i],
  }));
}
```

`apportion()` is carried over from v1 verbatim, including its handling of
`-0` and its deterministic tie-break on the fractional part.

## Accepted consequences

Known, decided, not open. Recorded so they are not mistaken for oversights.

- **The public-entry rule will demote existing players immediately.** Anyone
  who logs mostly privately loses most of their score overnight, including
  players who currently win matches. This is accepted. The rule is a
  requirement, and the logging hint exists so the reason is visible before a
  match settles rather than after.
- **Ratings either side of the cutover come from different rules.** Same units,
  different derivation. A rating is a running total, not a measurement.
- **Zero-caffeine variety farming is viable and stays viable.** Eight cups of
  effort beating one doppio is the intended trade.
