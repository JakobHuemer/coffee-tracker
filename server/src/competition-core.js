// Competitions — the pure math. Spec: docs/competitions-elo.md.
//
// Deliberately free of any DB import so it can be unit-tested without opening
// the database. Everything that touches SQLite lives in ./competitions.js.
//
// Two layers, never mixed:
//   1. score  — single-player, accumulating, per-metric, never zero-sum.
//   2. rating — consumes participants' scores for ONE match, ranks them, and
//               settles a zero-sum delta. Never reads raw metrics directly.

// ── Tuning surface ───────────────────────────────────────────────────────────
// Changing these only affects matches settled after the change; settled
// match_participants rows are an immutable log and are never recomputed.

const WEIGHTS = { caffeine: 0.45, cups: 0.35, variety: 0.20 };

// Half-credit points of the saturating curve: f(k) = 0.5.
const SATURATION = { caffeine: 200, cups: 3, variety: 2 };

const BASE_RATING = 1000;
const ELO_SCALE = 400;

// K lives on the match row, picked from the mode at creation time. Daily fires
// ~365x/year on one day's luck so it stays low-weight; weekly aggregates 7 days
// and sits well above it; 1v1/ondemand are rare and deliberate so they take the
// full classic weight; team sits below that because the team-level delta is
// split across members afterwards.
const K_BY_MODE = { daily: 8, weekly: 20, '1v1': 32, ondemand: 32, team: 24 };

const MODES = Object.keys(K_BY_MODE);

// Softmax temperature for the team contribution split.
const SHARE_TEMPERATURE = 1;

// ── Layer 1: performance score ───────────────────────────────────────────────

// Saturating curve x / (x + k): maps [0, inf) -> [0, 1), zero at zero, with
// diminishing returns so one huge day cannot dwarf the whole field.
function saturate(x, k) {
  const v = Math.max(0, Number(x) || 0);
  return v / (v + k);
}

// Weighted sum of the three normalised metrics. Result is in [0, 1).
function performanceScore({ caffeine = 0, cups = 0, variety = 0 } = {}) {
  return (
    WEIGHTS.caffeine * saturate(caffeine, SATURATION.caffeine) +
    WEIGHTS.cups * saturate(cups, SATURATION.cups) +
    WEIGHTS.variety * saturate(variety, SATURATION.variety)
  );
}

// Display form of a score: an integer 0..1000, so the UI never renders a float.
function scorePoints(score) {
  return Math.round(score * 1000);
}

// ── Layer 2: rating ──────────────────────────────────────────────────────────

// Standard Elo logistic on the usual 400-point scale.
function expectedScore(rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / ELO_SCALE));
}

// `actual` is RANK, not magnitude: only the ordering of two scores matters.
// Margin is the score layer's concern — a saturating curve already absorbs it,
// and letting it back in here would make Elo swing harder on a blowout than on
// a close finish.
function actualFromRank(score, opponentScore) {
  if (score > opponentScore) return 1;
  if (score < opponentScore) return 0;
  return 0.5;
}

// Ratings move in whole points only, and the whole-number deltas still have to
// add up to the match total exactly. Largest-remainder apportionment does both:
// floor every raw delta, then hand the leftover units to the entries with the
// biggest fractional part.
//
// The sum is exact by construction — the result is built from `total` minus the
// floors, never by re-adding the floats — so float error in `raw` cannot leak
// into the ledger. `leftover` is therefore always in [0, raw.length]: each floor
// gives away less than 1, and `sum(raw)` is `total`.
//
// Ties on the fractional part go to the earlier entry, which makes a settlement
// a pure function of participant order (`joined_at` at the call site).
function apportion(raw, total) {
  const floors = raw.map((v) => Math.floor(v));
  const leftover = total - floors.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let j = 0; j < leftover; j++) floors[byFraction[j].i] += 1;
  return floors;
}

