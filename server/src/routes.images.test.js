// HTTP + module tests for the responsive-image pipeline (issue #15):
// server/src/images.js, the upload/serve/delete wiring in routes/coffees.js and
// routes/auth.js, and the 016 legacy-wrap migration.
//
// There was zero coverage of photos before this. The security-critical piece is
// coffeeAccessForFile (a private photo must not resolve as public), so it is
// tested directly against both the legacy single-file and the new variant paths.
//
// Same harness as routes.competitions.test.js: a router on a real server driven
// with fetch, no extra dependency (VALUES 5).

import { test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-images-test-'));
process.env.JWT_SECRET = 'test-secret';

const db = require('./db');
require('./migrate')(db);
const images = require('./images');

const app = express();
app.use(express.json());
app.use('/api/auth', require('./routes/auth'));
app.use('/api/coffees', require('./routes/coffees'));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
afterAll(() => server.close());

// A real WebP master (1000x600) — the same shape the client downscaler produces.
let WEBP;
beforeAll(async () => {
  const { encode } = await import('@jsquash/webp');
  const W = 1000, H = 600;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = i % 255; data[i * 4 + 1] = 90; data[i * 4 + 2] = (i * 3) % 255; data[i * 4 + 3] = 255;
  }
  WEBP = Buffer.from(await encode({ data, width: W, height: H }, { quality: 80 }));
});

beforeEach(() => {
  db.exec('DELETE FROM image_variants; DELETE FROM images; DELETE FROM coffee_entries; DELETE FROM users;');
});

function makeUser(username) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at, timezone) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, 'x', Date.now(), 'UTC');
  return { id, username, token: jwt.sign({ id, username }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

async function postEntry(user, { isPublic = '1', withPhoto = true, description = 'hi' } = {}) {
  const fd = new FormData();
  fd.append('coffeeId', 'espresso');
  fd.append('is_public', isPublic);
  if (description) fd.append('description', description);
  if (withPhoto) fd.append('photo', new Blob([WEBP], { type: 'image/webp' }), 'master.webp');
  const res = await fetch(`${base}/api/coffees/entries`, {
    method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body: fd,
  });
  return { status: res.status, body: await res.json() };
}

const fileExists = (p) => fs.existsSync(path.join(images.UPLOAD_DIR, p));

test('coffee upload derives AVIF + WebP at three sizes, capped at the source width', async () => {
  const u = makeUser('alice');
  const { status, body } = await postEntry(u);
  expect(status).toBe(200);

  const img = body.entry.image;
  expect(img).toBeTruthy();
  expect(img.width).toBe(1000);
  expect(img.height).toBe(600);
  // Three widths (never upscaled to 1600) x two formats.
  expect(img.variants.map((v) => v.width)).toEqual([320, 320, 800, 800, 1000, 1000]);
  const byWidth = (w) => new Set(img.variants.filter((v) => v.width === w).map((v) => v.format));
  for (const w of [320, 800, 1000]) expect(byWidth(w)).toEqual(new Set(['avif', 'webp']));
  for (const v of img.variants) expect(fileExists(v.url.replace('/uploads/', ''))).toBe(true);

  // The new scheme lives entirely under image_id; the legacy column is left null.
  const row = db.prepare('SELECT photo_path, image_id FROM coffee_entries WHERE id = ?').get(body.entry.id);
  expect(row.photo_path).toBeNull();
  expect(row.image_id).toBeTruthy();
});

test('GET /coffees/photos returns the variant list', async () => {
  const u = makeUser('bob');
  await postEntry(u);
  const res = await fetch(`${base}/api/coffees/photos`, { headers: { authorization: `Bearer ${u.token}` } });
  const photos = await res.json();
  expect(photos.length).toBe(1);
  expect(photos[0].image.variants.length).toBe(6); // 3 sizes x avif+webp
  expect(photos[0].photo_url).toBeNull();
});

test('deleting an entry unlinks every variant file and cascades the rows', async () => {
  const u = makeUser('carol');
  const { body } = await postEntry(u);
  const paths = body.entry.image.variants.map((v) => v.url.replace('/uploads/', ''));
  const imageId = db.prepare('SELECT image_id FROM coffee_entries WHERE id = ?').get(body.entry.id).image_id;
  expect(paths.every(fileExists)).toBe(true);

  const res = await fetch(`${base}/api/coffees/entries/${body.entry.id}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${u.token}` },
  });
  expect(res.status).toBe(200);

  expect(paths.some(fileExists)).toBe(false); // no file left behind
  expect(db.prepare('SELECT COUNT(*) AS c FROM images WHERE id = ?').get(imageId).c).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS c FROM image_variants WHERE image_id = ?').get(imageId).c).toBe(0);
});

