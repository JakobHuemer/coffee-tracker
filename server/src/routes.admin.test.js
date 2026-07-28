// HTTP-level tests for the admin routes (routes/admin.js).
//
// A router mounted on a real server and driven with fetch — no supertest,
// mirroring routes.rankings.test.js. requireAdmin reads is_admin live from the
// DB, so these tests set the flag directly and exercise the access control,
// password reset, promotion, and the last-admin guard.

import { test, expect, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-admin-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);

const app = express();
app.use(express.json());
app.use('/api/admin', require('./routes/admin'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  db.exec('DELETE FROM users;');
});

function makeUser(username, { admin = false, password = 'secret' } = {}) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, bcrypt.hashSync(password, 10), Date.now(), 'UTC', admin ? 1 : 0);
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

function req(method, pathname, token, body) {
  return fetch(`${base}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('non-admin is forbidden on every admin route', async () => {
  const admin = makeUser('boss', { admin: true });
  const plain = makeUser('nobody');

  const list = await req('GET', '/api/admin/users', plain.token);
  expect(list.status).toBe(403);

  const reset = await req('POST', `/api/admin/users/${admin.id}/reset-password`, plain.token, { password: 'x' });
  expect(reset.status).toBe(403);

  const promote = await req('POST', `/api/admin/users/${plain.id}/admin`, plain.token, { is_admin: true });
  expect(promote.status).toBe(403);
});

test('missing token is unauthorized', async () => {
  const res = await req('GET', '/api/admin/users', undefined);
  expect(res.status).toBe(401);
});

test('admin lists all users without password hashes', async () => {
  makeUser('boss', { admin: true });
  const admin = makeUser('boss2', { admin: true });
  makeUser('alice');

  const res = await req('GET', '/api/admin/users', admin.token);
  expect(res.status).toBe(200);
  const users = await res.json();
  expect(users.length).toBe(3);
  expect(users.map(u => u.username)).toEqual(['alice', 'boss', 'boss2']); // ordered
  expect(users.every(u => !('password_hash' in u))).toBe(true);
});

test('admin resets a user password to a new value', async () => {
  const admin = makeUser('boss', { admin: true });
  const alice = makeUser('alice', { password: 'old-pw' });

  const res = await req('POST', `/api/admin/users/${alice.id}/reset-password`, admin.token, { password: 'brand-new' });
  expect(res.status).toBe(200);

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(alice.id);
  expect(bcrypt.compareSync('brand-new', row.password_hash)).toBe(true);
  expect(bcrypt.compareSync('old-pw', row.password_hash)).toBe(false);
});

test('reset rejects an empty / oversized / non-string password', async () => {
  const admin = makeUser('boss', { admin: true });
  const alice = makeUser('alice');

  for (const password of ['', 'x'.repeat(73), 123, null]) {
    const res = await req('POST', `/api/admin/users/${alice.id}/reset-password`, admin.token, { password });
    expect(res.status).toBe(400);
  }
});

test('reset on an unknown user is 404', async () => {
  const admin = makeUser('boss', { admin: true });
  const res = await req('POST', `/api/admin/users/${randomUUID()}/reset-password`, admin.token, { password: 'x' });
  expect(res.status).toBe(404);
});

test('admin promotes another user', async () => {
  const admin = makeUser('boss', { admin: true });
  const alice = makeUser('alice');

  const res = await req('POST', `/api/admin/users/${alice.id}/admin`, admin.token, { is_admin: true });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.is_admin).toBe(1);
  expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(alice.id).is_admin).toBe(1);
});

test('admin promote rejects a non-boolean flag', async () => {
  const admin = makeUser('boss', { admin: true });
  const alice = makeUser('alice');
  const res = await req('POST', `/api/admin/users/${alice.id}/admin`, admin.token, { is_admin: 'yes' });
  expect(res.status).toBe(400);
});

test('demoting the last admin is refused', async () => {
  const admin = makeUser('boss', { admin: true });
  const res = await req('POST', `/api/admin/users/${admin.id}/admin`, admin.token, { is_admin: false });
  expect(res.status).toBe(409);
  expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(admin.id).is_admin).toBe(1);
});

test('demoting is allowed while another admin remains', async () => {
  const admin = makeUser('boss', { admin: true });
  const other = makeUser('boss2', { admin: true });
  const res = await req('POST', `/api/admin/users/${other.id}/admin`, admin.token, { is_admin: false });
  expect(res.status).toBe(200);
  expect(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(other.id).is_admin).toBe(0);
});
