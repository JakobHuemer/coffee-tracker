// The v1 settlement math, frozen.
//
// This is a verbatim copy of what `competition-core.js` held when
// `015_resettle_whole_point_elo.js` was written: rank-based `actualFromRank`,
// the softmax team split, and the FFA/team settlements built on them. It exists
// so that migration keeps replaying history through the exact functions it was
// authored against.
//
// competition-core.js has since moved to rating v2 (margin-based `A_ij`, no team
// mode — docs/competitions-rating-v2.md). Pointing 015 at the live core instead
// would re-settle old matches under rules that did not exist when they were
// played, which v2 forbids outright: settled matches are immutable.
//
// **Nothing but a migration may import this file, and nothing in it may ever
// change.** It is a historical record, not shared code. New settlement logic
// belongs in competition-core.js.

const SHARE_TEMPERATURE = 1;

// Standard Elo logistic on the usual 400-point scale. Identical to v2's — the
// expected-score side never changed — but duplicated here so this file does not
// depend on the living core at all.
function expectedScore(rating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

// v1's `actual`: RANK, not magnitude. v2 replaced this with a margin logistic.
function actualFromRank(score, opponentScore) {
  if (score > opponentScore) return 1;
  if (score < opponentScore) return 0;
  return 0.5;
}

// Largest-remainder apportionment: floor every raw delta, hand the leftover
// units to the biggest fractional parts. Ties go to the earlier entry, so a
// settlement is a pure function of participant order.
function apportion(raw, total) {
  const floors = raw.map((v) => Math.floor(v) + 0);
  const leftover = total - floors.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let j = 0; j < leftover; j++) floors[byFraction[j].i] += 1;
  return floors;
}

// Free-for-all over N participants, decomposed into all N*(N-1)/2 pairs, with
// `actual` taken from rank.
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

  const deltas = apportion(raw, 0);

  return participants.map((p, i) => ({
    userId: p.userId,
    delta: deltas[i],
    ratingBefore: p.rating,
    ratingAfter: p.rating + deltas[i],
  }));
}

// Softmax over scores, used to split a team's pot by contribution.
function contributionShares(scores, temperature = SHARE_TEMPERATURE) {
  const exps = scores.map((s) => Math.exp(s / temperature));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Team match (x vs y): settle the team-level result, then split each side's pot
// by contribution share. Dropped entirely in v2.
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
  const pA = Math.round(k * (aA - eA));
  const pB = -pA;

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
  SHARE_TEMPERATURE,
  expectedScore, actualFromRank, apportion,
  settleFfa, contributionShares, settleTeams,
};
