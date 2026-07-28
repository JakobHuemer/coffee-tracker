// HTTP-level tests for the global leaderboard (routes/rankings.js).
//
// The board is an Elo ladder (issue #40): rating is the sort key, cups/caffeine
// are display columns only, and an unrated player never outranks an active one.
// A router mounted on a real server and driven with fetch — no supertest.

import { test, expect, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-rankings-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);

const app = express();
app.use(express.json());
app.use('/api/rankings', require('./routes/rankings'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  db.exec(`
    DELETE FROM match_participants;
    DELETE FROM matches;
    DELETE FROM group_members;
    DELETE FROM competition_groups;
    DELETE FROM user_ratings;
    DELETE FROM user_badges;
    DELETE FROM coffee_entries;
    DELETE FROM users;
  `);
});

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

function setRating(userId, rating, matches) {
  db.prepare('INSERT INTO user_ratings (user_id, rating, matches, updated_at) VALUES (?, ?, ?, ?)')
    .run(userId, rating, matches, Date.now());
}

function logCoffee(userId, mg) {
  db.prepare('INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, 'espresso', mg, Date.now());
}

function badgesFor(userId) {
  return db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?')
    .all(userId).map((r) => r.badge_id).sort();
}

async function rankings(user) {
  const res = await fetch(`${base}/api/rankings?period=alltime`, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  return (await res.json()).rankings;
}

test('the board sorts by Elo, not by caffeine', async () => {
  const low = makeUser('low-elo-heavy-drinker');
  const high = makeUser('high-elo-light-drinker');
  setRating(low.id, 900, 5);
  setRating(high.id, 1100, 5);
  // The caffeine ordering is the opposite of the Elo ordering on purpose.
  logCoffee(low.id, 5000);
  logCoffee(high.id, 50);

  const board = await rankings(low);
  expect(board.map((r) => r.username)).toEqual(['high-elo-light-drinker', 'low-elo-heavy-drinker']);
  // Caffeine still rides along as a display column.
  expect(board.find((r) => r.username === 'low-elo-heavy-drinker').total_caffeine).toBe(5000);
});

test('unrated players sort last, whatever their default rating', async () => {
  const active = makeUser('active');
  const idle = makeUser('idle');
  // `active` sits BELOW the 1000 default but has played; `idle` has no matches.
  setRating(active.id, 950, 3);
  // `idle` gets no user_ratings row at all → COALESCE gives the 1000 default.

  const board = await rankings(active);
  expect(board.map((r) => r.username)).toEqual(['active', 'idle']);
  expect(board[0]).toMatchObject({ rank: 1, matches: 3 });
  expect(board[1]).toMatchObject({ rank: 2, matches: 0, rating: require('./competition-core').BASE_RATING });
});

test('each row carries the player\'s group, or null', async () => {
  const a = makeUser('grouped');
  const b = makeUser('loner');
  setRating(a.id, 1050, 2);
  setRating(b.id, 1020, 2);

  const gid = randomUUID();
  db.prepare(`
    INSERT INTO competition_groups (id, name, description, owner_id, timezone, is_public, join_code, created_at)
    VALUES (?, 'Bean Team', NULL, ?, 'UTC', 1, 'ABC123', ?)
  `).run(gid, a.id, Date.now());
  db.prepare('INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), gid, a.id, Date.now());

  const board = await rankings(a);
  expect(board.find((r) => r.username === 'grouped').group_name).toBe('Bean Team');
  expect(board.find((r) => r.username === 'loner').group_name).toBeNull();
});

// The three standing #1 badges each go to a DIFFERENT board's leader, so the
// scenario deliberately makes the Elo, caffeine and cups winners three separate
// people — proving each metric is scored on its own board, not piggy-backing.
test('the #1 badges go to each board\'s leader (Elo/caffeine/cups)', async () => {
  const brewer = makeUser('elo-leader');
  const addict = makeUser('caffeine-leader');
  const collector = makeUser('cups-leader');

  setRating(brewer.id, 1200, 5);   // tops the Elo ladder
  setRating(addict.id, 1000, 2);
  setRating(collector.id, 900, 2);

  logCoffee(brewer.id, 10);        // 1 cup, 10mg
  logCoffee(addict.id, 5000);      // 1 cup, most caffeine
  for (let i = 0; i < 10; i++) logCoffee(collector.id, 1); // 10 cups, most cups

  await rankings(brewer); // the all-time fetch triggers the award pass

  expect(badgesFor(brewer.id)).toEqual(['rank_1']);
  expect(badgesFor(addict.id)).toEqual(['addicted']);
  expect(badgesFor(collector.id)).toEqual(['decorated']);
});

// An Elo board where nobody has settled a match must not crown the default-rated
// field. Caffeine/cups still have a real leader and are awarded.
test('Top Brewer is not awarded on an Elo board with no settled matches', async () => {
  const a = makeUser('only-drinker');
  // No user_ratings row → unrated. Still the caffeine and cups leader by default.
  logCoffee(a.id, 100);

  await rankings(a);

  expect(badgesFor(a.id)).toEqual(['addicted', 'decorated']);
});
