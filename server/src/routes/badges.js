const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { BADGES } = require('../data/badges');

const router = express.Router();

// Same dev gate as the coffee spacing override — testing only, never production.
const DEV_OVERRIDES = process.env.DEV_OVERRIDES === '1';

// GET /api/badges — all badges with unlock status
router.get('/', requireAuth, (req, res) => {
  const unlocked = db.prepare(
    'SELECT badge_id, unlocked_at FROM user_badges WHERE user_id = ?'
  ).all(req.user.id);
  const unlockedMap = Object.fromEntries(unlocked.map(u => [u.badge_id, u.unlocked_at]));

  const result = BADGES.map(b => {
    const isUnlocked = !!unlockedMap[b.id];
    if (b.secret && !isUnlocked) {
      return {
        id: b.id,
        name: '???',
        // No explanation for a hidden badge — a locked ??? gives nothing away.
        // Only real (unlocked) badges carry a description.
        description: '',
        icon: 'lock',
        rarity: 'secret',
        secret: true,
        unlocked: false,
        unlocked_at: null,
      };
    }
    return { ...b, unlocked: isUnlocked, unlocked_at: unlockedMap[b.id] || null };
  });

  res.json(result);
});

// POST /api/badges/dev-toggle — quick-and-dirty: unlock or lock a badge for the
// current user, for testing how profiles look with different badge sets. Gated
// behind DEV_OVERRIDES so it is a no-op (403) on any real server. Delete-then-
// insert so it works regardless of a unique constraint on user_badges.
router.post('/dev-toggle', requireAuth, (req, res) => {
  if (!DEV_OVERRIDES) return res.status(403).json({ error: 'Debug toggles are disabled' });
  const { badge_id, unlocked } = req.body;
  if (!BADGES.some(b => b.id === badge_id)) return res.status(400).json({ error: 'Unknown badge' });

  db.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?').run(req.user.id, badge_id);
  if (unlocked) {
    db.prepare('INSERT INTO user_badges (id, user_id, badge_id, unlocked_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), req.user.id, badge_id, Date.now());
  }
  res.json({ ok: true, badge_id, unlocked: !!unlocked });
});

module.exports = router;
