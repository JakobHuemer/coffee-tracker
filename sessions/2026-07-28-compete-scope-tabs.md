---
topics: [issue-53, compete-page, leaderboard-scope, sqlite-alias-trap, cross-group-history, playwright-in-docker, url-tab-state]
---

# Compete: Global/Group as top-level tabs (#53)

Branch `feat/issue-53-competitive-tabs` off main. Pure UI restructure plus one
endpoint gaining a `scope` filter — no ranking-math change.

## Shape

- Top-level scope tabs (`.stats-tabs`): Global / Group.
- Nested section tabs (`.tab-row`): Matches / Ranking / History (both scopes)
  + Preferences (Group only — auto-join and group settings are the only
  preferences that exist, and both are group-scoped).
- Rating card and rating graph are identical in both scopes: rating IS one
  global number, so scoping them would lie. Only the surrounding lists scope.

## Leaderboard scope contract

`GET /competitions/leaderboard?scope=global|group`. `scope=group` is a FILTER
over the global ordering, not a re-rank: a two-person group reads e.g. #3, #4,
never #1, #2. Response gained `scope` and `me` (caller's own row, present
even when they fall outside the 50-row global page). Unknown scope silently
falls back to global — the client trusts the echoed `scope`, not its own
query.

## SQLite alias trap (bug caught in dev)

`ORDER BY (matches = 0) ASC` broke for users with no `user_ratings` row: the
bare `matches` inside a larger expression resolved to the source column
(NULL), not the `COALESCE(r.matches, 0)` alias — so unrated users sorted
FIRST, the opposite of the spec. Fixed by repeating the COALESCEs in the
ORDER BY. The single-column alias case worked, which is what made it easy to
miss. See `server/src/routes/competitions.js` `globalStandings()`.

## Cross-group history hole (caught by review, fixed)

`Compete.tsx HistorySection` first filtered elo changes by
`e.group_id === data.group?.id`. A user who played in a group they have since
left has rows with the OLD group id — those would fall out of both the group
and the global lists while still showing as drops on the graph. Now the two
filters are complements (`(group_id === null) === global`) so every settled
match appears under exactly one section.

## Ownership visibility (regression avoided)

Deleted the members list from what became the Preferences section (Ranking is
the member list now). That list was the only place a non-owner saw the group
owner. Added an owner name to the group meta line in the card
(`Icon crown + owner.username`) so the info is not lost. CSS `.cmp-owner-tag`
(the old badge) is removed with its only consumer.

## Browser testing without OS deps

Local Chromium install failed on system libs (arm64, no sudo). Ran
Playwright's own container against `--network host` and the local test
server:

```
docker run --rm --network host \
  -v /tmp/ui53.mjs:/work/ui53.mjs:ro -v /tmp/shots:/tmp/shots -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  sh -c "npm i -s playwright-core@1.62.0 >/dev/null 2>&1; node ui53.mjs"
```

30 UI assertions across two scopes, four sections, and the no-group gate.
Useful pattern for any future work where headless Chromium won't launch
here directly.

## Review fixes (PR #57)

- Tab state lives in the PATH, not query params: routes `/compete`,
  `/compete/:scope`, `/compete/:scope/:section` all mount `<Compete>`; the page
  reads `useParams` and `useNavigate`. A `useEffect` canonicalises once data
  loads — bare `/compete`, an unknown scope, or a section the scope lacks all
  `navigate(replace)` to the resolved `/compete/<scope>/<section>`. Guarded by
  `isLoading` so `hasGroup` (which picks the default scope) is known first; no
  redirect loop because the rewrite target always matches the params it sets.
  Server SPA fallback (`app.get('*')`) already serves index.html, so deep-link
  refresh resolves client-side.
- Top-level Global/Group is a real underline tab bar (`.cmp-scope-tabs` /
  `.cmp-scope-tab`), NOT the shared `.stats-tabs` pills — Stats still needs
  those pills, so the compete bar got its own class.
- `.cmp-hist-list` is a direct child of `.cmp-body` (HistorySection returns a
  fragment) but was missing from the `.cmp-body >` horizontal-inset rule, so
  the elo-change list ran full-bleed and touched screen edges on mobile.
