const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('crypto');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isValidTz, DEFAULT_TZ } = require('../time');
const { clampHalfLife } = require('../energy');

const UPLOAD_DIR = process.env.DB_DIR
  ? path.join(process.env.DB_DIR, 'uploads')
  : path.join(__dirname, '..', '..', 'data', 'uploads');

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
};

const profilePhotoStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || 'jpg';
    cb(null, `pfp_${randomUUID()}.${ext}`);
  },
});
const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Convert multer upload failures (too large, wrong type) into a 400 with the
// real message instead of letting them fall through to the global 500 handler.
function handleUpload(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}

const router = express.Router();

const USER_COLS = 'id, username, avatar, profile_photo, featured_badges, timezone, caffeine_half_life_h, created_at';
const USERNAME_RE = /^[a-zA-Z0-9_-]{2,20}$/;

// Throttle credential guessing and mass account creation. Per-IP: generous
// enough that a shared NAT of real users never hits it, far too slow for
// brute force (30 attempts / 15 min).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later' },
});

function parseUser(u) {
  if (!u) return u;
  return {
    ...u,
    featured_badges: u.featured_badges ? u.featured_badges.split(',').filter(Boolean) : [],
    profile_photo_url: u.profile_photo ? `/uploads/${u.profile_photo}` : null,
  };
}

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', authLimiter, (req, res) => {
  const { username, password, timezone } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  // No complexity/minimum rule by design — this is a for-fun site, passwords
  // are treated as public (see the register-page warning). Any non-empty
  // string is fine. The upper bound only exists because bcrypt ignores
  // everything past 72 bytes anyway.
  if (typeof password !== 'string' || password.length > 72) return res.status(400).json({ error: 'Password must be a string of at most 72 characters' });
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 2-20 alphanumeric characters' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const password_hash = bcrypt.hashSync(password, 10);
  const id = randomUUID();
  const tz = isValidTz(timezone) ? timezone : DEFAULT_TZ;
  db.prepare('INSERT INTO users (id, username, password_hash, timezone, created_at) VALUES (?, ?, ?, ?, ?)').run(id, username, password_hash, tz, Date.now());
  db.prepare('INSERT INTO user_streaks (user_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO user_combos (user_id) VALUES (?)').run(id);

  const user = parseUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id));
  res.json({ token: makeToken(user), user });
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Missing fields' });

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  // Refresh the stored zone from the client on login (lazy tz update — the user
  // may have moved). Only when it's a valid IANA name and actually changed.
  const { timezone } = req.body;
  if (isValidTz(timezone) && timezone !== row.timezone) {
    db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, row.id);
    row.timezone = timezone;
  }
  const { password_hash, ...safe } = row;
  res.json({ token: makeToken(row), user: parseUser(safe) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = parseUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id));
  // A valid token whose user no longer exists (e.g. deleted, or DB reset) is an
  // invalid session, not a missing resource — 401 so the client logs out.
  if (!user) return res.status(401).json({ error: 'Session no longer valid' });
  res.json(user);
});

router.patch('/me', requireAuth, (req, res) => {
  const { username, avatar, featured_badges, password, timezone, caffeine_half_life_h } = req.body;
  if (username && !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  // Personal caffeine half-life (hours) for the Buzz score. null clears it back
  // to the population default. Out-of-range numbers are clamped rather than
  // rejected — the client offers a free-text box, and a typo should give a
  // sane curve, not an error. Anything non-numeric is a client bug: 400.
  if (caffeine_half_life_h !== undefined) {
    if (caffeine_half_life_h === null) {
      db.prepare('UPDATE users SET caffeine_half_life_h = NULL WHERE id = ?').run(req.user.id);
    } else if (typeof caffeine_half_life_h === 'number' && Number.isFinite(caffeine_half_life_h)) {
      db.prepare('UPDATE users SET caffeine_half_life_h = ? WHERE id = ?')
        .run(clampHalfLife(caffeine_half_life_h), req.user.id);
    } else {
      return res.status(400).json({ error: 'caffeine_half_life_h must be a number or null' });
    }
  }
  // Timezone: accept only a valid IANA name; silently ignore anything else so a
  // stale/garbage client value can't overwrite a good one.
  if (timezone !== undefined && isValidTz(timezone)) {
    db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, req.user.id);
  }
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length === 0 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be 1–72 characters' });
    }
    // Require the current password to rotate the hash. A valid JWT alone is not
    // enough: a stolen token could otherwise lock the real owner out by changing
    // the password. Re-authenticating proves possession of the secret itself.
    const { currentPassword } = req.body;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row || typeof currentPassword !== 'string' || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(403).json({ error: 'Current password is incorrect' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  }
  // Avatars are single emoji picked in the client; 16 chars covers any
  // multi-codepoint emoji while rejecting arbitrary blobs.
  if (avatar && (typeof avatar !== 'string' || avatar.length > 16)) {
    return res.status(400).json({ error: 'Invalid avatar' });
  }
  if (featured_badges !== undefined) {
    if (!Array.isArray(featured_badges) || featured_badges.length > 3 ||
        !featured_badges.every(b => typeof b === 'string' && b.length > 0 && !b.includes(','))) {
      return res.status(400).json({ error: 'featured_badges must be an array of up to 3 badge IDs' });
    }
    db.prepare('UPDATE users SET featured_badges = ? WHERE id = ?').run(featured_badges.join(','), req.user.id);
  }
  if (username) {
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.user.id);
    if (taken) return res.status(409).json({ error: 'Username taken' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.user.id);
  }
  if (avatar) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
  }
  const user = parseUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id));
  res.json(user);
});

router.patch('/me/photo', requireAuth, handleUpload(profilePhotoUpload.single('photo')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' });
  const existing = db.prepare('SELECT profile_photo FROM users WHERE id = ?').get(req.user.id);
  if (existing?.profile_photo) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, existing.profile_photo)); } catch { /* ignore */ }
  }
  db.prepare('UPDATE users SET profile_photo = ? WHERE id = ?').run(req.file.filename, req.user.id);
  const user = parseUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id));
  res.json(user);
});

router.delete('/me/photo', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT profile_photo FROM users WHERE id = ?').get(req.user.id);
  if (existing?.profile_photo) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, existing.profile_photo)); } catch { /* ignore */ }
    db.prepare('UPDATE users SET profile_photo = NULL WHERE id = ?').run(req.user.id);
  }
  const user = parseUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id));
  res.json(user);
});

router.delete('/me', requireAuth, (req, res) => {
  const coffeePhotos = db.prepare('SELECT photo_path FROM coffee_entries WHERE user_id = ? AND photo_path IS NOT NULL').all(req.user.id);
  const { profile_photo } = db.prepare('SELECT profile_photo FROM users WHERE id = ?').get(req.user.id) ?? {};
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  for (const { photo_path } of coffeePhotos) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, photo_path)); } catch { /* ignore */ }
  }
  if (profile_photo) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, profile_photo)); } catch { /* ignore */ }
  }
  res.status(204).end();
});

module.exports = router;
