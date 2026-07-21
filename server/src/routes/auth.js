const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('crypto');
const db       = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const USER_COLS = 'id, username, avatar, featured_badges, created_at';
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
  return { ...u, featured_badges: u.featured_badges ? u.featured_badges.split(',').filter(Boolean) : [] };
}

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', authLimiter, (req, res) => {
  const { username, password } = req.body;
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
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(id, username, password_hash, Date.now());
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
  const { password_hash, ...safe } = row;
  res.json({ token: makeToken(row), user: parseUser(safe) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = parseUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.patch('/me', requireAuth, (req, res) => {
  const { username, avatar, featured_badges } = req.body;
  if (username && !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Invalid username' });
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

module.exports = router;
