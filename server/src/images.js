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
// Phase 3 adds AVIF alongside WebP: every size is encoded to both formats and
// the client negotiates via <picture type>. AVIF is server-only (browsers can't
// reliably encode it) and gives the best ratio for slow connections; WebP stays
// as the universally decodable fallback.
//
// Encode cost note (VALUES 1): AVIF is CPU-heavy and @jsquash runs synchronously
// on the single JS thread, so a large encode briefly blocks the event loop.
// AVIF_SPEED is tuned to the fast end (near-instant on photographic content, a
// few seconds worst case on a 1600px noise image) to keep uploads from stalling
// the server. If concurrency ever grows, move encoding to a worker thread.
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
// AVIF quality knobs. cqLevel is 0 (lossless) .. 63 (worst); ~32 tracks WebP
// quality 80. speed is 0 (slowest/best) .. 10; 8 keeps encode time bounded (see
// the event-loop note above) at a negligible size cost over the default 6.
const AVIF_CQ = 32;
const AVIF_SPEED = 8;

// Formats produced per size, best-ratio first. The client emits one <picture>
// <source> per format in this order, so the browser picks AVIF when it can.
const VARIANT_FORMATS = ['avif', 'webp'];

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

// EXIF Orientation handling (issue #15 review). @jsquash/jpeg.decode returns raw
// RGBA and ignores the EXIF Orientation tag, but phone cameras store portrait
// shots as landscape pixels + Orientation = 6 ("rotate 90° CW to display"). If we
// resize/re-encode those raw pixels the tag is lost and every WebP/AVIF variant
// renders rotated. So we read the tag from the original JPEG and bake the
// rotation into the pixels here — the variants come out upright, tag-free.

// Read the EXIF Orientation (1..8) from a JPEG buffer; 1 (no transform) when the
// tag is absent or the bytes don't parse. Only the APP1/"Exif" segment is walked;
// scanning stops at SOS (start of compressed data). All reads are bounds-guarded.
function readJpegOrientation(buffer) {
  try {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      // Standalone markers (SOI/EOI/TEM/RSTn) carry no length payload.
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2; continue;
      }
      if (marker === 0xda) break; // SOS — image data starts, no more metadata
      const size = buffer.readUInt16BE(offset + 2);
      if (size < 2) return 1;
      if (marker === 0xe1) { // APP1
        const start = offset + 4;
        if (start + 6 <= buffer.length && buffer.toString('ascii', start, start + 4) === 'Exif') {
          return parseExifOrientation(buffer, start + 6); // skip "Exif\0\0"
        }
      }
      offset += 2 + size;
    }
  } catch { /* unparseable — treat as upright */ }
  return 1;
}

// Parse the TIFF block of an EXIF APP1 segment (starting at the byte-order mark)
// and return IFD0's Orientation value, or 1 when it isn't present.
function parseExifOrientation(buffer, tiffStart) {
  const le = buffer.toString('ascii', tiffStart, tiffStart + 2) === 'II';
  const u16 = (o) => (le ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const u32 = (o) => (le ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const ifd0 = tiffStart + u32(tiffStart + 4); // offset field skips the 0x002A magic
  if (ifd0 + 2 > buffer.length) return 1;
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > buffer.length) break;
    if (u16(entry) === 0x0112) { // Orientation, a SHORT stored inline in the value field
      const val = u16(entry + 8);
      return val >= 1 && val <= 8 ? val : 1;
    }
  }
  return 1;
}

// Rotate/flip a decoded { data, width, height } bitmap to its upright form for the
// given EXIF orientation. Orientations 5-8 swap the axes (portrait<->landscape).
function applyOrientation(image, orientation) {
  if (!orientation || orientation === 1) return image;
  const { data, width: w, height: h } = image;
  const swap = orientation >= 5;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx, dy;
      switch (orientation) {
        case 2: dx = w - 1 - x; dy = y; break;          // flip horizontal
        case 3: dx = w - 1 - x; dy = h - 1 - y; break;  // rotate 180
        case 4: dx = x; dy = h - 1 - y; break;          // flip vertical
        case 5: dx = y; dy = x; break;                  // transpose
        case 6: dx = h - 1 - y; dy = x; break;          // rotate 90 CW
        case 7: dx = h - 1 - y; dy = w - 1 - x; break;  // transverse
        case 8: dx = y; dy = w - 1 - x; break;          // rotate 90 CCW
        default: dx = x; dy = y;
      }
      const si = (y * w + x) * 4;
      const di = (dy * ow + dx) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: ow, height: oh };
}

// Decode to ImageData ({ data, width, height }) or null when we have no codec
// for the format (gif/heic) or the bytes are corrupt. Callers treat null as
// "store the file as a single un-resized variant" — never a hard failure.
// JPEGs are rotated to their upright EXIF orientation before returning.
async function decodeBuffer(buffer, format) {
  try {
    const ab = toArrayBuffer(buffer);
    if (format === 'webp') return await (await import('@jsquash/webp')).decode(ab);
    if (format === 'jpeg') {
      const decoded = await (await import('@jsquash/jpeg')).decode(ab);
      return applyOrientation(decoded, readJpegOrientation(buffer));
    }
    if (format === 'png') return await (await import('@jsquash/png')).decode(ab);
    return null; // gif / heic — no decoder wired (see docs/image-handling.md)
  } catch {
    return null;
  }
}

async function encodeTo(format, img) {
  if (format === 'webp') {
    return new Uint8Array(await (await import('@jsquash/webp')).encode(img, { quality: WEBP_QUALITY }));
  }
  if (format === 'avif') {
    return new Uint8Array(await (await import('@jsquash/avif')).encode(img, { cqLevel: AVIF_CQ, speed: AVIF_SPEED }));
  }
  throw new Error(`unknown variant format: ${format}`);
}

// From one decoded master, produce a file for every (format x target width).
// Returns [{ format, width, data: Uint8Array, bytes }]. Each width is resized
// once and then encoded to every requested format, so the expensive resize is
// shared. Ascending by width, formats in VARIANT_FORMATS order per width.
// Shared by uploads and the legacy backfill so both derive variants identically.
async function generateVariants(decoded, formats = VARIANT_FORMATS) {
  const { width: ow, height: oh } = decoded;
  const resize = (await import('@jsquash/resize')).default;
  const out = [];
  for (const w of targetWidths(ow)) {
    const img = w === ow
      ? decoded
      : await resize(decoded, { width: w, height: Math.max(1, Math.round((oh * w) / ow)) });
    for (const format of formats) {
      const data = await encodeTo(format, img);
      out.push({ format, width: w, data, bytes: data.length });
    }
  }
  return out;
}

// WebP-only helper, kept for callers that want the single-format subset.
async function generateWebpVariants(decoded) {
  return generateVariants(decoded, ['webp']);
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
    for (const v of await generateVariants(decoded)) {
      files.push({ format: v.format, width: v.width, filename: `${prefix}${imageId}_${v.width}.${v.format}`, bytes: v.bytes, data: v.data });
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
  readJpegOrientation,
  applyOrientation,
  decodeBuffer,
  generateVariants,
  generateWebpVariants,
  deriveAndStore,
  variantsFor,
  deleteImage,
  imagePathsForOwner,
  unlinkPaths,
  coffeeAccessForFile,
};
