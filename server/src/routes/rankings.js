const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { checkBadgeForRanking } = require('../achievements');
const { BASE_RATING } = require('../competition-core');

const router = express.Router();

// GET /api/rankings?period=daily|weekly|alltime
//
// The board is a global Elo ladder (issue #40): matches settled in Competitions
// produce a real rating in `user_ratings`, and that is the sort key. Cups and
// caffeine are display columns for the selected period, not the ranking — a
// player logging litres of coffee no longer outranks a better competitor.
// Each row also carries the player's group, like a normal Elo ladder.
//
// Unrated players (`matches = 0`) sort last, whatever their rating: the default
// 1000 must never place someone who has never played above an active player
// sitting just below it. Their rating is still shown, but they rank after
// everyone who has actually settled a match.
router.get('/', requireAuth, (req, res) => {
  const { period = 'alltime' } = req.query;

  let cutoff = 0;
  if (period === 'daily')  cutoff = Date.now() - 86400000;
  if (period === 'weekly') cutoff = Date.now() - 7 * 86400000;

  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar,
           COUNT(ce.id) AS cups,
           COALESCE(SUM(ce.caffeine_mg), 0) AS total_caffeine,
           COALESCE(r.rating, ?) AS rating,
           COALESCE(r.matches, 0) AS matches,
           g.name AS group_name
    FROM users u
    LEFT JOIN coffee_entries ce ON ce.user_id = u.id AND ce.logged_at >= ?
    LEFT JOIN user_ratings r ON r.user_id = u.id
    LEFT JOIN group_members gm ON gm.user_id = u.id
    LEFT JOIN competition_groups g ON g.id = gm.group_id
    GROUP BY u.id
    ORDER BY (COALESCE(r.matches, 0) = 0), COALESCE(r.rating, ?) DESC
    LIMIT 50
  `).all(BASE_RATING, cutoff, BASE_RATING);

  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  // The rank_1 badge goes to the leader of the all-time board — now the top of
  // the Elo ladder. Never award it when the leader is unrated (an empty ladder
  // where nobody has settled a match), or it would land on an arbitrary row.
  if (period === 'alltime' && ranked.length > 0 && ranked[0].matches > 0) {
    checkBadgeForRanking(ranked[0].id);
  }

  const myRank = ranked.find(r => r.id === req.user.id);
  res.json({ rankings: ranked, my_rank: myRank || null });
});

module.exports = router;
