// @-mention marks (post marking). When a post's description mentions a real
// user with @username, that user is recorded here as "marked" on the post, so
// the feed can highlight the post to them and link the mention to a comparison.
//
// Same shape as post_likes / post_bookmarks. Both foreign keys cascade: deleting
// the coffee entry drops its marks (the app relies on the cascade rather than an
// explicit delete), and deleting a user drops the marks pointing at them. The
// UNIQUE(entry_id, user_id) index (created implicitly by the constraint) also
// serves every read — the marked_me EXISTS check and the per-entry batch lookup
// both filter on entry_id first — so no extra index is needed.
exports.up = function (db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS post_marks (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES coffee_entries(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      UNIQUE(entry_id, user_id)
    )
  `).run();
};
