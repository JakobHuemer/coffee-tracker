const { randomUUID } = require('crypto');
const webpush = require('web-push');
const db = require('./db');

// Web Push delivery (issue #87). This is the one place that talks to the push
// services; everything else just writes notification rows. It is deliberately
// OPTIONAL: with no VAPID keys the whole path is inert (isEnabled() === false)
// so the single container still boots and local dev needs no setup. A PARTIAL
// or invalid key pair is a config mistake and fails fast at boot (init throws →
// index.js exits), consistent with VALUES.md #7.
//
// A notification's human text is NOT built here. The server ships only the
// frozen {id, type, payload}; the service worker renders the sentence from it,
// so wording stays in the frontend exactly like the in-app catalog
// (docs/notifications.md, docs/notifications-push.md).

let enabled = false;
let publicKey = null;

// The actual push call, isolated behind a seam so tests can drive sendToUser's
// fan-out / pruning without hitting the network. __setSender restores or
// replaces it; production always uses web-push directly.
let sender = (subscription, payload) => webpush.sendNotification(subscription, payload);

// Validate VAPID config and arm web-push. Returns true if push is enabled,
// false if it is intentionally off (no keys). Throws on a half/invalid config
// so the caller can fail the boot. Reads from `env` (injectable for tests).
function init(env = process.env) {
  const pub = (env.VAPID_PUBLIC_KEY || '').trim();
  const priv = (env.VAPID_PRIVATE_KEY || '').trim();
  // A subject (mailto: or https URL) is required by the spec so a push service
  // can contact the sender; default keeps single-key-pair setups zero-config.
  const subject = (env.VAPID_SUBJECT || 'mailto:push@coffee-tracker.app').trim();

  if (!pub && !priv) { enabled = false; publicKey = null; return false; }

  if (!pub || !priv) {
    throw new Error('VAPID is half-configured: set BOTH VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither.');
  }

  try {
    webpush.setVapidDetails(subject, pub, priv);
  } catch (err) {
    throw new Error(`Invalid VAPID configuration: ${err.message}.`);
  }

  enabled = true;
  publicKey = pub;
  return true;
}

function isEnabled() { return enabled; }

// The applicationServerKey the client subscribes with. Public by design.
function getPublicKey() { return publicKey; }

// Store (or refresh) one browser's subscription for a user. `endpoint` is
// UNIQUE, so re-subscribing — or the same device switching accounts — UPSERTs
// onto the same row instead of piling up duplicates.
function saveSubscription(userId, sub) {
  db.prepare(`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh  = excluded.p256dh,
      auth    = excluded.auth
  `).run(randomUUID(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

// Drop one of the caller's own subscriptions (they turned push off on a device).
function removeSubscription(userId, endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint);
}

function listSubscriptions(userId) {
  return db.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
  ).all(userId);
}

// Fan a just-written notification out to every device the user subscribed.
//
// Fire-and-forget by contract: the caller (notifications.js) schedules this on
// setImmediate AFTER the row's transaction commits, and every failure is
// swallowed here — a dead endpoint or a network blip must never surface into,
// or roll back, the write path. A push service that reports the subscription as
// permanently GONE (404/410) has it pruned so the table stays bounded and we
// stop retrying a subscription the browser has already discarded.
function sendToUser(userId, notification) {
  if (!enabled) return;
  const subs = listSubscriptions(userId);
  if (subs.length === 0) return;

  const payload = JSON.stringify({
    id: notification.id,
    type: notification.type,
    payload: notification.payload,
  });

  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    Promise.resolve()
      .then(() => sender(subscription, payload))
      .catch((err) => {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          try {
            db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
          } catch (_) { /* row already gone */ }
        } else {
          console.error('web push send failed:', code || (err && err.message) || err);
        }
      });
  }
}

// Test seam. Pass a fn to stub the network send; pass nothing to restore the
// real web-push sender.
function __setSender(fn) {
  sender = fn || ((subscription, payload) => webpush.sendNotification(subscription, payload));
}

module.exports = {
  init, isEnabled, getPublicKey,
  saveSubscription, removeSubscription, listSubscriptions,
  sendToUser, __setSender,
};
