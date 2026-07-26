// Competitions — everything that touches SQLite. The math lives in
// ./competition-core.js and never imports the database.
//
// Responsibilities:
//   - work out a group's civil day / week window (in the GROUP's zone)
//   - open the recurring daily/weekly matches for each group
//   - lock user-created lobbies when their start instant arrives
//   - settle any match whose window has closed, writing an immutable
//     match_participants row per player and updating the rating cache
//
// Nothing here recomputes a settled match. Settlement writes once.

const { randomUUID } = require('crypto');
const db = require('./db');
const {
  BASE_RATING, K_BY_MODE,
  performanceScore, settleFfa, settleTeams,
} = require('./competition-core');
const { localDateStr, localWallInstant, localDayBounds, isValidTz, DEFAULT_TZ } = require('./time');

// How often the ticker looks for work. A match settles on the first tick after
// its window closes, so this is also the worst-case settlement lag.
const TICK_MS = 60 * 1000;

// ── civil windows (group zone) ───────────────────────────────────────────────

function groupTz(group) {
  return isValidTz(group.timezone) ? group.timezone : DEFAULT_TZ;
}

// Local date of the Monday that starts the local week containing `dateStr`.
// Pure label arithmetic (parsed as UTC), so no zone is involved — a calendar
// date's weekday is the same wherever you evaluate it.
function mondayOf(dateStr) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return new Date(t - back * 86400000).toISOString().slice(0, 10);
}

