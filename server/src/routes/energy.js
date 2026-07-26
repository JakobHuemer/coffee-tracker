const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildEnergy, DOSE_LIFETIME_H } = require('../energy');

const router = express.Router();

const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;

// GET /api/energy?hours=24 — the Buzz battery: current level plus the curve
// over the requested window. Read-only and fully derived from coffee_entries
// (see server/src/energy.js); nothing is written or cached.
router.get('/', requireAuth, (req, res) => {
  let hours = DEFAULT_HOURS;
  if (req.query.hours !== undefined) {
    hours = Number(req.query.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
      return res.status(400).json({ error: `Invalid hours (expected 1-${MAX_HOURS})` });
    }
  }

  const now = Date.now();
  // Reach back past the window by a dose's useful lifetime so coffee drunk
  // before the window still shows as residual level at the left edge.
  const since = now - (hours + DOSE_LIFETIME_H) * 3600000;
  const doses = db.prepare(
    'SELECT id, coffee_id, caffeine_mg, logged_at FROM coffee_entries WHERE user_id = ? AND logged_at >= ? ORDER BY logged_at'
  ).all(req.user.id, since);

  // NULL here means the user never set one; buildEnergy resolves it to the
  // population default and returns whatever it actually used as `half_life_h`.
  const { caffeine_half_life_h } = db.prepare(
    'SELECT caffeine_half_life_h FROM users WHERE id = ?'
  ).get(req.user.id) ?? {};

  res.json(buildEnergy(doses, now, hours, caffeine_half_life_h));
});

module.exports = router;
