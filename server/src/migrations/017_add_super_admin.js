// The protected "primary" admin — the one bootstrapped from ADMIN_USERNAME.
//
// Two tiers of admin (see server/src/routes/admin.js):
//   - super admin (this flag): can manage EVERY user, and is the only one who
//     can manage other admins (change their admin status or password). Cannot
//     be demoted or have their password reset through the admin routes.
//   - regular admin (is_admin only): can manage non-admins and promote
//     non-admins to admin, but cannot touch any admin.
//
// Set by admin-bootstrap.js on boot, tracking ADMIN_USERNAME. Separate migration
// from 016 because 016 has already been applied on existing databases, so the
// column has to be added by a new numbered step.
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('is_super_admin')) {
    db.prepare('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0').run();
  }
};
