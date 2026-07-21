const { Database } = require('bun:sqlite');
const path = require('path');
const fs = require('fs');

// DB_DIR lets the host point the SQLite file at a persistent volume
// (e.g. a Railway volume mounted at /app/data). Defaults to ../data locally.
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'coffee.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar      TEXT DEFAULT '☕',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coffee_entries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    coffee_id   TEXT NOT NULL,
    caffeine_mg INTEGER NOT NULL,
    logged_at   INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_entries_user_logged ON coffee_entries(user_id, logged_at);

  CREATE TABLE IF NOT EXISTS user_achievements (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    achievement_id  TEXT NOT NULL,
    unlocked_at     INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS user_badges (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    badge_id    TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, badge_id)
  );

  CREATE TABLE IF NOT EXISTS user_streaks (
    user_id        TEXT PRIMARY KEY,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_goal_date TEXT,
    goals_completed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_combos (
    user_id        TEXT PRIMARY KEY,
    current_combo  INTEGER NOT NULL DEFAULT 0,
    highest_combo  INTEGER NOT NULL DEFAULT 0,
    last_coffee_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    creator_id  TEXT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    metric      TEXT NOT NULL,
    target      INTEGER NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS challenge_participants (
    id           TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    progress     INTEGER NOT NULL DEFAULT 0,
    completed    INTEGER NOT NULL DEFAULT 0,
    joined_at    INTEGER NOT NULL,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(challenge_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS coffee_casualties (
    id    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    count INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO coffee_casualties (id, count) VALUES (1, 0);

  CREATE TABLE IF NOT EXISTS compare_history (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    compared_with TEXT NOT NULL,
    compared_at  INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Idempotent migration: add featured_badges only if it's missing, so we don't
// swallow (and hide) unexpected ALTER TABLE errors with a blanket catch.
const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some(c => c.name === 'featured_badges')) {
  db.exec("ALTER TABLE users ADD COLUMN featured_badges TEXT NOT NULL DEFAULT ''");
}

// Idempotent migration: login switched from email to username, so drop the
// email column from existing databases. SQLite can't DROP a UNIQUE column
// directly, so we rebuild the table without it (the documented safe procedure)
// and carry every remaining row across. New databases never have the column
// because the CREATE TABLE above already omits it.
if (userColumns.some(c => c.name === 'email')) {
  // Foreign keys must be toggled outside the transaction (the PRAGMA is a
  // no-op inside one). OFF prevents the child ON DELETE CASCADEs from firing
  // when we drop the old users table.
  db.exec('PRAGMA foreign_keys = OFF');
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
  db.exec('PRAGMA foreign_keys = ON');
}

module.exports = db;
