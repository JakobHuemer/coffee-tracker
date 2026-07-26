const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { BASE_RATING, K_BY_MODE, scorePoints } = require('../competition-core');
const { groupOf, scoreFor, ratingOf } = require('../competitions');

const router = express.Router();

// Modes a user may open themselves. daily/weekly are opened by the ticker on a
// recurring window and are never created through the API.
const USER_MODES = ['ondemand', '1v1', 'team'];

const TITLE_MAX = 60;
// Upper bound on a user-created window. Long enough for "run this for a month",
// short enough that a typo can't park a match in the table for years.
const MAX_DURATION_MS = 90 * 86400000;
const MIN_DURATION_MS = 60 * 1000;

function matchOr404(res, id) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!match) {
    res.status(404).json({ error: 'Match not found' });
    return null;
  }
  return match;
}

// Participants with everything the UI needs. For a match that has not settled
// yet, `score` is computed live from the window so far; for a settled one it is
// the stored value, which is the number the deltas were actually derived from.
function participantsOf(match) {
  const rows = db.prepare(`
    SELECT p.*, u.username, u.avatar, u.profile_photo
    FROM match_participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.match_id = ?
    ORDER BY p.joined_at
  `).all(match.id);

  const settled = match.state === 'settled';
  const enriched = rows.map((r) => {
    const score = settled ? r.score : scoreFor(r.user_id, match.scope_start, Math.min(Date.now(), match.scope_end));
    return {
      user_id: r.user_id,
      username: r.username,
      avatar: r.avatar,
      profile_photo_url: r.profile_photo ? `/uploads/${r.profile_photo}` : null,
      side: r.side,
      joined_at: r.joined_at,
      score,
      points: scorePoints(score || 0),
      contribution_share: r.contribution_share,
      rating_before: r.rating_before,
      rating_after: r.rating_after,
      delta: r.delta,
      // A live match shows the rating a player is carrying INTO it; a settled
      // one shows what they had when it settled.
      current_rating: settled ? r.rating_after : ratingOf(r.user_id),
    };
  });

  // Standings order: highest score first. In a team match the sides are shown
  // separately, so keep the ordering within each side.
  return enriched.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function matchPayload(match, { withParticipants = true } = {}) {
  const base = {
    id: match.id,
    group_id: match.group_id,
    mode: match.mode,
    period_key: match.period_key,
    title: match.title,
    creator_id: match.creator_id,
    scope_start: match.scope_start,
    scope_end: match.scope_end,
    state: match.state,
    k_factor: match.k_factor,
    team_size: match.team_size,
    created_at: match.created_at,
    settled_at: match.settled_at,
    participant_count: db.prepare('SELECT COUNT(*) AS c FROM match_participants WHERE match_id = ?')
      .get(match.id).c,
  };
  return withParticipants ? { ...base, participants: participantsOf(match) } : base;
}

// GET /api/competitions — the caller's group's matches, plus their rating.
router.get('/', requireAuth, (req, res) => {
  const rating = db.prepare('SELECT rating, matches FROM user_ratings WHERE user_id = ?').get(req.user.id);
  const group = groupOf(req.user.id);
  if (!group) {
    return res.json({
      group: null,
      open: [], live: [], settled: [],
      my_rating: rating ? rating.rating : BASE_RATING,
      my_matches: rating ? rating.matches : 0,
    });
  }

  const rows = db.prepare('SELECT * FROM matches WHERE group_id = ? ORDER BY scope_start DESC LIMIT 60')
    .all(group.id);

  res.json({
    group: { id: group.id, name: group.name, timezone: group.timezone },
    open: rows.filter((m) => m.state === 'open').map((m) => matchPayload(m)),
    live: rows.filter((m) => m.state === 'pending').map((m) => matchPayload(m)),
    settled: rows.filter((m) => m.state === 'settled' || m.state === 'cancelled').map((m) => matchPayload(m)),
    my_rating: rating ? rating.rating : BASE_RATING,
    my_matches: rating ? rating.matches : 0,
  });
});

// GET /api/competitions/leaderboard — group standings by rating.
router.get('/leaderboard', requireAuth, (req, res) => {
  const group = groupOf(req.user.id);
  if (!group) return res.json({ group: null, leaderboard: [] });

  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.profile_photo,
           COALESCE(r.rating, ?) AS rating,
           COALESCE(r.matches, 0) AS matches
    FROM group_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN user_ratings r ON r.user_id = u.id
    WHERE m.group_id = ?
  `).all(BASE_RATING, group.id);

  // Players who have never settled a match sort last regardless of rating:
  // the default 1000 would otherwise place someone who has done nothing above
  // an active player sitting just below it.
  rows.sort((a, b) => {
    if ((a.matches === 0) !== (b.matches === 0)) return a.matches === 0 ? 1 : -1;
    return b.rating - a.rating;
  });

  res.json({
    group: { id: group.id, name: group.name },
    leaderboard: rows.map((r, i) => ({
      id: r.id,
      username: r.username,
      avatar: r.avatar,
      profile_photo_url: r.profile_photo ? `/uploads/${r.profile_photo}` : null,
      rating: r.rating,
      matches: r.matches,
      rank: i + 1,
    })),
  });
});

// POST /api/competitions — open a user-created match in the caller's group.
router.post('/', requireAuth, (req, res) => {
  const group = groupOf(req.user.id);
  if (!group) return res.status(400).json({ error: 'Join a group before starting a match' });

  const { mode, title = null, scope_start, scope_end, team_size = null, side = 'A' } = req.body || {};

  if (!USER_MODES.includes(mode)) {
    return res.status(400).json({ error: `Mode must be one of: ${USER_MODES.join(', ')}` });
  }
  if (title !== null && (typeof title !== 'string' || title.length > TITLE_MAX)) {
    return res.status(400).json({ error: `Title must be at most ${TITLE_MAX} characters` });
  }
  if (!Number.isFinite(scope_start) || !Number.isFinite(scope_end)) {
    return res.status(400).json({ error: 'scope_start and scope_end must be epoch milliseconds' });
  }

  const now = Date.now();
  // Joining runs until the start instant, so a match that starts in the past
  // could never be joined by anyone but its creator — and would then be
  // cancelled for an illegal roster on the very next tick.
  if (scope_start <= now) return res.status(400).json({ error: 'The match must start in the future' });
  const duration = scope_end - scope_start;
  if (duration < MIN_DURATION_MS) return res.status(400).json({ error: 'The match must run for at least a minute' });
  if (duration > MAX_DURATION_MS) return res.status(400).json({ error: 'A match can run for at most 90 days' });

  let teamSize = null;
  if (mode === 'team') {
    if (!Number.isInteger(team_size) || team_size < 2 || team_size > 10) {
      return res.status(400).json({ error: 'Team size must be a whole number between 2 and 10' });
    }
    // A side of one is the 1v1 mode, and the losing-side split divides by
    // (n - 1) — which is why the floor is 2, not 1.
    teamSize = team_size;
  }
  if (mode === 'team' && side !== 'A' && side !== 'B') {
    return res.status(400).json({ error: 'Side must be A or B' });
  }

  const id = randomUUID();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO matches (id, group_id, mode, period_key, title, creator_id,
                           scope_start, scope_end, state, k_factor, team_size, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(id, group.id, mode, title ? title.trim() : null, req.user.id,
      scope_start, scope_end, K_BY_MODE[mode], teamSize, now);

    db.prepare('INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, req.user.id, mode === 'team' ? side : null, now);
  })();

  res.status(201).json({ match: matchPayload(db.prepare('SELECT * FROM matches WHERE id = ?').get(id)) });
});

// POST /api/competitions/:id/join — take a slot in an open lobby.
router.post('/:id/join', requireAuth, (req, res) => {
  const match = matchOr404(res, req.params.id);
  if (!match) return;
  if (match.state !== 'open') return res.status(409).json({ error: 'This match is no longer open to join' });
  if (match.scope_start <= Date.now()) return res.status(409).json({ error: 'This match has already started' });

  const group = groupOf(req.user.id);
  if (!group || group.id !== match.group_id) {
    return res.status(403).json({ error: 'This match belongs to another group' });
  }

  const already = db.prepare('SELECT 1 FROM match_participants WHERE match_id = ? AND user_id = ?')
    .get(match.id, req.user.id);
  if (already) return res.status(409).json({ error: 'You are already in this match' });

  const current = db.prepare('SELECT side FROM match_participants WHERE match_id = ?').all(match.id);

  let side = null;
  if (match.mode === 'team') {
    side = req.body && req.body.side;
    if (side !== 'A' && side !== 'B') return res.status(400).json({ error: 'Pick side A or B' });
    if (current.filter((p) => p.side === side).length >= match.team_size) {
      return res.status(409).json({ error: 'That side is full' });
    }
  } else if (match.mode === '1v1' && current.length >= 2) {
    return res.status(409).json({ error: 'This match already has both players' });
  }

  db.prepare('INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), match.id, req.user.id, side, Date.now());

  res.json({ match: matchPayload(db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id)) });
});

// POST /api/competitions/:id/leave — give up a slot before the match starts.
router.post('/:id/leave', requireAuth, (req, res) => {
  const match = matchOr404(res, req.params.id);
  if (!match) return;
  // Only a lobby can be left. Once a match is running its roster is fixed —
  // that is what stops a player dodging a bad day, and it applies to leaving
  // the match for the same reason it applies to leaving the group.
  if (match.state !== 'open') return res.status(409).json({ error: 'A running match cannot be left' });

  const row = db.prepare('SELECT 1 FROM match_participants WHERE match_id = ? AND user_id = ?')
    .get(match.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'You are not in this match' });

  db.transaction(() => {
    db.prepare('DELETE FROM match_participants WHERE match_id = ? AND user_id = ?')
      .run(match.id, req.user.id);
    // A user-created lobby whose last player walked out is cancelled rather
    // than left as an ownerless shell the ticker would cancel anyway.
    //
    // A recurring lobby is NOT cancelled when it empties: it belongs to the
    // group, not to whoever happened to join first, and it opens a day (or two)
    // ahead precisely so people can join over that period. Emptying it must not
    // deny the rest of the group their daily match.
    const isRecurring = match.period_key !== null;
    const left = db.prepare('SELECT COUNT(*) AS c FROM match_participants WHERE match_id = ?').get(match.id).c;
    if (left === 0 && !isRecurring) {
      db.prepare("UPDATE matches SET state = 'cancelled', settled_at = ? WHERE id = ?").run(Date.now(), match.id);
    }
  })();

  res.json({ ok: true });
});

// GET /api/competitions/:id — one match with its standings.
router.get('/:id', requireAuth, (req, res) => {
  const match = matchOr404(res, req.params.id);
  if (!match) return;

  // Matches are group business: only members of the owning group can read one,
  // whether or not they are on its roster.
  const group = groupOf(req.user.id);
  const onRoster = db.prepare('SELECT 1 FROM match_participants WHERE match_id = ? AND user_id = ?')
    .get(match.id, req.user.id);
  if ((!group || group.id !== match.group_id) && !onRoster) {
    return res.status(403).json({ error: 'This match belongs to another group' });
  }

  res.json({ match: matchPayload(match) });
});

module.exports = router;
