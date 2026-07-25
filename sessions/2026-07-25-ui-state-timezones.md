---
topics: [pr13-review, theme-switch, animated-bg, feed-like-state, unified-header, css-quality, timezones, time-spec, values-rule0, fetch-over-recall]
---

# 2026-07-25 — UI cleanup, state fixes, timezone model

## Gotchas / non-obvious
- **Theme switch is deliberately instant.** No global color transition (it would
  need every element to animate and drifts as elements are added). `toggleDark`
  (client/src/store/theme.ts) uses the `disableTransitionOnChange` trick: inject
  `*{transition:none}`, set `data-dark`, force reflow, remove — so elements with
  `transition: all` (e.g. Stats filter pills' selection state) don't animate the
  theme flip while plain elements snap.
- **"just now" forever bug**: a post's `logged_at` was in the future →
  `timeAgo` diff negative → always "just now". Cause: LogCoffee picker applied a
  future time-of-day; server tolerated +1 day. Fixed: `validTimestamp` now
  allows only +2min skew; LogCoffee rejects future times.
- **BgCanvas** (particle bg) kept in tree but unmounted (commented in App.tsx).
- **Dead pages deleted**: Dashboard/Goals/Challenges/Rankings — their routes
  redirect to /stats; functionality lives in Stats.
- **Uploads** are served through an auth-gated `/uploads/:filename` route
  (index.js), not static — `<img>` can't send a header, so it also accepts
  `?token=`. Client wraps URLs via `uploadUrl()`.

## Timezone model (see docs/time-and-timezones.md — read it + its sources)
- Two domains: **instant** (UTC epoch, e.g. logged_at, post ages) vs **civil**
  (zoned: "today", before-10am, streaks, goals).
- Single translation boundary: `server/src/time.js`
  (`localDateStr/localTodayStr/localDayBounds/localWallInstant/getUserTz`), using
  Intl (zero-dep, DST-correct). Never `Date.getHours/setHours` for civil logic.
- User IANA zone stored on `users.timezone` (migration 008, default 'UTC').
  Client sends `Intl…timeZone` on register/login and PATCHes /me on load when it
  changed. Streak consecutiveness = compare local date strings (DST-proof), no
  retroactive recompute.
- Civil sites converted: coffees (stats + /entries?date), achievements (streak +
  time-of-day + morning-ritual/coffee-loop), goals, casualties, compare.
- **Challenges are challenge-global, NOT per-user** — shared across users, so
  their start/end dates are anchored to UTC explicitly (`…T00:00:00Z`), not any
  participant's zone.
- Verified: same entry gives today_cups=0 in UTC vs 1 in Honolulu.

## Standing rules added this session
- VALUES.md **rule 0** (hard gate): never reference a symbol that doesn't exist
  (CSS token / function / import). Rejected outright in review.
- AGENTS.md guardrail: **prefer fetching over recall** (assume ~1% knowledge);
  and follow docs/time-and-timezones.md before touching time code.
