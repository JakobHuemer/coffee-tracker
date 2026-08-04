// HTTP-level tests for the public profile endpoint (routes/users.js, issue #73):
// auth, 404 on an unknown user, the `self` flag, resolved featured badges, and
// headline stats. Same harness as the other route tests — a router on a real
// express server driven with fetch (rule 5).

import { test, expect, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-users-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);

const app = express();
app.use(express.json());
app.use('/api/users', require('./routes/users'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

afterAll(() => server.close());

beforeEach(() => {
  db.exec('DELETE FROM coffee_entries; DELETE FROM user_badges; DELETE FROM users;');
});

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, avatar, created_at, timezone) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, 'x', '☕', Date.now(), 'UTC');
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

function unlockBadge(userId, badgeId) {
  db.prepare('INSERT INTO user_badges (id, user_id, badge_id, unlocked_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, badgeId, Date.now());
}

function logCoffee(userId, caffeine = 80) {
  db.prepare('INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, is_public) VALUES (?, ?, ?, ?, ?, 1)')
    .run(randomUUID(), userId, 'espresso', caffeine, Date.now());
}

async function get(user, url) {
  const res = await fetch(base + url, {
    headers: user ? { authorization: `Bearer ${user.token}` } : {},
  });
  return { status: res.status, body: await res.json() };
}

test('unauthenticated calls are refused', async () => {
  const alice = makeUser('alice');
  expect((await get(null, `/api/users/${alice.username}`)).status).toBe(401);
});

test('unknown username is a 404', async () => {
  const alice = makeUser('alice');
  const res = await get(alice, '/api/users/nobody');
  expect(res.status).toBe(404);
});

test('returns identity, stats and self=false for another user', async () => {
  const alice = makeUser('alice');
  const bob = makeUser('bob');
  logCoffee(bob.id, 80);
  logCoffee(bob.id, 120);

  const { status, body } = await get(alice, `/api/users/${bob.username}`);
  expect(status).toBe(200);
  expect(body.username).toBe('bob');
  expect(body.self).toBe(false);
  expect(body.created_at).toBeGreaterThan(0);
  expect(body.stats.total_cups).toBe(2);
  expect(body.stats.total_caffeine).toBe(200);
});

test('self flag is true when you view your own profile', async () => {
  const alice = makeUser('alice');
  const { body } = await get(alice, `/api/users/${alice.username}`);
  expect(body.self).toBe(true);
});

test('all earned badges show, ordered rarest first', async () => {
  const alice = makeUser('alice');
  const viewer = makeUser('viewer');
  // coffee_rookie is common, streak_god is epic — the epic must come first.
  unlockBadge(alice.id, 'coffee_rookie');
  unlockBadge(alice.id, 'streak_god');

  const { body } = await get(viewer, `/api/users/${alice.username}`);
  expect(body.badges).toHaveLength(2);
  expect(body.badges[0]).toMatchObject({ id: 'streak_god', rarity: 'epic' });
  expect(body.badges[1]).toMatchObject({ id: 'coffee_rookie', icon: 'seedling', rarity: 'common' });
});

test('a user with no badges gets an empty list', async () => {
  const alice = makeUser('alice');
  const viewer = makeUser('viewer');
  const { body } = await get(viewer, `/api/users/${alice.username}`);
  expect(body.badges).toEqual([]);
});

test('a secret the viewer has not earned keeps name + icon but hides how-to', async () => {
  const alice = makeUser('alice');
  const viewer = makeUser('viewer');
  unlockBadge(alice.id, 'night_owl_badge'); // rarity: secret
  const { body } = await get(viewer, `/api/users/${alice.username}`);
  expect(body.badges).toHaveLength(1);
  expect(body.badges[0].id).toBe('night_owl_badge');
  expect(body.badges[0].name).not.toBe('???'); // the real name is shown
  expect(body.badges[0].icon).not.toBe('lock'); // the real icon is shown
  expect(body.badges[0].description).toBe('');   // but the how-to is withheld
});

test('a secret the viewer also holds shows its description', async () => {
  const alice = makeUser('alice');
  const viewer = makeUser('viewer');
  unlockBadge(alice.id, 'night_owl_badge');
  unlockBadge(viewer.id, 'night_owl_badge');
  const { body } = await get(viewer, `/api/users/${alice.username}`);
  expect(body.badges[0].id).toBe('night_owl_badge');
  expect(body.badges[0].description).not.toBe('');
});

test('your own secret badges keep their description for you', async () => {
  const alice = makeUser('alice');
  unlockBadge(alice.id, 'night_owl_badge');
  const { body } = await get(alice, `/api/users/${alice.username}`);
  expect(body.self).toBe(true);
  expect(body.badges[0].description).not.toBe('');
});
