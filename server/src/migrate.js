// Lightweight forward-only migration runner.
//
// Migrations live in ./migrations as NNN_description.js, each exporting an
// `up(db)` function (optionally `manualTransaction = true` if it must control
// its own transaction / PRAGMAs — see 003). They run in ascending numeric
// order. Each applied migration is recorded in the `schema_migrations` table;
// a migration whose version is already recorded is skipped. Any failure aborts
// the process (fail-fast) rather than leaving the DB half-migrated and serving.
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function loadMigrations() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.js$/.test(f));

  const migrations = files.map((file) => {
    const version = parseInt(file.split('_')[0], 10);
    const mod = require(path.join(MIGRATIONS_DIR, file));
    if (typeof mod.up !== 'function') {
      throw new Error(`Migration ${file} must export an up(db) function`);
    }
    return { version, file, up: mod.up, manualTransaction: !!mod.manualTransaction };
  });

  // Order by the parsed numeric version, not the filename string, so an
  // unpadded future name (e.g. 20_ vs 100_) still applies in numeric order.
  migrations.sort((a, b) => a.version - b.version);

  // Reject duplicate version numbers — ambiguous ordering is never acceptable.
  const seen = new Set();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
  return migrations;
}

// One-time compatibility for databases created before this runner existed:
// they carry the schema produced by the old inline blocks in db.js but have no
// schema_migrations table. Mark the historical migrations (1-3) as applied ONLY
// where their end-state already holds, so the runner never re-executes a
// destructive rebuild against live data. Any historical migration whose effect
// is NOT yet present is left unrecorded and will run normally below.
function bootstrapLegacy(db) {
  const hasRows = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c > 0;
  if (hasRows) return; // already managed by this runner

  const usersExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'")
    .get();
  if (!usersExists) return; // brand-new DB — let every migration run normally

  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  const now = Date.now();

  record.run(1, now); // 001 init — tables exist
  if (cols.includes('featured_badges')) record.run(2, now); // 002 — column present
  if (!cols.includes('email')) record.run(3, now); // 003 — email already dropped
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  bootstrapLegacy(db);

  const migrations = loadMigrations();
  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  for (const m of migrations) {
    if (isApplied.get(m.version)) continue;

    try {
      if (m.manualTransaction) {
        // Migration owns its own transaction; record after it returns.
        m.up(db);
        record.run(m.version, Date.now());
      } else {
        // Wrap migration + its bookkeeping in one transaction so an applied
        // migration is always recorded atomically with its effect.
        db.exec('BEGIN');
        m.up(db);
        record.run(m.version, Date.now());
        db.exec('COMMIT');
      }
      console.log(`Applied migration ${m.file}`);
    } catch (err) {
      if (!m.manualTransaction) {
        try { db.exec('ROLLBACK'); } catch (_) { /* no active txn */ }
      }
      console.error(`FATAL: migration ${m.file} failed. Refusing to start.`);
      console.error(err);
      process.exit(1);
    }
  }
}

module.exports = migrate;
