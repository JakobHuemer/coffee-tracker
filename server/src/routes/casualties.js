const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getUserTz, localTodayStr, localDayBounds } = require('../time');

const router = express.Router();

// GET /api/casualties — global casualty count + user's heart attack risk
router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT count FROM coffee_casualties WHERE id = 1').get();
  const globalCount = row?.count || 0;

  // Calculate today's caffeine for the requesting user, in their local day.
  const tz = getUserTz(db, req.user.id);
  const { start: dayStart, end: dayEnd } = localDayBounds(localTodayStr(tz), tz);
  const todayCaf = db.prepare(
    'SELECT COALESCE(SUM(caffeine_mg),0) as total FROM coffee_entries WHERE user_id = ? AND logged_at BETWEEN ? AND ?'
  ).get(req.user.id, dayStart, dayEnd).total;

  // Heart attack risk % — dramatic but clearly fictional
  // Formula: climbs to ~40% at 400mg, ~65% at 600mg, ~85% at 800mg, caps at 99%
  const risk = Math.min(99, Math.round(
    todayCaf <= 0 ? 0 :
    todayCaf < 200 ? (todayCaf / 200) * 20 :
    todayCaf < 400 ? 20 + ((todayCaf - 200) / 200) * 25 :
    todayCaf < 600 ? 45 + ((todayCaf - 400) / 200) * 22 :
    todayCaf < 800 ? 67 + ((todayCaf - 600) / 200) * 18 :
                     85 + ((todayCaf - 800) / 200) * 14
  ));

  res.json({
    global_count: globalCount,
    today_caffeine: todayCaf,
    heart_attack_risk: risk,
    disclaimer: 'For entertainment only. Not real medical data.',
  });
});

module.exports = router;
