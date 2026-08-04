---
topics: [profile-view-73, badges-80, badge-popover, featured-badges-removal, secret-badge-masking, badge-ordering, worktree-deps]
---

# Public profile view (#73) + badge polish (#80)

## Decisions (not in code)
- #73 was `status:needs-discussion` on how Compare surfaces. User chose **inline
  on the public profile page**, not a modal or separate page. `CompareContent`
  gained `hideSearch` for this reuse; the profile scroll-into-views it on open.
- #80: **removed the "featured badges" selection entirely.** A profile now shows
  **every earned badge**, rarest-first. No picker, no pick-N. `users.featured_badges`
  column dropped in **migration 022**. Do NOT reintroduce a featured/pick concept.

## Shape / naming
- Wire field renamed `featured_badges` → `badges` on every profile-bearing
  payload; client type `FeaturedBadge` → `ProfileBadge` (now carries optional
  `description` for the popover).
- `server/src/profile.js` is the single source: `badgesFor` / `badgesForMany`
  (batched, rarest-first) + `publicProfileFor`. feed / competitions / groups /
  compare / users routes all draw from it — match them for any new surface.
- Public profile: `GET /api/users/:username` (identity + badges + stats + `self`).
  Clicking any name/avatar → `/u/:username`.

## Gotchas
- **Badge info popover** via `withInfo` on `<Profile.Badges>`/`<BadgeRow>` —
  used on BOTH profile pages (public + private), not inline surfaces (posts,
  rosters). Hover is **mouse-only** (gated on `pointerType`): on touch the
  browser fires a synthetic `mouseenter` that opened-then-closed the popover on
  tap — the tap now goes through the click handler alone. Hover delay 300ms,
  200ms fade-in.
- **Secret badges: name+icon shown, how-to hidden.** On a profile a secret the
  owner earned shows its real name + icon, but `profile.js` withholds its
  `description` from any viewer who hasn't earned it (`viewerId` threaded through
  feed/competitions/groups/compare/users). Own secrets / shared secrets reveal
  the description. Separately, the badge *collection* page still masks an
  owner's *un*earned secret to `???` (badges route sends `description: ''`).
- Neither profile page has a "Profile" page-header title (redundant); the public
  one puts `@handle` on the name via `<Profile.Name handle>`.
- `byUnlockedThenRarity` (rarity.ts): unlocked group **rarest-first**, locked
  group **ascending** — intentional, asymmetric. Used by Badges + Achievements.
- **This worktree ships without node_modules** — `server/` and `client/` both
  needed `bun install`. Route tests fail with "Cannot find package 'express'"
  until you do; not a code bug.

## AGENTS.md self-catch
- Removed a scale-pop hover (`scale(1.05)`) on `.badge-medal` — violated the
  no-scale-as-feedback guardrail. Now translateY only.
