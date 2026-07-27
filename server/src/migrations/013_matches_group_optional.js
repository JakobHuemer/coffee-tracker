// 013 — allow a match with no group (issue #35, "cross-group"/global matches).
//
// 011 created `matches.group_id` as NOT NULL with an FK to competition_groups.
// A global match belongs to no group, so group_id must become nullable. SQLite
// cannot relax a column's NOT NULL in place, so we rebuild the table the
// documented safe way and carry every row across. Nothing else about the table
// changes — same FK (a NULL group_id simply has no parent row), same
// UNIQUE(group_id, mode, period_key) (NULLs are distinct, so any number of
// group-less user-created matches coexist), same indexes.
//
// `manualTransaction` for the same reason as 003: toggling foreign_keys must
// happen OUTSIDE a transaction, and we need FKs OFF so dropping the old table
// does not fire match_participants' ON DELETE CASCADE. Guarded + idempotent: on
// a DB whose group_id is already nullable this is a no-op.
exports.manualTransaction = true;

exports.up = (db) => {
  const col = db.prepare('PRAGMA table_info(matches)').all().find((c) => c.name === 'group_id');
  if (!col || col.notnull === 0) return; // already nullable (or table absent)

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE matches_new (
        id          TEXT PRIMARY KEY,
        group_id    TEXT REFERENCES competition_groups(id) ON DELETE CASCADE,
        mode        TEXT NOT NULL,
        period_key  TEXT,
        title       TEXT,
        creator_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        scope_start INTEGER NOT NULL,
        scope_end   INTEGER NOT NULL,
        state       TEXT NOT NULL DEFAULT 'pending',
        k_factor    REAL NOT NULL,
        team_size   INTEGER,
        created_at  INTEGER NOT NULL,
        settled_at  INTEGER,
        UNIQUE(group_id, mode, period_key)
      );
      INSERT INTO matches_new (id, group_id, mode, period_key, title, creator_id,
                               scope_start, scope_end, state, k_factor, team_size,
                               created_at, settled_at)
        SELECT id, group_id, mode, period_key, title, creator_id,
               scope_start, scope_end, state, k_factor, team_size,
               created_at, settled_at FROM matches;
      DROP TABLE matches;
      ALTER TABLE matches_new RENAME TO matches;
      CREATE INDEX IF NOT EXISTS idx_matches_group_state ON matches(group_id, state);
      CREATE INDEX IF NOT EXISTS idx_matches_state_end ON matches(state, scope_end);
      COMMIT;
    `);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};
