// Competitions — the pure math. Spec: docs/competitions-rating-v2.md.
//
// docs/competitions-elo.md describes v1 and every match settled under it. It is
// history, not a description of this file. Settled matches are never recomputed:
// v2 applies to matches settled after it shipped, and nothing back-fills.
//
// Deliberately free of any DB import so it can be unit-tested without opening
// the database. Everything that touches SQLite lives in ./competitions.js.
//
// Two layers, never mixed:
//   1. points — single-player, linear, uncapped, never zero-sum.
//   2. rating — consumes participants' points for ONE match and settles a
//               zero-sum delta from the score MARGIN. Never reads raw metrics.

// ── Tuning surface ───────────────────────────────────────────────────────────
// Changing these only affects matches settled after the change; settled
// match_participants rows are an immutable log and are never recomputed.
// docs/competitions-rating-v2.md documents what has to be re-derived alongside
// each one — in particular, moving a POINT_WEIGHT silently re-scales
// MARGIN_SCALE, because both are denominated in points.

// Points per unit of each metric: caffeine per mg, cups per logged entry,
// variety per distinct coffee_id. Linear and uncapped — the Nth cup is worth
// exactly what the first was, and one new kind of drink is worth one extra cup.
const POINT_WEIGHTS = { caffeine: 1, cups: 15, variety: 15 };

// Score gap, in points, at which a matchup is roughly 76/24 rather than 50/50.
// Small D makes every win look like a blowout; large D flattens everything
// toward a draw.
const MARGIN_SCALE = 150;

// Rating gap at which the favourite is expected to score 76/24. Classic Elo.
const ELO_SCALE = 400;

// Starting rating for an unrated user. Baked into every settled rating_before
// in the database — moving it would make historical rows incomparable.
const BASE_RATING = 1000;

// K lives on the match row, copied from here at creation time, so a match keeps
// the K it was created with even if this table changes before it settles. The
// most a rating can move in a two-player match is K/2, and less in a bigger
// field. Daily fires ~365x/year on one day's luck so it stays low-weight;
// weekly aggregates 7 days and is a far better sample; 1v1/ondemand are rare and
// deliberate, so they carry the full ±40 swing v2 targets.
const K_BY_MODE = { daily: 24, weekly: 48, '1v1': 80, ondemand: 80 };

const MODES = Object.keys(K_BY_MODE);

// ── Layer 1: points ──────────────────────────────────────────────────────────

// Linear, uncapped, zero for a user who logged nothing. There is no saturating
// curve and no display transform: the number this returns is the number the UI
// shows, raw. A weekly window is legitimately worth several times a daily one.
//
// Rounded once, at the end — not per term.
function points({ caffeine = 0, cups = 0, variety = 0 } = {}) {
  return Math.round(
    POINT_WEIGHTS.caffeine * Math.max(0, Number(caffeine) || 0)
    + POINT_WEIGHTS.cups * Math.max(0, Number(cups) || 0)
    + POINT_WEIGHTS.variety * Math.max(0, Number(variety) || 0)
  );
}

// ── Layer 2: rating ──────────────────────────────────────────────────────────

// Standard Elo logistic on the usual 400-point scale.
function expectedScore(rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / ELO_SCALE));
}

// `actual` is the score MARGIN, not rank: being 50 points behind the leader and
// 200 ahead of third is a materially different result from being 200 behind and
// 50 ahead, and the two must not settle identically (v1's rank-only form made
// them identical, which is the defect v2 exists to fix).
//
// It is the same Bradley-Terry logistic the expected-score side uses, and for
// the same structural reason: A_ij + A_ji = 1 by construction, which is what
// keeps the settlement zero-sum. A normalised score share would not be.
//
// It saturates: past roughly 4 * MARGIN_SCALE the result is within a rounding
// error of 1, so running up the score stops paying.
function actualFromMargin(score, opponentScore) {
  return 1 / (1 + Math.pow(10, (opponentScore - score) / MARGIN_SCALE));
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
  // `+ 0` folds Math.floor(-0) back to 0, so a zero delta is never the negative
  // zero that would make `delta === 0` pass but `Object.is(delta, 0)` fail.
  const floors = raw.map((v) => Math.floor(v) + 0);
  const leftover = total - floors.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let j = 0; j < leftover; j++) floors[byFraction[j].i] += 1;
  return floors;
}

// Free-for-all over N participants, decomposed into all N*(N-1)/2 pairs.
//
//   A_ij    = 1 / (1 + 10^((P_j - P_i)/MARGIN_SCALE))
//   E_ij    = 1 / (1 + 10^((R_j - R_i)/ELO_SCALE))
//   delta_i = K/(N-1) * sum_{j!=i} (A_ij - E_ij)
//
// Zero-sum is STRUCTURAL, not tested-after-the-fact: A_ij + A_ji = 1 and
// E_ij + E_ji = 1 always, so every pair's contribution to sum(delta_i) cancels
// exactly, for any N, any K, any rating spread, any score spread. `apportion`
// then makes the deltas whole without spending that guarantee.
//
// The K/(N-1) divisor is what keeps total movement bounded as the field grows,
// so a larger match settles more gently than a 1v1.
//
// Nobody moves when every score is equal — including when everyone scored zero,
// where A_ij = 0.5 for every pair. An empty match needs no special case.
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
      sum += actualFromMargin(p.score, q.score) - expectedScore(p.rating, q.rating);
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

module.exports = {
  POINT_WEIGHTS, MARGIN_SCALE, BASE_RATING, ELO_SCALE, K_BY_MODE, MODES,
  points, expectedScore, actualFromMargin, apportion, settleFfa,
};
