// 022 — drop users.featured_badges.
//
// The "featured badges" selection (pick up to 3 badges to show off) was removed:
// a profile now shows ALL the badges its owner has earned, resolved live from
// user_badges (see server/src/profile.js). That leaves the featured_badges
// column (added in 002) with nothing reading or writing it, so it goes. Badge
// unlocks themselves live in user_badges and are untouched — no earned badge is
// lost by this. Guarded so it is idempotent.
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.includes('featured_badges')) {
    db.exec('ALTER TABLE users DROP COLUMN featured_badges');
  }
};
