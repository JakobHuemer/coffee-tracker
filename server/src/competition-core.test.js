import { test, expect } from 'bun:test';

const {
  BASE_RATING, K_BY_MODE,
  saturate, performanceScore, scorePoints,
  expectedScore, actualFromRank, apportion, settleFfa, contributionShares, settleTeams,
} = require('./competition-core');

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

// ── score layer ──────────────────────────────────────────────────────────────

test('saturate maps 0 to 0 and the half-credit point to 0.5', () => {
  expect(saturate(0, 200)).toBe(0);
  expect(saturate(200, 200)).toBe(0.5);
  expect(saturate(-50, 200)).toBe(0); // negatives clamp, never go below zero
});

test('a user who logged nothing scores exactly 0', () => {
  expect(performanceScore({ caffeine: 0, cups: 0, variety: 0 })).toBe(0);
  expect(performanceScore()).toBe(0);
});

test('score stays inside [0, 1) no matter how extreme the day', () => {
  const huge = performanceScore({ caffeine: 1e9, cups: 1e9, variety: 1e9 });
  expect(huge).toBeGreaterThan(0.99);
  expect(huge).toBeLessThan(1);
});

test('score is monotone in every metric', () => {
  const base = { caffeine: 100, cups: 2, variety: 2 };
  expect(performanceScore({ ...base, caffeine: 200 })).toBeGreaterThan(performanceScore(base));
  expect(performanceScore({ ...base, cups: 3 })).toBeGreaterThan(performanceScore(base));
  expect(performanceScore({ ...base, variety: 3 })).toBeGreaterThan(performanceScore(base));
});

test('caffeine carries the most weight but stays under half', () => {
  const onlyCaf = performanceScore({ caffeine: 1e9 });
  expect(onlyCaf).toBeGreaterThan(performanceScore({ cups: 1e9 }));
  expect(onlyCaf).toBeLessThan(0.5);
});

test('scorePoints renders an integer 0..1000', () => {
  expect(scorePoints(0)).toBe(0);
  expect(Number.isInteger(scorePoints(performanceScore({ caffeine: 250, cups: 4, variety: 3 })))).toBe(true);
});

// ── rating primitives ────────────────────────────────────────────────────────

test('equal ratings expect a draw, and expectations sum to 1', () => {
  expect(expectedScore(1000, 1000)).toBe(0.5);
  expect(expectedScore(1200, 900) + expectedScore(900, 1200)).toBeCloseTo(1, 12);
});

test('actual is rank only — margin never leaks in', () => {
  expect(actualFromRank(0.9, 0.1)).toBe(1);
  expect(actualFromRank(0.51, 0.5)).toBe(1); // a hair ahead counts the same as a blowout
  expect(actualFromRank(0.5, 0.5)).toBe(0.5);
  expect(actualFromRank(0, 0)).toBe(0.5);    // nobody logged: drawn match
  expect(actualFromRank(0.1, 0.9)).toBe(0);
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

// ── FFA ──────────────────────────────────────────────────────────────────────

test('FFA is zero-sum for random N, ratings and scores', () => {
  const rand = rng(20260726);
  for (let trial = 0; trial < 400; trial++) {
    const n = 3 + Math.floor(rand() * 6); // N in [3, 8]
    const participants = Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      rating: 400 + rand() * 1800,
      score: rand(),
    }));
    const k = K_BY_MODE.daily + rand() * 30;
    const deltas = settleFfa(participants, k).map((r) => r.delta);
    // Exactly zero, not close to it: whole numbers have no float residue.
    expect(sum(deltas)).toBe(0);
  }
});

test('every FFA delta is a whole number, in every mode', () => {
  const rand = rng(31337);
  for (let trial = 0; trial < 400; trial++) {
    const n = 2 + Math.floor(rand() * 7); // N in [2, 8]
    const participants = Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      rating: 400 + rand() * 1800,
      score: rand(),
    }));
    const mode = Object.keys(K_BY_MODE)[Math.floor(rand() * Object.keys(K_BY_MODE).length)];
    const rows = settleFfa(participants, K_BY_MODE[mode]);
    expect(allWhole(rows.map((r) => r.delta))).toBe(true);
    expect(allWhole(rows.map((r) => r.ratingAfter - r.ratingBefore))).toBe(true);
    expect(sum(rows.map((r) => r.delta))).toBe(0);
  }
});

