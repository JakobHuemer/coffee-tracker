exports.up = function (db) {
  const cols = db.prepare('PRAGMA table_info(coffee_entries)').all().map(c => c.name);
  if (!cols.includes('photo_path'))
    db.prepare('ALTER TABLE coffee_entries ADD COLUMN photo_path TEXT').run();
  if (!cols.includes('description'))
    db.prepare('ALTER TABLE coffee_entries ADD COLUMN description TEXT').run();
  if (!cols.includes('is_public'))
    db.prepare('ALTER TABLE coffee_entries ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1').run();
};
