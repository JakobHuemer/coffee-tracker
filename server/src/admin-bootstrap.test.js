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

function makeUser(username, admin = false) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC', admin ? 1 : 0);
  return id;
}

test('promotes an existing ADMIN_USERNAME', () => {
  const id = makeUser('boss');
  process.env.ADMIN_USERNAME = 'boss';
  promoteBootstrapAdmin(db);
  expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id).is_admin).toBe(1);
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
  expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id).is_admin).toBe(0);
});

test('leaves an already-admin user admin (idempotent)', () => {
  const id = makeUser('boss', true);
  process.env.ADMIN_USERNAME = 'boss';
  promoteBootstrapAdmin(db);
  expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id).is_admin).toBe(1);
});
