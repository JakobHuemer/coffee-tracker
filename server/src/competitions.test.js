import { test, expect, beforeEach } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

// Point the DB at a throwaway directory BEFORE ./db is first required, so this
// suite never touches the repo's real database.
process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-comp-test-'));

const db = require('./db');
require('./migrate')(db);

const {
  mondayOf, dailyWindow, weeklyWindow, groupOf, scoreFor, ratingOf,
  ensureRecurringMatch, ensureRecurringMatches, rosterIsLegal,
  lockDueLobbies, settleMatch, settleDueMatches, tick,
} = require('./competitions');
const { BASE_RATING, K_BY_MODE, performanceScore } = require('./competition-core');

const DAY = 86400000;

beforeEach(() => {
  // Order matters only for readability — the FK cascades would handle it.
  db.exec(`
    DELETE FROM match_participants;
    DELETE FROM matches;
    DELETE FROM group_members;
    DELETE FROM competition_groups;
    DELETE FROM user_ratings;
    DELETE FROM coffee_entries;
    DELETE FROM users;
  `);
});

function makeUser(username, timezone = 'UTC') {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), timezone);
  return id;
}

function makeGroup(timezone = 'UTC', userIds = []) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO competition_groups (id, name, description, owner_id, timezone, is_public, join_code, created_at)
    VALUES (?, ?, NULL, ?, ?, 1, ?, ?)
  `).run(id, `g-${id.slice(0, 8)}`, userIds[0] || null, timezone, id.slice(0, 6).toUpperCase(), Date.now());
  for (const userId of userIds) {
    db.prepare('INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), id, userId, Date.now());
  }
  return db.prepare('SELECT * FROM competition_groups WHERE id = ?').get(id);
}

function logCoffee(userId, at, { coffeeId = 'espresso', mg = 80 } = {}) {
  db.prepare('INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, coffeeId, mg, at);
}

function openMatch({ group, mode, start, end, teamSize = null, state = 'open', roster = [], periodKey = null }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO matches (id, group_id, mode, period_key, title, creator_id,
                         scope_start, scope_end, state, k_factor, team_size, created_at)
    VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
  `).run(id, group.id, mode, periodKey, start, end, state, K_BY_MODE[mode], teamSize, Date.now());
  for (const { userId, side = null } of roster) {
    db.prepare('INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, userId, side, Date.now());
  }
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
}

