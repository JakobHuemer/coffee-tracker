import { test, expect } from 'bun:test';

const {
  POINT_WEIGHTS, MARGIN_SCALE, BASE_RATING, ELO_SCALE, K_BY_MODE, MODES,
  points, expectedScore, actualFromMargin, apportion, settleFfa,
} = require('./competition-core');

// The fixtures ARE the specification (docs/competitions-rating-v2.md, "Tests"):
// they were generated from the reference implementation in that document and
// reviewed before being frozen. A failure here means the implementation is
// wrong. Never edit a fixture to make a test pass.
const scoringFixture = require('../../docs/fixtures/rating-v2/scoring.json');
const ratingFixture = require('../../docs/fixtures/rating-v2/rating.json');

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const allWhole = (xs) => xs.every((x) => Number.isInteger(x));

// Deterministic PRNG so a failing random case is reproducible from the seed.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── the fixtures describe THESE constants ────────────────────────────────────

// Both files are denominated in points, so a weight change silently re-scales
// every margin in rating.json as well. This is the tripwire the spec asks for:
// move a constant without regenerating the fixtures and the suite says so here,
// rather than in eighteen unrelated failures further down.
test('the frozen fixtures were generated at the constants this file ships', () => {
  expect(scoringFixture.pointWeights).toEqual(POINT_WEIGHTS);
  expect(ratingFixture.pointWeights).toEqual(POINT_WEIGHTS);
  expect(scoringFixture.marginScale).toBe(MARGIN_SCALE);
  expect(ratingFixture.marginScale).toBe(MARGIN_SCALE);
  for (const c of ratingFixture.cases) expect(c.marginScale).toBe(MARGIN_SCALE);
});

// ── layer 1: points ──────────────────────────────────────────────────────────

test.each(scoringFixture.cases.map((c) => [c.name, c]))(
  'points — %s',
  (_name, c) => {
    expect(points(c.metrics)).toBe(c.expect.points);
  },
);

test('points are linear and uncapped — the Nth cup is worth the first', () => {
  const one = points({ caffeine: 63, cups: 1, variety: 1 });
  const twelve = points({ caffeine: 63 * 12, cups: 12, variety: 1 });
  // Twelve identical drinks minus the variety credit counted once.
  expect(twelve).toBe(one * 12 - POINT_WEIGHTS.variety * 11);
  // Nothing saturates: a hundred times the input is a hundred times the points.
  expect(points({ caffeine: 100000, cups: 1000, variety: 100 }))
    .toBe(100 * points({ caffeine: 1000, cups: 10, variety: 1 }));
});

test('a window with nothing in it is worth exactly 0', () => {
  expect(points({ caffeine: 0, cups: 0, variety: 0 })).toBe(0);
  expect(points()).toBe(0);
});

test('points never go negative, whatever the metrics say', () => {
  expect(points({ caffeine: -500, cups: -3, variety: -2 })).toBe(0);
  // A junk metric contributes nothing; the others still count.
  expect(points({ caffeine: NaN, cups: 2, variety: 1 })).toBe(45);
});

test('points are always a whole number, rounded once at the end', () => {
  // Two halves round up together (0.5 + 0.5 = 1), where rounding per term would
  // have produced 2.
  expect(points({ caffeine: 0.5, cups: 0, variety: 0.5 / POINT_WEIGHTS.variety })).toBe(1);
  const rand = rng(20260728);
  for (let i = 0; i < 500; i++) {
    expect(Number.isInteger(points({
      caffeine: rand() * 900, cups: rand() * 20, variety: rand() * 8,
    }))).toBe(true);
  }
});

// ── layer 2: rating primitives ───────────────────────────────────────────────

test('equal ratings expect a draw, and expectations sum to 1', () => {
  expect(expectedScore(1000, 1000)).toBe(0.5);
  expect(expectedScore(1200, 900) + expectedScore(900, 1200)).toBeCloseTo(1, 12);
});