// Free-for-all over N participants, decomposed into all N*(N-1)/2 pairs.
//
//   E_ij    = 1 / (1 + 10^((R_j - R_i)/400))
//   delta_i = K/(N-1) * sum_{j!=i} (A_ij - E_ij)
//
// Zero-sum is STRUCTURAL, not tested-after-the-fact: A_ij + A_ji = 1 and
// E_ij + E_ji = 1 always, so every pair's contribution to sum(delta_i) cancels
// exactly, for any N, any K, any rating spread. `apportion` then makes the
// deltas whole without spending that guarantee.
//
// A consequence of whole points: a mismatch lopsided enough that the raw delta
// is under half a point settles at 0 for everyone. Nobody's rating moves, which
// is the honest outcome — there was nothing there to win.
//
// There is deliberately NO floor/clamp on the resulting rating. A MIN_RATING
// clamp would break zero-sum the moment a participant hit it — the clamped
// amount would vanish from the ledger instead of landing on the other side of
// the match. A rating floor, if ever wanted, is display-only and must never
// feed back into rating_before.
//
// participants: [{ userId, rating, score }]  ->  [{ userId, delta, ratingAfter }]
function settleFfa(participants, k) {
  const n = participants.length;
  if (n < 2) throw new Error('settleFfa needs at least 2 participants');

  const raw = participants.map((p) => {
    let sum = 0;
    for (const q of participants) {
      if (q === p) continue;
      sum += actualFromRank(p.score, q.score) - expectedScore(p.rating, q.rating);
    }
    return (k / (n - 1)) * sum;
  });

  // Whole points, still summing to the zero the raw deltas sum to.
  const deltas = apportion(raw, 0);

  return participants.map((p, i) => ({
    userId: p.userId,
    delta: deltas[i],
    ratingBefore: p.rating,
    ratingAfter: p.rating + deltas[i],
  }));
}

// Softmax over scores. Keeps close scores near-equal but stops crushing the
// bottom performer as the gap widens (unlike a raw S_i/sum ratio, which
// punishes linearly). Also handles an all-zero-score team for free: exp(0) = 1
// for everyone, so the pot splits evenly with no separate fallback.
function contributionShares(scores, temperature = SHARE_TEMPERATURE) {
  const exps = scores.map((s) => Math.exp(s / temperature));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Team match (x vs y). Settle the team-level result first, then split each
// side's pot by contribution share.
//
//   P_A = K * (A_A - E_A),  P_B = -P_A
//   winning side: delta_i = P * share_i                 (sums to P)
//   losing side:  delta_i = P * (1 - share_i)/(n - 1)   (sums to P)
//
// Each side needs n >= 2: a side of one is the 1v1 mode, and the losing split
// would divide by zero.
//
// teamA/teamB: [{ userId, rating, score }]
function settleTeams(teamA, teamB, k) {
  if (teamA.length < 2 || teamB.length < 2) {
    throw new Error('settleTeams needs at least 2 members per side');
  }

  const rA = mean(teamA.map((p) => p.rating));
  const rB = mean(teamB.map((p) => p.rating));
  const sA = mean(teamA.map((p) => p.score));
  const sB = mean(teamB.map((p) => p.score));

  const eA = expectedScore(rA, rB);
  const aA = actualFromRank(sA, sB);
  // The pot is settled as a whole number first, so a side's whole-point split
  // can still sum to exactly the pot it was given.
  const pA = Math.round(k * (aA - eA));
  const pB = -pA;

  // The side holding the positive pot splits it by share; the other side
  // spreads its (negative) pot by inverse share. A drawn match that also lands
  // on E = 0.5 gives P = 0, so every delta is 0 with no special case.
  const aIsWinning = pA >= 0;

  function split(team, pot, isWinning) {
    const shares = contributionShares(team.map((p) => p.score));
    const raw = shares.map((share) => (
      isWinning ? pot * share : pot * ((1 - share) / (team.length - 1))
    ));
    const deltas = apportion(raw, pot);
    return team.map((p, i) => ({
      userId: p.userId,
      delta: deltas[i],
      share: shares[i],
      ratingBefore: p.rating,
      ratingAfter: p.rating + deltas[i],
    }));
  }

  return [
    ...split(teamA, pA, aIsWinning).map((r) => ({ ...r, side: 'A' })),
    ...split(teamB, pB, !aIsWinning).map((r) => ({ ...r, side: 'B' })),
  ];
}

module.exports = {
  WEIGHTS, SATURATION, BASE_RATING, ELO_SCALE, K_BY_MODE, MODES, SHARE_TEMPERATURE,
  saturate, performanceScore, scorePoints,
  expectedScore, actualFromRank, apportion, settleFfa, contributionShares, settleTeams,
};
