const express = require('express');
const { randomUUID, randomInt } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isValidTz, getUserTz } = require('../time');
const { BASE_RATING } = require('../competition-core');
const { ensureRecurringMatches, groupOf } = require('../competitions');

const router = express.Router();

const NAME_RE = /^[\w][\w '-]{1,30}$/;
const DESCRIPTION_MAX = 200;

// Join codes are read off a screen and typed by hand, so the alphabet drops
// the characters that get confused there (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function makeJoinCode() {
  // Loop rather than return blindly: a collision on a 6-char code is unlikely
  // but the column is UNIQUE, so an unchecked insert would 500.
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM competition_groups WHERE join_code = ?').get(code)) return code;
  }
  throw new Error('Could not allocate a unique join code');
}

function memberCount(groupId) {
  return db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(groupId).c;
}

// Shape sent to the client. join_code is only included for members — it is the
// key to a private group, so the public listing must not leak it.
function publicGroup(group, { includeCode = false } = {}) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    owner_id: group.owner_id,
    timezone: group.timezone,
    is_public: group.is_public,
    member_count: memberCount(group.id),
    created_at: group.created_at,
    ...(includeCode ? { join_code: group.join_code } : {}),
  };
}

function membersOf(groupId) {
  return db.prepare(`
    SELECT u.id, u.username, u.avatar, u.profile_photo, m.joined_at,
           COALESCE(r.rating, ?) AS rating,
           COALESCE(r.matches, 0) AS matches
    FROM group_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN user_ratings r ON r.user_id = u.id
    WHERE m.group_id = ?
    ORDER BY rating DESC, u.username ASC
  `).all(BASE_RATING, groupId).map((m) => ({
    id: m.id,
    username: m.username,
    avatar: m.avatar,
    profile_photo_url: m.profile_photo ? `/uploads/${m.profile_photo}` : null,
    joined_at: m.joined_at,
    rating: m.rating,
    matches: m.matches,
  }));
}

// Leaving must never destroy a group: settled matches hang off it and are the
// rating ledger. So the row survives an empty roster, and ownership passes to
// the longest-standing remaining member instead.
function reassignOwnerIfNeeded(group, leavingUserId) {
  if (group.owner_id !== leavingUserId) return;
  const next = db.prepare(
    'SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at LIMIT 1'
  ).get(group.id);
  db.prepare('UPDATE competition_groups SET owner_id = ? WHERE id = ?')
    .run(next ? next.user_id : null, group.id);
}

// GET /api/groups — the public directory plus the caller's own group.
router.get('/', requireAuth, (req, res) => {
  const mine = groupOf(req.user.id);
  const rows = db.prepare(
    'SELECT * FROM competition_groups WHERE is_public = 1 ORDER BY created_at DESC LIMIT 100'
  ).all();
  res.json({
    groups: rows.map((g) => publicGroup(g)),
    my_group: mine ? publicGroup(mine, { includeCode: true }) : null,
  });
});

// GET /api/groups/mine — the caller's group with its roster.
router.get('/mine', requireAuth, (req, res) => {
  const group = groupOf(req.user.id);
  if (!group) return res.json({ group: null, members: [] });
  res.json({ group: publicGroup(group, { includeCode: true }), members: membersOf(group.id) });
});

// POST /api/groups — create a group and join it (leaving any current one).
router.post('/', requireAuth, (req, res) => {
  const { name, description = null, timezone, is_public = true } = req.body || {};

  if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
    return res.status(400).json({ error: 'Name must be 2-31 characters (letters, numbers, spaces, - or \')' });
  }
  if (description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    return res.status(400).json({ error: `Description must be at most ${DESCRIPTION_MAX} characters` });
  }
  // The group's zone anchors every member's day/week boundary, so it must be a
  // real IANA name. Default to the creator's own zone.
  const tz = timezone === undefined || timezone === null ? getUserTz(db, req.user.id) : timezone;
  if (!isValidTz(tz)) return res.status(400).json({ error: 'Invalid timezone' });

  const trimmed = name.trim();
  if (db.prepare('SELECT 1 FROM competition_groups WHERE name = ?').get(trimmed)) {
    return res.status(409).json({ error: 'That group name is taken' });
  }

  const now = Date.now();
  const id = randomUUID();
  const code = makeJoinCode();
  const previous = groupOf(req.user.id);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO competition_groups (id, name, description, owner_id, timezone, is_public, join_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, trimmed, description ? description.trim() : null, req.user.id, tz, is_public ? 1 : 0, code, now);

    if (previous) {
      db.prepare('DELETE FROM group_members WHERE user_id = ?').run(req.user.id);
      reassignOwnerIfNeeded(previous, req.user.id);
    }
    db.prepare('INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), id, req.user.id, now);
  })();

  // A brand-new group has one member, so nothing is created yet; this only
  // matters for the joins that follow.
  ensureRecurringMatches(now);

  const group = db.prepare('SELECT * FROM competition_groups WHERE id = ?').get(id);
  res.status(201).json({ group: publicGroup(group, { includeCode: true }), members: membersOf(id) });
});

