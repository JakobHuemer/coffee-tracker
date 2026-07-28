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
// docs/competitions-rating-v2.1.md documents what has to be re-derived alongside
// each one — in particular, moving a POINT_WEIGHT silently re-scales the margin,
// because MARGIN_PER_DAY is denominated in the same points.

// Points per unit of each metric: caffeine per mg, cups per logged entry,
// variety per distinct coffee_id. Linear and uncapped — the Nth cup is worth
// exactly what the first was, and one new kind of drink is worth one extra cup.
const POINT_WEIGHTS = { caffeine: 1, cups: 15, variety: 15 };

// The margin scale grows with the window (v2.1): a weekly accumulates ~7x a
// daily's points, so a fixed gap threshold would grade the two on completely
// different curves. Instead the scale is derived per match from its duration —
// see marginScaleFor(). MARGIN_PER_DAY is the gap, per day of window, that grades
// as roughly 90/10; MARGIN_FLOOR is the shortest window's scale, below which a
// single drink would be an automatic shutout.
const MARGIN_PER_DAY = 500;
const MARGIN_FLOOR = 150;
const DAY_MS = 86400000;

// Rating gap at which the favourite is expected to score ~91/9 (a full scale;
// 76/24 lands at half of it). Classic Elo.
const ELO_SCALE = 400;

// Starting rating for an unrated user. Baked into every settled rating_before
// in the database — moving it would make historical rows incomparable.
const BASE_RATING = 1000;

// One K for every mode (v2.1). Daily, weekly, ondemand and 1v1 settle
// identically — the duration-scaled margin already grades a short window's
// closeness, so K no longer has to also dampen it. The only thing that
// distinguishes daily/weekly is that the server opens them automatically. K is
// copied onto the match row at creation, so a match keeps the K it was created
// with; v1 matches keep whatever K they were created with. ~40 is the swing an
// emphatic 1v1 produces (delta is K*(A-E), so K/2 between equal ratings).
const K = 80;

// Retained as a map keyed by every current mode so callers can index it by
// `match.mode` exactly as before; every entry is the single K above.
const K_BY_MODE = { daily: K, weekly: K, '1v1': K, ondemand: K };

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

// The margin scale for one match, from its window length (v2.1). `scopeEnd` is
// inclusive, so the window is (end - start + 1) ms. Grows linearly with duration
// above the floor: ~7.2h and shorter all sit at MARGIN_FLOOR; a daily is 500, a
// weekly 3500. Derived rather than stored — it is a pure function of scope_start
// and scope_end, which are already on the match row, already immutable, and
// already shown to participants.
//
// A whole match uses ONE scale, applied to every pair in it. It may differ
// between matches but must never vary within one, or the zero-sum antisymmetry
// (A_ij + A_ji = 1) breaks.
function marginScaleFor(scopeStart, scopeEnd) {
  const durationMs = scopeEnd - scopeStart + 1;
  return Math.max(MARGIN_FLOOR, MARGIN_PER_DAY * (durationMs / DAY_MS));
}

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
// It saturates: past roughly 4 * marginScale the result is within a rounding
// error of 1, so running up the score stops paying. `marginScale` comes from
// marginScaleFor() at the call site.
function actualFromMargin(score, opponentScore, marginScale) {
  return 1 / (1 + Math.pow(10, (opponentScore - score) / marginScale));
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
//   A_ij    = 1 / (1 + 10^((P_j - P_i)/marginScale))
//   E_ij    = 1 / (1 + 10^((R_j - R_i)/ELO_SCALE))
//   delta_i = K/(N-1) * sum_{j!=i} (A_ij - E_ij)
//
// `marginScale` is one value for the whole match — marginScaleFor(scope_start,
// scope_end) at the call site. Passing it in (rather than reading a module
// constant) is what lets a daily and a weekly grade on curves matched to their
// own length while every pair inside one match still shares a scale.
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
function settleFfa(participants, k, marginScale) {
  const n = participants.length;
  if (n < 2) throw new Error('settleFfa needs at least 2 participants');

  const raw = participants.map((p) => {
    let sum = 0;
    for (const q of participants) {
      if (q === p) continue;
      sum += actualFromMargin(p.score, q.score, marginScale) - expectedScore(p.rating, q.rating);
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
  POINT_WEIGHTS, MARGIN_PER_DAY, MARGIN_FLOOR, BASE_RATING, ELO_SCALE,
  K, K_BY_MODE, MODES,
  points, marginScaleFor, expectedScore, actualFromMargin, apportion, settleFfa,
};
