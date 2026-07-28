// Startup admin bootstrap.
//
// If ADMIN_USERNAME names an existing user, ensure that user is an admin. This
// runs on every boot (after migrations, before routes mount) so it is
// self-healing: a fresh deployment can set ADMIN_USERNAME before the account
// exists, and the promotion lands on the first boot after that user registers.
//
// Deliberately NON-fatal, unlike the JWT_SECRET check: a missing user or an
// unset var is a normal state, not bad config, so it must never stop the
// process (VALUES.md #7 is about refusing to run *degraded/insecure* — an
// un-bootstrapped admin is neither).
function promoteBootstrapAdmin(db) {
  const username = process.env.ADMIN_USERNAME;
  if (!username) return;

  const user = db.prepare('SELECT id, is_admin FROM users WHERE username = ?').get(username);
  if (!user) {
    console.log(`ADMIN_USERNAME="${username}" set but no such user yet — will promote once they register.`);
    return;
  }
  if (user.is_admin === 1) {
    console.log(`ADMIN_USERNAME="${username}" is already an admin.`);
    return;
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  console.log(`Promoted "${username}" to admin (ADMIN_USERNAME bootstrap).`);
}

module.exports = { promoteBootstrapAdmin };
