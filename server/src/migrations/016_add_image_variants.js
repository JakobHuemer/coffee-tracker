// 016 — responsive image variants (issue #15, phase 2).
//
// Moves images from the single-file scheme (coffee_entries.photo_path /
// users.profile_photo, one path each) to a queryable multi-variant one:
//
//   images          — one row per logical image (owner + original dimensions)
//   image_variants  — one row per stored file (format + width + path + bytes)
//
// and adds a nullable image_id pointer on both users of images. See
// docs/image-handling.md for the full plan.
//
// This migration is DB-only and MUST stay that way (it runs at boot, before
// routes mount). It never decodes or re-encodes a pixel — a boot migration that
// pushed every historical photo through a WASM codec would make startup
// unbounded and could fail-fast the whole process (VALUES 7) over one bad file.
// So step 2 below just *wraps* each existing file: the file on disk is never
// moved, renamed or rewritten, and photo_path / profile_photo are left in place
// (a later migration drops them once every reader uses image_id). The heavy
// re-encode into real sizes/formats is the separate, resumable backfill job
// (server/scripts/backfill-images.js), run once after this ships.
//
// Additive + idempotent, modelled on 004/006: every DDL step is guarded so a
// re-run (or a crash-then-retry) is a no-op.

// Recover the stored format from a legacy filename's extension. The upload MIME
// map only ever wrote jpg|png|webp|gif|heic|heif, so the extension alone
// classifies a legacy file with no decode needed. heif is an alias of heic.
function formatFromPath(p) {
  const ext = String(p).split('.').pop().toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'heif') return 'heic';
  if (ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'heic') return ext;
  return 'jpeg'; // matches the upload map's fallback
}

exports.up = (db) => {
  const { randomUUID } = require('crypto');

  // 1. DDL — create the two tables (idempotent via IF NOT EXISTS) and add the
  //    nullable image_id column to each existing user of images (guarded by
  //    PRAGMA table_info, exactly like 004/006).
  //
  //    image_id is a PLAIN column, not an inline FOREIGN KEY: SQLite's
  //    ALTER TABLE ADD COLUMN only accepts a REFERENCES clause under narrow
  //    rules and the delete-time cleanup already runs in code (it has to unlink
  //    files, which no cascade can do). The images/image_variants tables, being
  //    created fresh here, DO carry real FKs with ON DELETE CASCADE.
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      orig_width  INTEGER,          -- NULL until a decode fills it (backfill)
      orig_height INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS image_variants (
      image_id TEXT NOT NULL,
      format   TEXT NOT NULL,       -- 'webp'|'jpeg'|'png'|'gif'|'heic'
      width    INTEGER,             -- NULL for a legacy file of unknown size
      path     TEXT NOT NULL,
      bytes    INTEGER,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      UNIQUE(image_id, format, width)
    );

    CREATE INDEX IF NOT EXISTS idx_image_variants_image ON image_variants(image_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_image_variants_path ON image_variants(path);
  `);

  const entryCols = db.prepare('PRAGMA table_info(coffee_entries)').all().map(c => c.name);
  if (!entryCols.includes('image_id')) {
    db.prepare('ALTER TABLE coffee_entries ADD COLUMN image_id TEXT').run();
  }
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('image_id')) {
    db.prepare('ALTER TABLE users ADD COLUMN image_id TEXT').run();
  }

  // 2. Cheap wrap (DB-only) — give every existing file an images +
  //    image_variants row and point image_id at it. Guarded on image_id IS NULL
  //    so a re-run only fills what's missing. width/height/bytes stay NULL: they
  //    are unknown without decoding, which is the backfill job's work.
  const insImage = db.prepare(
    'INSERT INTO images (id, owner_id, created_at, orig_width, orig_height) VALUES (?, ?, ?, NULL, NULL)'
  );
  const insVariant = db.prepare(
    'INSERT INTO image_variants (image_id, format, width, path, bytes) VALUES (?, ?, NULL, ?, NULL)'
  );

  const entries = db.prepare(
    'SELECT id, user_id, created_at, logged_at, photo_path FROM coffee_entries WHERE photo_path IS NOT NULL AND image_id IS NULL'
  ).all();
  const setEntryImage = db.prepare('UPDATE coffee_entries SET image_id = ? WHERE id = ?');
  for (const e of entries) {
    const imageId = randomUUID();
    insImage.run(imageId, e.user_id, e.created_at ?? e.logged_at ?? Date.now());
    insVariant.run(imageId, formatFromPath(e.photo_path), e.photo_path);
    setEntryImage.run(imageId, e.id);
  }

  const profiles = db.prepare(
    'SELECT id, profile_photo FROM users WHERE profile_photo IS NOT NULL AND image_id IS NULL'
  ).all();
  const setUserImage = db.prepare('UPDATE users SET image_id = ? WHERE id = ?');
  for (const u of profiles) {
    const imageId = randomUUID();
    insImage.run(imageId, u.id, Date.now());
    insVariant.run(imageId, formatFromPath(u.profile_photo), u.profile_photo);
    setUserImage.run(imageId, u.id);
  }
};

// Exported for reuse by the backfill job so the extension→format mapping lives
// in exactly one place.
exports.formatFromPath = formatFromPath;
