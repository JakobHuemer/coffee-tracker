// Shared image pipeline (issue #15, phase 2). Centralises everything that used
// to be scattered across the upload/serve/delete routes: where files live, how
// a master is turned into responsive size variants, how the API describes an
// image, and how every file of an image is removed.
//
// Encoding runs on the @jsquash WASM codecs — the same WASM the browser could
// use, with no native libvips/node-gyp toolchain to build in the container
// (VALUES 1/5). The codecs are ESM-only, so this CommonJS module imports them
// lazily with dynamic import() inside async functions (the module cache makes
// repeat imports free).
//
// AVIF and <picture type> negotiation are phase 3 — this module produces WebP
// only, which is universally decodable and already the big bandwidth win.
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const db = require('./db');

// Uploads share the DB volume so photos survive restarts (this file sits in
// server/src/, same depth as index.js — one `..` to server/).
const UPLOAD_DIR = process.env.DB_DIR
  ? path.join(process.env.DB_DIR, 'uploads')
  : path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Longest-edge widths. Ascending so target derivation stays ordered. thumb is
// enough for feed grids/avatars, large is the lightbox ceiling — the original
// is never stored above `large`.
const SIZES = [
  { name: 'thumb', width: 320 },
  { name: 'medium', width: 800 },
  { name: 'large', width: 1600 },
];
const WEBP_QUALITY = 80;

const MIME_FORMAT = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heic',
};
function mimeToFormat(mime) {
  return MIME_FORMAT[mime] || 'jpeg';
}

