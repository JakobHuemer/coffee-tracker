const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Shape a raw joined row into the API post object. bookmarked_by_me is derived
// from a correlated EXISTS (not a join) so it can't inflate the likes COUNT.
function mapPost(p) {
  return {
    ...p,
    photo_url: p.photo_path ? `/uploads/${p.photo_path}` : null,
    profile_photo_url: p.profile_photo ? `/uploads/${p.profile_photo}` : null,
    liked_by_me: p.liked_by_me === 1,
    bookmarked_by_me: p.bookmarked_by_me === 1,
  };
}

const POST_COLUMNS = `
  e.id, e.user_id, e.coffee_id, e.caffeine_mg, e.logged_at,
  e.photo_path, e.description, e.is_public,
  u.username, u.avatar, u.profile_photo,
  COUNT(pl.id) AS likes_count,
  MAX(CASE WHEN pl.user_id = ? THEN 1 ELSE 0 END) AS liked_by_me,
  EXISTS(SELECT 1 FROM post_bookmarks pb WHERE pb.entry_id = e.id AND pb.user_id = ?) AS bookmarked_by_me
`;

router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const posts = db.prepare(`
    SELECT ${POST_COLUMNS}
    FROM coffee_entries e
    JOIN users u ON e.user_id = u.id
    LEFT JOIN post_likes pl ON pl.entry_id = e.id
    WHERE e.is_public = 1
    GROUP BY e.id
    ORDER BY e.logged_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, req.user.id, limit, offset);

  res.json(posts.map(mapPost));
});

// The current user's saved posts, newest-saved first. Still-public only — a post
// that has since gone private drops out, matching the main feed's privacy rule.
router.get('/saved', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const posts = db.prepare(`
    SELECT ${POST_COLUMNS}, mine.created_at AS saved_at
    FROM post_bookmarks mine
    JOIN coffee_entries e ON e.id = mine.entry_id
    JOIN users u ON e.user_id = u.id
    LEFT JOIN post_likes pl ON pl.entry_id = e.id
    WHERE mine.user_id = ? AND e.is_public = 1
    GROUP BY e.id
    ORDER BY mine.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, req.user.id, req.user.id, limit, offset);

  res.json(posts.map(mapPost));
});

router.post('/:entryId/like', requireAuth, (req, res) => {
  const entry = db.prepare(
    'SELECT id, user_id FROM coffee_entries WHERE id = ? AND is_public = 1'
  ).get(req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  if (entry.user_id === req.user.id) {
    return res.status(403).json({ error: "You can't like your own post." });
  }

  try {
    db.prepare(
      'INSERT INTO post_likes (id, entry_id, user_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), req.params.entryId, req.user.id, Date.now());
  } catch (err) {
    // Only a duplicate like (UNIQUE(entry_id, user_id)) is expected here — treat
    // it as idempotent and return the current count. Any other DB error (FK,
    // I/O) is real and must not be silently reported as success.
    if (!String(err.code).startsWith('SQLITE_CONSTRAINT')) throw err;
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

// Bookmarks are private — unlike likes, you may bookmark your own post.
router.post('/:entryId/bookmark', requireAuth, (req, res) => {
  const entry = db.prepare(
    'SELECT id FROM coffee_entries WHERE id = ? AND is_public = 1'
  ).get(req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Post not found' });

  try {
    db.prepare(
      'INSERT INTO post_bookmarks (id, entry_id, user_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), req.params.entryId, req.user.id, Date.now());
  } catch (err) {
    // Duplicate bookmark is idempotent; any other DB error is real.
    if (!String(err.code).startsWith('SQLITE_CONSTRAINT')) throw err;
  }

  res.json({ bookmarked_by_me: true });
});

router.delete('/:entryId/bookmark', requireAuth, (req, res) => {
  db.prepare(
    'DELETE FROM post_bookmarks WHERE entry_id = ? AND user_id = ?'
  ).run(req.params.entryId, req.user.id);

  res.json({ bookmarked_by_me: false });
});

module.exports = router;
