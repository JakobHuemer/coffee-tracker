// Stateful image pipeline (issue #15, phase 2). Owns everything that touches the
// DB or disk: where files live, the API description of an image, deletion, access
// checks, and the upload path. The pure pixel work (probe/decode/resize/encode)
// lives in ./image-codec and runs on a worker thread (see the pool below) so the
// CPU-bound WASM codecs never block the main event loop mid-request.
//
// The codec exports are re-exported from here unchanged so existing callers
// (the backfill script, tests) keep using `images.decodeBuffer` etc. Those run
// the codec inline on the calling thread — fine for an offline one-shot script —
// while the live upload route goes through the worker pool via deriveAndStore.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { Worker } = require('worker_threads');
const db = require('./db');
const codec = require('./image-codec');

// Uploads share the DB volume so photos survive restarts (this file sits in
// server/src/, same depth as index.js — one `..` to server/).
const UPLOAD_DIR = process.env.DB_DIR
  ? path.join(process.env.DB_DIR, 'uploads')
  : path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Encode worker pool ------------------------------------------------------
//
// A small fixed pool of worker threads runs decode/resize/encode. Fixed (not
// per-request) so a burst of uploads can't fork unbounded threads and defeat the
// point. Size is bounded to leave a core for the main loop and the DB; this app
// is low-concurrency (VALUES 1), so 1-2 is plenty and keeps memory (each worker
// loads its own copy of the WASM codecs) modest.
const WORKER_PATH = path.join(__dirname, 'image-worker.js');
const POOL_SIZE = Math.max(1, Math.min(2, (os.cpus()?.length || 2) - 1));

class ImageWorkerPool {
  constructor(workerPath, size) {
    this.workerPath = workerPath;
    this.size = size;
    this.workers = [];        // { worker, busy }
    this.queue = [];          // { msg, transfer, resolve, reject }
    this.pending = new Map(); // id -> { resolve, reject, entry }
    this.seq = 0;
  }

  run(msg, transfer = []) {
    return new Promise((resolve, reject) => {
      this.queue.push({ msg, transfer, resolve, reject });
      this._drain();
    });
  }

  _spawn() {
    const worker = new Worker(this.workerPath);
    const entry = { worker, busy: false };
    // An idle worker must not pin the process open. The caller awaiting a job
    // keeps the loop alive through whatever already holds it (the HTTP server,
    // or the test runner mid-await), so message delivery is unaffected — unref
    // only stops the worker itself from being a reason not to exit. This also
    // lets a one-shot script that never uploads exit cleanly.
    worker.unref();
    worker.on('message', (res) => {
      const p = this.pending.get(res.id);
      if (p) {
        this.pending.delete(res.id);
        entry.busy = false;
        if (res.error) p.reject(new Error(res.error));
        else p.resolve(res);
      }
      this._drain();
    });
    worker.on('error', (err) => {
      // Fail whatever job this worker was running and drop it from the pool; a
      // replacement spawns lazily on the next _drain.
      for (const [id, p] of this.pending) {
        if (p.entry === entry) { this.pending.delete(id); p.reject(err); }
      }
      this.workers = this.workers.filter((e) => e !== entry);
      this._drain();
    });
    this.workers.push(entry);
    return entry;
  }

  _drain() {
    if (this.queue.length === 0) return;
    let entry = this.workers.find((e) => !e.busy);
    if (!entry && this.workers.length < this.size) entry = this._spawn();
    if (!entry) return; // pool saturated — the task waits in the queue
    const task = this.queue.shift();
    const id = ++this.seq;
    entry.busy = true;
    this.pending.set(id, { resolve: task.resolve, reject: task.reject, entry });
    entry.worker.postMessage({ ...task.msg, id }, task.transfer);
  }
}

let pool = null;
function getPool() {
  if (!pool) pool = new ImageWorkerPool(WORKER_PATH, POOL_SIZE);
  return pool;
}