// The widths to actually produce for a source of width `ow`: each configured
// size clamped so we NEVER upscale, de-duplicated. A 200px source yields one
// 200px variant; a 4000px source is capped at 1600 (large).
function targetWidths(ow) {
  const seen = new Set();
  const out = [];
  for (const s of SIZES) {
    const w = Math.min(s.width, ow);
    if (w >= 1 && !seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

// A Node Buffer's underlying ArrayBuffer may be a shared pool slice; hand the
// codecs exactly this buffer's bytes.
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Decode to ImageData ({ data, width, height }) or null when we have no codec
// for the format (gif/heic) or the bytes are corrupt. Callers treat null as
// "store the file as a single un-resized variant" — never a hard failure.
async function decodeBuffer(buffer, format) {
  try {
    const ab = toArrayBuffer(buffer);
    if (format === 'webp') return await (await import('@jsquash/webp')).decode(ab);
    if (format === 'jpeg') return await (await import('@jsquash/jpeg')).decode(ab);
    if (format === 'png') return await (await import('@jsquash/png')).decode(ab);
    return null; // gif / heic — no decoder wired (see docs/image-handling.md)
  } catch {
    return null;
  }
}

// From one decoded master, produce a WebP file for every target width. Returns
// [{ width, data: Uint8Array, bytes }] ascending. Shared by uploads and the
// legacy backfill so both derive sizes identically.
async function generateWebpVariants(decoded) {
  const { width: ow, height: oh } = decoded;
  const { encode: encodeWebp } = await import('@jsquash/webp');
  const resize = (await import('@jsquash/resize')).default;
  const out = [];
  for (const w of targetWidths(ow)) {
    const img = w === ow
      ? decoded
      : await resize(decoded, { width: w, height: Math.max(1, Math.round((oh * w) / ow)) });
    const data = new Uint8Array(await encodeWebp(img, { quality: WEBP_QUALITY }));
    out.push({ width: w, data, bytes: data.length });
  }
  return out;
}

// Full upload path: master bytes -> derived files on disk -> images +
// image_variants rows -> the new image id. `prefix` ('' or 'pfp_') keeps the
// serving route's public-vs-owned distinction filename-based (see index.js).
//
// Async work (decode/resize/encode) is done first and buffered; the DB writes
// then happen in one synchronous transaction (bun:sqlite transactions can't
// span an await). If the transaction fails, any files already written are
// unlinked so a failed upload never strands orphans.
async function deriveAndStore({ buffer, mimetype, ownerId, createdAt, prefix = '' }) {
  const imageId = randomUUID();
  const format = mimeToFormat(mimetype);
  const decoded = await decodeBuffer(buffer, format);

  let origWidth = null;
  let origHeight = null;
  const files = []; // { format, width, filename, bytes, data }

  if (decoded) {
    origWidth = decoded.width;
    origHeight = decoded.height;
    for (const v of await generateWebpVariants(decoded)) {
      files.push({ format: 'webp', width: v.width, filename: `${prefix}${imageId}_${v.width}.webp`, bytes: v.bytes, data: v.data });
    }
  } else {
    // Undecodable format (gif/heic) or corrupt bytes: keep the upload verbatim
    // as the sole variant. It still serves; dimensions stay unknown.
    const ext = format === 'jpeg' ? 'jpg' : format;
    files.push({ format, width: null, filename: `${prefix}${imageId}.${ext}`, bytes: buffer.length, data: buffer });
  }

  const written = [];
  try {
    for (const f of files) {
      fs.writeFileSync(path.join(UPLOAD_DIR, f.filename), Buffer.from(f.data));
      written.push(f.filename);
    }
    const insImage = db.prepare('INSERT INTO images (id, owner_id, created_at, orig_width, orig_height) VALUES (?, ?, ?, ?, ?)');
    const insVariant = db.prepare('INSERT INTO image_variants (image_id, format, width, path, bytes) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      insImage.run(imageId, ownerId, createdAt ?? Date.now(), origWidth, origHeight);
      for (const f of files) insVariant.run(imageId, f.format, f.width, f.filename, f.bytes);
    });
    tx();
    return imageId;
  } catch (err) {
    for (const name of written) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch { /* best effort */ }
    }
    throw err;
  }
}

// The API description of an image: an ascending list of variant URLs plus the
// original aspect. Returns null when there is no image (so callers fall back to
// a legacy photo_url). Nulls-last on width keeps a legacy single variant of
// unknown size at the front as the plain-src fallback.
function variantsFor(imageId) {
  if (!imageId) return null;
  const img = db.prepare('SELECT orig_width, orig_height FROM images WHERE id = ?').get(imageId);
  if (!img) return null;
  const rows = db.prepare(
    'SELECT format, width, path FROM image_variants WHERE image_id = ? ORDER BY (width IS NULL), width ASC'
  ).all(imageId);
  if (rows.length === 0) return null;
  return {
    width: img.orig_width ?? null,
    height: img.orig_height ?? null,
    variants: rows.map(r => ({ url: `/uploads/${r.path}`, width: r.width ?? null, format: r.format })),
  };
}

// Delete an image everywhere: remove the images row (ON DELETE CASCADE clears
// image_variants) and unlink every variant file. A cascade never touches disk,
// so the unlinks are explicit. Safe to call with a null/absent id.
function deleteImage(imageId) {
  if (!imageId) return;
  const paths = db.prepare('SELECT path FROM image_variants WHERE image_id = ?').all(imageId).map(r => r.path);
  db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
  unlinkPaths(paths);
}

// Every variant file path for an owner's images — used to unlink files before
// deleting a whole account (the users cascade removes the rows, not the files).
function imagePathsForOwner(ownerId) {
  return db.prepare(
    'SELECT v.path FROM image_variants v JOIN images i ON i.id = v.image_id WHERE i.owner_id = ?'
  ).all(ownerId).map(r => r.path);
}

function unlinkPaths(paths) {
  for (const p of paths) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, p)); } catch { /* best effort */ }
  }
}

// Ownership/visibility for a coffee-photo file request, checking both the
// legacy single-file column and the new variant files. Returns { user_id,
// is_public } or null. Profile photos are handled by filename prefix in the
// serving route and never reach this.
function coffeeAccessForFile(filename) {
  const legacy = db.prepare('SELECT user_id, is_public FROM coffee_entries WHERE photo_path = ?').get(filename);
  if (legacy) return legacy;
  return db.prepare(`
    SELECT ce.user_id, ce.is_public
    FROM image_variants v
    JOIN coffee_entries ce ON ce.image_id = v.image_id
    WHERE v.path = ?
  `).get(filename) || null;
}

module.exports = {
  UPLOAD_DIR,
  SIZES,
  mimeToFormat,
  targetWidths,
  decodeBuffer,
  generateWebpVariants,
  deriveAndStore,
  variantsFor,
  deleteImage,
  imagePathsForOwner,
  unlinkPaths,
  coffeeAccessForFile,
};
