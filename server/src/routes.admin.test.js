// HTTP-level tests for the admin routes (routes/admin.js).
//
// A router mounted on a real server and driven with fetch — no supertest,
// mirroring routes.rankings.test.js. Two admin tiers: the protected super admin
// (is_super_admin) may manage everyone and is untouchable; a regular admin may
// manage non-admins and promote non-admins, but may not touch any admin.
// requireAdmin reads status live from the DB, so tests set the flags directly.

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

// tier: 'super' | 'admin' | undefined (regular user)
function makeUser(username, { tier, password = 'secret' } = {}) {
  const id = randomUUID();
  const isAdmin = tier === 'super' || tier === 'admin' ? 1 : 0;
  const isSuper = tier === 'super' ? 1 : 0;
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone, is_admin, is_super_admin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, bcrypt.hashSync(password, 10), Date.now(), 'UTC', isAdmin, isSuper);
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

const isAdmin = (id) => db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id).is_admin;
const pwMatches = (id, pw) => bcrypt.compareSync(pw, db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id).password_hash);

// ── access control ───────────────────────────────────────────────────────────

test('non-admin is forbidden on every admin route', async () => {
  makeUser('boss', { tier: 'super' });
  const alice = makeUser('alice');
  const plain = makeUser('nobody');

  expect((await req('GET', '/api/admin/users/boss', plain.token)).status).toBe(403);
  expect((await req('POST', `/api/admin/users/${alice.id}/reset-password`, plain.token, { password: 'x' })).status).toBe(403);
  expect((await req('POST', `/api/admin/users/${alice.id}/admin`, plain.token, { is_admin: true })).status).toBe(403);
});

test('missing token is unauthorized', async () => {
  const res = await req('GET', '/api/admin/users/boss', undefined);
  expect(res.status).toBe(401);
});

// ── lookup ───────────────────────────────────────────────────────────────────

test('admin looks up a user by username, incl. tier flags, no password hash', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  makeUser('alice');

  const res = await req('GET', '/api/admin/users/alice', boss.token);
  expect(res.status).toBe(200);
  const user = await res.json();
  expect(user.username).toBe('alice');
  expect(user.is_admin).toBe(0);
  expect(user.is_super_admin).toBe(0);
  expect('password_hash' in user).toBe(false);
});

test('looking up an unknown username is 404', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const res = await req('GET', '/api/admin/users/ghost', boss.token);
  expect(res.status).toBe(404);
});

// ── managing non-admins: open to any admin ────────────────────────────────────

test('a regular admin can reset a non-admin password', async () => {
  const mod = makeUser('mod', { tier: 'admin' });
  const alice = makeUser('alice', { password: 'old' });

  const res = await req('POST', `/api/admin/users/${alice.id}/reset-password`, mod.token, { password: 'new-pw' });
  expect(res.status).toBe(200);
  expect(pwMatches(alice.id, 'new-pw')).toBe(true);
  expect(pwMatches(alice.id, 'old')).toBe(false);
});

test('a regular admin can promote a non-admin', async () => {
  const mod = makeUser('mod', { tier: 'admin' });
  const alice = makeUser('alice');

  const res = await req('POST', `/api/admin/users/${alice.id}/admin`, mod.token, { is_admin: true });
  expect(res.status).toBe(200);
  expect((await res.json()).is_admin).toBe(1);
  expect(isAdmin(alice.id)).toBe(1);
});

test('reset rejects an empty / oversized / non-string password', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const alice = makeUser('alice');
  for (const password of ['', 'x'.repeat(73), 123, null]) {
    const res = await req('POST', `/api/admin/users/${alice.id}/reset-password`, boss.token, { password });
    expect(res.status).toBe(400);
  }
});

test('reset on an unknown user is 404', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const res = await req('POST', `/api/admin/users/${randomUUID()}/reset-password`, boss.token, { password: 'x' });
  expect(res.status).toBe(404);
});

test('admin promote rejects a non-boolean flag', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const alice = makeUser('alice');
  const res = await req('POST', `/api/admin/users/${alice.id}/admin`, boss.token, { is_admin: 'yes' });
  expect(res.status).toBe(400);
});

// ── managing admins: super only ────────────────────────────────────────────────

test('a regular admin cannot reset another admin password', async () => {
  const mod = makeUser('mod', { tier: 'admin' });
  const other = makeUser('other', { tier: 'admin', password: 'keep' });

  const res = await req('POST', `/api/admin/users/${other.id}/reset-password`, mod.token, { password: 'hacked' });
  expect(res.status).toBe(403);
  expect(pwMatches(other.id, 'keep')).toBe(true);
});

test('a regular admin cannot demote another admin', async () => {
  const mod = makeUser('mod', { tier: 'admin' });
  const other = makeUser('other', { tier: 'admin' });

  const res = await req('POST', `/api/admin/users/${other.id}/admin`, mod.token, { is_admin: false });
  expect(res.status).toBe(403);
  expect(isAdmin(other.id)).toBe(1);
});

