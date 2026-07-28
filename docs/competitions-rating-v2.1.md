# Competitions — rating v2.1 (amendment)

Status: **specified, not implemented.**

This amends [competitions-rating-v2.md](./competitions-rating-v2.md). Everything
in that document still holds except where contradicted here. It is an amendment
rather than a replacement because exactly one thing changes: **`MARGIN_SCALE`
stops being a constant and becomes a function of the match window's length.**

Points, the rating formula, zero-sum, apportionment, the public-entry rule, the
removals and the immutability of settled matches are all unchanged.

It also flattens `K_BY_MODE` to a single value — see
[K is now one number](#k-is-now-one-number).

## Why this exists

v2 shipped `MARGIN_SCALE = 150` as a single constant while making points linear
and uncapped. Those two decisions are incompatible, and the tuning-surface note
in v2 says so in advance — "changing a weight silently changes how hard the
rating layer reacts" — but the same coupling applies to the *window*, which v2
did not account for. A weekly accumulates roughly seven times a daily's points,
so a fixed gap threshold means the two are graded on completely different
curves.

Measured against real usage (a working group's actual logging: a weak day is
~350 points, an average day ~420, a heavy day ~665):

| matchup | gap | at D=150 | at v2.1 |
|---|--:|--:|--:|
| average vs weak | 70 | 75% | 58% |
| heavy vs average | 245 | 98% | 76% |
| heavy vs weak | 315 | 99% | 81% |
| heavy vs someone who logged nothing | 665 | 100% | 96% |

At 150, every matchup above the smallest is graded 98–100% — indistinguishable.
That is v1's rank-only behaviour, which is the defect v2 was written to remove.
v2 removed it only in the first drink or two and reinstated it everywhere else.

The weekly is worse. At a fixed 150, *every* realistic weekly gap reads 100/0:

| weekly gap | at D=150 | at v2.1 |
|---:|--:|--:|
| 350 | 100% | 56% |
| 1225 | 100% | 69% |
| 3325 | 100% | 90% |

And user-created matches make a constant indefensible outright: `ondemand` and
`1v1` windows are user-chosen anywhere from **60 seconds to 90 days**. No single
number can grade both.

## What changes

`MARGIN_SCALE` is replaced by two constants and a derivation.

```js
// Point gap, per day of window, that grades as roughly 90/10.
const MARGIN_PER_DAY = 500;

// Shortest window the scale is allowed to reach. Below ~7.2 hours the
// derivation would make a single drink an automatic shutout.
const MARGIN_FLOOR = 150;

// The margin scale for one match. `scope_end` is inclusive, hence the + 1.
function marginScaleFor(scopeStart, scopeEnd) {
  const durationMs = scopeEnd - scopeStart + 1;
  return Math.max(MARGIN_FLOOR, MARGIN_PER_DAY * (durationMs / 86400000));
}
```

`actualFromMargin` and `settleFfa` take the scale as a parameter instead of
closing over a module constant:

```js
function actualFromMargin(score, opponentScore, marginScale) {
  return 1 / (1 + Math.pow(10, (opponentScore - score) / marginScale));
}

function settleFfa(participants, k, marginScale) { /* otherwise unchanged */ }
```

The caller passes `marginScaleFor(match.scope_start, match.scope_end)`.

### What each window becomes

| window | scale |
|---|--:|
| 1 minute (shortest legal ondemand) | 150 |
| 1 hour | 150 |
| 6 hours | 150 |
| 12 hours | 250 |
| daily | 500 |
| daily across a spring-forward (23h) | 479 |
| weekly | 3500 |
| 30 days | 15000 |
| 90 days (longest legal ondemand) | 45000 |

### Why it is not stored on the match row

`k_factor` is copied onto `matches` at creation so the K a match will settle at
is visible from the moment someone joins. The scale needs no such column: it is
a pure function of `scope_start` and `scope_end`, which are already stored,
already immutable, and already shown to participants. Deriving it is exactly as
visible as storing it, and one less thing that can disagree with itself.

No migration. Nothing is added to the schema.

## Derived, not given

- **Zero-sum is untouched.** The scale is one constant per match, applied to
  every pair in it. `A_ij + A_ji = 1` holds for any positive scale, so the
  antisymmetry argument in v2 carries over verbatim. This is why the scale may
  vary between matches but must never vary *within* one.
- **A DST day grades slightly harder**, because it is genuinely a shorter window
  with less drinking in it. This falls out of the derivation and is correct.
- **`MARGIN_PER_DAY` is denominated in points**, so v2's warning still applies
  with full force: changing a `POINT_WEIGHT` requires re-deriving this constant
  in the same commit.
- **The floor is the old v2 constant.** Below ~7.2 hours a match keeps behaving
  exactly as v2 specified. That is a deliberate anchor, not a coincidence: 150
  is a known-reasonable grading for a window with one or two drinks in it.

## Why 500, and why not tighter

500 was chosen against the measured range above. A tighter scale (400) would
spread that group's specific spread across more of the curve, and was rejected:
it fits today's habits, and goes wrong the first time someone has a genuine
outlier day or the group grows. 500 fits the observed range into the 58–81%
band — the useful part of the curve — and leaves headroom above it.

The shortcut for re-deriving it: **the scale is approximately the gap you want
to read as 90/10.** Exactly, the 90/10 gap is `scale × log10(9)` = 477, so a
scale of 500 grades a 477-point gap at exactly 90% and a 500-point gap at 91%.

## K is now one number

v2 gave each mode its own K (`daily 24`, `weekly 48`, `1v1`/`ondemand` 80) on the
theory that a daily is a poorer sample and should move ratings less. The
duration-scaled margin removes the reason for that. A daily and a weekly are now
graded on curves matched to their own length, so a close day is *already* graded
as close — the K no longer has to also dampen it. Keeping a low daily K on top of
that double-counts, which is what produced the near-zero +4 / +2 / −6 daily.

So K collapses to a single value:

```js
const K = 80;
```

**Every mode settles identically. The only thing that distinguishes daily and
weekly from ondemand is that the server opens them automatically** — the rating
math does not know or care which. The v2 worked daily now settles +14 / +7 / −21
(K=80, scale 500), in line with the ~40-point swing an emphatic result is meant
to produce.

`matches.k_factor` stays: it is still copied onto the row at creation, still
immutable, still 80 for every new match. A match settled under v1 keeps whatever
K it was created with.

## Corrections to v2's prose

Two statements in v2 are wrong as written. Neither describes a defect in the
code, and neither is fixed by this amendment's formula — they are documentation
errors, recorded so the next reader does not trust them.

1. **"Rating gap at which the favourite is expected to score 76/24" (both
   `MARGIN_SCALE` and `ELO_SCALE`)** — off by a factor of two. A full scale of
   gap grades as 91/9; 76/24 lands at *half* a scale. The D=150 table in v2 is
   correct; only the one-line glosses are not. (This is inherited from the
   classic "Elo 400 = 76%" gloss, which has the same error.)
2. **"A single match can move a rating by around 40 points" / the "max 1v1
   swing" column** — this is the swing between *evenly rated* players, not a
   ceiling. `delta = K·(A − E)`, and `E` is only 0.5 when ratings match, so the
   real bound is `|delta| < K`. v2's own frozen `favourite underperforms`
   fixture settles at **±64 on K=80**, past the ±40 the table advertises. The
   40 was always intended as a rough magnitude rather than a promise; it should
   read as one.

## Tests

`docs/fixtures/rating-v2/scoring.json` is **unaffected** — points do not change.

`docs/fixtures/rating-v2/rating.json` survives almost intact. Every case already
carries an explicit `marginScale: 150`, so once `settleFfa` takes the scale as a
parameter, twelve of the fourteen cases are pure-math tests of the settlement at
a given scale and their expected values remain correct as frozen.

The two exceptions are the mode-labelled ones:

- **`worked ondemand example, K=80`** — a working-afternoon window is under 7.2
  hours, so it sits on the floor at 150. Expected values **unchanged**.
- **`worked daily example`** — now K=80 (not 24) and scale 500 (not 150). Its
  expected deltas change to +14 / +7 / −21 and this case must be regenerated,
  along with its `k` field.

The other twelve cases keep their explicit `k` and `marginScale`; as pure-math
tests of the settlement at a given `(k, scale)` their frozen values stay
correct, regardless of what production K now is.

New cases to add, since nothing currently covers the derivation:

- `marginScaleFor` at 1 minute, 6h, 7.2h (the floor boundary), 24h, 7d, 90d.
- A DST daily (23h) producing 479.
- The same three participants settled over a daily window and a weekly window,
  showing the same point spread grading differently.
- Two matches with identical scores and K but different window lengths, settling
  differently — the whole point of the amendment, and the case that would have
  caught its absence.

The three invariants v2 asserts over every rating case (sum is zero, deltas are
integers, ordering respected) are unchanged and must still hold for every scale.

## History

v2.1 supersedes v2 outright, with **no history split** — unlike v2 versus v1.
No match has ever settled under v2: it is implemented on a branch and has not
run in production. There is therefore nothing denominated in v2's rules to
preserve, no cutover, and no back-fill question to answer.

Everything v2 says about matches settled under **v1** still applies without
change: they keep their stored scores, deltas and ratings forever, and
`migrations/lib/settle-v1.js` stays frozen.