test('actual comes from the MARGIN, so a near-miss is not a thrashing', () => {
  expect(actualFromMargin(400, 400)).toBe(0.5);
  expect(actualFromMargin(0, 0)).toBe(0.5); // nobody logged: drawn match
  // 25 points ahead is worth far less than 200 ahead — the v1 defect was that
  // both paid the same.
  expect(actualFromMargin(425, 400)).toBeLessThan(actualFromMargin(600, 400));
  expect(actualFromMargin(425, 400)).toBeGreaterThan(0.5);

  // Calibration, straight off the D=150 column of the table in
  // docs/competitions-rating-v2.md. Note where 76/24 actually lands: at HALF a
  // MARGIN_SCALE of gap, since 10^-0.5 = 0.316. A full MARGIN_SCALE is 10^-1,
  // i.e. 91/9 — the same factor-of-two the classic "400 points is 76%" gloss on
  // ELO_SCALE gets loose about.
  expect(actualFromMargin(450, 400)).toBeCloseTo(0.68, 2);
  expect(actualFromMargin(600, 400)).toBeCloseTo(0.96, 2);
  expect(actualFromMargin(400 + MARGIN_SCALE / 2, 400)).toBeCloseTo(0.76, 2);
  expect(actualFromMargin(400 + MARGIN_SCALE, 400)).toBeCloseTo(0.91, 2);
});

test('the margin logistic is antisymmetric — this is what makes settlement zero-sum', () => {
  const rand = rng(11235);
  for (let i = 0; i < 500; i++) {
    const a = rand() * 2000;
    const b = rand() * 2000;
    expect(actualFromMargin(a, b) + actualFromMargin(b, a)).toBeCloseTo(1, 12);
  }
});

test('the margin saturates, so running up the score stops paying', () => {
  // Past ~4x MARGIN_SCALE the logistic is within a rounding error of 1.
  expect(actualFromMargin(4 * MARGIN_SCALE, 0)).toBeGreaterThan(0.9999);
  expect(actualFromMargin(40 * MARGIN_SCALE, 0)).toBeLessThanOrEqual(1);
});

// ── apportionment (whole-number deltas, issue #49) ───────────────────────────

test('apportion hands out whole numbers that hit the target sum exactly', () => {
  const rand = rng(49490);
  for (let trial = 0; trial < 500; trial++) {
    const n = 2 + Math.floor(rand() * 7);
    const total = Math.floor(rand() * 61) - 30;
    // Random split of `total` into n reals, so the input genuinely sums to it.
    const cuts = Array.from({ length: n - 1 }, () => rand()).sort((a, b) => a - b);
    const raw = [...cuts, 1].map((c, i) => (c - (i === 0 ? 0 : cuts[i - 1])) * total);

    const out = apportion(raw, total);
    expect(allWhole(out)).toBe(true);
    expect(sum(out)).toBe(total);
    // Largest remainder never moves anyone a full point off their real share.
    for (let i = 0; i < n; i++) expect(Math.abs(out[i] - raw[i])).toBeLessThan(1);
  }
});

test('apportion breaks fractional ties by position, so it is order-deterministic', () => {
  expect(apportion([1.5, -1.5], 0)).toEqual([2, -2]);
  expect(apportion([-1.5, 1.5], 0)).toEqual([-1, 1]);
  expect(apportion([0.5, 0.5, 0.5, -1.5], 0)).toEqual([1, 1, 0, -2]);
});

test('apportion leaves values that are already whole untouched', () => {
  expect(apportion([16, -16], 0)).toEqual([16, -16]);
  expect(apportion([0, 0, 0], 0)).toEqual([0, 0, 0]);
});

test('apportion absorbs float drift between the raw values and the target', () => {
  expect(apportion([-1e-17, -1e-17, -1e-17], 0)).toEqual([0, 0, 0]);
  expect(sum(apportion([-7.000000000000001, -7.000000000000001, -7.000000000000001], -21))).toBe(-21);
  expect(sum(apportion([4.999999999, 5.000000001, -10], 0))).toBe(0);
});

test('a zero delta is positive zero, never negative zero', () => {
  // -0 would survive into the ledger and make an exact `toBe(0)` fail later.
  for (const d of apportion([-0, -0], -0)) expect(Object.is(d, 0)).toBe(true);
  const drawn = settleFfa(
    [{ userId: 'a', rating: BASE_RATING, score: 0 }, { userId: 'b', rating: BASE_RATING, score: 0 }],
    K_BY_MODE['1v1'],
  );
  for (const r of drawn) expect(Object.is(r.delta, 0)).toBe(true);
});

