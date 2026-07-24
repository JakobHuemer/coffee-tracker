exports.up = function (db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS post_likes (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES coffee_entries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      UNIQUE(entry_id, user_id)
    )
  `).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_post_likes_entry ON post_likes(entry_id)'
  ).run();
};
