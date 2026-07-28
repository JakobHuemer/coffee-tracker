// One-time, resumable backfill for legacy images (issue #15, phase 2, Part 2).
//
//   bun server/scripts/backfill-images.js
//
// Run ONCE after migration 016 has shipped. Migration 016 only *wrapped* each
// existing photo in an images + image_variants row (DB-only, no pixels touched),
// so every legacy image still has a single un-sized variant in its original
// format. This job does the heavy, failure-prone work the boot migration must
// never do: decode each legacy file once, record its real dimensions, and
// generate the missing responsive WebP sizes.
//
// It is NOT a migration and nothing depends on it finishing — the single legacy
// variant already serves throughout. Properties:
//   - Resumable / idempotent: keyed on "a variant with this (image_id, webp,
//     width) already exists", so an interrupted run only fills gaps.
//   - Best-effort: one unreadable file is logged and skipped, never fatal.
//   - Never strands an image: the legacy file is only removed for formats a
//     browser can't render (HEIC) AND only once a WebP variant exists. Renderable
//     legacy files (jpeg/png/webp) are kept as the full-size variant.
//   - Throttled: pauses between batches so it doesn't peg CPU on a live box.
//
// Scope note: WebP/JPEG/PNG legacy files are decoded and re-sized here. GIF and
// HEIC have no decoder wired (see server/src/images.js), so they are left as
// their single original variant — HEIC conversion is tracked as a follow-up in
// docs/image-handling.md.
const path = require('path');
const fs = require('fs');
const db = require('../src/db');
const images = require('../src/images');

const BATCH = 20;         // images per pause
const THROTTLE_MS = 100;  // pause between batches

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // Candidates: any image not yet measured (a fresh legacy wrap has orig_width
  // NULL). Already-backfilled images have their dimensions set and are skipped.
  const candidates = db.prepare('SELECT id FROM images WHERE orig_width IS NULL').all();
  console.log(`backfill: ${candidates.length} image(s) to process`);

  let done = 0, skipped = 0, failed = 0, variantsWritten = 0;

  for (let i = 0; i < candidates.length; i++) {
    const imageId = candidates[i].id;
    try {
      const variants = db.prepare('SELECT rowid, format, width, path FROM image_variants WHERE image_id = ?').all(imageId);
      // Find a source we can actually decode (the legacy original).
      const source = variants.find((v) => ['webp', 'jpeg', 'png'].includes(v.format));
      if (!source) { skipped++; continue; } // gif/heic only — leave untouched

      const filePath = path.join(images.UPLOAD_DIR, source.path);
      if (!fs.existsSync(filePath)) { skipped++; continue; }

      const decoded = await images.decodeBuffer(fs.readFileSync(filePath), source.format);
      if (!decoded) { skipped++; continue; }

      // Record real dimensions on the image and on the source variant.
      db.prepare('UPDATE images SET orig_width = ?, orig_height = ? WHERE id = ?')
        .run(decoded.width, decoded.height, imageId);
      db.prepare('UPDATE image_variants SET width = ?, bytes = ? WHERE rowid = ?')
        .run(decoded.width, fs.statSync(filePath).size, source.rowid);

      // Derive the responsive WebP sizes, writing only the ones not already there.
      const have = new Set(
        variants.filter((v) => v.format === 'webp' && v.width != null).map((v) => v.width),
      );
      // The legacy file keeps its base name so profile photos retain the `pfp_`
      // prefix the serving route relies on.
      const base = source.path.replace(/\.[^.]+$/, '');
      const insVariant = db.prepare('INSERT INTO image_variants (image_id, format, width, path, bytes) VALUES (?, ?, ?, ?, ?)');

      for (const v of await images.generateWebpVariants(decoded)) {
        if (have.has(v.width)) continue;
        // Don't duplicate the source file as a webp of the same width/format.
        if (source.format === 'webp' && v.width === decoded.width) continue;
        const filename = `${base}_${v.width}.webp`;
        fs.writeFileSync(path.join(images.UPLOAD_DIR, filename), Buffer.from(v.data));
        try {
          insVariant.run(imageId, 'webp', v.width, filename, v.bytes);
          variantsWritten++;
        } catch (err) {
          // Row already existed (UNIQUE) from a prior interrupted run — the file
          // we just rewrote is identical, so this is a safe no-op.
          try { fs.unlinkSync(path.join(images.UPLOAD_DIR, filename)); } catch { /* keep going */ }
          if (!String(err.code).startsWith('SQLITE_CONSTRAINT')) throw err;
        }
      }

      // HEIC/HEIF originals can't be produced here (no decoder), so they never
      // reach this branch. This is where an un-renderable legacy file would be
      // dropped once a renderable variant exists — currently a no-op by design.

      done++;
    } catch (err) {
      failed++;
      console.error(`backfill: image ${imageId} failed:`, err.message);
    }

    if ((i + 1) % BATCH === 0) {
      console.log(`backfill: ${i + 1}/${candidates.length} (…${variantsWritten} variants written)`);
      await sleep(THROTTLE_MS);
    }
  }

  console.log(`backfill done: ${done} processed, ${skipped} skipped (no decoder), ${failed} failed, ${variantsWritten} variants written`);
}

// Checkpoint the WAL into the main DB file before exiting, then let the process
// end on its own. A forced process.exit(0) here raced the flush and could leave
// just-written variant rows only in the WAL — closing cleanly is what makes the
// run durable (VALUES 2).
run()
  .then(() => {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  })
  .catch((err) => {
    console.error('backfill fatal:', err);
    try { db.close(); } catch { /* already closed */ }
    process.exitCode = 1;
  });
