# Competitions & Brew Rating (spec)

Spec for issue #21. Nothing implemented yet. Base model: matches, a score per
participant per match, an Elo rating settled from that score. Nothing beyond
that is assumed without being flagged below.

## Two layers

1. **Score** — single-player, accumulating, per-metric. Never zero-sum.
2. **Rating (Elo)** — consumes participants' scores for one match, ranks them,
   settles a zero-sum delta. Never reads raw metrics directly.

**Hard requirement: every match is zero-sum, no exceptions.** Sum of deltas
across all participants in a match = 0, always. No virtual/synthetic opponent
— every delta traces to a real participant on the other side of it. This must
be provable from the formula structure, not just tested after the fact.

## Layer 1 — score

Per user, per match window, from `coffee_entries`:

```
f(x, k) = x / (x + k)                      # [0,∞) -> [0,1), diminishing returns

S = w_caf * f(caffeine_mg_sum, k_caf)
  + w_cups * f(cup_count, k_cups)
  + w_var * f(distinct_coffee_count, k_var)
```

Decided: `w = 0.45/0.35/0.20`, `k = 200/3/2` (caffeine headline but under half,
cups rewards usage, variety saturates fastest and so gets lowest weight).

A user who logs nothing in a window has `S = 0`. That's it — no separate
"skip" mechanic in the score layer.

## Layer 2 — rating

One global rating per user (`BASE_RATING = 1000`), shared across all modes.
K varies per match — lives on the match row, not globally.

Decided — K per mode (classic single-match Elo uses `K=32` as reference):

| mode      | K  | scope window |
|-----------|----|--------------|
| daily     | 8  | recurring day, per timezone shard |
| weekly    | 20 | recurring week, per timezone shard |
| 1v1       | 32 | set at match creation, not recurring |
| ondemand (FFA) | 32 | set at match creation, not recurring |
| team      | 24 | set at match creation, not recurring |

Daily fires ~365x/year on one day's luck, so it's kept low-weight. Weekly
fires ~52x/year but each match aggregates 7 days — closer to a real
consistency signal, so it sits well above daily. 1v1/ondemand are rare and
deliberate (someone chose to start this match), so they take the full
classic weight. Team sits slightly below that since the team-level delta gets
further split across members (a form of dampening already baked into the
split step), not because the match itself is less deliberate.

1v1, ondemand, and team matches have no fixed recurring window — the
`scope_start`/`scope_end` is whatever the creator sets when the match is
made (e.g. "settle at end of today", "run for the next 3 days"). Only daily
and weekly are on a fixed recurring window.

### Timezones

Two cases.

**Automatic matches (daily, weekly)** run one match per timezone shard, so the
reset lands on each player's own midnight.

Shard key comes from the user's zone evaluated at one fixed reference instant
(`2026-01-15T12:00:00Z`). DST is deliberately ignored — the offset at that
instant is the offset used all year.

```
offsetHours = offsetMs(REFERENCE_INSTANT, userTz) / 3600000
shard       = ((Math.round(offsetHours) % 24) + 24) % 24   // 0..23
```

Rounding to whole hours folds :30/:45 zones (India, Nepal, Chatham) into the
nearest hour. The `% 24` wrap merges +14 with -10 and +13 with -11 — those
share a wall clock, so they belong in the same match. Exactly 24 shards.

**Rounding rule is JS `Math.round`: ties break toward `+∞`, not away from
zero.** This matters only for negative half-hour zones — `Math.round(-9.5)`
is `-9` (Marquesas lands on -9), `Math.round(-3.5)` is `-3` (Newfoundland
lands on -3). Any reimplementation must match this exactly; a language whose
`round` breaks ties away from zero would put those zones in a different
shard.

Window for shard `s` on civil date `D`:

```
start = Date.parse(`${D}T00:00:00Z`) - s * 3600000
end   = start + 86400000 - 1
```

Weekly is the same, anchored to Monday, running 7 days.

Accepted cost: a DST-observing region is off by an hour for half the year
(Vienna resets 00:00 in winter, 01:00 in summer). Chosen so shard membership
never churns and nobody switches match mid-season.

**User-created matches (1v1, ondemand, team)** are global — no shard. Their
timeframe is fixed at creation as absolute UTC instants and applies to every
participant regardless of location. The frontend renders those instants in the
viewer's local time; the server never re-anchors them.

`scope_start`/`scope_end` are UTC epoch ms in both cases. Every participant in
a match shares one identical window, so the zero-sum/fairness argument is
unchanged.

