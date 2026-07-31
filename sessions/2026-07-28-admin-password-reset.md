---
topics: [admin, password-reset, is-admin, is-super-admin, super-admin, migration-016, migration-017, admin-bootstrap, requireAdmin, ADMIN_USERNAME]
---

# Admin password reset (feat/admin-password-reset)

Added an admin capability: admins reset a user's password (direct set, no
current-password needed) and promote users to admin. Reset-link/token idea
dropped — the app has no email, so an admin sets the password and tells the user
out of band.

**Two tiers** (no general role system): `is_super_admin` = the protected primary
admin from ADMIN_USERNAME; `is_admin` = a regular admin. Rules (enforced in
routes/admin.js AND mirrored in the Profile UI):
- super admin: manages everyone; is the ONLY one who can manage other admins
  (reset their password / demote them); is itself untouchable via the admin
  routes (can't be demoted or reset, not even by itself — uses self-service).
- regular admin: manages non-admins (reset pw) and can promote non-admins to
  admin, but cannot touch any admin.

## Non-obvious notes
- **JWTs are not invalidated on password reset or demotion.** There is no
  token-version/blacklist anywhere in the app; the 30-day JWT (makeToken in
  routes/auth.js) stays valid until expiry. `requireAdmin` reads `is_admin`
  LIVE from the DB, so a *demoted* admin loses admin access on the next request
  — but a reset target's old sessions keep working. Same limitation the
  self-service password change already had. Accepted, not a bug.
- **Bootstrap is non-fatal on a missing user** (unlike JWT_SECRET). `ADMIN_USERNAME`
  makes the named user the super admin on every boot if they exist, and strips
  is_super_admin from anyone else (single super admin, tracks the env value). If
  the user is absent, or the var is unset, it touches nothing and self-heals.
  Runs in index.js after migrate(), before routes mount.
- **No last-admin count guard needed.** The super admin can't be demoted and is
  always an admin, and only the super admin can demote admins, so zero-admins is
  unreachable — the protected-admin rule subsumes the old count guard, which was
  removed.
- Verified the real boot path on an isolated port (not just the unit tests):
  register-before-boot → restart promotes to super; reset lets the target log in
  with the new pw. `PRAGMA integrity_check` = ok after the migrations.
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