test('a whole-number delta never lands more than a point off the raw Elo change', () => {
  // The raw change for the favourite here is K*(1 - E) with E from the ratings.
  const k = 20;
  const rows = settleFfa(
    [{ userId: 'a', rating: 1240, score: 0.7 }, { userId: 'b', rating: 1000, score: 0.2 }],
    k,
  );
  const raw = k * (1 - expectedScore(1240, 1000));
  const a = rows.find((r) => r.userId === 'a');
  expect(Math.abs(a.delta - raw)).toBeLessThan(1);
  expect(a.delta).toBe(Math.round(raw)); // no tie in play, so it is plain rounding
});

test('a mismatch too lopsided to be worth a whole point moves nobody', () => {
  // K*(1 - E) here is ~3e-5, and there is no fraction of a point to hand over.
  const rows = settleFfa(
    [{ userId: 'a', rating: 2400, score: 0.9 }, { userId: 'b', rating: 5, score: 0 }],
    32,
  );
  for (const r of rows) expect(r.delta).toBe(0);
  expect(sum(rows.map((r) => r.delta))).toBe(0);
});

test('FFA at N=2 reduces to classic head-to-head Elo, rounded to whole points', () => {
  const k = 32;
  const [a, b] = settleFfa(
    [{ userId: 'a', rating: 1200, score: 0.6 }, { userId: 'b', rating: 1000, score: 0.4 }],
    k,
  );
  const expectedA = expectedScore(1200, 1000);
  expect(a.delta).toBe(Math.round(k * (1 - expectedA)));
  expect(b.delta).toBe(-a.delta); // the loser pays exactly what the winner takes
  expect(a.delta + b.delta).toBe(0);
});

test('an all-tie FFA between equal ratings moves nobody', () => {
  const rows = settleFfa(
    [0, 1, 2].map((i) => ({ userId: `u${i}`, rating: BASE_RATING, score: 0.3 })),
    K_BY_MODE.daily,
  );
  for (const r of rows) expect(r.delta).toBeCloseTo(0, 12);
});

test('a participant who logged nothing loses to anyone who scored above 0', () => {
  const [active, idle] = settleFfa(
    [{ userId: 'a', rating: 1000, score: 0.4 }, { userId: 'b', rating: 1000, score: 0 }],
    32,
  );
  expect(active.delta).toBeGreaterThan(0);
  expect(idle.delta).toBeLessThan(0);
  expect(active.delta + idle.delta).toBeCloseTo(0, 12);
});

test('ratingAfter is never floored — a big loss can push below any floor', () => {
  const rows = settleFfa(
    [{ userId: 'a', rating: 300, score: 0.9 }, { userId: 'b', rating: 3, score: 0 }],
    32,
  );
  const loser = rows.find((r) => r.userId === 'b');
  expect(loser.ratingAfter).toBeLessThan(0);
  expect(sum(rows.map((r) => r.delta))).toBe(0);
});

test('FFA needs at least two participants', () => {
  expect(() => settleFfa([{ userId: 'a', rating: 1000, score: 0.5 }], 32)).toThrow();
});

// ── teams ────────────────────────────────────────────────────────────────────

test('contribution shares sum to 1 and split an all-zero team evenly', () => {
  expect(sum(contributionShares([0.9, 0.3, 0.1]))).toBeCloseTo(1, 12);
  const even = contributionShares([0, 0, 0, 0]);
  for (const s of even) expect(s).toBeCloseTo(0.25, 12);
});

test('team match is zero-sum overall and each side splits exactly its pot', () => {
  const rand = rng(4242);
  for (let trial = 0; trial < 300; trial++) {
    const sizeA = 2 + Math.floor(rand() * 4);
    const sizeB = 2 + Math.floor(rand() * 4);
    const mk = (p) => Array.from({ length: p }, (_, i) => ({
      userId: `${p}-${i}-${trial}`, rating: 400 + rand() * 1800, score: rand(),
    }));
    const teamA = mk(sizeA);
    const teamB = mk(sizeB);

    const rows = settleTeams(teamA, teamB, K_BY_MODE.team);
    expect(sum(rows.map((r) => r.delta))).toBe(0);

    const potA = sum(rows.filter((r) => r.side === 'A').map((r) => r.delta));
    const potB = sum(rows.filter((r) => r.side === 'B').map((r) => r.delta));
    expect(potA + potB).toBe(0);
  }
});

