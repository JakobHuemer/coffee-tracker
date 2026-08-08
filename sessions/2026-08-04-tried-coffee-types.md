---
topics: [log-menu-tried-types, variety-achievements, local-dev-ports, stale-local-main]
---

# Show tried coffee types in the log menu

Feature: in `LogCoffee`, mark coffee types the user has already logged so the
variety achievements (`variety_3/7/all` — "Explorer"/"Connoisseur"/"Full Menu")
stop being invisible. Green corner check on tried buttons + an `X / Y tried`
pill by the "Drink" label.

- Source of "tried": `GET /coffees/stats` → `by_type` keys are exactly the tried
  coffee ids (same source Milestones uses for `unique_types`). No new endpoint.
- Pill numerator counts **current-menu** coffees tried, not `by_type` length.
  Deliberate: a coffee tried then removed from the menu is in `by_type` but not
  the menu, so raw length could exceed the menu size and render "23 / 22". The
  achievement engine's `unique_types` still uses raw distinct — so in that one
  edge case the pill and Milestones can differ by design.
- Chose a check badge over a background swap: `.coffee-btn` background is already
  owned by `.selected`/`:hover`, so tinting tried/untried would collide.

## Gotchas (worth knowing on this machine)

- **Port 3001 is OS-reserved here** (Windows excluded port range) — nothing can
  bind it. The client Vite proxy hardcodes `http://localhost:3001`
  (`client/vite.config.ts`), so the normal two-process local dev is broken on
  this box. Workaround used for verification: `bun run build` the client, copy
  `client/dist` → `server/public` (untracked, server serves SPA single-origin),
  run the server on a free port with `DB_DIR` pointed at a scratch **copy** of
  `server/data` (so the competitions ticker can't mutate real dev data), open
  the browser at that port. Minted a dev JWT the way the route tests do
  (`jwt.sign({id,username})`) to view an authed page — no login flow.
- **Local `main` is stale — `behind 49` vs `origin/main`.** Real trunk is
  `origin/main` (had every feature this change builds on: data-driven coffee
  menu #77, `--success-*` tokens). Branch feature work off `origin/main`, never
  the local `main` ref.
- Browser pane screenshots fail in this session ("pane not displayed"); verified
  via `read_page` + computed styles instead (both light and dark themes).