// ── layer 2: settlement, against the frozen fixtures ─────────────────────────

const ratingCases = ratingFixture.cases.map((c) => [c.name, c]);

// A fixture case as settleFfa wants it. `points` is the score the rating layer
// consumes — the fixtures name it `points` because that is what layer 1 now
// produces.
const asParticipants = (c) => c.participants.map((p) => ({
  userId: p.name, rating: p.rating, score: p.points,
}));

test.each(ratingCases)('settle — %s', (_name, c) => {
  const rows = settleFfa(asParticipants(c), c.k);
  for (const want of c.expect) {
    const got = rows.find((r) => r.userId === want.name);
    expect(got.delta).toBe(want.delta);
    expect(got.ratingAfter).toBe(want.ratingAfter);
  }
});

// The three invariants the spec asserts over EVERY case in the file, not
// per-case. They are properties of the formula, so a new fixture inherits them
// without anyone having to remember to write them.

test.each(ratingCases)('settle is zero-sum — %s', (_name, c) => {
  // Exactly zero, not close to it: whole-number deltas have no float residue.
  expect(sum(settleFfa(asParticipants(c), c.k).map((r) => r.delta))).toBe(0);
});

test.each(ratingCases)('every delta is a whole number — %s', (_name, c) => {
  const rows = settleFfa(asParticipants(c), c.k);
  expect(allWhole(rows.map((r) => r.delta))).toBe(true);
  expect(allWhole(rows.map((r) => r.ratingAfter))).toBe(true);
});

test.each(ratingCases)('more points never pays less, at equal ratings — %s', (_name, c) => {
  const rows = settleFfa(asParticipants(c), c.k);
  const byName = new Map(rows.map((r) => [r.userId, r]));
  for (const p of c.participants) {
    for (const q of c.participants) {
      if (p.rating !== q.rating || p.points <= q.points) continue;
      expect(byName.get(p.name).delta).toBeGreaterThanOrEqual(byName.get(q.name).delta);
    }
  }
});

// ── layer 2: structural properties beyond the fixtures ───────────────────────

test('FFA is zero-sum for random N, ratings and point spreads', () => {
  const rand = rng(20260726);
  for (let trial = 0; trial < 400; trial++) {
    const n = 3 + Math.floor(rand() * 6); // N in [3, 8]
    const participants = Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      rating: 400 + rand() * 1800,
      score: Math.round(rand() * 1200),
    }));
    const k = K_BY_MODE.daily + rand() * 60;
    expect(sum(settleFfa(participants, k).map((r) => r.delta))).toBe(0);
  }
});

test('every FFA delta is a whole number, in every mode', () => {
  const rand = rng(31337);
  for (let trial = 0; trial < 400; trial++) {
    const n = 2 + Math.floor(rand() * 7); // N in [2, 8]
    const participants = Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      rating: 400 + rand() * 1800,
      score: Math.round(rand() * 1200),
    }));
    const mode = MODES[Math.floor(rand() * MODES.length)];
    const rows = settleFfa(participants, K_BY_MODE[mode]);
    expect(allWhole(rows.map((r) => r.delta))).toBe(true);
    expect(allWhole(rows.map((r) => r.ratingAfter - r.ratingBefore))).toBe(true);
    expect(sum(rows.map((r) => r.delta))).toBe(0);
  }
});

test('a 1v1 between EQUAL ratings tops out at K/2', () => {
  // The K/2 figure in the spec's tuning table is a property of equal ratings,
  // not a cap: delta is K*(A - E), and E is only 0.5 when the ratings match.
  // An 800-point margin saturates A at ~1, so this is the most an evenly-rated
  // pair can move.
  for (const k of Object.values(K_BY_MODE)) {
    const [winner, loser] = settleFfa(
      [{ userId: 'a', rating: BASE_RATING, score: 1200 }, { userId: 'b', rating: BASE_RATING, score: 400 }],
      k,
    );
    expect(winner.delta).toBe(k / 2); // saturated: this margin is worth the lot
    expect(loser.delta).toBe(-winner.delta);
  }
});