// What POST /competitions/:id/join does to the database. Recurring lobbies open
// empty now, so every settlement test has to put its players on the roster the
// same way a real player would.
function joinMatch(matchId, userIds, side = null) {
  for (const userId of [].concat(userIds)) {
    db.prepare('INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), matchId, userId, side, Date.now());
  }
}

const matchById = (id) => db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
const participants = (id) => db.prepare('SELECT * FROM match_participants WHERE match_id = ?').all(id);

// ── windows ──────────────────────────────────────────────────────────────────

test('mondayOf lands on the Monday of that week and is a fixed point on Mondays', () => {
  expect(mondayOf('2026-07-26')).toBe('2026-07-20'); // a Sunday -> previous Monday
  expect(mondayOf('2026-07-20')).toBe('2026-07-20');
  expect(mondayOf('2026-07-21')).toBe('2026-07-20');
  expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // across a year boundary
});

test('the daily window follows the GROUP zone, not the process zone', () => {
  // 2026-07-26T01:00Z is still 2026-07-25 in New York and already the 26th in
  // Vienna, so the two groups must be measuring different days at that instant.
  const at = Date.parse('2026-07-26T01:00:00Z');
  const vienna = dailyWindow({ timezone: 'Europe/Vienna' }, at);
  const newYork = dailyWindow({ timezone: 'America/New_York' }, at);

  expect(vienna.periodKey).toBe('2026-07-26');
  expect(newYork.periodKey).toBe('2026-07-25');
  expect(at).toBeGreaterThanOrEqual(vienna.start);
  expect(at).toBeLessThanOrEqual(vienna.end);
  expect(at).toBeGreaterThanOrEqual(newYork.start);
  expect(at).toBeLessThanOrEqual(newYork.end);
});

test('a daily window is exactly one day long and abuts the next one', () => {
  const at = Date.parse('2026-07-26T09:00:00Z');
  const w = dailyWindow({ timezone: 'Europe/Vienna' }, at);
  expect(w.end - w.start).toBe(DAY - 1);
  const next = dailyWindow({ timezone: 'Europe/Vienna' }, w.end + 1);
  expect(next.start).toBe(w.end + 1);
});

test('a spring-forward day is 23 hours, not 24 — the zone does the work', () => {
  // Europe/Vienna springs forward on 2026-03-29.
  const at = Date.parse('2026-03-29T12:00:00Z');
  const w = dailyWindow({ timezone: 'Europe/Vienna' }, at);
  expect(w.periodKey).toBe('2026-03-29');
  expect(w.end - w.start).toBe(23 * 3600000 - 1);
});

test('the weekly window covers seven local days from Monday', () => {
  const at = Date.parse('2026-07-23T12:00:00Z'); // a Thursday
  const w = weeklyWindow({ timezone: 'Europe/Vienna' }, at);
  expect(w.periodKey).toBe('2026-07-20');
  expect(w.end - w.start).toBe(7 * DAY - 1);
  expect(at).toBeGreaterThan(w.start);
  expect(at).toBeLessThan(w.end);
});

test('an invalid group zone falls back to UTC instead of throwing', () => {
  const w = dailyWindow({ timezone: 'Not/AZone' }, Date.parse('2026-07-26T01:00:00Z'));
  expect(w.periodKey).toBe('2026-07-26');
});

// ── scoring ──────────────────────────────────────────────────────────────────

test('score counts only entries inside the window', () => {
  const user = makeUser('scorer');
  const start = Date.parse('2026-07-26T00:00:00Z');
  const end = start + DAY - 1;

  logCoffee(user, start - 1);          // just before
  logCoffee(user, end + 1);            // just after
  expect(scoreFor(user, start, end)).toBe(0);

  // Neither drink appears in SCORE_CAFFEINE, so both score at their stored mg
  // and this stays a test about the window, not about scoring overrides.
  logCoffee(user, start, { mg: 200, coffeeId: 'espresso' });
  logCoffee(user, start + 3600000, { mg: 100, coffeeId: 'lungo' });
  expect(scoreFor(user, start, end))
    .toBeCloseTo(performanceScore({ caffeine: 300, cups: 2, variety: 2 }), 12);
});

test('an overridden drink scores its SCORE_CAFFEINE value, not its stored mg', () => {
  const user = makeUser('latte-drinker');
  const start = Date.parse('2026-07-26T00:00:00Z');
  const end = start + DAY - 1;

  // Stored at the catalog's displayed 63mg; both lattes must score as 25.
  logCoffee(user, start, { mg: 63, coffeeId: 'latte' });
  logCoffee(user, start + 3600000, { mg: 63, coffeeId: 'latte_macchiato' });
  expect(scoreFor(user, start, end))
    .toBeCloseTo(performanceScore({ caffeine: 50, cups: 2, variety: 2 }), 12);
});

test('a user with no entries at all scores zero, not NaN', () => {
  const user = makeUser('empty');
  expect(scoreFor(user, 0, Date.now())).toBe(0);
});

// ── recurring match creation ─────────────────────────────────────────────────

test('recurring matches open EMPTY — being in a group never enters you in one', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const now = Date.parse('2026-07-26T10:00:00Z');

  ensureRecurringMatches(now);
  ensureRecurringMatches(now); // second pass must not duplicate

  const rows = db.prepare('SELECT * FROM matches WHERE group_id = ?').all(group.id);
  expect(rows.length).toBe(2);
  expect(rows.map((m) => m.mode).sort()).toEqual(['daily', 'weekly']);
  for (const m of rows) {
    expect(m.state).toBe('open');            // a lobby, not a running match
    expect(participants(m.id).length).toBe(0); // nobody was placed on it
  }
  expect(rows.find((m) => m.mode === 'daily').k_factor).toBe(K_BY_MODE.daily);
  expect(rows.find((m) => m.mode === 'weekly').k_factor).toBe(K_BY_MODE.weekly);
});