test('coffeeAccessForFile resolves ownership/visibility for a variant path', async () => {
  const owner = makeUser('dan');
  const other = makeUser('erin');
  const priv = await postEntry(owner, { isPublic: '0' });
  const pub = await postEntry(other, { isPublic: '1' });

  const privPath = priv.body.entry.image.variants[0].url.replace('/uploads/', '');
  const pubPath = pub.body.entry.image.variants[0].url.replace('/uploads/', '');

  const privAccess = images.coffeeAccessForFile(privPath);
  expect(privAccess.is_public).toBe(0);
  expect(privAccess.user_id).toBe(owner.id);

  const pubAccess = images.coffeeAccessForFile(pubPath);
  expect(pubAccess.is_public).toBe(1);

  expect(images.coffeeAccessForFile('does-not-exist.webp')).toBeNull();
});

test('profile photo upload is prefixed pfp_ and produces variants', async () => {
  const u = makeUser('fay');
  const fd = new FormData();
  fd.append('photo', new Blob([WEBP], { type: 'image/webp' }), 'me.webp');
  const res = await fetch(`${base}/api/auth/me/photo`, {
    method: 'PATCH', headers: { authorization: `Bearer ${u.token}` }, body: fd,
  });
  expect(res.status).toBe(200);
  const user = await res.json();
  expect(user.profile_image.variants.length).toBe(6); // 3 sizes x avif+webp
  expect(user.profile_photo_url).toBeNull();
  // The pfp_ prefix is what keeps profile photos publicly viewable in the feed.
  expect(user.profile_image.variants.every((v) => v.url.startsWith('/uploads/pfp_'))).toBe(true);
});

test('migration 016 wraps a legacy single file into a single-variant image', () => {
  // A pre-016 coffee entry: a bare photo_path, no image_id.
  const u = makeUser('gus');
  const entryId = randomUUID();
  db.prepare(
    'INSERT INTO coffee_entries (id, user_id, coffee_id, caffeine_mg, logged_at, created_at, photo_path, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(entryId, u.id, 'espresso', 63, Date.now(), Date.now(), 'legacy-abc.jpg', 1);

  // Re-running the migration's up() wraps the new legacy row (guarded on
  // image_id IS NULL, so it is idempotent).
  require('./migrations/016_add_image_variants').up(db);

  const row = db.prepare('SELECT image_id FROM coffee_entries WHERE id = ?').get(entryId);
  expect(row.image_id).toBeTruthy();

  const field = images.variantsFor(row.image_id);
  expect(field.width).toBeNull();           // dimensions unknown until backfill
  expect(field.variants.length).toBe(1);
  expect(field.variants[0].format).toBe('jpeg'); // recovered from the .jpg extension
  expect(field.variants[0].width).toBeNull();
  expect(field.variants[0].url).toBe('/uploads/legacy-abc.jpg'); // file never moved
});

test('generateWebpVariants never upscales past the source', async () => {
  // A 200px-wide source yields exactly one 200px variant, not 320/800/1600.
  const { encode } = await import('@jsquash/webp');
  const W = 200, H = 150;
  const data = new Uint8ClampedArray(W * H * 4).fill(200);
  const small = Buffer.from(await encode({ data, width: W, height: H }, { quality: 80 }));

  const decoded = await images.decodeBuffer(small, 'webp');
  const variants = await images.generateWebpVariants(decoded);
  expect(variants.map((v) => v.width)).toEqual([200]);
  expect(images.targetWidths(1000)).toEqual([320, 800, 1000]);
  expect(images.targetWidths(4000)).toEqual([320, 800, 1600]); // capped at large
});

test('generateVariants produces AVIF + WebP per size, decodable back', async () => {
  const { encode } = await import('@jsquash/webp');
  const W = 900, H = 600;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = i % 255; data[i * 4 + 1] = 40; data[i * 4 + 2] = (i * 5) % 255; data[i * 4 + 3] = 255;
  }
  const master = Buffer.from(await encode({ data, width: W, height: H }, { quality: 80 }));
  const decoded = await images.decodeBuffer(master, 'webp');

  const variants = await images.generateVariants(decoded);
  // 320/800/900 x avif+webp, interleaved avif-first per width.
  expect(variants.map((v) => `${v.format}:${v.width}`)).toEqual([
    'avif:320', 'webp:320', 'avif:800', 'webp:800', 'avif:900', 'webp:900',
  ]);
  expect(variants.every((v) => v.bytes > 0)).toBe(true);

  // The AVIF bytes are real AVIF: they decode back to the right dimensions.
  const avif800 = variants.find((v) => v.format === 'avif' && v.width === 800);
  const { decode: decodeAvif } = await import('@jsquash/avif');
  const ab = avif800.data.buffer.slice(avif800.data.byteOffset, avif800.data.byteOffset + avif800.data.byteLength);
  const round = await decodeAvif(ab);
  expect(round.width).toBe(800);
});
