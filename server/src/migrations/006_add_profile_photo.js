exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('profile_photo')) {
    db.exec('ALTER TABLE users ADD COLUMN profile_photo TEXT');
  }
};
