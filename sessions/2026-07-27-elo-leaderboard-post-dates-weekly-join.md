---
topics: [issue29, issue40, issue44, global-leaderboard, elo-ranking, rankings-route, post-dates, feed-time, weekly-first-day-join, competitions-lock]
---

# Elo leaderboard + post dates + weekly first-day join (issues #29, #40, #44)

Branched off **main** (not the #41/#42 stack — user's call). #44 edits
`competitions.js`/`routes/competitions.js`, which the unmerged #42 also touches,
so expect a merge conflict there once both land.

## #40 Global leaderboard by Elo
- `routes/rankings.js` was `ORDER BY total_caffeine DESC`. Now sorts by
  `user_ratings.rating` (imported `BASE_RATING` for the COALESCE default), cups
  and caffeine are display columns only. Unrated (`matches = 0`) sort last via
  `ORDER BY (COALESCE(r.matches,0) = 0), rating DESC` — the `=0` boolean sorts
  rated(0) before unrated(1). Each row also LEFT JOINs group_members +
  competition_groups for `group_name` (one-group-per-user UNIQUE keeps GROUP BY
  u.id deterministic).
- `rank_1` badge now guarded with `ranked[0].matches > 0` so an all-unrated board
  doesn't award it to an arbitrary row.
- Client `Stats.tsx` RankingsTab: rating is the headline, group·cups·caffeine a
  muted sub-line; unrated rows show rank `—` (not a medal), same convention as
  the Compete leaderboard. Hero "Global Rank" tile shows `—` when `matches===0`.
  New CSS `.lb-userinfo`/`.lb-substat`. Period tabs now only filter the
  cups/caffeine columns — the Elo order is period-independent.

## #29 Detailed date on posts
- `FeedList.tsx`: added `exactTime()` (`toLocaleString` month/day/hour/min) shown
  beside the coarse `timeAgo` — "3d ago · Jul 24, 09:15" — with a `title` giving
  the full locale timestamp. Same in the photo lightbox meta.

## #44 Weekly joinable on its first day
- New `joinDeadline(match)` in `competitions.js`: for a weekly it's the end of
  the group-local **first day** (`localWallInstant(period_key + 1 day, 00:00,
  tz)`); for every other mode it's `scope_start` (unchanged). Used in BOTH
  `lockDueLobbies` (skip locking a weekly still in its first day) and the join
  route (replaced the `scope_start <= now` reject). So a weekly stays an `open`
  lobby, and joinable, through day one, then locks like anything else. Scoring
  window is untouched (still Mon–Sun), so zero-sum holds.
- Client MatchCard: an `open` match whose `scope_start` is already past (the
  weekly day-1 case) now shows "Open · ends …" instead of "Starts 5h ago".
- `openMatch` test helper gained a `periodKey` arg (weeklies need one for
  joinDeadline). New tests: weekly stays open through day 1 then locks; daily
  still locks at start; route-level first-day join; plus routes.rankings.test.js
  (new file) for the Elo sort / unrated-last / group column.