test('the daily that opens is TOMORROW\'s, and it starts in the future', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const now = Date.parse('2026-07-26T10:00:00Z');

  ensureRecurringMatch(group, 'daily', now);
  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);

  expect(daily.period_key).toBe('2026-07-27');
  expect(daily.scope_start).toBeGreaterThan(now); // joinable for the rest of today
  expect(daily.scope_start).toBe(Date.parse('2026-07-27T00:00:00Z'));
});

test('the weekly opens exactly two days before it starts, not earlier', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);

  // Week of Mon 2026-07-27. The two-day lead only crosses a week boundary on
  // Sat/Sun; Mon-Fri it resolves to the week already under way, which is not a
  // match anyone can be opened into.
  ensureRecurringMatch(group, 'weekly', Date.parse('2026-07-24T10:00:00Z')); // Fri
  expect(db.prepare("SELECT period_key FROM matches WHERE group_id = ? AND mode = 'weekly'")
    .all(group.id).map((r) => r.period_key)).toEqual([]);

  ensureRecurringMatch(group, 'weekly', Date.parse('2026-07-25T10:00:00Z')); // Sat
  const keys = db.prepare("SELECT period_key FROM matches WHERE group_id = ? AND mode = 'weekly' ORDER BY period_key")
    .all(group.id).map((r) => r.period_key);
  expect(keys).toEqual(['2026-07-27']);

  const next = db.prepare("SELECT * FROM matches WHERE group_id = ? AND period_key = ?").get(group.id, '2026-07-27');
  expect(next.scope_start - Date.parse('2026-07-25T10:00:00Z')).toBeGreaterThan(DAY);
});

test('a group that reaches two members mid-week gets no weekly for the week already running', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const wed = Date.parse('2026-07-29T12:00:00Z');

  // Before the guard this opened the week of 2026-07-27 — a window that started
  // two days before the group existed. Empty it was cancelled on the next tick;
  // with auto-join members on the roster it went live and settled over days
  // nobody had been in the group for.
  ensureRecurringMatches(wed);
  expect(db.prepare("SELECT COUNT(*) AS c FROM matches WHERE group_id = ? AND mode = 'weekly'")
    .get(group.id).c).toBe(0);

  // The daily is unaffected: its one-day lead always lands on tomorrow.
  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  expect(daily.period_key).toBe('2026-07-30');
  expect(daily.scope_start).toBeGreaterThan(wed);
});

test('auto-join members never get rostered into a window that already started', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  db.prepare('UPDATE users SET auto_join_weekly = 1 WHERE id IN (?, ?)').run(a, b);
  const group = makeGroup('UTC', [a, b]);
  const wed = Date.parse('2026-07-29T12:00:00Z');

  tick(wed);
  expect(db.prepare("SELECT COUNT(*) AS c FROM matches WHERE group_id = ? AND mode = 'weekly'")
    .get(group.id).c).toBe(0);
  // Nothing settled, so no rating moved for a week they were not in the group for.
  expect(ratingOf(a)).toBe(BASE_RATING);
  expect(ratingOf(b)).toBe(BASE_RATING);
});

test('a solo group gets no match at all', () => {
  const a = makeUser('solo');
  const group = makeGroup('UTC', [a]);
  ensureRecurringMatches(Date.now());
  expect(db.prepare('SELECT COUNT(*) AS c FROM matches WHERE group_id = ?').get(group.id).c).toBe(0);
});

test('each day opens its own daily without touching the previous one', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);

  ensureRecurringMatch(group, 'daily', Date.parse('2026-07-26T10:00:00Z'));
  ensureRecurringMatch(group, 'daily', Date.parse('2026-07-27T10:00:00Z'));

  const keys = db.prepare("SELECT period_key FROM matches WHERE group_id = ? AND mode = 'daily' ORDER BY period_key")
    .all(group.id).map((r) => r.period_key);
  expect(keys).toEqual(['2026-07-27', '2026-07-28']);
});

