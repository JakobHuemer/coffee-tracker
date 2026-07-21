// 001 — initial schema. Historically faithful: the `users` table is created
// WITHOUT `featured_badges` (added in 002) and without `email` (the app has
// always been username-only in this migration line; 003 handles legacy DBs
// that still carry an email column). On a fresh database, 001→002→003 produce
// the exact same schema the old inline blocks in db.js produced.
exports.up = (db) => {
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
};
