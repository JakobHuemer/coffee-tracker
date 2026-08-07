// Unit tests for @-mention parsing and marking (mentions.js).

import { test, expect, beforeEach } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-mentions-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);
const { extractMentions, syncPostMentions, marksForMany } = require('./mentions');

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return id;
}
function makeEntry(userId) {
  const id = randomUUID();
  db.prepare('INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, created_at, is_public) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(id, userId, 'espresso', 63, Date.now(), Date.now());
  return id;
}

beforeEach(() => {
  db.exec('DELETE FROM post_marks; DELETE FROM coffee_entries; DELETE FROM users;');
});

// ── extractMentions (pure parsing) ────────────────────────────────────────────

test('extracts distinct @mentions in first-seen order', () => {
  expect(extractMentions('gm @alice and @bob, later @alice')).toEqual(['alice', 'bob']);
});

test('a mention may start the string and use - and _', () => {
  expect(extractMentions('@alice hi @bob-cat and @under_score')).toEqual(['alice', 'bob-cat', 'under_score']);
});

test('an @ right after a word char is not a mention (e.g. an email)', () => {
  expect(extractMentions('reach me at foo@bar today')).toEqual([]);
});

test('stops at punctuation and rejects too-short / empty handles', () => {
  expect(extractMentions('@alice! done')).toEqual(['alice']);
  expect(extractMentions('@a @ nothing')).toEqual([]);
  expect(extractMentions('')).toEqual([]);
  expect(extractMentions(null)).toEqual([]);
});

// ── syncPostMentions (resolve + store) ────────────────────────────────────────

test('records real mentioned users, skipping unknown handles and the author', () => {
  const author = makeUser('author');
  makeUser('alice');
  makeUser('bob');
  const entry = makeEntry(author);

  const count = syncPostMentions(entry, 'yo @alice @bob @ghost @author', author);
  expect(count).toBe(2);
  expect(new Set(marksForMany([entry]).get(entry))).toEqual(new Set(['alice', 'bob']));
});

test('is idempotent — re-running replaces rather than duplicating', () => {
  const author = makeUser('author');
  makeUser('alice');
  const entry = makeEntry(author);

  syncPostMentions(entry, '@alice', author);
  syncPostMentions(entry, '@alice', author);
  expect(marksForMany([entry]).get(entry)).toEqual(['alice']);
});

test('a description with no valid mentions clears any existing marks', () => {
  const author = makeUser('author');
  makeUser('alice');
  const entry = makeEntry(author);

  syncPostMentions(entry, '@alice', author);
  expect(syncPostMentions(entry, 'just coffee', author)).toBe(0);
  expect(marksForMany([entry]).get(entry)).toBeUndefined();
});

// ── marksForMany (batched read) ───────────────────────────────────────────────

test('batches many entries and returns an empty map for none', () => {
  const author = makeUser('author');
  makeUser('alice');
  makeUser('bob');
  const e1 = makeEntry(author);
  const e2 = makeEntry(author);
  syncPostMentions(e1, '@alice', author);
  syncPostMentions(e2, '@bob', author);

  const map = marksForMany([e1, e2]);
  expect(map.get(e1)).toEqual(['alice']);
  expect(map.get(e2)).toEqual(['bob']);
  expect(marksForMany([]).size).toBe(0);
});

test('deleting the entry cascades its marks away', () => {
  const author = makeUser('author');
  makeUser('alice');
  const entry = makeEntry(author);
  syncPostMentions(entry, '@alice', author);

  db.prepare('DELETE FROM coffee_entries WHERE id = ?').run(entry);
  expect(db.prepare('SELECT COUNT(*) AS c FROM post_marks').get().c).toBe(0);
});
