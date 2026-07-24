exports.up = function (db) {
  const cols = db.prepare('PRAGMA table_info(coffee_entries)').all().map(c => c.name);
  if (!cols.includes('created_at')) {
    db.prepare('ALTER TABLE coffee_entries ADD COLUMN created_at INTEGER').run();
    // Backfill existing rows so the column is never NULL.
    db.prepare('UPDATE coffee_entries SET created_at = logged_at WHERE created_at IS NULL').run();
  }
};