// POST /api/groups/join — by id (public groups) or by join code (any group).
router.post('/join', requireAuth, (req, res) => {
  const { group_id = null, code = null } = req.body || {};

  let group = null;
  if (typeof code === 'string' && code.trim()) {
    group = db.prepare('SELECT * FROM competition_groups WHERE join_code = ?')
      .get(code.trim().toUpperCase());
  } else if (typeof group_id === 'string' && group_id) {
    group = db.prepare('SELECT * FROM competition_groups WHERE id = ?').get(group_id);
    // A private group is reachable by its code only — an id alone is not proof
    // of an invitation.
    if (group && group.is_public !== 1) group = null;
  } else {
    return res.status(400).json({ error: 'Provide a group id or a join code' });
  }
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const previous = groupOf(req.user.id);
  if (previous && previous.id === group.id) {
    return res.status(409).json({ error: 'You are already in this group' });
  }

  const now = Date.now();
  db.transaction(() => {
    if (previous) {
      db.prepare('DELETE FROM group_members WHERE user_id = ?').run(req.user.id);
      reassignOwnerIfNeeded(previous, req.user.id);
    }
    db.prepare('INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), group.id, req.user.id, now);
  })();

  // Joining can take a group from one member to two, which is the point at
  // which its recurring matches start existing. Don't wait for the next tick.
  ensureRecurringMatches(now);

  res.json({
    group: publicGroup(group, { includeCode: true }),
    members: membersOf(group.id),
    left_group: previous ? { id: previous.id, name: previous.name } : null,
  });
});

// POST /api/groups/leave — stop being in any group.
router.post('/leave', requireAuth, (req, res) => {
  const group = groupOf(req.user.id);
  if (!group) return res.status(404).json({ error: 'You are not in a group' });

  // Matches already under way keep the caller on their roster and settle
  // normally — leaving takes effect from the next window. Rating is global, so
  // it follows the user out of the group either way.
  db.transaction(() => {
    db.prepare('DELETE FROM group_members WHERE user_id = ?').run(req.user.id);
    reassignOwnerIfNeeded(group, req.user.id);
  })();

  res.json({ ok: true, left_group: { id: group.id, name: group.name } });
});

// PATCH /api/groups/:id — owner-only settings.
router.patch('/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM competition_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the group owner can change this' });

  const { name, description, timezone, is_public } = req.body || {};
  const next = {
    name: group.name,
    description: group.description,
    timezone: group.timezone,
    is_public: group.is_public,
  };

  if (name !== undefined) {
    if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
      return res.status(400).json({ error: 'Name must be 2-31 characters (letters, numbers, spaces, - or \')' });
    }
    const taken = db.prepare('SELECT 1 FROM competition_groups WHERE name = ? AND id != ?').get(name.trim(), group.id);
    if (taken) return res.status(409).json({ error: 'That group name is taken' });
    next.name = name.trim();
  }
  if (description !== undefined) {
    if (description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
      return res.status(400).json({ error: `Description must be at most ${DESCRIPTION_MAX} characters` });
    }
    next.description = description ? description.trim() : null;
  }
  if (timezone !== undefined) {
    if (!isValidTz(timezone)) return res.status(400).json({ error: 'Invalid timezone' });
    next.timezone = timezone;
  }
  if (is_public !== undefined) next.is_public = is_public ? 1 : 0;

  db.prepare('UPDATE competition_groups SET name = ?, description = ?, timezone = ?, is_public = ? WHERE id = ?')
    .run(next.name, next.description, next.timezone, next.is_public, group.id);

  // A zone change moves the day boundary. Matches already open keep the window
  // they were created with (their scores are already being measured against
  // it); the new zone applies from the next period.
  const updated = db.prepare('SELECT * FROM competition_groups WHERE id = ?').get(group.id);
  res.json({ group: publicGroup(updated, { includeCode: true }), members: membersOf(group.id) });
});

// GET /api/groups/:id — detail. Private groups are visible to members only.
router.get('/:id', requireAuth, (req, res) => {
  const group = db.prepare('SELECT * FROM competition_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const isMember = !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, req.user.id);
  if (group.is_public !== 1 && !isMember) return res.status(404).json({ error: 'Group not found' });

  res.json({
    group: publicGroup(group, { includeCode: isMember }),
    members: membersOf(group.id),
    is_member: isMember,
  });
});

module.exports = router;
