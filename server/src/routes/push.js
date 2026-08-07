const express = require('express');
const { requireAuth } = require('../middleware/auth');
const push = require('../push');

const router = express.Router();

// Web Push subscription management (issue #87). Every route is scoped to
// req.user.id — a caller only ever reads or mutates their own device
// subscriptions. The actual delivery lives in ../push.js; this router is just
// the address-book API the client uses to register and drop a device.

// GET /api/push/vapid-public-key
//   Bootstraps the client subscription. `enabled` tells the UI whether push is
//   configured on this deployment at all (so it can hide the toggle rather than
//   offer a button that can only 503).
router.get('/vapid-public-key', requireAuth, (req, res) => {
  res.json({ enabled: push.isEnabled(), key: push.getPublicKey() });
});

// POST /api/push/subscribe  body: { endpoint, keys: { p256dh, auth } }
//   Stores (or refreshes) this browser's PushSubscription for the caller.
router.post('/subscribe', requireAuth, (req, res) => {
  if (!push.isEnabled()) return res.status(503).json({ error: 'Push is not configured' });

  const sub = req.body || {};
  const keys = sub.keys || {};
  if (typeof sub.endpoint !== 'string' ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string') {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  push.saveSubscription(req.user.id, { endpoint: sub.endpoint, keys });
  res.json({ ok: true });
});

// POST /api/push/unsubscribe  body: { endpoint }
//   Removes this browser's subscription (user turned push off on the device).
router.post('/unsubscribe', requireAuth, (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint required' });

  push.removeSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

module.exports = router;