`actual` is rank, not magnitude: for scores `S_i`, `S_j`,
`A_ij = 1 if S_i>S_j, 0.5 if equal, 0 if S_i<S_j`. Only ordering matters —
margin is the score layer's concern, not rating's.

### FFA (N participants) — pairwise decomposition

All `N*(N-1)/2` unordered pairs. For ordered pair `(i,j)`:

```
E_ij = 1 / (1 + 10^((R_j - R_i) / 400))
delta_i = K/(N-1) * sum_{j!=i} (A_ij - E_ij)
rating_i' = rating_i + delta_i
```

**No floor/clamp in the settlement formula, anywhere, in any mode.** A
`MIN_RATING` clamp on `rating_i'` would break zero-sum the moment any single
participant hits it — the clamped amount vanishes from the ledger instead of
landing on the other side. If a rating floor is wanted at all, it's a
display-only concern (e.g. render `max(0, rating)` on the leaderboard) and
must never feed back into `rating_before` for the next match — the stored,
settled rating is unclamped, full stop.

Zero-sum is structural: `A_ij+A_ji=1` and `E_ij+E_ji=1` always, so every pair's
contribution to `sum(delta_i)` cancels exactly, for any N, K, rating spread.
A participant with `S=0` (didn't log) still plays the match — they rank at or
near the bottom against anyone who scored above 0 and lose rating like any
other last-place finish. That is not a special penalty, it's the same formula
everyone else gets; there is no carve-out for non-logging participants.

### 1v1

N=2 of the same formula, no branch: one pair, `K/(N-1)=K`, reduces to classic
head-to-head Elo.

### Teams (x vs y)

Each side must have `n>=2` — a side of 1 is the 1v1 mode above, not a team of
one (avoids a `(n-1)` division by zero in the losing-side split below).

Settle team result first, then split each side's pot by contribution share.

```
R_team  = mean(rating_i for i in team)
S_team  = mean(S_i for i in team)
E_A = 1 / (1 + 10^((R_B - R_A)/400))
A_A = 1 if S_A > S_B, 0.5 if S_A == S_B, 0 if S_A < S_B
P_A = K_team * (A_A - E_A)
P_B = -P_A

share_i = exp(S_i / T) / sum_k exp(S_k / T)  # softmax, T=1, see below

winning side: delta_i = P * share_i                   # sum = P
losing side:  delta_i = P * (1-share_i)/(n-1)          # sum = P
```

A team-level tie (`A_A = 0.5`) that also lands on `E_A = 0.5` gives `P = 0`,
so every member's delta is `0 * share_i = 0` — no special case needed.

Decided — softmax over score, temperature `T=1`:

```
share_i = exp(S_i / T) / sum_k exp(S_k / T)
```

Keeps close scores near-equal (same as raw ratio there), but stops crushing
the bottom performer as the score gap widens — unlike `S_i/sum(S_k)`, which
punishes linearly. Also handles the all-zero-score team for free (`exp(0)=1`
for everyone), no separate fallback needed.

Both splits sum exactly to `P` by construction once `share_i` sums to 1.
Combined with `P_A=-P_B`, the whole match nets to zero.

### Tests required

- FFA: random N in [3,8], random ratings/scores, assert `sum(deltas)==0`.
- 1v1: N=2 FFA path matches classic two-player Elo numbers exactly.
- Teams: random team sizes, assert whole-match sum is 0 and each side's split
  sums to its pot.
- Simulation: several hundred mixed matches over a synthetic pool, assert pool
  mean rating doesn't drift beyond noise (drift would mean the zero-sum proof
  above doesn't hold in the actual code).

## Schema (proposal, not fixed)

```
matches
  id, mode ('daily'|'weekly'|'ondemand'|'1v1'|'team'),
  shard (0..23, NULL for user-created modes),
  scope_start, scope_end, state ('pending'|'settled'), k_factor, settled_at

match_participants
  id, match_id, user_id, team_id (NULL for FFA/1v1),
  score, contribution_share, rating_before, rating_after, delta

user_ratings                      -- current-value cache
  user_id, rating, matches, updated_at
```

Rating history reconstructs by replaying `match_participants` per user ordered
by `settled_at`; `user_ratings` is a derived cache, not source of truth.
Next migration: `010_add_competitions.js` (main is at 009).

Decided: rosters form by explicit opt-in only. A user must join a competition
(a `competitions`/`competition_members`-style row) before any match includes
them — no mechanism auto-adds a user to a match based on activity alone.

## Open (implementation time)

- Leaderboard display rule for users with zero matches — display/UI concern,
  not addressed here.