test('only members who opted in are auto-joined, and only for that mode', () => {
  const optIn = makeUser('optin');
  const optOut = makeUser('optout');
  const weeklyOnly = makeUser('weeklyonly');
  const group = makeGroup('UTC', [optIn, optOut, weeklyOnly]);
  db.prepare('UPDATE users SET auto_join_daily = 1, auto_join_weekly = 1 WHERE id = ?').run(optIn);
  db.prepare('UPDATE users SET auto_join_weekly = 1 WHERE id = ?').run(weeklyOnly);

  const now = Date.parse('2026-07-25T10:00:00Z'); // Saturday: both modes open
  ensureRecurringMatches(now);

  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  const weekly = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'weekly'").get(group.id);

  expect(participants(daily.id).map((p) => p.user_id)).toEqual([optIn]);
  expect(participants(weekly.id).map((p) => p.user_id).sort()).toEqual([optIn, weeklyOnly].sort());
});

test('auto-join defaults to off for a brand-new user', () => {
  const u = makeUser('fresh');
  const row = db.prepare('SELECT auto_join_daily, auto_join_weekly FROM users WHERE id = ?').get(u);
  expect(row.auto_join_daily).toBe(0);
  expect(row.auto_join_weekly).toBe(0);
});

test('joining a lobby is what puts you on a roster', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const now = Date.parse('2026-07-26T10:00:00Z');
  ensureRecurringMatches(now);

  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  expect(participants(daily.id).length).toBe(0);

  db.prepare('INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, NULL, ?)')
    .run(randomUUID(), daily.id, a, now);
  expect(participants(daily.id).map((p) => p.user_id)).toEqual([a]);

  // One player is not a match: the lobby is cancelled at its start instant and
  // nobody's rating moves.
  lockDueLobbies(daily.scope_start);
  expect(matchById(daily.id).state).toBe('cancelled');
  expect(db.prepare('SELECT COUNT(*) AS c FROM user_ratings').get().c).toBe(0);
});

// ── lobbies ──────────────────────────────────────────────────────────────────

test('rosterIsLegal enforces each mode\'s shape', () => {
  expect(rosterIsLegal({ mode: '1v1' }, [{ side: null }, { side: null }])).toBe(true);
  expect(rosterIsLegal({ mode: '1v1' }, [{ side: null }])).toBe(false);
  expect(rosterIsLegal({ mode: 'ondemand' }, [{ side: null }, { side: null }, { side: null }])).toBe(true);
  expect(rosterIsLegal({ mode: 'ondemand' }, [{ side: null }])).toBe(false);
  const team = { mode: 'team', team_size: 2 };
  expect(rosterIsLegal(team, [{ side: 'A' }, { side: 'A' }, { side: 'B' }, { side: 'B' }])).toBe(true);
  expect(rosterIsLegal(team, [{ side: 'A' }, { side: 'A' }, { side: 'B' }])).toBe(false);
});

test('a lobby that filled goes live, one that did not is cancelled with no rating moved', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const start = Date.now() - 1000;

  const filled = openMatch({ group, mode: '1v1', start, end: start + DAY, roster: [{ userId: a }, { userId: b }] });
  const empty = openMatch({ group, mode: '1v1', start, end: start + DAY, roster: [{ userId: a }] });

  lockDueLobbies(Date.now());

  expect(matchById(filled.id).state).toBe('pending');
  expect(matchById(empty.id).state).toBe('cancelled');
  expect(db.prepare('SELECT COUNT(*) AS c FROM user_ratings').get().c).toBe(0);
});

test('a weekly stays open through its first day, then locks like anything else (issue #44)', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  // Monday 2026-07-20 UTC; window runs Mon 00:00 → Sun 23:59:59.999.
  const monday = Date.parse('2026-07-20T00:00:00Z');
  const weekly = openMatch({
    group, mode: 'weekly', periodKey: '2026-07-20',
    start: monday, end: monday + 7 * DAY - 1,
    roster: [{ userId: a }, { userId: b }],
  });

  // Midday on the first day: the window is running, but the lobby is NOT locked
  // — nobody joins a weekly at 00:00 Monday, so day one stays joinable.
  lockDueLobbies(monday + 12 * 3600000);
  expect(matchById(weekly.id).state).toBe('open');

  // A second before the first day ends it is still open...
  lockDueLobbies(Date.parse('2026-07-21T00:00:00Z') - 1);
  expect(matchById(weekly.id).state).toBe('open');

  // ...and at the next local midnight it locks like any other match.
  lockDueLobbies(Date.parse('2026-07-21T00:00:00Z'));
  expect(matchById(weekly.id).state).toBe('pending');
});

