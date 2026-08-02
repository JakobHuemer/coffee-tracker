// 019 — in-app notification system (issue #32, phase 1).
//
// One append-only, immutable event per row. `payload` carries a frozen,
// self-contained copy of everything the frontend needs to render the row: the
// renderer never reads back into live tables, so a fact that later changes is a
// NEW notification, never an edit to an old one. See docs/notifications.md.
//
// `type` is a plain TEXT tag and `payload` is opaque JSON, so adding a new
// notification type needs no migration — only a server-side allowlist entry
// (server/src/notifications.js) and a frontend catalog entry.
//
// Additive + idempotent, modelled on the earlier migrations: every DDL step is
// guarded (IF NOT EXISTS) so a re-run or a crash-then-retry is a no-op.

exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,          -- allowlisted server-side
      payload     TEXT NOT NULL,          -- JSON string, self-contained + immutable
      read_at     INTEGER,                -- epoch ms; NULL = unread
      created_at  INTEGER NOT NULL,       -- epoch ms
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
  `);
};
