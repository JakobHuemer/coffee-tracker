---
topics: [match-history, competitions-history-endpoint, rating-graph, teas-catalog, image-handling-plan, issue-15, issue-34]
---

# Match history (#34), more teas, image-handling plan (#15)

Branch `feat/issues-15-34-teas` off main. #15 was left as a **plan doc only**
(`docs/image-handling.md`) at the user's direction — it is `effort:large`
/ "needs a plan first", so no code for it this session.

## Teas
- `server/src/data/coffees.js`: `tea` 0→5mg, added `black_tea` 7mg, `fruit_tea`
  6mg, all `class: 'tea'`, all reuse the existing `tea` icon (FaLeaf).
- Catalog is consumed generically: `COFFEES.length` drives the "try all types"
  achievement target and the "Variety Show" challenge, class grouping is
  derived (`[...new Set(coffees.map(c=>c.class))]`). Adding rows just raises the
  target and lengthens the tea group — no stale constant to chase.
- Existing entries keep the caffeine copied at log time, so the 0→5 bump only
  affects teas logged from now on (by design, see the file's header comment).

## Match history (#34)
- New endpoint `GET /api/competitions/history` (routes/competitions.js), placed
  BEFORE `/:id` like `/leaderboard` so the literal path wins.
  - `personal`: caller's `state='settled'` participations across group AND
    global (rating is one global number), newest first, with
    before/after/delta. Cancelled excluded (moved no rating).
  - `group_history`: caller's group's settled matches as full `matchPayload`
    cards, newest first, `LIMIT 40`.
- Client: new **History tab** (group-level, added to the `hasGroup` tab set).
  `RatingGraph` windows `personal` client-side into 24h/7d/30d — the anchor
  rating entering a window is the prior settlement's `rating_after`, or the
  first window match's `rating_before` (so **no 1000 literal** duplicating the
  server's BASE_RATING), else current rating (flat line).
- **Behaviour change:** group finished matches moved OUT of Matches>Finished
  INTO the History tab (new `finished` prop on `MatchList`, default true;
  MatchesTab passes `false`). Global tab keeps its inline Finished — it has no
  history pill. One home per scope, no duplicated list.
- Graph mirrors the Buzz chart (stretched viewBox + non-scaling strokes); no
  dots (preserveAspectRatio="none" distorts circles — same reason BuzzWidget
  uses none).
