// Admin routes. Every endpoint is behind requireAdmin (see middleware/auth.js),
// so admin status is checked live on each request.
//
// Scope: reset any user's password, and promote/demote admins. No role system —
// a single is_admin flag (migration 016). The first admin is bootstrapped from
// ADMIN_USERNAME at startup (admin-bootstrap.js); everyone else is made admin
// here by an existing admin.
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// The columns the admin UI needs. Never exposes password_hash.
const ADMIN_USER_COLS = 'id, username, avatar, is_admin, created_at';

router.use(requireAdmin);

// Look up a single user by exact username. The admin UI is search-based (like
// the Compare page), not a full user list — an instance can have any number of
// users, so dumping them all is neither useful nor scalable. Exact match,
// mirroring login/compare. 404 when there is no such user.
router.get('/users/:username', (req, res) => {
  const user = db.prepare(`SELECT ${ADMIN_USER_COLS} FROM users WHERE username = ?`).get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Reset a user's password to a new value. Deliberately does NOT require the
// target's current password — that is the whole point of an admin reset, since
// the user has forgotten it. Bounds mirror the self-service rule in
// routes/auth.js (1..72 chars; bcrypt ignores bytes past 72 anyway).
router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || password.length === 0 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 1–72 characters' });
  }
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, target.id);
  res.json({ ok: true });
});

// Promote or demote a user. `is_admin` is a boolean in the request; stored as
// 0/1. The last-admin guard refuses to remove the final admin so the instance
// can never be left with nobody able to administer it.
router.post('/users/:id/admin', (req, res) => {
  const { is_admin } = req.body;
  if (typeof is_admin !== 'boolean') {
    return res.status(400).json({ error: 'is_admin must be true or false' });
  }
  const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (!is_admin) {
    const adminCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
    if (target.is_admin === 1 && adminCount <= 1) {
      return res.status(409).json({ error: 'Cannot remove the last admin' });
    }
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, target.id);
  const user = db.prepare(`SELECT ${ADMIN_USER_COLS} FROM users WHERE id = ?`).get(target.id);
  res.json(user);
});

module.exports = router;
