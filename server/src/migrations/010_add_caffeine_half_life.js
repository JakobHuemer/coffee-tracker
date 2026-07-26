// Per-user caffeine elimination half-life, in hours — the one parameter of the
// Buzz score that genuinely differs between people (roughly 2-3 h in fast
// CYP1A2 metabolizers vs 9-12 h in slow ones). See docs/energy-score.md.
//
// Nullable with no default on purpose: NULL means "this user never set one",
// which the server resolves to DEFAULT_HALF_LIFE_H at read time. Storing the
// default in the column instead would freeze today's value into every existing
// row and make a future change to the default invisible to them.
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('caffeine_half_life_h')) {
    db.exec('ALTER TABLE users ADD COLUMN caffeine_half_life_h REAL');
  }
};
