// Startup admin bootstrap.
//
// If ADMIN_USERNAME names an existing user, make them the protected "primary"
// admin (is_admin + is_super_admin), and ensure they are the ONLY super admin —
// any previously-protected user is dropped back to a regular admin, so the
// super admin always tracks the current ADMIN_USERNAME. See migration 017 and
// routes/admin.js for what the super flag grants.
//
// This runs on every boot (after migrations, before routes mount) so it is
// self-healing: a fresh deployment can set ADMIN_USERNAME before the account
// exists, and the promotion lands on the first boot after that user registers.
//
// Deliberately NON-fatal, unlike the JWT_SECRET check: a missing user or an
// unset var is a normal state, not bad config, so it must never stop the
// process. When ADMIN_USERNAME is unset we touch nothing — an existing super
// admin keeps their protection rather than being silently stripped.
function promoteBootstrapAdmin(db) {
  const username = process.env.ADMIN_USERNAME;
  if (!username) return;

  const user = db.prepare('SELECT id, is_admin, is_super_admin FROM users WHERE username = ?').get(username);
  if (!user) {
    console.log(`ADMIN_USERNAME="${username}" set but no such user yet — will promote once they register.`);
    return;
  }

  const alreadyPrimary = user.is_admin === 1 && user.is_super_admin === 1;
  db.transaction(() => {
    // Exactly one super admin: strip it from anyone who isn't this user.
    db.prepare('UPDATE users SET is_super_admin = 0 WHERE is_super_admin = 1 AND id != ?').run(user.id);
    db.prepare('UPDATE users SET is_admin = 1, is_super_admin = 1 WHERE id = ?').run(user.id);
  })();

  console.log(alreadyPrimary
    ? `ADMIN_USERNAME="${username}" is already the protected admin.`
    : `Promoted "${username}" to protected admin (ADMIN_USERNAME bootstrap).`);
}

module.exports = { promoteBootstrapAdmin };
