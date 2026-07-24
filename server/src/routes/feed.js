const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const posts = db.prepare(`
    SELECT
      e.id, e.user_id, e.coffee_id, e.caffeine_mg, e.logged_at,
      e.photo_path, e.description, e.is_public,
      u.username, u.avatar, u.profile_photo,
      COUNT(pl.id) AS likes_count,
      MAX(CASE WHEN pl.user_id = ? THEN 1 ELSE 0 END) AS liked_by_me
    FROM coffee_entries e
    JOIN users u ON e.user_id = u.id
    LEFT JOIN post_likes pl ON pl.entry_id = e.id
    WHERE e.is_public = 1
    GROUP BY e.id
    ORDER BY e.logged_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  res.json(posts.map(p => ({
    ...p,
    photo_url: p.photo_path ? `/uploads/${p.photo_path}` : null,
    profile_photo_url: p.profile_photo ? `/uploads/${p.profile_photo}` : null,
    liked_by_me: p.liked_by_me === 1,
  })));
});

router.post('/:entryId/like', requireAuth, (req, res) => {
  const entry = db.prepare(
    'SELECT id FROM coffee_entries WHERE id = ? AND is_public = 1'
  ).get(req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Post not found' });

  try {
    db.prepare(
      'INSERT INTO post_likes (id, entry_id, user_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), req.params.entryId, req.user.id, Date.now());
  } catch (_) {
    // Already liked — UNIQUE constraint; just return current count.
  }

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM post_likes WHERE entry_id = ?'
  ).get(req.params.entryId);
  res.json({ likes_count: count, liked_by_me: true });
});

router.delete('/:entryId/like', requireAuth, (req, res) => {
  db.prepare(
    'DELETE FROM post_likes WHERE entry_id = ? AND user_id = ?'
  ).run(req.params.entryId, req.user.id);

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM post_likes WHERE entry_id = ?'
  ).get(req.params.entryId);
  res.json({ likes_count: count, liked_by_me: false });
});

module.exports = router;
