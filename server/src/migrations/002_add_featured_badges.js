// 002 — add users.featured_badges. Guarded so it is idempotent even if a
// pre-existing DB already has the column (the runner's bootstrap normally
// prevents re-running this on such DBs, but the guard is cheap insurance).
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some(c => c.name === 'featured_badges')) {
    db.exec("ALTER TABLE users ADD COLUMN featured_badges TEXT NOT NULL DEFAULT ''");
  }
};
