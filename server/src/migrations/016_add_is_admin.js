// Administrators. A single boolean flag on the user row — no role system by
// design (out of scope). Admins can reset any user's password and promote or
// demote other admins; see server/src/routes/admin.js.
//
// Defaults to 0: existing users are non-admin. The first admin is bootstrapped
// from the ADMIN_USERNAME env var at startup (server/src/admin-bootstrap.js).
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('is_admin')) {
    db.prepare('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0').run();
  }
};
