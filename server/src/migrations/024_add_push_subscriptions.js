// 024 — Web Push subscriptions (issue #87, Android web push).
//
// One row per (browser endpoint) a user has granted notification permission on.
// A single user can have several (phone, laptop, …); a single physical device
// yields a fresh endpoint per browser profile. The push send path (server/src/
// push.js) reads these to deliver a notification even when the app is closed.
//
// `endpoint` is UNIQUE: the browser mints a stable URL per subscription, so a
// re-subscribe (or the same device switching accounts) UPSERTs onto the same
// row rather than accumulating duplicates. Keys `p256dh`/`auth` are the client's
// ECDH public key + auth secret, required by the Web Push encryption scheme.
//
// Additive + idempotent (IF NOT EXISTS), matching the surrounding migrations —
// a re-run or crash-then-retry is a no-op. `type`/`payload` of a notification
// still need no migration; this table is only the delivery address book.

exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      created_at  INTEGER NOT NULL,       -- epoch ms
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
  `);
};
