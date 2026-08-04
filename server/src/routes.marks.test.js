// HTTP-level tests for @-mention marks surfacing in the feed (routes/feed.js).
//
// A router mounted on a real server and driven with fetch, mirroring the other
// routes.*.test.js files. Marks are seeded through mentions.syncPostMentions —
// the same call the coffee-create route makes — then the feed is read as
// different viewers to check marked_me and the mention list.

import { test, expect, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-marks-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);
const { syncPostMentions } = require('./mentions');

const app = express();
app.use(express.json());
app.use('/api/feed', require('./routes/feed'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

beforeEach(() => {
  db.exec('DELETE FROM post_marks; DELETE FROM coffee_entries; DELETE FROM users;');
});

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}
function makePost(userId, description) {
  const id = randomUUID();
  db.prepare('INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, created_at, description, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(id, userId, 'espresso', 63, Date.now(), Date.now(), description);
  return id;
}
function feedAs(token) {
  return fetch(`${base}/api/feed`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
}

test('a marked user sees marked_me on the post, and everyone sees the mention list', async () => {
  const author = makeUser('author');
  const alice = makeUser('alice');
  const carol = makeUser('carol');
  const desc = 'morning brew with @alice';
  const post = makePost(author.id, desc);
  syncPostMentions(post, desc, author.id);

  const aliceView = (await feedAs(alice.token)).find((p) => p.id === post);
  expect(aliceView.marked_me).toBe(true);
  expect(aliceView.marks).toEqual(['alice']);

  const carolView = (await feedAs(carol.token)).find((p) => p.id === post);
  expect(carolView.marked_me).toBe(false);
  expect(carolView.marks).toEqual(['alice']);
});

test('the author is not marked on their own post', async () => {
  const author = makeUser('author');
  makeUser('alice');
  const desc = '@alice look';
  const post = makePost(author.id, desc);
  syncPostMentions(post, desc, author.id);

  const authorView = (await feedAs(author.token)).find((p) => p.id === post);
  expect(authorView.marked_me).toBe(false);
  expect(authorView.marks).toEqual(['alice']);
});

test('a post with no mentions carries an empty marks list and marked_me false', async () => {
  const author = makeUser('author');
  const alice = makeUser('alice');
  const desc = 'just a quiet cup';
  const post = makePost(author.id, desc);
  syncPostMentions(post, desc, author.id);

  const view = (await feedAs(alice.token)).find((p) => p.id === post);
  expect(view.marks).toEqual([]);
  expect(view.marked_me).toBe(false);
});
