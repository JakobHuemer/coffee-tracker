const express = require('express');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { COFFEES } = require('../data/coffees');
const { checkAfterCoffeeLog } = require('../achievements');
const { dateStr, dayBounds, DATE_RE } = require('./_helpers');

const router = express.Router();

// Upload directory mirrors DB_DIR so photos survive restarts on the same volume.
const UPLOAD_DIR = process.env.DB_DIR
  ? path.join(process.env.DB_DIR, 'uploads')
  : path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, _file, cb) => cb(null, `${randomUUID()}.jpg`),
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Timestamps must stay in a range Date can represent, otherwise a single
// poisoned value (e.g. 1e300) makes every later toISOString() throw and
// permanently breaks /stats, /compare and achievement checks for that user.
// Allow backdating to 2000-01-01 and up to one day of clock skew ahead.
const MIN_TS = Date.UTC(2000, 0, 1);
function validTimestamp(ts) {
  return typeof ts === 'number' && Number.isFinite(ts) && ts >= MIN_TS && ts <= Date.now() + 86400000;
}

router.get('/', (req, res) => {
  res.json(COFFEES);
});

router.get('/entries', requireAuth, (req, res) => {
  const { date, days } = req.query;
  let rows;
  if (date) {
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
    const { start, end } = dayBounds(date);
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
router.post('/entries', requireAuth, upload.single('photo'), (req, res) => {
  const { coffeeId, timestamp: rawTs, is_public: rawPublic, description } = req.body;
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

  const recent = db.prepare(
    'SELECT logged_at FROM coffee_entries WHERE user_id = ? ORDER BY logged_at DESC LIMIT 1'
  ).get(req.user.id);
  if (recent && Date.now() - recent.logged_at < 5 * 60 * 1000) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(409).json({ error: 'Too soon — last coffee was less than 5 minutes ago.' });
  }

  const id = randomUUID();
  const logged_at = ts || Date.now();
  const photo_path = req.file ? req.file.filename : null;
  const is_public = rawPublic === '0' || rawPublic === 'false' ? 0 : 1;
  const desc = description?.trim() || null;

  db.prepare(
    'INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, photo_path, description, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.user.id, coffeeId, coffee.caffeine, logged_at, photo_path, desc, is_public);

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

  const today = new Date().toISOString().slice(0, 10);
  const todayEntries = allEntries.filter(e => dateStr(e.logged_at) === today);

  const byType = {};
  for (const e of allEntries) byType[e.coffee_id] = (byType[e.coffee_id] || 0) + 1;

  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i)); return d.toISOString().slice(0, 10);
  });

  const byDay = {};
  for (const e of allEntries) {
    const d = dateStr(e.logged_at);
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
