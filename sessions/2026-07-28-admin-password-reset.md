---
topics: [admin, password-reset, is-admin, migration-016, admin-bootstrap, requireAdmin, ADMIN_USERNAME]
---

# Admin password reset (feat/admin-password-reset)

Added an admin capability: admins reset any user's password (direct set, no
current-password needed) and promote/demote admins. Single `is_admin` flag, no
role system (out of scope by request). Reset-link/token idea dropped — the app
has no email, so an admin sets the password and tells the user out of band.

## Non-obvious notes
- **JWTs are not invalidated on password reset or demotion.** There is no
  token-version/blacklist anywhere in the app; the 30-day JWT (makeToken in
  routes/auth.js) stays valid until expiry. `requireAdmin` reads `is_admin`
  LIVE from the DB, so a *demoted* admin loses admin access on the next request
  — but a reset target's old sessions keep working. Same limitation the
  self-service password change already had. Accepted, not a bug.
- **Bootstrap is non-fatal on a missing user** (unlike JWT_SECRET). `ADMIN_USERNAME`
  promotes the named user on every boot if they exist; if absent it logs and
  continues, so it self-heals once that user registers. Runs in index.js after
  migrate(), before routes mount.
- Verified the real boot path on an isolated port (not just the unit tests):
  register-before-boot → restart promotes; reset lets the target log in with the
  new pw; last-admin demote → 409. `PRAGMA integrity_check` = ok after mig 016.
- Admin UI is **search-by-username** (mirrors the Compare page), NOT a user
  list — an instance can have any number of users. Backend is therefore
  GET /admin/users/:username (exact lookup, 404), not a list-all.
- CSS gotcha: `.field input { width: 100% }` (index.css) applies to ANY input
  inside a `.field`, so wrapping a `.search-row` in `.field` blows the inline
  input to full width and breaks the row. Use the bare `.section-label` +
  `.search-row` structure (like Compare) for an inline input+button, never
  `.field` around it.
- To render the real UI in the browser under same-origin/no-CORS: build the
  client, copy client/dist -> server/public, seed a scratch DB_DIR before boot
  (exclusive access, no WAL lock fight), run index.js on a high port. Screenshots
  time out when the pane isn't displayed — verify via read_page + javascript_tool
  geometry/computed-style instead.
