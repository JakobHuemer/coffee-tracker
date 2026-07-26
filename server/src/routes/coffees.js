const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { COFFEES } = require('../data/coffees');
const { checkAfterCoffeeLog } = require('../achievements');
const { DATE_RE } = require('./_helpers');
const { getUserTz, localTodayStr, localDateStr, localDayBounds } = require('../time');

const router = express.Router();

// Upload directory mirrors DB_DIR so photos survive restarts on the same volume.
const UPLOAD_DIR = process.env.DB_DIR
  ? path.join(process.env.DB_DIR, 'uploads')
  : path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
};

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || 'jpg';
    cb(null, `${randomUUID()}.${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Multer surfaces upload failures (too large, wrong type) as errors that would
// otherwise hit the global handler as a 500. They are client errors, so turn
// them into a 400 with the actual message the user can act on.
function handleUpload(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}

// Timestamps must stay in a range Date can represent, otherwise a single
// poisoned value (e.g. 1e300) makes every later toISOString() throw and
// permanently breaks /stats, /compare and achievement checks for that user.
// No future events (docs/time-and-timezones.md): reject anything past now, with
// only a 2-minute allowance for client/server clock skew — the old +1 day
// window let a post sit at "just now" for hours. Backdating to 2000-01-01 is
// still allowed.
const MIN_TS = Date.UTC(2000, 0, 1);
const SKEW_MS = 2 * 60 * 1000;
function validTimestamp(ts) {
  return typeof ts === 'number' && Number.isFinite(ts) && ts >= MIN_TS && ts <= Date.now() + SKEW_MS;
}

// Dev-only escape hatch for the 5-minute spacing rule below, so seeding a day's
// worth of test coffees doesn't need fake timestamps 5 minutes apart.
//
// Opt-in and off by default: a production container that simply never sets the
// variable keeps the rule enforced. It is deliberately NOT derived from
// NODE_ENV — nothing in this repo sets NODE_ENV, so "absent means dev" would
// silently disable a data-integrity rule in production.
const DEV_OVERRIDES = process.env.DEV_OVERRIDES === '1';
if (DEV_OVERRIDES) {
  console.warn('DEV_OVERRIDES=1 — the 5-minute coffee spacing rule can be bypassed per request. Never set this in production.');
}

router.get('/', (req, res) => {
  res.json(COFFEES);
});

// Which debug overrides this server actually honours. The client uses this to
// decide whether to show the toggle at all, so the UI can never offer a switch
// that does nothing (VALUES.md 0.4).
router.get('/dev-flags', requireAuth, (req, res) => {
  res.json({ spacing_override: DEV_OVERRIDES });
});

router.get('/entries', requireAuth, (req, res) => {
  const { date, days } = req.query;
  let rows;
  if (date) {
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
    // `date` is a civil day in the user's zone → convert to UTC instant bounds.
    const { start, end } = localDayBounds(date, getUserTz(db, req.user.id));
    rows = db.prepare(
      'SELECT * FROM coffee_entries WHERE user_id = ? AND logged_at BETWEEN ? AND ? ORDER BY logged_at DESC'
    ).all(req.user.id, start, end);
  } else if (days) {
    const n = parseInt(days, 10);
    if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'Invalid days parameter' });
    const cutoff = Date.now() - n * 86400000;
    rows = db.prepare(
      'SELECT * FROM coffee_entries WHERE user_id = ? AND logged_at >= ? ORDER BY logged_at DESC'
    ).all(req.user.id, cutoff);
  } else {
    rows = db.prepare(
      'SELECT * FROM coffee_entries WHERE user_id = ? ORDER BY logged_at DESC'
    ).all(req.user.id);
  }
  res.json(rows);
});

router.get('/photos', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, coffee_id, logged_at, photo_path, description FROM coffee_entries WHERE user_id = ? AND photo_path IS NOT NULL ORDER BY logged_at DESC'
  ).all(req.user.id);
  res.json(rows.map(r => ({ ...r, photo_url: `/uploads/${r.photo_path}` })));
});

// Accepts multipart/form-data (photo optional) or falls back to JSON-parsed
// body when no file part is present. The photo field must be named "photo".
router.post('/entries', requireAuth, handleUpload(upload.single('photo')), (req, res) => {
  const { coffeeId, timestamp: rawTs, is_public: rawPublic, description, skip_spacing: rawSkip } = req.body;
  const coffee = COFFEES.find(c => c.id === coffeeId);
  if (!coffee) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Unknown coffee type' });
  }

  let ts;
  if (rawTs !== undefined && rawTs !== '') {
    ts = Number(rawTs);
    if (!validTimestamp(ts)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Invalid timestamp' });
    }
  }

  // A coffee entry must carry a photo or a description — never neither.
  if (!req.file && !description?.trim()) {
    return res.status(400).json({ error: 'Add a photo or a description.' });
  }

  const id = randomUUID();
  const now = Date.now();
  const logged_at = ts || now;

  // Not a rate limit — a data-integrity rule on the coffee's own time. No two
  // coffees may occupy the same 5-minute window (you can't drink two that
  // close), so we reject when any existing entry sits within ±5 min of this
  // one's logged_at. Because the constraint is on logged_at (not wall-clock
  // insert time), a user can still backfill several past coffees in one sitting
  // as long as each is 5+ minutes apart.
  //
  // The client may ask to skip it, but only a server started with
  // DEV_OVERRIDES=1 honours that — the request flag alone can never disable the
  // rule. Accepts the multipart string '1'/'true' and the JSON boolean/number.
  const skipSpacing = DEV_OVERRIDES &&
    (rawSkip === true || rawSkip === 1 || rawSkip === '1' || rawSkip === 'true');
  if (!skipSpacing) {
    const clash = db.prepare(
      'SELECT id FROM coffee_entries WHERE user_id = ? AND ABS(logged_at - ?) < ? LIMIT 1'
    ).get(req.user.id, logged_at, 5 * 60 * 1000);
    if (clash) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(409).json({ error: 'Another coffee is already logged within 5 minutes of this time.' });
    }
  }

  const photo_path = req.file ? req.file.filename : null;
  // Public only when explicitly opted in. Accepts the multipart string '1'/'true'
  // and the JSON boolean true / number 1; anything else (including an absent
  // field, e.g. the Dashboard quick-log) stays private.
  const is_public =
    rawPublic === true || rawPublic === 1 || rawPublic === '1' || rawPublic === 'true' ? 1 : 0;
  const desc = description?.trim() || null;

  db.prepare(
    'INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, created_at, photo_path, description, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.user.id, coffeeId, coffee.caffeine, logged_at, now, photo_path, desc, is_public);

  const unlocked = checkAfterCoffeeLog(req.user.id);

  const entry = { id, user_id: req.user.id, coffee_id: coffeeId, caffeine_mg: coffee.caffeine, logged_at, photo_path, description: desc, is_public };
  res.json({ entry, unlocked });
});

router.patch('/entries/:id', requireAuth, (req, res) => {
  const { timestamp } = req.body;
  if (!validTimestamp(timestamp)) return res.status(400).json({ error: 'timestamp required' });
  const entry = db.prepare('SELECT * FROM coffee_entries WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('UPDATE coffee_entries SET logged_at = ? WHERE id = ?').run(timestamp, req.params.id);
  const updated = db.prepare('SELECT * FROM coffee_entries WHERE id = ?').get(req.params.id);
  res.json(updated);
});

router.delete('/entries/:id', requireAuth, (req, res) => {
  const entry = db.prepare('SELECT * FROM coffee_entries WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (entry.photo_path) {
    fs.unlink(path.join(UPLOAD_DIR, entry.photo_path), () => {});
  }
  db.prepare('DELETE FROM coffee_entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/stats', requireAuth, (req, res) => {
  const allEntries = db.prepare(
    'SELECT coffee_id, caffeine_mg, logged_at FROM coffee_entries WHERE user_id = ? ORDER BY logged_at'
  ).all(req.user.id);

  // Civil "today" and per-day grouping are evaluated in the user's zone, so the
  // day boundaries match what the user sees on their own clock.
  const tz = getUserTz(db, req.user.id);
  const today = localTodayStr(tz);
  const todayEntries = allEntries.filter(e => localDateStr(e.logged_at, tz) === today);

  const byType = {};
  for (const e of allEntries) byType[e.coffee_id] = (byType[e.coffee_id] || 0) + 1;

  // Last 14 civil days ending today, by date-only arithmetic on the label.
  const last14 = Array.from({ length: 14 }, (_, i) => {
    return new Date(Date.parse(`${today}T00:00:00Z`) - (13 - i) * 86400000).toISOString().slice(0, 10);
  });

  const byDay = {};
  for (const e of allEntries) {
    const d = localDateStr(e.logged_at, tz);
    if (!byDay[d]) byDay[d] = { cups: 0, caffeine: 0 };
    byDay[d].cups++;
    byDay[d].caffeine += e.caffeine_mg;
  }

  const sevenDayTotal = allEntries.filter(e => Date.now() - e.logged_at <= 7 * 86400000).length;

  res.json({
    total_cups: allEntries.length,
    today_cups: todayEntries.length,
    today_caffeine: todayEntries.reduce((s, e) => s + e.caffeine_mg, 0),
    total_caffeine: allEntries.reduce((s, e) => s + e.caffeine_mg, 0),
    seven_day_avg: +(sevenDayTotal / 7).toFixed(1),
    by_type: byType,
    last14: last14.map(d => ({ date: d, cups: byDay[d]?.cups || 0, caffeine: byDay[d]?.caffeine || 0 })),
  });
});

module.exports = router;
