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
- Manual React-UI-in-browser check was skipped on purpose: same-origin/no-CORS
  means the Vite dev server must proxy to the API's fixed port, and AGENTS.md
  forbids risking the developer's own dev server there. UI compiles (build+lint
  clean); the AdminCard in Profile.tsx has a trivial data flow.
