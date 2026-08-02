// HTTP-level tests for the notification feed (routes/notifications.js, issue
// #32). Rows are written directly here rather than through the emit sites — the
// emit is covered by the module tests in competitions.test.js and
// achievements' own path. This file covers the read surface: auth, per-caller
// scoping, the unread filter, marking read, and keyset paging.
//
// No supertest: a router mounted on a real express server and driven with fetch
// (rule 5 — Bun everywhere, nothing extra).

import { test, expect, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-notif-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);

const app = express();
app.use(express.json());
app.use('/api/notifications', require('./routes/notifications'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

afterAll(() => server.close());

beforeEach(() => {
  db.exec('DELETE FROM notifications; DELETE FROM users;');
});

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

// Insert a notification straight into the table so a test can control its
// created_at (for paging) and read state without going through an emit site.
function seed(userId, { type = 'achievement', payload = { id: 'x', name: 'X', icon: 'star', description: 'd' }, read_at = null, created_at = Date.now() } = {}) {
  const id = randomUUID();
  db.prepare('INSERT INTO notifications (id, user_id, type, payload, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, type, JSON.stringify(payload), read_at, created_at);
  return id;
}

async function call(user, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user ? { authorization: `Bearer ${user.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}
const get = (u, url) => call(u, 'GET', url);
const post = (u, url, body) => call(u, 'POST', url, body ?? {});

test('unauthenticated calls are refused', async () => {
  expect((await get(null, '/api/notifications')).status).toBe(401);
  expect((await post(null, '/api/notifications/read', { all: true })).status).toBe(401);
});

test('list is scoped to the caller — A never sees B', async () => {
  const a = makeUser('a');
  const b = makeUser('b');
  seed(a.id, { payload: { id: 'a1', name: 'A1', icon: 'star', description: 'd' } });
  seed(b.id, { payload: { id: 'b1', name: 'B1', icon: 'star', description: 'd' } });

  const res = await get(a, '/api/notifications');
  expect(res.status).toBe(200);
  expect(res.body.notifications).toHaveLength(1);
  expect(res.body.notifications[0].payload.id).toBe('a1');
  expect(res.body.unread_count).toBe(1);
});

test('payload is returned parsed, newest first', async () => {
  const a = makeUser('a');
  seed(a.id, { created_at: 1000, payload: { id: 'old', name: 'Old', icon: 'star', description: 'd' } });
  seed(a.id, { created_at: 2000, payload: { id: 'new', name: 'New', icon: 'star', description: 'd' } });

  const res = await get(a, '/api/notifications');
  expect(res.body.notifications.map((n) => n.payload.id)).toEqual(['new', 'old']);
  expect(typeof res.body.notifications[0].payload).toBe('object');
});

test('unread=1 returns only unread rows; unread_count is total unread', async () => {
  const a = makeUser('a');
  seed(a.id, { read_at: Date.now() });
  seed(a.id, { read_at: null });
  seed(a.id, { read_at: null });

  const all = await get(a, '/api/notifications');
  expect(all.body.notifications).toHaveLength(3);
  expect(all.body.unread_count).toBe(2);

  const unread = await get(a, '/api/notifications?unread=1');
  expect(unread.body.notifications).toHaveLength(2);
  expect(unread.body.unread_count).toBe(2);
});

test('read by ids marks only those rows and drops unread_count', async () => {
  const a = makeUser('a');
  const one = seed(a.id, { read_at: null });
  seed(a.id, { read_at: null });

  const res = await post(a, '/api/notifications/read', { ids: [one] });
  expect(res.status).toBe(200);
  expect(res.body.unread_count).toBe(1);

  const still = db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(one);
  expect(still.read_at).not.toBeNull();
});

test('read all clears every unread row for the caller only', async () => {
  const a = makeUser('a');
  const b = makeUser('b');
  seed(a.id, { read_at: null });
  seed(a.id, { read_at: null });
  const bUnread = seed(b.id, { read_at: null });

  const res = await post(a, '/api/notifications/read', { all: true });
  expect(res.body.unread_count).toBe(0);
  expect(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(bUnread).read_at).toBeNull();
});

test('limit caps the page and before pages older rows via the keyset cursor', async () => {
  const a = makeUser('a');
  for (let i = 1; i <= 5; i++) seed(a.id, { created_at: i * 1000, payload: { id: `n${i}`, name: 'N', icon: 'star', description: 'd' } });

  const page1 = await get(a, '/api/notifications?limit=2');
  expect(page1.body.notifications.map((n) => n.payload.id)).toEqual(['n5', 'n4']);

  const page2 = await get(a, '/api/notifications?limit=2&before=4000');
  expect(page2.body.notifications.map((n) => n.payload.id)).toEqual(['n3', 'n2']);
});
