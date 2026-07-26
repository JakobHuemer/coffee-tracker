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

// How far ahead a recurring match opens for joining. Both are lobbies: they
// exist before their window starts precisely so members have a period in which
// to join them, because nothing joins on a member's behalf.
const DAILY_LEAD_DAYS = 1;   // tomorrow's daily is joinable all of today
const WEEKLY_LEAD_DAYS = 2;  // next week's weekly opens on the Saturday before

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

// The daily window `offsetDays` from the group's current local day.
// offsetDays = 0 is today, 1 is tomorrow (the one that opens for joining).
function dailyWindow(group, now = Date.now(), offsetDays = 0) {
  const tz = groupTz(group);
  const date = addDaysStr(localDateStr(now, tz), offsetDays);
  const { start, end } = localDayBounds(date, tz);
  return { periodKey: date, start, end };
}

// The weekly window containing "now plus `offsetDays`", Monday-anchored in the
// group's zone. With the weekly lead time this rolls over to next week's match
// exactly `WEEKLY_LEAD_DAYS` before it starts.
function weeklyWindow(group, now = Date.now(), offsetDays = 0) {
  const tz = groupTz(group);
  const monday = mondayOf(addDaysStr(localDateStr(now, tz), offsetDays));
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

// Same thing for a whole roster, in ONE query instead of one per player.
// Rendering a match list means scoring every participant of every match, so the
// per-user form turns a page load into hundreds of round trips.
// Returns Map(userId -> score); users with no entries are absent, so read it
// with `?? 0`.
function scoresForMany(userIds, start, end) {
  if (userIds.length === 0) return new Map();
  const holes = userIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT user_id,
           COALESCE(SUM(caffeine_mg), 0) AS caffeine,
           COUNT(*)                      AS cups,
           COUNT(DISTINCT coffee_id)     AS variety
    FROM coffee_entries
    WHERE user_id IN (${holes}) AND logged_at >= ? AND logged_at <= ?
    GROUP BY user_id
  `).all(...userIds, start, end);
  return new Map(rows.map((r) => [r.user_id, performanceScore(r)]));
}

// Ratings for a whole roster in one query. Absent users are unrated, so read
// with `?? BASE_RATING`.
function ratingsForMany(userIds) {
  if (userIds.length === 0) return new Map();
  const holes = userIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT user_id, rating FROM user_ratings WHERE user_id IN (${holes})`)
    .all(...userIds);
  return new Map(rows.map((r) => [r.user_id, r.rating]));
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

// Members who asked to be entered into this mode's recurring matches without
// pressing join each time. Opt-in only: a member who has not set the flag is
// never placed on a roster by the server.
function autoJoinMemberIds(groupId, mode) {
  const column = mode === 'daily' ? 'auto_join_daily' : 'auto_join_weekly';
  return db.prepare(`
    SELECT m.user_id FROM group_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND u.${column} = 1
    ORDER BY m.joined_at
  `).all(groupId).map((r) => r.user_id);
}

// Open one recurring match if it does not already exist for this period.
//
// It opens as a LOBBY, ahead of its own window (a day early for daily, two for
// weekly), and starts EMPTY. Group membership does not put anyone on a roster:
// being in a group means you may join its matches, not that you are entered in
// all of them. The only exception is a member who explicitly turned on
// auto-join for this mode, which is what that preference means.
//
// Group size still gates creation: with fewer than two members nobody could
// field a legal roster by the start instant, so the lobby would only ever be
// cancelled.
function ensureRecurringMatch(group, mode, now) {
  const leadDays = mode === 'daily' ? DAILY_LEAD_DAYS : WEEKLY_LEAD_DAYS;
  const { periodKey, start, end } = mode === 'daily'
    ? dailyWindow(group, now, leadDays)
    : weeklyWindow(group, now, leadDays);

  const existing = db.prepare(
    'SELECT id FROM matches WHERE group_id = ? AND mode = ? AND period_key = ?'
  ).get(group.id, mode, periodKey);
  if (existing) return null;

  // Never open a period that is already under way. The lead time only lands on
  // a future window when it crosses a period boundary — weekly's two days do
  // that on Sat/Sun only, so Mon-Fri this asks for the CURRENT week. For a
  // group that already has the row that is a no-op (caught above), but a group
  // that crosses two members mid-week would otherwise get a match whose window
  // opened days before it existed: cancelled on the next tick at best, and at
  // worst settled over days nobody was in the group for.
  if (start <= now) return null;

  if (memberIds(group.id).length < 2) return null;

  const matchId = randomUUID();
  const insertMatch = db.prepare(`
    INSERT INTO matches (id, group_id, mode, period_key, title, creator_id,
                         scope_start, scope_end, state, k_factor, team_size, created_at)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'open', ?, NULL, ?)
  `);
  const insertParticipant = db.prepare(
    'INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, NULL, ?)'
  );

  db.transaction(() => {
    insertMatch.run(matchId, group.id, mode, periodKey, start, end, K_BY_MODE[mode], now);
    for (const userId of autoJoinMemberIds(group.id, mode)) {
      insertParticipant.run(randomUUID(), matchId, userId, now);
    }
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
  // ondemand, daily and weekly are free-for-alls: any two players make a match.
  // A recurring lobby nobody joined is cancelled by this, which is the intended
  // outcome — an empty day costs nobody any rating.
  return participants.length >= 2;
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
  TICK_MS, DAILY_LEAD_DAYS, WEEKLY_LEAD_DAYS,
  mondayOf, addDaysStr, dailyWindow, weeklyWindow, groupOf, autoJoinMemberIds,
  metricsFor, scoreFor, scoresForMany, ratingOf, ratingsForMany,
  ensureRecurringMatch, ensureRecurringMatches, rosterIsLegal, lockDueLobbies,
  settleMatch, settleDueMatches, tick, startTicker, stopTicker,
};