// Full upload path: master bytes -> derived files on disk -> images +
// image_variants rows -> the new image id. `prefix` ('' or 'pfp_') keeps the
// serving route's public-vs-owned distinction filename-based (see index.js).
//
// The decode/resize/encode runs on a worker thread (getPool) so it never blocks
// the main event loop. The DB writes then happen back here in one synchronous
// transaction (bun:sqlite transactions can't span an await). If the transaction
// fails, any files already written are unlinked so a failed upload never strands
// orphans.
async function deriveAndStore({ buffer, mimetype, ownerId, createdAt, prefix = '' }) {
  const imageId = randomUUID();
  const format = codec.mimeToFormat(mimetype);

  // Reject a decompression bomb up front, on the main thread, before dispatching
  // any work: a decodable format whose header declares more pixels than the
  // decode cap. Cheap header read; the worker guards again as defence in depth.
  // The upload routes turn this throw into a 400.
  if (codec.exceedsPixelCap(buffer, format)) {
    throw new Error(`image exceeds ${codec.MAX_MEGAPIXELS}MP decode limit`);
  }

  const result = await getPool().run({ buffer, format });

  let origWidth = null;
  let origHeight = null;
  const files = []; // { format, width, filename, bytes, data }

  if (result.decoded) {
    origWidth = result.width;
    origHeight = result.height;
    for (const v of result.files) {
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

// Batched variantsFor: resolve many image ids in two queries total instead of
// two per id. List endpoints (feed, leaderboards, group members, match rosters)
// shape one row per user/post, so the per-row variantsFor was an N+1 that grew
// with the list — a full leaderboard fired ~2N round trips. Returns a
// Map<imageId, field>; ids with no image simply aren't in the map, so callers do
// `map.get(id) ?? null` and fall back to a legacy *_url exactly as before.
function variantsForMany(imageIds) {
  const ids = [...new Set(imageIds.filter(Boolean))];
  const out = new Map();
  if (ids.length === 0) return out;

  // Chunk the IN list so a large roster can't blow past SQLite's bound-variable
  // limit (~999). Two queries per chunk; chunks are large so this stays O(1) for
  // any realistic list.
  const CHUNK = 500;
  const dims = new Map();      // imageId -> { orig_width, orig_height }
  const byImage = new Map();   // imageId -> [variant rows] (already sorted)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const ph = slice.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT id, orig_width, orig_height FROM images WHERE id IN (${ph})`).all(...slice)) {
      dims.set(r.id, r);
    }
    const rows = db.prepare(
      `SELECT image_id, format, width, path FROM image_variants WHERE image_id IN (${ph}) ORDER BY image_id, (width IS NULL), width ASC`
    ).all(...slice);
    for (const r of rows) {
      if (!byImage.has(r.image_id)) byImage.set(r.image_id, []);
      byImage.get(r.image_id).push(r);
    }
  }

  for (const id of ids) {
    const img = dims.get(id);
    const rows = byImage.get(id);
    if (!img || !rows || rows.length === 0) continue; // no image -> caller falls back
    out.set(id, {
      width: img.orig_width ?? null,
      height: img.orig_height ?? null,
      variants: rows.map(r => ({ url: `/uploads/${r.path}`, width: r.width ?? null, format: r.format })),
    });
  }
  return out;
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
  // Re-exported pure codec helpers (run inline on the caller's thread): used by
  // the backfill script and the test suite.
  SIZES: codec.SIZES,
  mimeToFormat: codec.mimeToFormat,
  targetWidths: codec.targetWidths,
  readJpegOrientation: codec.readJpegOrientation,
  applyOrientation: codec.applyOrientation,
  probeDimensions: codec.probeDimensions,
  decodeBuffer: codec.decodeBuffer,
  generateVariants: codec.generateVariants,
  generateWebpVariants: codec.generateWebpVariants,
  // Stateful pipeline.
  deriveAndStore,
  variantsFor,
  variantsForMany,
  deleteImage,
  imagePathsForOwner,
  unlinkPaths,
  coffeeAccessForFile,
};