test('every team delta is a whole number, and each side still splits its whole pot', () => {
  const rand = rng(490049);
  for (let trial = 0; trial < 300; trial++) {
    const mk = (p) => Array.from({ length: p }, (_, i) => ({
      userId: `${p}-${i}-${trial}`, rating: 400 + rand() * 1800, score: rand(),
    }));
    const teamA = mk(2 + Math.floor(rand() * 4));
    const teamB = mk(2 + Math.floor(rand() * 4));

    const rows = settleTeams(teamA, teamB, K_BY_MODE.team);
    expect(allWhole(rows.map((r) => r.delta))).toBe(true);
    expect(sum(rows.map((r) => r.delta))).toBe(0);
    // The pot itself is whole, so no side can be handed a fraction to divide.
    const potA = sum(rows.filter((r) => r.side === 'A').map((r) => r.delta));
    expect(Number.isInteger(potA)).toBe(true);
    expect(Math.abs(potA)).toBeLessThanOrEqual(K_BY_MODE.team);
  }
});

test('on the winning side the bigger contributor earns more', () => {
  const teamA = [
    { userId: 'carry', rating: 1000, score: 0.9 },
    { userId: 'idle', rating: 1000, score: 0.0 },
  ];
  const teamB = [
    { userId: 'x', rating: 1000, score: 0.1 },
    { userId: 'y', rating: 1000, score: 0.1 },
  ];
  const rows = settleTeams(teamA, teamB, K_BY_MODE.team);
  const carry = rows.find((r) => r.userId === 'carry');
  const idle = rows.find((r) => r.userId === 'idle');
  expect(carry.delta).toBeGreaterThan(idle.delta);
  expect(idle.delta).toBeGreaterThan(0); // still a win for the whole side
});

test('on the losing side the bigger contributor loses less', () => {
  const teamA = [
    { userId: 'x', rating: 1000, score: 0.8 },
    { userId: 'y', rating: 1000, score: 0.8 },
  ];
  const teamB = [
    { userId: 'tried', rating: 1000, score: 0.5 },
    { userId: 'idle', rating: 1000, score: 0.0 },
  ];
  const rows = settleTeams(teamA, teamB, K_BY_MODE.team);
  const tried = rows.find((r) => r.userId === 'tried');
  const idle = rows.find((r) => r.userId === 'idle');
  expect(tried.delta).toBeLessThan(0);
  expect(idle.delta).toBeLessThan(tried.delta); // idle loses more
});

test('an evenly matched drawn team game moves nobody', () => {
  const teamA = [
    { userId: 'a1', rating: 1000, score: 0.5 },
    { userId: 'a2', rating: 1000, score: 0.5 },
  ];
  const teamB = [
    { userId: 'b1', rating: 1000, score: 0.5 },
    { userId: 'b2', rating: 1000, score: 0.5 },
  ];
  for (const r of settleTeams(teamA, teamB, K_BY_MODE.team)) expect(r.delta).toBeCloseTo(0, 12);
});

test('a side of one is rejected — that is 1v1, not a team', () => {
  const solo = [{ userId: 'a', rating: 1000, score: 0.5 }];
  const pair = [
    { userId: 'b', rating: 1000, score: 0.5 },
    { userId: 'c', rating: 1000, score: 0.5 },
  ];
  expect(() => settleTeams(solo, pair, 24)).toThrow();
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
      score: Math.max(0, Math.min(0.999, p.skill + (rand() - 0.5) * 0.3)),
    }));
  };

  for (let m = 0; m < 600; m++) {
    const roll = rand();
    let rows;
    if (roll < 0.5) {
      rows = settleFfa(pick(2 + Math.floor(rand() * 7)), K_BY_MODE.daily);
    } else if (roll < 0.75) {
      rows = settleFfa(pick(2), K_BY_MODE['1v1']);
    } else {
      const members = pick(4 + 2 * Math.floor(rand() * 2));
      const half = members.length / 2;
      rows = settleTeams(members.slice(0, half), members.slice(half), K_BY_MODE.team);
    }
    for (const r of rows) ratingOf.set(r.userId, r.ratingAfter);
  }

  const after = sum([...ratingOf.values()]) / pool.length;
  // Not "within noise" and not "close to" — whole-number zero-sum deltas
  // conserve the pool total bit for bit. Any drift at all is a broken formula.
  expect(after).toBe(before);
  // And a pool that started whole is still whole 600 matches later.
  expect(allWhole([...ratingOf.values()])).toBe(true);
});
