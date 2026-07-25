# Frontend quality issues

Audit of the vibe-coded client for state bugs, layout inconsistency, and
animation/transition inconsistency. Checkboxes track the fixing pass.

## A. Theme-switch animation (target: global, uniform ~0.15s)

- [x] **A1 — Theme transition applied to an arbitrary subset of elements.**
  Only a hand-picked list (`body`, `.card`, `.hero-tile`, `.chart-card`,
  `.log-item`, `.bd-item`, `.app-header`, `.bottom-nav`, …) transitions on
  theme change; everything else hard-switches. Timings are mixed (0.4s / 0.5s).
  Result: switching theme fades some elements and snaps others.
  Fixed: theme switch is now **instant/hard** — all ad-hoc 0.4/0.5s theme
  transitions removed and no global transition added. (A global transition
  would need every element to animate its colors and would drift out of sync
  as soon as any new element is added, so we deliberately don't animate it.)
- [x] **A2 — `.theme-badge { transition: all 0.5s }`** animates layout props too
  (and the element is now dead). Remove.
- [x] **A3 — Theme-blind hardcoded colors** that stay light in dark mode:
  `.auth-error` (#FEE/#F0BCBC), `.auth-warn` (#FFF6E5…), `.pw-success`
  (#E8F5E9), `.ch-badge.community` (#E3F2FD), `.ch-badge.personal` (#F3E5F5).
  Fix: drive them from theme-aware tokens / `[data-dark]` overrides.

## B. Interaction animation timing

- [x] **B1 — Hover/press durations scattered:** 0.12s, 0.15s, 0.2s, 0.3s across
  otherwise-identical interactions (buttons, cards, thumbs). Standardize
  interaction transitions to **0.15s**; keep functional bar-fills (progress /
  vs-fill, 0.4s) and the share-toggle slide (0.2s) as intentional.
- [x] **B2 — Overbroad `transition: all`** in several rules animates unintended
  properties. Prefer explicit property lists where trivial.

## C. Layout consistency

- [x] **C1 — Content max-width differs per page:** Feed 640px, Profile/Compare
  `main` 960px, Stats unbounded (full-bleed on desktop). Unify to one content
  width (640px) via a shared token.
- [x] **C2 — Mixed horizontal gutter model:** `.card { margin: 0 16px }` vs
  `main { padding: 0 16px }` vs `.hero-row/.charts-grid { padding: 0 16px }`.
  Cards inside `<main>` get double-inset (main padding + card margin). Pick one
  model (gutter on the container, cards flush).
- [x] **C3 — Two different page scaffolds:** Profile/Compare wrap content in
  `<main>` (max-width 960, padding 24/16/40); Stats builds directly inside
  `.page` with its own paddings. Give the main pages one consistent content
  container.

## D. State / correctness

- [x] **D1 — Undefined CSS var `var(--text)`** used in `.milestone-label` and
  `.profile-remove-photo:hover` — no such variable exists; falls back to
  inherited color (wrong in dark mode). Use `var(--text-primary)`.
- [x] **D2 — Feed likes lost on navigation** (component-local state over cache).
  Fixed: optimistic write into the `['feed']` cache with rollback.
- [x] **D3 — Profile edit form seeded once at mount** (stale/empty). Fixed:
  seed from live user each time editing opens.
- [x] **D4 — Log/goal/challenge mutations under-invalidated** derived queries.
  Fixed: broadened invalidation so all pages stay consistent.