test('a daily still locks at its start instant, not a day later', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const monday = Date.parse('2026-07-20T00:00:00Z');
  const daily = openMatch({
    group, mode: 'daily', periodKey: '2026-07-20',
    start: monday, end: monday + DAY - 1,
    roster: [{ userId: a }, { userId: b }],
  });
  // A minute in, the daily is already locked — the first-day grace is weekly-only.
  lockDueLobbies(monday + 60000);
  expect(matchById(daily.id).state).toBe('pending');
});

test('period_key is what tells a recurring match from a user-created one', () => {
  // The leave route keys off exactly this to decide whether an emptied lobby
  // gets cancelled: a user-created one does, a group's daily does not (it
  // belongs to the group, so one player leaving must not deny everyone else
  // the match). That branch itself is HTTP-level and is covered by driving the
  // API, not here — this pins the invariant it depends on.
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  ensureRecurringMatches(Date.parse('2026-07-26T10:00:00Z'));

  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  expect(daily.period_key).not.toBeNull();

  const adhoc = openMatch({ group, mode: '1v1', start: Date.now() + DAY, end: Date.now() + 2 * DAY });
  expect(adhoc.period_key).toBeNull();
});

test('a lobby whose start is still ahead stays open', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const start = Date.now() + DAY;
  const m = openMatch({ group, mode: '1v1', start, end: start + DAY, roster: [{ userId: a }, { userId: b }] });
  lockDueLobbies(Date.now());
  expect(matchById(m.id).state).toBe('open');
});

// ── settlement ───────────────────────────────────────────────────────────────

test('settling a daily match moves rating from the idle player to the active one', () => {
  const a = makeUser('active');
  const b = makeUser('idle');
  const group = makeGroup('UTC', [a, b]);
  const now = Date.parse('2026-07-26T10:00:00Z');
  ensureRecurringMatches(now);

  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  joinMatch(daily.id, [a, b]);
  logCoffee(a, daily.scope_start + 3600000, { mg: 150 });

  settleMatch(daily, daily.scope_end + 1);

  const rows = participants(daily.id);
  const active = rows.find((r) => r.user_id === a);
  const idle = rows.find((r) => r.user_id === b);

  expect(matchById(daily.id).state).toBe('settled');
  expect(active.delta).toBeGreaterThan(0);
  expect(idle.delta).toBeLessThan(0);
  expect(active.delta + idle.delta).toBe(0);
  expect(active.rating_before).toBe(BASE_RATING);
  expect(active.rating_after).toBe(BASE_RATING + active.delta);
  expect(idle.score).toBe(0);

  // Whole points survive the round-trip through SQLite's REAL columns (#49).
  for (const r of rows) expect(Number.isInteger(r.delta)).toBe(true);
  expect(Number.isInteger(ratingOf(a))).toBe(true);

  expect(ratingOf(a)).toBe(active.rating_after);
  expect(ratingOf(b)).toBe(idle.rating_after);
  expect(db.prepare('SELECT matches FROM user_ratings WHERE user_id = ?').get(a).matches).toBe(1);
});

test('a settled match is never settled twice', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  // Mid-week on purpose: on a Sunday the daily and weekly windows close at the
  // same instant, which would make the "only one match was due" check vacuous.
  const now = Date.parse('2026-07-22T10:00:00Z');
  ensureRecurringMatches(now);
  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  joinMatch(daily.id, [a, b]);
  logCoffee(a, daily.scope_start + 1000, { mg: 150 });
  lockDueLobbies(daily.scope_start); // the lobby goes live before it can settle

  const after = daily.scope_end + 1;
  // Only the daily window has closed — the weekly one still has days to run.
  expect(settleDueMatches(after)).toBe(1);
  const ratingAfterFirst = ratingOf(a);

  expect(settleDueMatches(after + 1000)).toBe(0);
  expect(ratingOf(a)).toBe(ratingAfterFirst);
  expect(db.prepare('SELECT matches FROM user_ratings WHERE user_id = ?').get(a).matches).toBe(1);
});

