// Bookmarks (saved posts) — a separate concern from likes. A like is a public
// signal on someone else's post; a bookmark is a private "save for later" the
// user makes for their own reference. Same shape as post_likes but semantically
// distinct, so it gets its own table rather than a flag on the like row.
exports.up = function (db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS post_bookmarks (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES coffee_entries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      UNIQUE(entry_id, user_id)
    )
  `).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_post_bookmarks_user ON post_bookmarks(user_id)'
  ).run();
};
