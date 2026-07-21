// 003 — drop the legacy users.email column (login switched email→username).
// SQLite can't DROP a UNIQUE column directly, so we rebuild the table without
// it and carry every remaining row across (the documented safe procedure).
//
// This migration is `manualTransaction` because toggling foreign_keys must
// happen OUTSIDE a transaction — the PRAGMA is a no-op inside one, and we need
// FKs OFF so dropping the old users table doesn't fire child ON DELETE
// CASCADEs. The runner therefore does NOT wrap this in its own BEGIN/COMMIT;
// this file owns its transaction. Guarded + idempotent: on any DB without an
// email column (every fresh DB, and every DB the old inline block already
// migrated) this is a no-op.
exports.manualTransaction = true;

exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some(c => c.name === 'email')) return; // nothing to drop

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE users_new (
        id          TEXT PRIMARY KEY,
        username    TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar      TEXT DEFAULT '☕',
        created_at  INTEGER NOT NULL,
        featured_badges TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO users_new (id, username, password_hash, avatar, created_at, featured_badges)
        SELECT id, username, password_hash, avatar, created_at, featured_badges FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};