function addDaysStr(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// The current daily window for a group: { periodKey, start, end }.
function dailyWindow(group, now = Date.now()) {
  const tz = groupTz(group);
  const date = localDateStr(now, tz);
  const { start, end } = localDayBounds(date, tz);
  return { periodKey: date, start, end };
}

// The current weekly window for a group, Monday-anchored in the group's zone.
function weeklyWindow(group, now = Date.now()) {
  const tz = groupTz(group);
  const monday = mondayOf(localDateStr(now, tz));
  const start = localWallInstant(monday, '00:00:00', tz);
  const end = localWallInstant(addDaysStr(monday, 7), '00:00:00', tz) - 1;
  return { periodKey: monday, start, end };
}

// ── layer 1: score a user over a window ──────────────────────────────────────

const metricsStmt = () => db.prepare(`
  SELECT COALESCE(SUM(caffeine_mg), 0) AS caffeine,
         COUNT(*)                      AS cups,
         COUNT(DISTINCT coffee_id)     AS variety
  FROM coffee_entries
  WHERE user_id = ? AND logged_at >= ? AND logged_at <= ?
`);

// Raw metrics a user accumulated inside a match window.
function metricsFor(userId, start, end) {
  return metricsStmt().get(userId, start, end);
}

// The 0..1 performance score a user earned inside a match window.
function scoreFor(userId, start, end) {
  return performanceScore(metricsFor(userId, start, end));
}

// ── rating cache ─────────────────────────────────────────────────────────────

function ratingOf(userId) {
  const row = db.prepare('SELECT rating FROM user_ratings WHERE user_id = ?').get(userId);
  return row ? row.rating : BASE_RATING;
}

function writeRating(userId, rating, now) {
  db.prepare(`
    INSERT INTO user_ratings (user_id, rating, matches, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      rating = excluded.rating,
      matches = user_ratings.matches + 1,
      updated_at = excluded.updated_at
  `).run(userId, rating, now);
}

// ── creating the recurring matches ───────────────────────────────────────────

// The group a user belongs to, or null. Membership is exclusive — the
// UNIQUE on group_members.user_id means this is always at most one row.
function groupOf(userId) {
  return db.prepare(`
    SELECT g.* FROM competition_groups g
    JOIN group_members m ON m.group_id = g.id
    WHERE m.user_id = ?
  `).get(userId);
}

function memberIds(groupId) {
  return db.prepare('SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at')
    .all(groupId).map((r) => r.user_id);
}

// Open one recurring match if it does not already exist for this period. The
// roster is the group's membership at creation time and is then fixed: someone
// who joins the group mid-window plays from the next window, and someone who
// leaves still finishes the match they were already in (no dodging a bad day).
//
// A group with fewer than two members gets no match at all — a solo match is a
// mathematical no-op (every delta is 0) and would only add empty rows.
function ensureRecurringMatch(group, mode, now) {
  const { periodKey, start, end } = mode === 'daily'
    ? dailyWindow(group, now)
    : weeklyWindow(group, now);

  const existing = db.prepare(
    'SELECT id FROM matches WHERE group_id = ? AND mode = ? AND period_key = ?'
  ).get(group.id, mode, periodKey);
  if (existing) return null;

  const members = memberIds(group.id);
  if (members.length < 2) return null;

  const matchId = randomUUID();
  const insertMatch = db.prepare(`
    INSERT INTO matches (id, group_id, mode, period_key, title, creator_id,
                         scope_start, scope_end, state, k_factor, team_size, created_at)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'pending', ?, NULL, ?)
  `);
  const insertParticipant = db.prepare(
    'INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, NULL, ?)'
  );

  db.transaction(() => {
    insertMatch.run(matchId, group.id, mode, periodKey, start, end, K_BY_MODE[mode], now);
    for (const userId of members) insertParticipant.run(randomUUID(), matchId, userId, now);
  })();

  return matchId;
}

function ensureRecurringMatches(now = Date.now()) {
  const groups = db.prepare('SELECT id, timezone FROM competition_groups').all();
  for (const group of groups) {
    ensureRecurringMatch(group, 'daily', now);
    ensureRecurringMatch(group, 'weekly', now);
  }
}

// ── locking lobbies ──────────────────────────────────────────────────────────

// A user-created match accepts joins until its start instant. At that point the
// roster must be legal for its mode, or the match is cancelled without touching
// anyone's rating.
function rosterIsLegal(match, participants) {
  if (match.mode === '1v1') return participants.length === 2;
  if (match.mode === 'team') {
    const a = participants.filter((p) => p.side === 'A').length;
    const b = participants.filter((p) => p.side === 'B').length;
    return a === match.team_size && b === match.team_size;
  }
  return participants.length >= 2; // ondemand free-for-all
}

function lockDueLobbies(now = Date.now()) {
  const due = db.prepare("SELECT * FROM matches WHERE state = 'open' AND scope_start <= ?").all(now);
  for (const match of due) {
    const participants = db.prepare('SELECT user_id, side FROM match_participants WHERE match_id = ?')
      .all(match.id);
    const nextState = rosterIsLegal(match, participants) ? 'pending' : 'cancelled';
    db.prepare('UPDATE matches SET state = ?, settled_at = ? WHERE id = ?')
      .run(nextState, nextState === 'cancelled' ? now : null, match.id);
  }
}

// ── settlement ───────────────────────────────────────────────────────────────

function cancel(matchId, now) {
  db.prepare("UPDATE matches SET state = 'cancelled', settled_at = ? WHERE id = ?").run(now, matchId);
}

// Settle one match: score every participant over the match window, run the
// mode's settlement, and write the result. The whole thing is one transaction,
// so a crash mid-settlement leaves the match pending and it settles cleanly on
// the next tick rather than half-applying deltas to the rating cache.
function settleMatch(match, now = Date.now()) {
  const rows = db.prepare(
    'SELECT user_id, side FROM match_participants WHERE match_id = ? ORDER BY joined_at'
  ).all(match.id);

  const players = rows.map((r) => ({
    userId: r.user_id,
    side: r.side,
    rating: ratingOf(r.user_id),
    score: scoreFor(r.user_id, match.scope_start, match.scope_end),
  }));

  let results;
  if (match.mode === 'team') {
    const a = players.filter((p) => p.side === 'A');
    const b = players.filter((p) => p.side === 'B');
    if (a.length < 2 || b.length < 2) return cancel(match.id, now);
    results = settleTeams(a, b, match.k_factor);
  } else {
    if (players.length < 2) return cancel(match.id, now);
    results = settleFfa(players, match.k_factor);
  }

  const scoreByUser = new Map(players.map((p) => [p.userId, p.score]));
  const updateParticipant = db.prepare(`
    UPDATE match_participants
    SET score = ?, contribution_share = ?, rating_before = ?, rating_after = ?, delta = ?
    WHERE match_id = ? AND user_id = ?
  `);

  db.transaction(() => {
    for (const r of results) {
      updateParticipant.run(
        scoreByUser.get(r.userId), r.share ?? null,
        r.ratingBefore, r.ratingAfter, r.delta,
        match.id, r.userId,
      );
      writeRating(r.userId, r.ratingAfter, now);
    }
    db.prepare("UPDATE matches SET state = 'settled', settled_at = ? WHERE id = ?").run(now, match.id);
  })();
}

function settleDueMatches(now = Date.now()) {
  const due = db.prepare("SELECT * FROM matches WHERE state = 'pending' AND scope_end <= ?").all(now);
  for (const match of due) settleMatch(match, now);
  return due.length;
}

// ── the ticker ───────────────────────────────────────────────────────────────

// One pass: open what should exist, lock what has started, settle what has
// finished. Ordered so a window that opened and closed between two ticks (only
// possible for a very short user-created match) still gets locked before it is
// considered for settlement.
function tick(now = Date.now()) {
  ensureRecurringMatches(now);
  lockDueLobbies(now);
  settleDueMatches(now);
}

let timer = null;

// Runs one pass immediately so a restart catches up on anything that closed
// while the process was down, then every TICK_MS. unref'd: the ticker must
// never be the reason the process stays alive.
function startTicker() {
  if (timer) return timer;
  const safeTick = () => {
    try {
      tick();
    } catch (err) {
      // A bad match must not take the process down or stop the ticker; the next
      // pass retries it.
      console.error('competition tick failed:', err);
    }
  };
  safeTick();
  timer = setInterval(safeTick, TICK_MS);
  timer.unref();
  return timer;
}

function stopTicker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  TICK_MS,
  mondayOf, addDaysStr, dailyWindow, weeklyWindow, groupOf,
  metricsFor, scoreFor, ratingOf,
  ensureRecurringMatch, ensureRecurringMatches, rosterIsLegal, lockDueLobbies,
  settleMatch, settleDueMatches, tick, startTicker, stopTicker,
};
