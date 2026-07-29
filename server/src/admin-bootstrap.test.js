// Unit tests for the startup admin bootstrap (admin-bootstrap.js).

import { test, expect, beforeEach, afterEach } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-bootstrap-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);
const { promoteBootstrapAdmin } = require('./admin-bootstrap');

beforeEach(() => {
  db.exec('DELETE FROM users;');
  delete process.env.ADMIN_USERNAME;
});
afterEach(() => {
  delete process.env.ADMIN_USERNAME;
});

// tier: 'super' | 'admin' | undefined
function makeUser(username, tier) {
  const id = randomUUID();
  const isAdmin = tier === 'super' || tier === 'admin' ? 1 : 0;
  const isSuper = tier === 'super' ? 1 : 0;
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone, is_admin, is_super_admin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC', isAdmin, isSuper);
  return id;
}
const row = (id) => db.prepare('SELECT is_admin, is_super_admin FROM users WHERE id = ?').get(id);

test('promotes an existing ADMIN_USERNAME to protected super admin', () => {
  const id = makeUser('boss');
  process.env.ADMIN_USERNAME = 'boss';
  promoteBootstrapAdmin(db);
  expect(row(id)).toEqual({ is_admin: 1, is_super_admin: 1 });
});

test('no-op when the named user does not exist', () => {
  process.env.ADMIN_USERNAME = 'ghost';
  // Must not throw and must not create anyone.
  promoteBootstrapAdmin(db);
  expect(db.prepare('SELECT COUNT(*) AS c FROM users').get().c).toBe(0);
});

test('no-op when ADMIN_USERNAME is unset', () => {
  const id = makeUser('boss');
  promoteBootstrapAdmin(db);
  expect(row(id)).toEqual({ is_admin: 0, is_super_admin: 0 });
});

test('leaves an already-protected admin protected (idempotent)', () => {
  const id = makeUser('boss', 'super');
  process.env.ADMIN_USERNAME = 'boss';
  promoteBootstrapAdmin(db);
  expect(row(id)).toEqual({ is_admin: 1, is_super_admin: 1 });
});

test('moves protection to the current ADMIN_USERNAME, demoting the old super admin to a regular admin', () => {
  const oldBoss = makeUser('oldboss', 'super');
  const newBoss = makeUser('newboss', 'admin');
  process.env.ADMIN_USERNAME = 'newboss';
  promoteBootstrapAdmin(db);
  expect(row(newBoss)).toEqual({ is_admin: 1, is_super_admin: 1 });
  // The previous super admin keeps admin, but loses the protected flag.
  expect(row(oldBoss)).toEqual({ is_admin: 1, is_super_admin: 0 });
});