test('the whole ticker pass is safe to run repeatedly', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  makeGroup('UTC', [a, b]);
  tick();
  tick();
  tick();
  const counts = db.prepare('SELECT mode, COUNT(*) AS c FROM matches GROUP BY mode').all();
  for (const row of counts) expect(row.c).toBe(1);
});

test('a team match settles zero-sum and records each member\'s contribution share', () => {
  const users = ['a1', 'a2', 'b1', 'b2'].map((n) => makeUser(n));
  const group = makeGroup('UTC', users);
  const start = Date.now() - DAY;
  const end = Date.now() - 1000;

  const match = openMatch({
    group, mode: 'team', start, end, teamSize: 2, state: 'pending',
    roster: [
      { userId: users[0], side: 'A' }, { userId: users[1], side: 'A' },
      { userId: users[2], side: 'B' }, { userId: users[3], side: 'B' },
    ],
  });

  logCoffee(users[0], start + 1000, { mg: 300, coffeeId: 'espresso' });
  logCoffee(users[0], start + 2000, { mg: 200, coffeeId: 'latte' });
  logCoffee(users[2], start + 1000, { mg: 50 });

  settleMatch(match, end + 1);

  const rows = participants(match.id);
  expect(matchById(match.id).state).toBe('settled');
  expect(rows.reduce((s, r) => s + r.delta, 0)).toBe(0);
  for (const r of rows) expect(r.contribution_share).toBeGreaterThan(0);
  for (const r of rows) expect(Number.isInteger(r.delta)).toBe(true);

  const carry = rows.find((r) => r.user_id === users[0]);
  const passenger = rows.find((r) => r.user_id === users[1]);
  expect(carry.delta).toBeGreaterThan(0);          // side A won
  expect(carry.delta).toBeGreaterThan(passenger.delta); // and carried it
});

test('a pending match that lost a side is cancelled rather than settled', () => {
  const users = ['a1', 'a2', 'b1'].map((n) => makeUser(n));
  const group = makeGroup('UTC', users);
  const start = Date.now() - DAY;
  const end = Date.now() - 1000;
  const match = openMatch({
    group, mode: 'team', start, end, teamSize: 2, state: 'pending',
    roster: [
      { userId: users[0], side: 'A' }, { userId: users[1], side: 'A' },
      { userId: users[2], side: 'B' },
    ],
  });

  settleMatch(match, end + 1);
  expect(matchById(match.id).state).toBe('cancelled');
  expect(db.prepare('SELECT COUNT(*) AS c FROM user_ratings').get().c).toBe(0);
});

test('ratings compound across matches — the second match starts from the first result', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);

  const runDay = (dayInstant) => {
    ensureRecurringMatch(group, 'daily', dayInstant);
    const m = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily' AND state = 'open' ORDER BY scope_start DESC")
      .get(group.id);
    joinMatch(m.id, [a, b]);
    logCoffee(a, m.scope_start + 1000, { mg: 150 });
    settleMatch(m, m.scope_end + 1);
    return m;
  };

  const first = runDay(Date.parse('2026-07-26T10:00:00Z'));
  const second = runDay(Date.parse('2026-07-27T10:00:00Z'));

  const p1 = participants(first.id).find((p) => p.user_id === a);
  const p2 = participants(second.id).find((p) => p.user_id === a);
  expect(p2.rating_before).toBe(p1.rating_after);
  expect(db.prepare('SELECT matches FROM user_ratings WHERE user_id = ?').get(a).matches).toBe(2);
});

test('groupOf returns the one group a user is in', () => {
  const a = makeUser('a');
  expect(groupOf(a)).toBeNull(); // bun:sqlite .get() misses as null, not undefined
  const group = makeGroup('UTC', [a]);
  expect(groupOf(a).id).toBe(group.id);
});
