const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  checkAfterChallengeWin,
  checkAfterFirstChallenge,
} = require('../achievements');
const { todayStr, DATE_RE } = require('./_helpers');

const router = express.Router();

const VALID_METRICS = ['total_cups', 'caffeine', 'espresso_cups', 'unique_types'];

// Aggregate progress toward a metric for one or more users since startDate.
// Pass a single-element array for an individual participant's progress.
function computeProgress(metric, startDate, userIds) {
  if (!userIds || userIds.length === 0) return 0;
  const start = new Date(startDate + 'T00:00:00').getTime();
  const placeholders = userIds.map(() => '?').join(',');
  const scope = `user_id IN (${placeholders}) AND`;

  switch (metric) {
    case 'espresso_cups':
      return db.prepare(
        `SELECT COUNT(*) as v FROM coffee_entries WHERE ${scope} coffee_id IN ('espresso','espresso_mac') AND logged_at >= ?`
      ).get(...userIds, start).v;
    case 'caffeine':
      return db.prepare(
        `SELECT COALESCE(SUM(caffeine_mg),0) as v FROM coffee_entries WHERE ${scope} logged_at >= ?`
      ).get(...userIds, start).v;
    case 'unique_types':
      return db.prepare(
        `SELECT COUNT(DISTINCT coffee_id) as v FROM coffee_entries WHERE ${scope} logged_at >= ?`
      ).get(...userIds, start).v;
    case 'total_cups':
      return db.prepare(
        `SELECT COUNT(*) as v FROM coffee_entries WHERE ${scope} logged_at >= ?`
      ).get(...userIds, start).v;
    default:
      return 0;
  }
}

function communityProgressFor(challenge, participants) {
  return computeProgress(challenge.metric, challenge.start_date, participants.map(p => p.user_id));
}

function userProgressFor(challenge, userId) {
  return computeProgress(challenge.metric, challenge.start_date, [userId]);
}

function seedCommunityChallenges() {
  const existing = db.prepare("SELECT COUNT(*) as cnt FROM challenges WHERE type = 'community'").get();
  if (existing.cnt > 0) return;

  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  const monthEnd = new Date(today);
  monthEnd.setDate(today.getDate() + 30);
  const todayStr2 = today.toISOString().slice(0, 10);

  const challenges = [
    { id: randomUUID(), name: 'Espresso Week', description: 'As a community, drink 500 espressos this week!', metric: 'espresso_cups', target: 500, end: weekEnd },
    { id: randomUUID(), name: 'Caffeine Collective', description: 'Reach 100,000mg of caffeine together this month!', metric: 'caffeine', target: 100000, end: monthEnd },
    { id: randomUUID(), name: 'Variety Show', description: 'Try all 13 coffee types as a community this week!', metric: 'unique_types', target: 13, end: weekEnd },
  ];

  const insert = db.prepare(
    'INSERT INTO challenges (id, type, creator_id, name, description, metric, target, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const c of challenges) {
    insert.run(c.id, 'community', null, c.name, c.description, c.metric, c.target, todayStr2, c.end.toISOString().slice(0, 10), 'active');
  }
}

seedCommunityChallenges();

router.get('/', requireAuth, (req, res) => {
  const challenges = db.prepare(
    "SELECT * FROM challenges WHERE status = 'active' ORDER BY type, end_date"
  ).all();

  const result = challenges.map(c => {
    const participants = db.prepare(
      'SELECT cp.*, u.username FROM challenge_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.challenge_id = ?'
    ).all(c.id);
    const joined = participants.some(p => p.user_id === req.user.id);

    return {
      ...c,
      participants_count: participants.length,
      community_progress: communityProgressFor(c, participants),
      my_progress: joined ? userProgressFor(c, req.user.id) : null,
      joined,
    };
  });

  res.json(result);
});

router.post('/', requireAuth, (req, res) => {
  const { name, description, metric, target, endDate } = req.body;
  if (!name || !metric || !target || !endDate) return res.status(400).json({ error: 'Missing fields' });
  if (typeof name !== 'string' || name.length > 100) return res.status(400).json({ error: 'Invalid name' });
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    return res.status(400).json({ error: 'Invalid description' });
  }
  if (!VALID_METRICS.includes(metric)) return res.status(400).json({ error: 'Invalid metric' });

  const targetNum = Number(target);
  if (!Number.isInteger(targetNum) || targetNum <= 0) return res.status(400).json({ error: 'Target must be a positive integer' });
  if (!DATE_RE.test(endDate)) return res.status(400).json({ error: 'Invalid end date (expected YYYY-MM-DD)' });

  const id = randomUUID();
  const today = todayStr();
  db.prepare(
    'INSERT INTO challenges (id, type, creator_id, name, description, metric, target, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, 'personal', req.user.id, name, description || '', metric, targetNum, today, endDate, 'active');

  db.prepare(
    'INSERT INTO challenge_participants (id, challenge_id, user_id, joined_at) VALUES (?, ?, ?, ?)'
  ).run(randomUUID(), id, req.user.id, Date.now());

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  res.json(challenge);
});

router.post('/:id/join', requireAuth, (req, res) => {
  const challenge = db.prepare("SELECT * FROM challenges WHERE id = ? AND status = 'active'").get(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

  const existing = db.prepare('SELECT id FROM challenge_participants WHERE challenge_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Already joined' });

  db.prepare(
    'INSERT INTO challenge_participants (id, challenge_id, user_id, joined_at) VALUES (?, ?, ?, ?)'
  ).run(randomUUID(), req.params.id, req.user.id, Date.now());

  const unlocked = checkAfterFirstChallenge(req.user.id);
  res.json({ ok: true, unlocked });
});

router.get('/:id', requireAuth, (req, res) => {
  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Not found' });

  const participants = db.prepare(
    'SELECT cp.*, u.username FROM challenge_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.challenge_id = ?'
  ).all(challenge.id);
  const communityProgress = communityProgressFor(challenge, participants);

  const now = new Date();
  const endDate = new Date(challenge.end_date + 'T23:59:59');

  if (challenge.type === 'community' && communityProgress >= challenge.target && challenge.status === 'active') {
    db.prepare("UPDATE challenges SET status = 'completed' WHERE id = ?").run(challenge.id);
    for (const p of participants) {
      db.prepare('UPDATE challenge_participants SET completed = 1 WHERE challenge_id = ? AND user_id = ?').run(challenge.id, p.user_id);
      checkAfterChallengeWin(p.user_id);
    }
  } else if (now > endDate && challenge.status === 'active') {
    db.prepare("UPDATE challenges SET status = 'completed' WHERE id = ?").run(challenge.id);
    if (challenge.type === 'personal') {
      const myProgress = userProgressFor(challenge, req.user.id);
      if (myProgress >= challenge.target) {
        db.prepare('UPDATE challenge_participants SET completed = 1 WHERE challenge_id = ? AND user_id = ?').run(challenge.id, req.user.id);
        checkAfterChallengeWin(req.user.id);
      }
    }
  }

  res.json({
    ...challenge,
    participants_count: participants.length,
    participants: participants.map(p => ({
      username: p.username,
      progress: userProgressFor(challenge, p.user_id),
    })),
    community_progress: communityProgress,
    my_progress: userProgressFor(challenge, req.user.id),
    joined: participants.some(p => p.user_id === req.user.id),
  });
});

module.exports = router;