test('a rating mismatch CAN move more than K/2 — the real bound is K', () => {
  // Not a defect and not a cap being breached: A and E are each in (0, 1), so
  // K*(A - E) is bounded by K, and only by K/2 when E = 0.5. A favourite who
  // loses to an underdog is the case that exceeds it, and the spec's own frozen
  // `favourite underperforms` fixture settles at ±64 on K=80 for exactly this
  // reason. Read the tuning table's "max 1v1 swing" column as the even-matchup
  // swing, not a limit.
  const [favourite, underdog] = settleFfa(
    [{ userId: 'fav', rating: 1200, score: 400 }, { userId: 'dog', rating: 900, score: 600 }],
    K_BY_MODE['1v1'],
  );
  expect(favourite.delta).toBe(-64);
  expect(Math.abs(favourite.delta)).toBeGreaterThan(K_BY_MODE['1v1'] / 2);
  expect(Math.abs(favourite.delta)).toBeLessThan(K_BY_MODE['1v1']);
  expect(favourite.delta + underdog.delta).toBe(0);

  // The bound that actually holds, over the whole tuning table.
  const rand = rng(64064);
  for (let i = 0; i < 2000; i++) {
    const k = K_BY_MODE[MODES[Math.floor(rand() * MODES.length)]];
    const rows = settleFfa([
      { userId: 'a', rating: rand() * 2400, score: Math.round(rand() * 1500) },
      { userId: 'b', rating: rand() * 2400, score: Math.round(rand() * 1500) },
    ], k);
    for (const r of rows) expect(Math.abs(r.delta)).toBeLessThanOrEqual(k);
  }
});

test('a runner-up near the lead and one near the tail do NOT settle alike', () => {
  // The defect v2 exists to fix: under v1's rank-only actual, `second` took the
  // identical delta in both of these.
  const near = settleFfa([
    { userId: 'first', rating: BASE_RATING, score: 900 },
    { userId: 'second', rating: BASE_RATING, score: 850 },
    { userId: 'third', rating: BASE_RATING, score: 650 },
  ], K_BY_MODE['1v1']);
  const far = settleFfa([
    { userId: 'first', rating: BASE_RATING, score: 900 },
    { userId: 'second', rating: BASE_RATING, score: 700 },
    { userId: 'third', rating: BASE_RATING, score: 650 },
  ], K_BY_MODE['1v1']);

  const secondNear = near.find((r) => r.userId === 'second').delta;
  const secondFar = far.find((r) => r.userId === 'second').delta;
  expect(secondNear).toBeGreaterThan(0);   // a near-miss is a good result
  expect(secondFar).toBeLessThan(0);       // trailing the field is not
  expect(secondNear).not.toBe(secondFar);
});

test('nobody moves when every score is equal — including an all-zero match', () => {
  for (const score of [0, 500]) {
    const rows = settleFfa(
      [0, 1, 2].map((i) => ({ userId: `u${i}`, rating: BASE_RATING, score })),
      K_BY_MODE.daily,
    );
    for (const r of rows) expect(r.delta).toBe(0);
  }
});

test('a favourite who underperforms loses more than an equal would', () => {
  const asEqual = settleFfa(
    [{ userId: 'a', rating: BASE_RATING, score: 400 }, { userId: 'b', rating: BASE_RATING, score: 600 }],
    K_BY_MODE['1v1'],
  );
  const asFavourite = settleFfa(
    [{ userId: 'a', rating: BASE_RATING + 300, score: 400 }, { userId: 'b', rating: BASE_RATING - 300, score: 600 }],
    K_BY_MODE['1v1'],
  );
  expect(asFavourite.find((r) => r.userId === 'a').delta)
    .toBeLessThan(asEqual.find((r) => r.userId === 'a').delta);
});

test('a larger field settles more gently than a 1v1 on the same margins', () => {
  // K/(N-1) is what bounds total movement as N grows.
  const heads = settleFfa([
    { userId: 'a', rating: BASE_RATING, score: 800 },
    { userId: 'b', rating: BASE_RATING, score: 200 },
  ], K_BY_MODE.ondemand);
  const field = settleFfa([
    { userId: 'a', rating: BASE_RATING, score: 800 },
    { userId: 'b', rating: BASE_RATING, score: 200 },
    { userId: 'c', rating: BASE_RATING, score: 500 },
    { userId: 'd', rating: BASE_RATING, score: 500 },
  ], K_BY_MODE.ondemand);
  expect(field.find((r) => r.userId === 'a').delta)
    .toBeLessThan(heads.find((r) => r.userId === 'a').delta);
});

