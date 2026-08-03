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
const { isValidPassword } = require('../password');
const { ID_RE, listCoffeesAdmin } = require('../coffees');

const router = express.Router();

// The columns the admin UI needs. Never exposes password_hash.
const ADMIN_USER_COLS = 'id, username, avatar, is_admin, is_super_admin, created_at';

router.use(requireAdmin);

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
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be 1–72 characters' });
  }
  const target = db.prepare('SELECT id, is_admin, is_super_admin FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const block = manageBlock(req.actor, target);
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

  // Same gate as reset-password: the protected admin is untouchable, and only the
  // super admin may manage another admin. Which flag we're setting doesn't relax
  // that — promoting a non-admin is the one admin-status change open to a regular
  // admin, and manageBlock already permits it (the target isn't an admin yet).
  const block = manageBlock(req.actor, target);
  if (block) return res.status(403).json({ error: block });

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, target.id);
  const user = db.prepare(`SELECT ${ADMIN_USER_COLS} FROM users WHERE id = ?`).get(target.id);
  res.json(user);
});

// ── Coffee catalog (issue #77) ──────────────────────────────────────────────
//
// The menu lives in the `coffees` table (seeded by migration 020) and is edited
// here, so adding/retiring a drink or changing its caffeine no longer needs a
// redeploy. Any admin may edit the catalog — these are not user-management
// routes, so the super-admin manageBlock rules above don't apply.
//
// Note on history: coffee_entries copy `caffeine` at log time and store the
// coffee_id as a bare string (no FK), so editing or deleting a coffee never
// rewrites or breaks past entries — it only changes what future logs get and
// what the picker/labels show. This mirrors the long-standing catalog contract.

// Validate a coffee body. `partial` skips required-field checks for PATCH,
// where an absent field means "leave unchanged". Returns { error } or { values }
// holding only the fields present (so PATCH can build a targeted UPDATE).
function validateCoffee(body, { partial } = {}) {
  const values = {};

  if (body.name !== undefined || !partial) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' };
    values.name = body.name.trim();
  }
  if (body.caffeine !== undefined || !partial) {
    const n = Number(body.caffeine);
    if (!Number.isInteger(n) || n < 0) return { error: 'caffeine must be a non-negative integer' };
    values.caffeine = n;
  }
  if (body.icon !== undefined || !partial) {
    if (typeof body.icon !== 'string' || !body.icon.trim()) return { error: 'icon is required' };
    values.icon = body.icon.trim();
  }
  if (body.class !== undefined || !partial) {
    if (typeof body.class !== 'string' || !body.class.trim()) return { error: 'class is required' };
    values.class = body.class.trim();
  }
  // score_caffeine is the competition-only override. Explicit null (or empty
  // string from a form) clears it → "score what you show".
  if (body.score_caffeine !== undefined) {
    if (body.score_caffeine === null || body.score_caffeine === '') {
      values.score_caffeine = null;
    } else {
      const s = Number(body.score_caffeine);
      if (!Number.isInteger(s) || s < 0) return { error: 'score_caffeine must be a non-negative integer or null' };
      values.score_caffeine = s;
    }
  } else if (!partial) {
    values.score_caffeine = null;
  }

  return { values };
}

// Full catalog incl. the score override and order — the admin view needs every
// column, unlike the public GET /api/coffees which hides score_caffeine.
router.get('/coffees', (req, res) => {
  res.json(listCoffeesAdmin());
});

router.post('/coffees', (req, res) => {
  const id = typeof req.body.id === 'string' ? req.body.id.trim() : '';
  // The id is interpolated into a SQL CASE by scoreMgSql() and stored on every
  // entry, so it must be a strict slug — see coffees.js ID_RE.
  if (!ID_RE.test(id)) {
    return res.status(400).json({ error: 'id must be lowercase letters, numbers and underscores' });
  }
  if (db.prepare('SELECT id FROM coffees WHERE id = ?').get(id)) {
    return res.status(409).json({ error: 'A coffee with that id already exists' });
  }

  const { error, values } = validateCoffee(req.body, { partial: false });
  if (error) return res.status(400).json({ error });

  // New drinks go to the end of the menu; sort_order is otherwise not editable.
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM coffees').get().m;
  db.prepare(
    'INSERT INTO coffees (id, name, caffeine, icon, class, score_caffeine, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, values.name, values.caffeine, values.icon, values.class, values.score_caffeine, max + 1);

  res.status(201).json(db.prepare('SELECT id, name, caffeine, icon, class, score_caffeine, sort_order FROM coffees WHERE id = ?').get(id));
});

router.patch('/coffees/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM coffees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Coffee not found' });

  const { error, values } = validateCoffee(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  if (keys.length === 0) return res.status(400).json({ error: 'No fields to update' });

  // The id is the primary key and is embedded in existing entries, so it is not
  // rewritable here — a rename is a delete + re-create decision, not an edit.
  const setSql = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE coffees SET ${setSql} WHERE id = ?`).run(...keys.map((k) => values[k]), req.params.id);

  res.json(db.prepare('SELECT id, name, caffeine, icon, class, score_caffeine, sort_order FROM coffees WHERE id = ?').get(req.params.id));
});

router.delete('/coffees/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM coffees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Coffee not found' });
  // Past entries keep their copied caffeine_mg and coffee_id string; only the
  // picker loses the option (see the history note above).
  db.prepare('DELETE FROM coffees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
