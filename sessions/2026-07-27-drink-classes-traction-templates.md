---
topics: [issue11, issue6, issue7, drink-classes, coffee-catalog, latte-caffeine, github-link, issue-templates, gh-cli-auth]
---

# Drink classes + traction link + issue templates (issues #11, #6, #7)

## #11 Drink classes
- `class` on each `server/src/data/coffees.js` item is a *semantic key like
  `icon`*: server sends the id (`coffee`/`chocolate`/`tea`/`energy`), client owns
  the label (`CLASS_LABEL` in `LogCoffee.tsx`). No server-side label/list —
  group order is derived from catalog order (`[...new Set(coffees.map(c=>c.class))]`),
  the single source. An earlier `CLASSES` export was removed as a duplicate order.
- Latte + Latte Macchiato caffeine 75→**50** ("basically milk", one shot). This
  is a product number, not a measured one — flagged to maintainer, easy to tweak.
- **No migration / no entries-schema change.** `caffeine_mg` is copied onto each
  entry at log time (`POST /coffees/entries`), so the new value only affects
  future logs; history is untouched. `class` is derivable from `coffee_id` via
  the catalog, so it is *not* denormalized onto rows.
- Deliberately **out of scope**: the #11 NOTE about adding class variety to the
  ranking score is issue **#21**'s work (would need a class column on entries +
  a `rankings.js` formula change). Not touched here.
- `unique_types`/"Full Menu" achievements & challenges count distinct
  `coffee_id` against `COFFEES.length` — unaffected by adding a `class` field.
- Picker copy that assumed coffee-only was updated (VALUES 0.4): section label
  "Coffee type"→"Drink", "Pick a coffee type…"→"Pick a drink…", submit error.

## #6 / #7
- #6: GitHub link is an `<a class="header-btn">` in `AppHeader.tsx` (added
  `text-decoration:none` to `.header-btn` since it's now used by an anchor).
  New `github` icon = `FaGithub` from `react-icons/fa6` (brand icons live there
  in v5 — verified in node_modules).
- #7: `.github/ISSUE_TEMPLATE/` as YAML issue *forms* (idea.yml, bug.yml) +
  `config.yml` with `blank_issues_enabled:false`. Labels prefill to the repo's
  `type:`/`priority:` taxonomy from AGENTS.md.

## gh CLI
- Installed via winget (v2.96) but **not authenticated** and no GH_TOKEN in env.
  Issues were read via the public REST API. Claim protocol / PR / issue comments
  all need interactive `gh auth login` by the developer.
