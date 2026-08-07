// Module tests for the Web Push sender (push.js, issue #87). Two concerns:
//
//  1. Config gate (init): no keys → disabled; a half pair → throws (fail fast,
//     VALUES.md #7); a valid pair → enabled with the public key exposed.
//  2. Delivery (sendToUser): fans out to every one of a user's subscriptions,
//     ships the frozen { id, type, payload }, swallows failures, and prunes a
//     subscription the push service reports as gone (404/410).
//
// The real web-push network call is replaced through push.__setSender, so this
// runs offline and deterministically.

import { test, expect, beforeEach, afterEach } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const webpush = require('web-push');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-push-mod-test-'));

const db = require('./db');
require('./migrate')(db);
const push = require('./push');

const keys = webpush.generateVAPIDKeys();
const VALID = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };

beforeEach(() => {
  db.exec('DELETE FROM push_subscriptions; DELETE FROM users;');
  push.init(VALID);           // re-arm after any config test disabled it
  push.__setSender();         // restore the real sender; send tests override it
});
afterEach(() => push.__setSender());

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return id;
}
function seedSub(userId, endpoint) {
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), userId, endpoint, 'p', 'a', Date.now());
}
// Let scheduled microtasks (the fan-out Promises and their .catch prune) settle.
const flush = () => new Promise((r) => setTimeout(r, 20));

// ── config gate ──────────────────────────────────────────────────────────────

test('no VAPID keys → push disabled (feature simply off)', () => {
  expect(push.init({})).toBe(false);
  expect(push.isEnabled()).toBe(false);
  expect(push.getPublicKey()).toBeNull();
});

test('a half-configured pair throws (fail fast)', () => {
  expect(() => push.init({ VAPID_PUBLIC_KEY: keys.publicKey })).toThrow(/half-configured/);
  expect(() => push.init({ VAPID_PRIVATE_KEY: keys.privateKey })).toThrow(/half-configured/);
});

test('an invalid key pair throws', () => {
  expect(() => push.init({ VAPID_PUBLIC_KEY: 'not-a-key', VAPID_PRIVATE_KEY: 'nope' })).toThrow();
});

test('a valid pair enables push and exposes the public key', () => {
  expect(push.init(VALID)).toBe(true);
  expect(push.isEnabled()).toBe(true);
  expect(push.getPublicKey()).toBe(keys.publicKey);
});

// ── delivery ─────────────────────────────────────────────────────────────────

test('sendToUser fans out to every subscription with the frozen payload', async () => {
  const u = makeUser('a');
  seedSub(u, 'https://push/one');
  seedSub(u, 'https://push/two');

  const calls = [];
  push.__setSender((subscription, payload) => { calls.push({ subscription, payload }); return Promise.resolve(); });

  push.sendToUser(u, { id: 'n1', type: 'achievement', payload: { name: 'First sip' } });
  await flush();

  expect(calls).toHaveLength(2);
  expect(calls.map((c) => c.subscription.endpoint).sort()).toEqual(['https://push/one', 'https://push/two']);
  expect(JSON.parse(calls[0].payload)).toEqual({ id: 'n1', type: 'achievement', payload: { name: 'First sip' } });
});

test('sendToUser is a no-op when push is disabled', async () => {
  const u = makeUser('a');
  seedSub(u, 'https://push/one');
  push.init({}); // disable

  let called = false;
  push.__setSender(() => { called = true; return Promise.resolve(); });
  push.sendToUser(u, { id: 'n', type: 'badge', payload: {} });
  await flush();

  expect(called).toBe(false);
});

test('a 410 Gone prunes that subscription; a live one is kept', async () => {
  const u = makeUser('a');
  seedSub(u, 'https://push/dead');
  seedSub(u, 'https://push/live');

  push.__setSender((subscription) => {
    if (subscription.endpoint === 'https://push/dead') {
      return Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }));
    }
    return Promise.resolve();
  });

  push.sendToUser(u, { id: 'n', type: 'badge', payload: {} });
  await flush();

  const rows = db.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?').all(u);
  expect(rows.map((r) => r.endpoint)).toEqual(['https://push/live']);
});

test('a transient send error does NOT prune the subscription', async () => {
  const u = makeUser('a');
  seedSub(u, 'https://push/flaky');

  push.__setSender(() => Promise.reject(Object.assign(new Error('boom'), { statusCode: 500 })));
  push.sendToUser(u, { id: 'n', type: 'badge', payload: {} });
  await flush();

  expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n).toBe(1);
});

test('sendToUser with no subscriptions does nothing and never throws', async () => {
  const u = makeUser('a');
  let called = false;
  push.__setSender(() => { called = true; return Promise.resolve(); });
  expect(() => push.sendToUser(u, { id: 'n', type: 'badge', payload: {} })).not.toThrow();
  await flush();
  expect(called).toBe(false);
});
