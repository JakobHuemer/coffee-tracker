const { randomUUID } = require('crypto');
const db = require('./db');

// The one writer for the notifications table (issue #32). A notification is an
// immutable event: this module only ever INSERTs. Nothing here (or anywhere)
// UPDATEs a payload — if a described fact later changes, that is a new row.
//
// Requires only ./db so it can be pulled into achievements.js and
// competitions.js without a dependency cycle.

// Server-side allowlist of known type strings. A typo cannot write an
// unrenderable row. Adding a type is one entry here plus a frontend catalog
// entry — never a migration (`type`/`payload` are opaque columns).
const TYPES = {
  ACHIEVEMENT: 'achievement',
  BADGE: 'badge',
  MATCH_END: 'match_end',
};
const KNOWN = new Set(Object.values(TYPES));

// createNotification(userId, type, payload) → the row's id.
//
// `payload` must already carry every display-relevant field (ids AND names);
// it is stringified on write and parsed on read, and nothing recomputes on
// read. An unknown `type` is a programming error and throws, so a bad tag
// fails loud at the write site instead of silently persisting.
function createNotification(userId, type, payload) {
  if (!KNOWN.has(type)) throw new Error(`unknown notification type: ${type}`);
  const id = randomUUID();
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, payload, read_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
  ).run(id, userId, type, JSON.stringify(payload), Date.now());

  // Deliver the same event as a Web Push (issue #87) so it reaches the user's
  // phone even with the app closed. Deferred to setImmediate on purpose:
  // createNotification runs inside settlement transactions (competitions.js), and
  // deferring guarantees the push reflects a COMMITTED row and can never run
  // inside — or roll back — that transaction. Fire-and-forget: push is a no-op
  // when VAPID is unconfigured, and any send failure is swallowed downstream, so
  // this can never disturb the write path. Lazy require keeps the web-push
  // dependency off notifications.js's own load path.
  setImmediate(() => {
    try { require('./push').sendToUser(userId, { id, type, payload }); }
    catch (err) { console.error('push dispatch failed:', err && err.message); }
  });

  return id;
}

module.exports = { createNotification, TYPES };
