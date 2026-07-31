// One-time, resumable backfill for legacy images (issue #15, phase 2, Part 2).
//
//   bun server/scripts/backfill-images.js
//
// Run ONCE after migration 018 ships, and again after phase 3 to add AVIF.
// Migration 018 only *wrapped* each existing photo in an images + image_variants
// row (DB-only, no pixels touched), so every legacy image still has a single
// un-sized variant in its original format. This job does the heavy,
// failure-prone work the boot migration must never do: decode each image once,
// record its real dimensions, and generate the missing responsive variants
// (WebP + AVIF) at every size.
//
// It is NOT a migration and nothing depends on it finishing — the single legacy
// variant already serves throughout. Properties:
//   - Resumable / idempotent: keyed on "a variant with this (image_id, format,
//     width) already exists", so an interrupted run only fills gaps. Re-running
//     after phase 3 tops up AVIF on images that already have WebP.
//   - Best-effort: one unreadable file is logged and skipped, never fatal.
//   - Never strands an image: the legacy file is only removed for formats a
//     browser can't render (HEIC) AND only once a WebP variant exists. Renderable
//     legacy files (jpeg/png/webp) are kept as the full-size variant.
//   - Throttled: pauses between batches so it doesn't peg CPU on a live box.
//
// Scope note: WebP/JPEG/PNG files are decoded and re-encoded here. GIF and HEIC
// have no decoder wired (see server/src/images.js), so they are left as their
// single original variant — HEIC conversion is tracked as a follow-up in
// docs/image-handling.md.
const path = require('path');
const fs = require('fs');
const db = require('../src/db');
const images = require('../src/images');

const BATCH = 20;         // images per pause
const THROTTLE_MS = 100;  // pause between batches

// A derived variant's filename is `<originalBase>_<width>.<avif|webp>`; the
// original legacy file has no such suffix. Used to tell the two apart when
// picking a decode source and when purging under --reencode.
const DERIVED_RE = /_\d+\.(?:avif|webp)$/;

// --reencode: force every candidate's derived variants to be dropped and
// regenerated from its original. Needed after the EXIF-orientation fix — a DB
// backfilled by the old (rotation-dropping) code has mis-rotated WebP/AVIF
// variants that are idempotent-"present", so a plain re-run would skip them.
const REENCODE = process.argv.includes('--reencode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // Candidates: any image not yet measured (a fresh legacy wrap has orig_width
  // NULL) OR one that has no AVIF variant yet (phase-2 images, which have WebP
  // only). Fully-derived images match neither and are skipped. gif/heic-only
  // images always match the AVIF clause but are cheaply skipped below (no
  // decodable source), so re-runs stay a no-op for them.
  //
  // --reencode widens this to every image (the orientation fix must reach
  // already-fully-derived ones too); undecodable images are still skipped below.
  const candidates = REENCODE
    ? db.prepare('SELECT id FROM images').all()
    : db.prepare(`
    SELECT DISTINCT i.id FROM images i
    WHERE i.orig_width IS NULL
       OR NOT EXISTS (SELECT 1 FROM image_variants v WHERE v.image_id = i.id AND v.format = 'avif')
  `).all();
  console.log(`backfill${REENCODE ? ' (reencode)' : ''}: ${candidates.length} image(s) to process`);

  let done = 0, skipped = 0, failed = 0, variantsWritten = 0;

  for (let i = 0; i < candidates.length; i++) {
    const imageId = candidates[i].id;
    try {
      const variants = db.prepare('SELECT rowid, format, width, path FROM image_variants WHERE image_id = ?').all(imageId);
      // Decode the WIDEST decodable file, but prefer the ORIGINAL (non-derived)
      // over any derived WebP of equal width. The original is what still carries
      // the EXIF orientation tag, so decoding it (not a derived, already-baked
      // WebP) is what lets decodeBuffer produce upright pixels.
      const decodable = variants.filter((v) => ['webp', 'jpeg', 'png'].includes(v.format));
      const originals = decodable.filter((v) => !DERIVED_RE.test(v.path));
      const source = (originals.length ? originals : decodable)
        .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      if (!source) { skipped++; continue; } // gif/heic only — leave untouched

      const filePath = path.join(images.UPLOAD_DIR, source.path);
      if (!fs.existsSync(filePath)) { skipped++; continue; }

      const decoded = await images.decodeBuffer(fs.readFileSync(filePath), source.format);
      if (!decoded) { skipped++; continue; }

      // --reencode: drop every variant except the source before regenerating, so
      // the stale (mis-rotated) derived files/rows are replaced rather than kept.
      if (REENCODE) {
        const delVar = db.prepare('DELETE FROM image_variants WHERE rowid = ?');
        for (const v of variants) {
          if (v.rowid === source.rowid) continue;
          try { fs.unlinkSync(path.join(images.UPLOAD_DIR, v.path)); } catch { /* already gone */ }
          delVar.run(v.rowid);
        }
      }

      // Record real dimensions on the image and on the source variant.
      db.prepare('UPDATE images SET orig_width = ?, orig_height = ? WHERE id = ?')
        .run(decoded.width, decoded.height, imageId);
      db.prepare('UPDATE image_variants SET width = ?, bytes = ? WHERE rowid = ?')
        .run(decoded.width, fs.statSync(filePath).size, source.rowid);

      // Derive the responsive variants (WebP + AVIF), writing only the
      // (format,width) pairs not already present. Under --reencode the derived
      // rows were just purged, so only the surviving source counts as present.
      const present = REENCODE ? [source] : variants;
      const have = new Set(
        present.filter((v) => v.width != null).map((v) => `${v.format}:${v.width}`),
      );
      // Derived files keep the source's base name so profile photos retain the
      // `pfp_` prefix the serving route relies on.
      const base = source.path.replace(/\.[^.]+$/, '');
      const insVariant = db.prepare('INSERT INTO image_variants (image_id, format, width, path, bytes) VALUES (?, ?, ?, ?, ?)');

      for (const v of await images.generateVariants(decoded)) {
        if (have.has(`${v.format}:${v.width}`)) continue;
        // Don't duplicate the source file as the same format+width already on disk.
        if (v.format === source.format && v.width === decoded.width) continue;
        const filename = `${base}_${v.width}.${v.format}`;
        fs.writeFileSync(path.join(images.UPLOAD_DIR, filename), Buffer.from(v.data));
        try {
          insVariant.run(imageId, v.format, v.width, filename, v.bytes);
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

// Keep the process alive across the awaited WASM encodes. Bun otherwise drains
// the event loop and exits mid-`await` in a plain script (the pending WASM work
// doesn't ref the loop), which would silently end the run after the first image.
// The interval is cleared once run() settles so the process can exit normally.
const keepAlive = setInterval(() => {}, 1 << 30);

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
  })
  .finally(() => clearInterval(keepAlive));
