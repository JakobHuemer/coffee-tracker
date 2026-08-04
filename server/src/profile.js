// Shared public-profile helpers. A user's public face — avatar, name, featured
// badges, headline stats — is shown in many places (the Compare view, the
// public profile page, feed post headers, competition rosters). Building that
// face lived only inside routes/compare.js; it moved here so every surface
// draws the identical shape from one source (VALUES.md rule 0.4).
const db = require('./db');
const images = require('./images');
const { BADGES } = require('./data/badges');
const { getCoffee } = require('./coffees');
const { getUserTz, localTodayStr, localDateStr } = require('./time');

// Headline stats for one user, in that user's own timezone. Same shape the
// Compare view has always rendered.
function buildUserStats(userId) {
  const allEntries = db.prepare(
    'SELECT coffee_id, caffeine_mg, logged_at FROM coffee_entries WHERE user_id = ? ORDER BY logged_at'
  ).all(userId);

  const tz = getUserTz(db, userId);
  const today = localTodayStr(tz);
  const todayEntries = allEntries.filter(e => localDateStr(e.logged_at, tz) === today);
  const sevenDayTotal = allEntries.filter(e => Date.now() - e.logged_at <= 7 * 86400000).length;

  const byType = {};
  for (const e of allEntries) byType[e.coffee_id] = (byType[e.coffee_id] || 0) + 1;
  const favouriteId = Object.entries(byType).sort(([, a], [, b]) => b - a)[0]?.[0];
  // A favourite later removed from the catalog resolves to null; the entries
  // themselves are self-contained and unaffected.
  const favourite = (favouriteId && getCoffee(favouriteId)) || null;

  const streak = db.prepare('SELECT * FROM user_streaks WHERE user_id = ?').get(userId);
  const achievements = db.prepare('SELECT COUNT(*) as cnt FROM user_achievements WHERE user_id = ?').get(userId);
  const badges = db.prepare('SELECT COUNT(*) as cnt FROM user_badges WHERE user_id = ?').get(userId);

  return {
    total_cups: allEntries.length,
    total_caffeine: allEntries.reduce((s, e) => s + e.caffeine_mg, 0),
    today_cups: todayEntries.length,
    today_caffeine: todayEntries.reduce((s, e) => s + e.caffeine_mg, 0),
    seven_day_avg: +(sevenDayTotal / 7).toFixed(1),
    favourite_coffee: favourite,
    unique_types: Object.keys(byType).length,
    current_streak: streak?.current_streak || 0,
    longest_streak: streak?.longest_streak || 0,
    achievements_count: achievements.cnt,
    badges_count: badges.cnt,
  };
}

// Rarest first, so a profile row leads with the flashiest badge.
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, secret: 5 };

// Every badge a user has unlocked, resolved to { id, name, icon, rarity,
// description } chips, ordered rarest first. There is no "featured" subset any
// more — a profile shows all the badges its owner has earned. `viewerId` is who
// is looking: a SECRET badge the viewer has not earned themselves is masked to
// ??? so viewing someone's profile can't spoil a hidden badge you haven't found.
function badgesFor(userId, viewerId) {
  return badgesForMany([userId], viewerId).get(userId) ?? [];
}

// Batched badgesFor: resolve many users in one query instead of per-row. Feed
// pages and leaderboards render one row per user, so a per-row lookup would be
// an N+1 that grows with the page. Returns Map<userId, chips>; a user with no
// badges is simply absent (callers default to []).
function badgesForMany(userIds, viewerId) {
  const ids = [...new Set(userIds)].filter(Boolean);
  const out = new Map();
  if (ids.length === 0) return out;

  const rows = db.prepare(
    `SELECT user_id, badge_id FROM user_badges WHERE user_id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);

  // The secret badges the viewer holds — the only secrets shown to them in full.
  // A viewer's own badges are in this set, so their own secrets are never masked.
  const viewerHas = viewerId
    ? new Set(db.prepare('SELECT badge_id FROM user_badges WHERE user_id = ?').all(viewerId).map(r => r.badge_id))
    : new Set();

  for (const r of rows) {
    const b = BADGES.find(x => x.id === r.badge_id);
    if (!b) continue; // an unlocked row for a badge dropped from the catalogue
    const list = out.get(r.user_id) ?? [];
    // Name and icon always show — you can see WHICH badge someone earned. But a
    // secret badge's description (how to get it) is withheld from a viewer who
    // hasn't earned it themselves, so a profile can't spoil how to unlock it.
    const hideHow = b.secret && !viewerHas.has(b.id);
    list.push({
      id: b.id, name: b.name, icon: b.icon, rarity: b.rarity,
      description: hideHow ? '' : b.description,
    });
    out.set(r.user_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (RARITY_RANK[b.rarity] ?? -1) - (RARITY_RANK[a.rarity] ?? -1));
  }
  return out;
}

// The full public profile object for one user row (as selected with id,
// username, avatar, profile_photo, image_id). Includes resolved photo urls,
// earned badges and headline stats. `self` marks the caller's own profile.
function publicProfileFor(userRow, { self = false, viewerId } = {}) {
  const { image_id, profile_photo, ...rest } = userRow;
  return {
    ...rest,
    self,
    profile_photo_url: profile_photo ? `/uploads/${profile_photo}` : null,
    profile_image: images.variantsFor(image_id),
    badges: badgesFor(userRow.id, viewerId),
    stats: buildUserStats(userRow.id),
  };
}

module.exports = {
  buildUserStats,
  badgesFor,
  badgesForMany,
  publicProfileFor,
};
