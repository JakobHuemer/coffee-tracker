// HTTP-level tests for the Web Push subscription API (routes/push.js, issue
// #87). Same harness as the other routes.*.test.js: a router mounted on a real
// express server, driven with fetch, no supertest.
//
// Push is enabled here by init()'ing with a generated VAPID pair BEFORE the
// router is required, so /subscribe accepts rather than 503s. The actual push
// send/prune fan-out is covered in push.test.js; this file covers the address-
// book surface: auth, per-caller scoping, upsert, validation, unsubscribe, and
// the vapid-public-key bootstrap.

import { test, expect, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const webpush = require('web-push');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-push-test-'));
process.env.JWT_SECRET = 'test-secret';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

const db = require('./db');
require('./migrate')(db);
require('./push').init(); // arm push before the router reads isEnabled()

const app = express();
app.use(express.json());
app.use('/api/push', require('./routes/push'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

afterAll(() => server.close());

beforeEach(() => {
  db.exec('DELETE FROM push_subscriptions; DELETE FROM users;');
});

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
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

const sub = (endpoint) => ({ endpoint, keys: { p256dh: 'pub-key', auth: 'auth-secret' } });

test('unauthenticated calls are refused', async () => {
  expect((await get(null, '/api/push/vapid-public-key')).status).toBe(401);
  expect((await post(null, '/api/push/subscribe', sub('https://push/x'))).status).toBe(401);
  expect((await post(null, '/api/push/unsubscribe', { endpoint: 'x' })).status).toBe(401);
});

test('vapid-public-key reports enabled + the public key', async () => {
  const a = makeUser('a');
  const res = await get(a, '/api/push/vapid-public-key');
  expect(res.status).toBe(200);
  expect(res.body.enabled).toBe(true);
  expect(res.body.key).toBe(keys.publicKey);
});

test('subscribe stores the caller\'s subscription', async () => {
  const a = makeUser('a');
  const res = await post(a, '/api/push/subscribe', sub('https://push/a1'));
  expect(res.status).toBe(200);

  const rows = db.prepare('SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions').all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ user_id: a.id, endpoint: 'https://push/a1', p256dh: 'pub-key', auth: 'auth-secret' });
});

test('subscribe upserts on a repeat endpoint rather than duplicating', async () => {
  const a = makeUser('a');
  await post(a, '/api/push/subscribe', sub('https://push/same'));
  await post(a, '/api/push/subscribe', { endpoint: 'https://push/same', keys: { p256dh: 'new-pub', auth: 'new-auth' } });

  const rows = db.prepare('SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = ?').all('https://push/same');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ p256dh: 'new-pub', auth: 'new-auth' });
});

test('a re-subscribe from another account takes over the endpoint (unique)', async () => {
  const a = makeUser('a');
  const b = makeUser('b');
  await post(a, '/api/push/subscribe', sub('https://push/device'));
  await post(b, '/api/push/subscribe', sub('https://push/device'));

  const rows = db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').all('https://push/device');
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(b.id);
});

test('subscribe rejects a malformed body', async () => {
  const a = makeUser('a');
  expect((await post(a, '/api/push/subscribe', { endpoint: 'x' })).status).toBe(400);           // no keys
  expect((await post(a, '/api/push/subscribe', { keys: { p256dh: 'p', auth: 'a' } })).status).toBe(400); // no endpoint
  expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n).toBe(0);
});

test('unsubscribe removes only the caller\'s own endpoint', async () => {
  const a = makeUser('a');
  const b = makeUser('b');
  await post(a, '/api/push/subscribe', sub('https://push/a'));
  await post(b, '/api/push/subscribe', sub('https://push/b'));

  // A cannot delete B's endpoint even by naming it.
  await post(a, '/api/push/unsubscribe', { endpoint: 'https://push/b' });
  expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n).toBe(2);

  await post(a, '/api/push/unsubscribe', { endpoint: 'https://push/a' });
  const rows = db.prepare('SELECT endpoint FROM push_subscriptions').all();
  expect(rows.map((r) => r.endpoint)).toEqual(['https://push/b']);
});

test('unsubscribe rejects a missing endpoint', async () => {
  const a = makeUser('a');
  expect((await post(a, '/api/push/unsubscribe', {})).status).toBe(400);
});
