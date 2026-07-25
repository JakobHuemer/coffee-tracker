---
topics: [issue21, issue4, competitions, elo-v2, brew-rating-v2, zero-sum-elo, docs-competitions-elo]
---

# 2026-07-25 — Competitions & Brew Rating v2 spec (issues #21, #4)

Spec-only session, nothing implemented. Full spec: `docs/competitions-elo.md`.
This file records only what isn't in that doc.

## Why this session exists

Prior attempt on `feat/elo-ranking-system` (unmerged, issue #4) implemented an
Elo layer that rated each user against a synthetic "average opponent" —
reviewed and found flawed: not zero-sum, deflated pool ~0.5 rating/user/day in
simulation. `docs/competitions-elo.md` replaces that Elo layer with a real
pairwise/team match model; the score layer (`performanceScore`) from that
branch is still fine and is reused as-is.

## Key design decision not obvious from the doc's structure

Switched Elo's `actual` from Bradley–Terry share (`S/(S+opp)`, magnitude-
sensitive) to strict rank comparison (`S_i > S_j` → 1, tie → 0.5, else 0).
This wasn't just "the old thing was zero-sum-broken" — a magnitude-sensitive
actual score is a second, independent problem: it would make Elo swing harder
on a blowout day than a close one, effectively duplicating what the score
layer's saturating curve already exists to absorb. The continuation prompt's
"only ordering matters" line is the justification; worth keeping if this spec
gets revisited.

## Dead ends avoided

- Did not attempt to reuse `feat/elo-ranking-system`'s migration `010_add_
  ratings.js` — main is at `009_add_post_bookmarks.js` and that branch never
  merged, so its `010` is stale relative to main. Implementation needs a fresh
  `010_add_competitions.js` covering both rating tables and the new match/
  competition tables in one migration.

## Not done

- Issue #21 not edited on GitHub (auto-join line). Left alone per instruction
  — write to GitHub needs explicit ask.
- No code written yet — this session is spec-only, per the goal command's
  literal ask ("write the rough spec").
