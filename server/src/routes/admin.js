// Admin routes. Every endpoint is behind requireAdmin (see middleware/auth.js),
// so admin status is checked live on each request.
//
// Two tiers of admin (see migration 017 / admin-bootstrap.js):
//   - super admin (is_super_admin): the protected primary admin from
//     ADMIN_USERNAME. Can manage EVERY user, and is the ONLY one allowed to
//     manage other admins. Cannot be demoted or reset through these routes by
//     anyone — the protection is enforced here, server-side, not just hidden in
//     the UI.
//   - regular admin (is_admin only): may manage non-admins (reset their
//     password) and promote non-admins to admin, but may not touch any admin.
//
// "Manage" = change a user's admin status or reset their password.
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// The columns the admin UI needs. Never exposes password_hash.
const ADMIN_USER_COLS = 'id, username, avatar, is_admin, is_super_admin, created_at';

router.use(requireAdmin);

function actorRow(req) {
  return db.prepare('SELECT id, is_admin, is_super_admin FROM users WHERE id = ?').get(req.user.id);
}

// Whether `actor` may manage `target` (reset password / change admin status).
// Returns an error string to reject with, or null when allowed. The rules:
//   - the protected super admin is untouchable by anyone (including themselves
//     via these routes — they use the self-service flow instead);
//   - managing any other admin requires the actor to be the super admin;
//   - managing a non-admin is open to any admin.
function manageBlock(actor, target) {
  if (target.is_super_admin === 1) return 'The protected admin cannot be modified';
  if (target.is_admin === 1 && actor.is_super_admin !== 1) {
    return 'Only the primary admin can manage other admins';
  }
  return null;
}

// Look up a single user by exact username. The admin UI is search-based (like
// the Compare page), not a full user list. Exact match; 404 when absent.
router.get('/users/:username', (req, res) => {
  const user = db.prepare(`SELECT ${ADMIN_USER_COLS} FROM users WHERE username = ?`).get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Reset a user's password to a new value. Deliberately does NOT require the
// target's current password — that is the whole point of an admin reset. Bounds
// mirror the self-service rule in routes/auth.js (1..72 chars).
router.post('/users/:id/reset-password', (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || password.length === 0 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 1–72 characters' });
  }
  const target = db.prepare('SELECT id, is_admin, is_super_admin FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const block = manageBlock(actorRow(req), target);
  if (block) return res.status(403).json({ error: block });

  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, target.id);
  res.json({ ok: true });
});

// Promote or demote a user. Promoting a non-admin is open to any admin;
// demoting an admin is "managing an admin" and so restricted to the super
// admin. The protected super admin can never be changed.
router.post('/users/:id/admin', (req, res) => {
  const { is_admin } = req.body;
  if (typeof is_admin !== 'boolean') {
    return res.status(400).json({ error: 'is_admin must be true or false' });
  }
  const target = db.prepare('SELECT id, is_admin, is_super_admin FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.is_super_admin === 1) {
    return res.status(403).json({ error: 'The protected admin cannot be modified' });
  }
  // Demoting an existing admin is an admin-management action → super only.
  // Promoting a non-admin (or a no-op promote of an admin) is open to any admin.
  if (!is_admin && target.is_admin === 1 && actorRow(req).is_super_admin !== 1) {
    return res.status(403).json({ error: 'Only the primary admin can manage other admins' });
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, target.id);
  const user = db.prepare(`SELECT ${ADMIN_USER_COLS} FROM users WHERE id = ?`).get(target.id);
  res.json(user);
});

module.exports = router;
