const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { publicProfileFor } = require('../profile');

const router = express.Router();

// GET /api/users/:username — a user's public profile (issue #73): identity,
// featured badges and headline stats, viewable without the Compare flow. Any
// authenticated user may view any profile; the payload is public info only
// (no email, no private posts). `self` is true when it is the caller's own.
router.get('/:username', requireAuth, (req, res) => {
  const target = db.prepare(
    'SELECT id, username, avatar, profile_photo, image_id, created_at FROM users WHERE username = ?'
  ).get(req.params.username);

  if (!target) return res.status(404).json({ error: 'User not found' });

  res.json(publicProfileFor(target, { self: target.id === req.user.id, viewerId: req.user.id }));
});

module.exports = router;