test('a participant who logged nothing loses to anyone who scored above 0', () => {
  const [active, idle] = settleFfa(
    [{ userId: 'a', rating: BASE_RATING, score: 300 }, { userId: 'b', rating: BASE_RATING, score: 0 }],
    K_BY_MODE['1v1'],
  );
  expect(active.delta).toBeGreaterThan(0);
  expect(idle.delta).toBeLessThan(0);
  expect(active.delta + idle.delta).toBe(0);
});

test('a mismatch too lopsided to be worth a whole point moves nobody', () => {
  // E is ~1 for the favourite and the margin agrees, so there is no fraction of
  // a point to hand over.
  const rows = settleFfa(
    [{ userId: 'a', rating: 2400, score: 900 }, { userId: 'b', rating: 5, score: 0 }],
    K_BY_MODE.daily,
  );
  for (const r of rows) expect(r.delta).toBe(0);
});

test('ratingAfter is never floored — a big loss can push below any floor', () => {
  const rows = settleFfa(
    [{ userId: 'a', rating: 300, score: 900 }, { userId: 'b', rating: 3, score: 0 }],
    K_BY_MODE['1v1'],
  );
  const loser = rows.find((r) => r.userId === 'b');
  expect(loser.ratingAfter).toBeLessThan(0);
  expect(sum(rows.map((r) => r.delta))).toBe(0);
});

test('FFA needs at least two participants', () => {
  expect(() => settleFfa([{ userId: 'a', rating: BASE_RATING, score: 500 }], 80)).toThrow();
});

test('team mode is gone — no mode, no K, no settlement function', () => {
  expect(MODES).toEqual(['daily', 'weekly', '1v1', 'ondemand']);
  expect(K_BY_MODE.team).toBeUndefined();
  expect(require('./competition-core').settleTeams).toBeUndefined();
  expect(require('./competition-core').actualFromRank).toBeUndefined();
  expect(require('./competition-core').scorePoints).toBeUndefined();
  expect(require('./competition-core').performanceScore).toBeUndefined();
});

test('ELO_SCALE and BASE_RATING are the v1 values and must stay there', () => {
  // BASE_RATING is baked into every settled rating_before in the database.
  expect(ELO_SCALE).toBe(400);
  expect(BASE_RATING).toBe(1000);
});

// ── pool simulation ──────────────────────────────────────────────────────────

test('several hundred mixed matches leave the pool mean exactly where it started', () => {
  const rand = rng(777);
  const pool = Array.from({ length: 40 }, (_, i) => ({
    userId: `p${i}`,
    rating: BASE_RATING + Math.round((rand() - 0.5) * 200),
    skill: rand(),
  }));
  const before = sum(pool.map((p) => p.rating)) / pool.length;
  const ratingOf = new Map(pool.map((p) => [p.userId, p.rating]));

  const pick = (count) => {
    const shuffled = [...pool].sort(() => rand() - 0.5);
    return shuffled.slice(0, count).map((p) => ({
      userId: p.userId,
      rating: ratingOf.get(p.userId),
      // A day's points, skill plus noise. Uncapped, so no clamp here either.
      score: Math.max(0, Math.round((p.skill + (rand() - 0.5) * 0.3) * 900)),
    }));
  };

  for (let m = 0; m < 600; m++) {
    const roll = rand();
    const rows = roll < 0.5
      ? settleFfa(pick(2 + Math.floor(rand() * 7)), K_BY_MODE.daily)
      : roll < 0.75
        ? settleFfa(pick(2), K_BY_MODE['1v1'])
        : settleFfa(pick(3 + Math.floor(rand() * 4)), K_BY_MODE.weekly);
    for (const r of rows) ratingOf.set(r.userId, r.ratingAfter);
  }

  const after = sum([...ratingOf.values()]) / pool.length;
  // Not "within noise" and not "close to" — whole-number zero-sum deltas
  // conserve the pool total bit for bit. Any drift at all is a broken formula.
  expect(after).toBe(before);
  // And a pool that started whole is still whole 600 matches later.
  expect(allWhole([...ratingOf.values()])).toBe(true);
});