test('the super admin can reset a regular admin password', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const mod = makeUser('mod', { tier: 'admin', password: 'old' });

  const res = await req('POST', `/api/admin/users/${mod.id}/reset-password`, boss.token, { password: 'new-pw' });
  expect(res.status).toBe(200);
  expect(pwMatches(mod.id, 'new-pw')).toBe(true);
});

test('the super admin can demote a regular admin', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const mod = makeUser('mod', { tier: 'admin' });

  const res = await req('POST', `/api/admin/users/${mod.id}/admin`, boss.token, { is_admin: false });
  expect(res.status).toBe(200);
  expect(isAdmin(mod.id)).toBe(0);
});

// ── the protected super admin is untouchable ──────────────────────────────────

test('the super admin cannot be demoted — not even by itself', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  expect((await req('POST', `/api/admin/users/${boss.id}/admin`, boss.token, { is_admin: false })).status).toBe(403);
  expect(isAdmin(boss.id)).toBe(1);
});

test("the super admin's password cannot be reset via the admin route", async () => {
  const boss = makeUser('boss', { tier: 'super', password: 'boss-pw' });
  const res = await req('POST', `/api/admin/users/${boss.id}/reset-password`, boss.token, { password: 'changed' });
  expect(res.status).toBe(403);
  expect(pwMatches(boss.id, 'boss-pw')).toBe(true);
});

test('a regular admin cannot touch the super admin', async () => {
  const mod = makeUser('mod', { tier: 'admin' });
  const boss = makeUser('boss', { tier: 'super', password: 'boss-pw' });

  expect((await req('POST', `/api/admin/users/${boss.id}/reset-password`, mod.token, { password: 'x' })).status).toBe(403);
  expect((await req('POST', `/api/admin/users/${boss.id}/admin`, mod.token, { is_admin: false })).status).toBe(403);
  expect(pwMatches(boss.id, 'boss-pw')).toBe(true);
  expect(isAdmin(boss.id)).toBe(1);
});

// ── coffee catalog (issue #77) ─────────────────────────────────────────────────
// The seed rows (migration 020) survive beforeEach (it only clears users), so
// these tests use ids that aren't in the seed and clean them up after each run.
const coffeeRow = (id) => db.prepare('SELECT * FROM coffees WHERE id = ?').get(id);
const classRow = (id) => db.prepare('SELECT * FROM coffee_classes WHERE id = ?').get(id);
beforeEach(() => {
  db.exec("DELETE FROM coffees WHERE id LIKE 'test\\_%' ESCAPE '\\';");
  db.exec("DELETE FROM coffee_classes WHERE id LIKE 'test\\_%' ESCAPE '\\';");
});

test('the catalog is admin-only', async () => {
  const plain = makeUser('nobody');
  expect((await req('GET', '/api/admin/coffees', plain.token)).status).toBe(403);
  expect((await req('POST', '/api/admin/coffees', plain.token, { id: 'test_x', name: 'X', caffeine: 1, icon: 'coffee', class: 'coffee' })).status).toBe(403);
});

test('GET returns the seeded catalog incl. the score override', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const rows = await (await req('GET', '/api/admin/coffees', boss.token)).json();
  const latte = rows.find((c) => c.id === 'latte');
  expect(latte).toMatchObject({ caffeine: 63, score_caffeine: 25 });
  const espresso = rows.find((c) => c.id === 'espresso');
  expect(espresso.score_caffeine).toBe(null);
});

test('an admin creates a coffee; it appears in the public menu', async () => {
  const mod = makeUser('mod', { tier: 'admin' });
  const res = await req('POST', '/api/admin/coffees', mod.token, {
    id: 'test_brew', name: 'Test Brew', caffeine: 42, icon: 'coffee', class: 'coffee',
  });
  expect(res.status).toBe(201);
  expect(coffeeRow('test_brew')).toMatchObject({ name: 'Test Brew', caffeine: 42, score_caffeine: null });
});

test('create rejects a bad id, duplicate id, and bad caffeine', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const good = { name: 'Y', caffeine: 1, icon: 'coffee', class: 'coffee' };
  expect((await req('POST', '/api/admin/coffees', boss.token, { id: 'Bad Id', ...good })).status).toBe(400);
  expect((await req('POST', '/api/admin/coffees', boss.token, { id: 'espresso', ...good })).status).toBe(409);
  expect((await req('POST', '/api/admin/coffees', boss.token, { id: 'test_neg', name: 'Y', caffeine: -1, icon: 'coffee', class: 'coffee' })).status).toBe(400);
  expect((await req('POST', '/api/admin/coffees', boss.token, { id: 'test_str', name: 'Y', caffeine: 'lots', icon: 'coffee', class: 'coffee' })).status).toBe(400);
});

