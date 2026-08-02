// The unlock → notification bridge (issue #32). unlockAchievement /
// unlockBadge are the only two unlock write points, so emitting from them
// covers every caller. These tests pin the two properties that matter: an
// unlock writes exactly one notification, and a DUPLICATE unlock writes none
// (the unlock functions return null before inserting on a re-check, so no
// second row can be created).

import { test, expect, beforeEach } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-ach-notif-test-'));

const db = require('./db');
require('./migrate')(db);
const { unlockAchievement, unlockBadge } = require('./achievements');

beforeEach(() => {
  db.exec(`
    DELETE FROM notifications;
    DELETE FROM user_achievements;
    DELETE FROM user_badges;
    DELETE FROM users;
  `);
});

function makeUser() {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, `u-${id.slice(0, 8)}`, 'x', Date.now(), 'UTC');
  return id;
}

const notifs = (userId, type) =>
  db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ?').all(userId, type)
    .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));

test('unlocking an achievement writes one achievement notification with the def embedded', () => {
  const u = makeUser();
  unlockAchievement(u, 'first_sip');

  const rows = notifs(u, 'achievement');
  expect(rows).toHaveLength(1);
  // The payload is self-contained: id AND name/icon/description, no fetch.
  expect(rows[0].payload).toMatchObject({ id: 'first_sip', name: 'First Sip' });
  expect(typeof rows[0].payload.icon).toBe('string');
  expect(typeof rows[0].payload.description).toBe('string');
  expect(rows[0].read_at).toBeNull();
});

test('a second identical unlock writes no new notification row', () => {
  const u = makeUser();
  unlockAchievement(u, 'first_sip');
  const after1 = notifs(u, 'achievement').length;

  expect(unlockAchievement(u, 'first_sip')).toBeNull(); // duplicate: no-op
  expect(notifs(u, 'achievement').length).toBe(after1);
});

test('unlocking a badge writes one badge notification; a duplicate writes none', () => {
  const u = makeUser();
  unlockBadge(u, 'coffee_rookie');
  expect(notifs(u, 'badge')).toHaveLength(1);
  expect(notifs(u, 'badge')[0].payload).toMatchObject({ id: 'coffee_rookie' });

  expect(unlockBadge(u, 'coffee_rookie')).toBeNull();
  expect(notifs(u, 'badge')).toHaveLength(1);
});
