// Re-evaluate every already-settled match under the whole-point settlement
// (issue #49) and reassign the Elo it moved, so history is not left telling two
// stories: fractional deltas on old matches, whole ones from here on.
//
// Settlement is a pure function of (rating_before, score, k), and only the
// rating layer changed — scores are untouched — so this replays the stored
// scores through the same settleFfa/settleTeams the live code now uses. It does
// NOT re-score from coffee_entries: the per-participant `score` written at
// settlement is the immutable record of that window, and re-reading raw entries
// (which may have been edited or deleted since) would change what the match was.
//
// The replay is chronological because each match's rating_before is the running
// rating the previous matches left behind. Ordering is (settled_at, id): a total
// order, so the result is deterministic rather than dependent on SQLite row
// order. Matches that share a settled_at (a restart can settle a whole tick at
// one instant) are ordered by their UUID — arbitrary, but the replay is still
// whole and zero-sum whatever that order is, and only a match whose window
// overlaps another's for a shared player is even sensitive to it.
//
// user_ratings is a derived cache, so it is rebuilt wholesale from the replay:
// every row in it traces to a settlement, and no settled match is ever undone.
const { BASE_RATING, settleFfa, settleTeams } = require('../competition-core');

exports.up = (db) => {
  const matches = db.prepare(
    "SELECT id, mode, k_factor, settled_at FROM matches WHERE state = 'settled' ORDER BY settled_at, id"
  ).all();
  if (matches.length === 0) return; // fresh or match-less DB — nothing to reassign

  const loadRoster = db.prepare(
    'SELECT user_id, side, score FROM match_participants WHERE match_id = ? ORDER BY joined_at, user_id'
  );
  const updateParticipant = db.prepare(`
    UPDATE match_participants
    SET contribution_share = ?, rating_before = ?, rating_after = ?, delta = ?
    WHERE match_id = ? AND user_id = ?
  `);

  const ratings = new Map();  // user_id -> running rating
  const counts = new Map();   // user_id -> settled matches played
  const updated = new Map();  // user_id -> settled_at of their latest match
  const ratingOf = (id) => (ratings.has(id) ? ratings.get(id) : BASE_RATING);

  for (const match of matches) {
    const roster = loadRoster.all(match.id);
    const players = roster.map((r) => ({
      userId: r.user_id,
      side: r.side,
      rating: ratingOf(r.user_id),
      score: r.score ?? 0,
    }));

    let results;
    if (match.mode === 'team') {
      results = settleTeams(
        players.filter((p) => p.side === 'A'),
        players.filter((p) => p.side === 'B'),
        match.k_factor,
      );
    } else {
      results = settleFfa(players, match.k_factor);
    }

    for (const r of results) {
      updateParticipant.run(r.share ?? null, r.ratingBefore, r.ratingAfter, r.delta, match.id, r.userId);
      ratings.set(r.userId, r.ratingAfter);
      counts.set(r.userId, (counts.get(r.userId) || 0) + 1);
      updated.set(r.userId, match.settled_at ?? Date.now());
    }
  }

  // Rebuild the cache from the replay: delete first so a user whose every match
  // somehow vanished cannot keep a stale row, then re-insert exactly the users a
  // settlement touched.
  db.prepare('DELETE FROM user_ratings').run();
  const insertRating = db.prepare(
    'INSERT INTO user_ratings (user_id, rating, matches, updated_at) VALUES (?, ?, ?, ?)'
  );
  for (const [userId, rating] of ratings) {
    insertRating.run(userId, rating, counts.get(userId), updated.get(userId));
  }
};