test('PATCH updates only the sent fields and can set/clear the score override', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  await req('POST', '/api/admin/coffees', boss.token, { id: 'test_brew', name: 'Brew', caffeine: 50, icon: 'coffee', class: 'coffee' });

  await req('PATCH', '/api/admin/coffees/test_brew', boss.token, { caffeine: 80, score_caffeine: 30 });
  expect(coffeeRow('test_brew')).toMatchObject({ name: 'Brew', caffeine: 80, score_caffeine: 30 });

  await req('PATCH', '/api/admin/coffees/test_brew', boss.token, { score_caffeine: null });
  expect(coffeeRow('test_brew').score_caffeine).toBe(null);
});

test('PATCH on an unknown coffee is 404', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  expect((await req('PATCH', '/api/admin/coffees/test_ghost', boss.token, { caffeine: 1 })).status).toBe(404);
});

test('DELETE removes a coffee but leaves existing entries intact', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  await req('POST', '/api/admin/coffees', boss.token, { id: 'test_brew', name: 'Brew', caffeine: 50, icon: 'coffee', class: 'coffee' });
  // An entry logged against it copies its own caffeine_mg and coffee_id string.
  db.prepare('INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, is_public) VALUES (?, ?, ?, ?, ?, 0)')
    .run(randomUUID(), boss.id, 'test_brew', 50, Date.now());

  expect((await req('DELETE', '/api/admin/coffees/test_brew', boss.token)).status).toBe(200);
  expect(coffeeRow('test_brew')).toBeNull();
  const entry = db.prepare("SELECT caffeine_mg, coffee_id FROM coffee_entries WHERE coffee_id = 'test_brew'").get();
  expect(entry).toMatchObject({ caffeine_mg: 50, coffee_id: 'test_brew' });
  db.exec("DELETE FROM coffee_entries WHERE coffee_id = 'test_brew';");
});

// ── drink categories (migration 021) ───────────────────────────────────────────

test('GET returns seeded categories with names and order', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const rows = await (await req('GET', '/api/admin/coffee-classes', boss.token)).json();
  const coffee = rows.find((c) => c.id === 'coffee');
  expect(coffee).toMatchObject({ name: 'Coffee', sort_order: 0 });
  expect(rows.map((c) => c.id)).toContain('energy');
});

test('a coffee must reference a real category', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const res = await req('POST', '/api/admin/coffees', boss.token, {
    id: 'test_brew', name: 'Brew', caffeine: 40, icon: 'coffee', class: 'test_ghost',
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('Unknown category');
});

test('create/patch a category, then a coffee can use it', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  const created = await (await req('POST', '/api/admin/coffee-classes', boss.token, { id: 'test_kombucha', name: 'Kombucha' })).json();
  expect(created).toMatchObject({ id: 'test_kombucha', name: 'Kombucha' });

  await req('PATCH', '/api/admin/coffee-classes/test_kombucha', boss.token, { name: 'Fermented' });
  expect(classRow('test_kombucha').name).toBe('Fermented');

  const coffee = await req('POST', '/api/admin/coffees', boss.token, { id: 'test_booch', name: 'Booch', caffeine: 10, icon: 'tea', class: 'test_kombucha' });
  expect(coffee.status).toBe(201);
});

test('category create rejects bad id and duplicate', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  expect((await req('POST', '/api/admin/coffee-classes', boss.token, { id: 'Bad Id', name: 'X' })).status).toBe(400);
  expect((await req('POST', '/api/admin/coffee-classes', boss.token, { id: 'coffee', name: 'Dup' })).status).toBe(409);
});

test('a category in use cannot be deleted; an empty one can', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  await req('POST', '/api/admin/coffee-classes', boss.token, { id: 'test_kombucha', name: 'Kombucha' });
  await req('POST', '/api/admin/coffees', boss.token, { id: 'test_booch', name: 'Booch', caffeine: 10, icon: 'tea', class: 'test_kombucha' });

  expect((await req('DELETE', '/api/admin/coffee-classes/test_kombucha', boss.token)).status).toBe(409);
  db.exec("DELETE FROM coffees WHERE id = 'test_booch';");
  expect((await req('DELETE', '/api/admin/coffee-classes/test_kombucha', boss.token)).status).toBe(200);
  expect(classRow('test_kombucha')).toBeNull();
});

test('move swaps a category with its neighbour', async () => {
  const boss = makeUser('boss', { tier: 'super' });
  // Append two fresh categories at the end so the swap is deterministic.
  await req('POST', '/api/admin/coffee-classes', boss.token, { id: 'test_a', name: 'A' });
  await req('POST', '/api/admin/coffee-classes', boss.token, { id: 'test_b', name: 'B' });
  const aBefore = classRow('test_a').sort_order;
  const bBefore = classRow('test_b').sort_order;
  expect(bBefore).toBe(aBefore + 1);

  await req('POST', '/api/admin/coffee-classes/test_b/move', boss.token, { direction: 'up' });
  expect(classRow('test_b').sort_order).toBe(aBefore);
  expect(classRow('test_a').sort_order).toBe(bBefore);
});
