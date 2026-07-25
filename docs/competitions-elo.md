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
| daily     | 8  | fixed recurring UTC day |
| weekly    | 20 | fixed recurring UTC week |
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

**Daily/weekly windows are UTC, not per-user civil days — deliberate
exception to `docs/time-and-timezones.md`.** That doc's convention (civil
day/week boundaries evaluated per-user IANA timezone) exists for single-user
constructs like streaks and goals. A match pools multiple participants who
must all be scored over the *identical* window — if each participant's "day"
were their own civil day, two participants in different zones would be
scored over windows offset by up to ~23 hours, handing one of them extra
time to accumulate score before settlement. A single shared clock (UTC)
removes that unfairness entirely, so it also removes the need for a
timezone-based join restriction: participants in any timezone can compete
in the same daily/weekly match, since the window is an absolute instant
range, not evaluated relative to anyone's locale. No cross-timezone block
needed — the shared clock *is* the simpler solution.

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
R_team = mean(rating_i for i in team)
E_A = 1 / (1 + 10^((R_B - R_A)/400))
A_A = 1/0.5/0 by which team's aggregate score is higher
P_A = K_team * (A_A - E_A)
P_B = -P_A

share_i = exp(S_i / T) / sum_k exp(S_k / T)  # softmax, T=1, see below

winning side: delta_i = P * share_i                   # sum = P
losing side:  delta_i = P * (1-share_i)/(n-1)          # sum = P
```

Decided: `R_team = mean(rating_i)`, team score for the A/B logistic =
`mean(S_i)`.

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
