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

function openMatch({ group, mode, start, end, teamSize = null, state = 'open', roster = [] }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO matches (id, group_id, mode, period_key, title, creator_id,
                         scope_start, scope_end, state, k_factor, team_size, created_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
  `).run(id, group.id, mode, start, end, state, K_BY_MODE[mode], teamSize, Date.now());
  for (const { userId, side = null } of roster) {
    db.prepare('INSERT INTO match_participants (id, match_id, user_id, side, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, userId, side, Date.now());
  }
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
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

  logCoffee(user, start, { mg: 200, coffeeId: 'espresso' });
  logCoffee(user, start + 3600000, { mg: 100, coffeeId: 'latte' });
  expect(scoreFor(user, start, end))
    .toBeCloseTo(performanceScore({ caffeine: 300, cups: 2, variety: 2 }), 12);
});

test('a user with no entries at all scores zero, not NaN', () => {
  const user = makeUser('empty');
  expect(scoreFor(user, 0, Date.now())).toBe(0);
});

// ── recurring match creation ─────────────────────────────────────────────────

test('a group of two gets one daily and one weekly match, and creation is idempotent', () => {
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
    expect(m.state).toBe('pending');
    expect(participants(m.id).length).toBe(2);
  }
  expect(rows.find((m) => m.mode === 'daily').k_factor).toBe(K_BY_MODE.daily);
  expect(rows.find((m) => m.mode === 'weekly').k_factor).toBe(K_BY_MODE.weekly);
});

test('a solo group gets no match at all', () => {
  const a = makeUser('solo');
  const group = makeGroup('UTC', [a]);
  ensureRecurringMatches(Date.now());
  expect(db.prepare('SELECT COUNT(*) AS c FROM matches WHERE group_id = ?').get(group.id).c).toBe(0);
});

test('a new day opens a new daily match without touching the old one', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);

  ensureRecurringMatch(group, 'daily', Date.parse('2026-07-26T10:00:00Z'));
  ensureRecurringMatch(group, 'daily', Date.parse('2026-07-27T10:00:00Z'));

  const keys = db.prepare("SELECT period_key FROM matches WHERE group_id = ? AND mode = 'daily' ORDER BY period_key")
    .all(group.id).map((r) => r.period_key);
  expect(keys).toEqual(['2026-07-26', '2026-07-27']);
});

test('the roster is frozen at creation — a later joiner plays from the next window', () => {
  const a = makeUser('a');
  const b = makeUser('b');
  const group = makeGroup('UTC', [a, b]);
  const now = Date.parse('2026-07-26T10:00:00Z');
  ensureRecurringMatches(now);

  const late = makeUser('late');
  db.prepare('INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), group.id, late, Date.now());
  ensureRecurringMatches(now); // same period — nothing new

  const daily = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily'").get(group.id);
  expect(participants(daily.id).map((p) => p.user_id).sort()).toEqual([a, b].sort());

  ensureRecurringMatches(now + DAY); // next day picks the newcomer up
  const tomorrow = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily' AND period_key = ?")
    .get(group.id, '2026-07-27');
  expect(participants(tomorrow.id).length).toBe(3);
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
  logCoffee(a, daily.scope_start + 3600000, { mg: 150 });

  settleMatch(daily, daily.scope_end + 1);

  const rows = participants(daily.id);
  const active = rows.find((r) => r.user_id === a);
  const idle = rows.find((r) => r.user_id === b);

  expect(matchById(daily.id).state).toBe('settled');
  expect(active.delta).toBeGreaterThan(0);
  expect(idle.delta).toBeLessThan(0);
  expect(active.delta + idle.delta).toBeCloseTo(0, 9);
  expect(active.rating_before).toBe(BASE_RATING);
  expect(active.rating_after).toBeCloseTo(BASE_RATING + active.delta, 9);
  expect(idle.score).toBe(0);

  expect(ratingOf(a)).toBeCloseTo(active.rating_after, 9);
  expect(ratingOf(b)).toBeCloseTo(idle.rating_after, 9);
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
  logCoffee(a, daily.scope_start + 1000, { mg: 150 });

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
  expect(rows.reduce((s, r) => s + r.delta, 0)).toBeCloseTo(0, 9);
  for (const r of rows) expect(r.contribution_share).toBeGreaterThan(0);

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
    const m = db.prepare("SELECT * FROM matches WHERE group_id = ? AND mode = 'daily' AND state = 'pending' ORDER BY scope_start DESC")
      .get(group.id);
    logCoffee(a, m.scope_start + 1000, { mg: 150 });
    settleMatch(m, m.scope_end + 1);
    return m;
  };

  const first = runDay(Date.parse('2026-07-26T10:00:00Z'));
  const second = runDay(Date.parse('2026-07-27T10:00:00Z'));

  const p1 = participants(first.id).find((p) => p.user_id === a);
  const p2 = participants(second.id).find((p) => p.user_id === a);
  expect(p2.rating_before).toBeCloseTo(p1.rating_after, 9);
  expect(db.prepare('SELECT matches FROM user_ratings WHERE user_id = ?').get(a).matches).toBe(2);
});

test('groupOf returns the one group a user is in', () => {
  const a = makeUser('a');
  expect(groupOf(a)).toBeNull(); // bun:sqlite .get() misses as null, not undefined
  const group = makeGroup('UTC', [a]);
  expect(groupOf(a).id).toBe(group.id);
});
