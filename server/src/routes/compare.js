const express = require('express');
const db = require('../db');
const images = require('../images');
const { requireAuth } = require('../middleware/auth');
const { checkAfterCompare } = require('../achievements');
const { buildUserStats, badgesFor } = require('../profile');

const router = express.Router();

router.get('/:username', requireAuth, (req, res) => {
  const target = db.prepare(
    'SELECT id, username, avatar, profile_photo, image_id FROM users WHERE username = ?'
  ).get(req.params.username);

  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot compare with yourself' });

  const myStats = buildUserStats(req.user.id);
  const theirStats = buildUserStats(target.id);
  // Unlock side effect only — persisted as a notification and delivered through
  // the bell, so no `unlocked` array on this response (issue #32).
  checkAfterCompare(req.user.id, target.id);
  const me = db.prepare('SELECT id, username, avatar, profile_photo, image_id FROM users WHERE id = ?').get(req.user.id);

  function withPhotoUrl(u) {
    const { image_id, ...rest } = u;
    return {
      ...rest,
      profile_photo_url: u.profile_photo ? `/uploads/${u.profile_photo}` : null,
      profile_image: images.variantsFor(image_id),
    };
  }

  res.json({
    me: { ...withPhotoUrl(me), badges: badgesFor(req.user.id, req.user.id), stats: myStats },
    them: { ...withPhotoUrl(target), badges: badgesFor(target.id, req.user.id), stats: theirStats },
  });
});

module.exports = router;
