---
topics: [buzz-energy-score, caffeine-pharmacokinetics, energy-endpoint, svg-charts, chartjs-unused]
---

# Buzz energy score (issue #22)

- **Constants are derived, not tuned.** `ka` and `ke` in `server/src/energy.js`
  come from two fetched facts (half-life ~5 h, 99% absorbed in 45 min). Peak at
  ~38 min / ~92% of dose *falls out* of them — it is not a hand-picked number.
  Don't "adjust for feel"; change a source fact and let the peak move. Full
  rationale + links in `docs/energy-score.md`.
- **No migration on purpose.** The score is a pure function of `coffee_entries`,
  so a deleted/backdated coffee instantly rewrites the whole curve and the value
  can never drift from the log. Resist any future request to cache it in a column.
- **Window needs a lookback.** `GET /api/energy` loads doses from
  `now − (hours + 36 h)`, otherwise the left edge of the chart starts at a false
  zero for someone who drank coffee just before the window.
- **`chart.js` is a dependency but is used nowhere** in `client/src`. Every chart
  in this app is hand-rolled CSS bars or inline SVG. The Buzz chart follows that
  (inline SVG, `vector-effect="non-scaling-stroke"` because the viewBox is
  stretched with `preserveAspectRatio="none"`). Either adopt chart.js everywhere
  or drop it from `package.json` — right now it is dead weight.
- **Instant domain only.** `energy.js` must never import `../time`: there is no
  civil-day logic in it, elapsed time is a duration, so no timezone applies.
  Axis labels are formatted client-side in the browser's zone.
- Testing note: `bun test` in `server/` picks up `src/energy.test.js`; the model
  is exported separately from the route precisely so it is testable without HTTP.
