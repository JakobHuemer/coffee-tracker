import { test, expect } from 'bun:test';

const {
  DEFAULT_HALF_LIFE_H, MIN_HALF_LIFE_H, MAX_HALF_LIFE_H, FULL_MG, MAX_POINTS,
  clampHalfLife, activeFromDose, activeMgAt, levelFromMg, emptyAt, stepMsFor, buildEnergy,
} = require('./energy');

const HALF_LIFE_H = DEFAULT_HALF_LIFE_H;

const HOUR = 3600000;

test('a dose contributes nothing before and at the moment it is drunk', () => {
  expect(activeFromDose(100, -1)).toBe(0);
  expect(activeFromDose(100, 0)).toBe(0);
});

test('absorption ramps up instead of jumping to the full dose', () => {
  const at5min = activeFromDose(100, 5 / 60);
  const at20min = activeFromDose(100, 20 / 60);
  expect(at5min).toBeLessThan(50);
  expect(at20min).toBeGreaterThan(at5min);
});

test('peaks near 40 minutes at just over 90% of the dose', () => {
  let best = { t: 0, mg: 0 };
  for (let m = 1; m <= 240; m++) {
    const mg = activeFromDose(100, m / 60);
    if (mg > best.mg) best = { t: m, mg };
  }
  expect(best.t).toBeGreaterThan(25);
  expect(best.t).toBeLessThan(55);
  expect(best.mg).toBeGreaterThan(88);
  expect(best.mg).toBeLessThan(95);
});

test('decays by roughly the half-life once absorption is done', () => {
  // Compared from the peak onward, where elimination dominates.
  const a = activeFromDose(100, 4);
  const b = activeFromDose(100, 4 + HALF_LIFE_H);
  expect(b / a).toBeGreaterThan(0.48);
  expect(b / a).toBeLessThan(0.52);
});

test('doses stack additively', () => {
  const now = Date.now();
  const doses = [
    { logged_at: now - 2 * HOUR, caffeine_mg: 63 },
    { logged_at: now - 1 * HOUR, caffeine_mg: 95 },
  ];
  const expected = activeFromDose(63, 2) + activeFromDose(95, 1);
  expect(activeMgAt(doses, now)).toBeCloseTo(expected, 6);
});

test('future doses never count toward the current level', () => {
  const now = Date.now();
  expect(activeMgAt([{ logged_at: now + HOUR, caffeine_mg: 150 }], now)).toBe(0);
});

test('level is a capped 0-100 battery reading', () => {
  expect(levelFromMg(0)).toBe(0);
  expect(levelFromMg(FULL_MG / 2)).toBe(50);
  expect(levelFromMg(FULL_MG)).toBe(100);
  expect(levelFromMg(FULL_MG * 3)).toBe(100);
});

test('empty_at lands after the last dose and is null once already empty', () => {
  const now = Date.now();
  const doses = [{ logged_at: now - HOUR, caffeine_mg: 95 }];
  const t = emptyAt(doses, now);
  expect(t).not.toBeNull();
  expect(t).toBeGreaterThan(now);
  expect(emptyAt([], now)).toBeNull();
});

test('step size keeps the series bounded for any window', () => {
  for (const hours of [1, 24, 168]) {
    const step = stepMsFor(hours * HOUR);
    expect(step).toBeGreaterThanOrEqual(60000);
    expect(Math.ceil((hours * HOUR) / step)).toBeLessThanOrEqual(MAX_POINTS);
  }
});

test('buildEnergy reports charging right after a coffee and draining later', () => {
  const now = Date.now();
  const fresh = buildEnergy([{ logged_at: now - 5 * 60000, caffeine_mg: 95 }], now, 24);
  expect(fresh.state).toBe('charging');

  const old = buildEnergy([{ logged_at: now - 3 * HOUR, caffeine_mg: 95 }], now, 24);
  expect(old.state).toBe('draining');

  expect(buildEnergy([], now, 24).state).toBe('empty');
});

test('buildEnergy series spans the window and ends exactly at now', () => {
  const now = Date.now();
  const out = buildEnergy([{ logged_at: now - 2 * HOUR, caffeine_mg: 63 }], now, 24);
  expect(out.series.length).toBeLessThanOrEqual(MAX_POINTS + 1);
  expect(out.series[0].t).toBe(now - 24 * HOUR);
  expect(out.series[out.series.length - 1].t).toBe(now);
  expect(out.level).toBe(out.series[out.series.length - 1].level);
  expect(out.window_hours).toBe(24);
  expect(out.full_mg).toBe(FULL_MG);
});

test('coffee from before the window still shows as residual level at the left edge', () => {
  const now = Date.now();
  const out = buildEnergy([{ logged_at: now - 26 * HOUR, caffeine_mg: 150 }], now, 24);
  expect(out.series[0].active_mg).toBeGreaterThan(0);
});

test('peak is the highest point of the returned series', () => {
  const now = Date.now();
  const out = buildEnergy([
    { logged_at: now - 20 * HOUR, caffeine_mg: 150 },
    { logged_at: now - 3 * HOUR, caffeine_mg: 63 },
  ], now, 24);
  const max = Math.max(...out.series.map(p => p.active_mg));
  expect(out.peak.active_mg).toBe(max);
});

test('only doses inside the window are listed', () => {
  const now = Date.now();
  const out = buildEnergy([
    { id: 'old', logged_at: now - 30 * HOUR, caffeine_mg: 95 },
    { id: 'in', logged_at: now - 2 * HOUR, caffeine_mg: 95 },
  ], now, 24);
  expect(out.doses.map(d => d.id)).toEqual(['in']);
});

test('zero-caffeine drinks do not move the battery', () => {
  const now = Date.now();
  const out = buildEnergy([{ logged_at: now - HOUR, caffeine_mg: 0 }], now, 24);
  expect(out.level).toBe(0);
  expect(out.state).toBe('empty');
});

// ── Per-user half-life ───────────────────────────────────────────────────────

test('clampHalfLife falls back to the default for anything unusable', () => {
  for (const bad of [null, undefined, '', 'abc', NaN, Infinity, 0, -3]) {
    expect(clampHalfLife(bad)).toBe(DEFAULT_HALF_LIFE_H);
  }
});

test('clampHalfLife clamps to the published range and keeps valid values', () => {
  expect(clampHalfLife(0.5)).toBe(MIN_HALF_LIFE_H);
  expect(clampHalfLife(99)).toBe(MAX_HALF_LIFE_H);
  expect(clampHalfLife(3.5)).toBe(3.5);
  expect(clampHalfLife('7')).toBe(7);
});

test('a shorter half-life decays faster than a longer one', () => {
  const fast = activeFromDose(100, 8, 3.5);
  const normal = activeFromDose(100, 8, 5);
  const slow = activeFromDose(100, 8, 7);
  expect(fast).toBeLessThan(normal);
  expect(normal).toBeLessThan(slow);
});

test('decay tracks whichever half-life is passed', () => {
  for (const hl of [2, 3.5, 5, 7, 9.5]) {
    const a = activeFromDose(100, 6, hl);
    const b = activeFromDose(100, 6 + hl, hl);
    expect(b / a).toBeGreaterThan(0.48);
    expect(b / a).toBeLessThan(0.52);
  }
});

test('a personal half-life changes the curve, the level and empty_at', () => {
  const now = Date.now();
  const doses = [{ logged_at: now - 6 * HOUR, caffeine_mg: 150 }];
  const fast = buildEnergy(doses, now, 24, 3.5);
  const slow = buildEnergy(doses, now, 24, 7);
  expect(fast.half_life_h).toBe(3.5);
  expect(slow.half_life_h).toBe(7);
  expect(fast.level).toBeLessThan(slow.level);
  expect(fast.empty_at).toBeLessThan(slow.empty_at);
});

test('an unset (null) half-life reports and uses the population default', () => {
  const now = Date.now();
  const doses = [{ logged_at: now - 3 * HOUR, caffeine_mg: 95 }];
  const unset = buildEnergy(doses, now, 24, null);
  const explicit = buildEnergy(doses, now, 24, DEFAULT_HALF_LIFE_H);
  expect(unset.half_life_h).toBe(DEFAULT_HALF_LIFE_H);
  expect(unset.level).toBe(explicit.level);
});

test('an out-of-range stored value is clamped, not honoured', () => {
  const now = Date.now();
  expect(buildEnergy([], now, 24, 500).half_life_h).toBe(MAX_HALF_LIFE_H);
  expect(buildEnergy([], now, 24, 0.1).half_life_h).toBe(MIN_HALF_LIFE_H);
});

test('the slowest metabolizer still gets a real empty_at, not null', () => {
  const now = Date.now();
  // A full battery at the slowest half-life is the worst case for the forecast
  // horizon — it must still resolve rather than reporting "unknown".
  const out = buildEnergy([{ logged_at: now - HOUR, caffeine_mg: 200 }], now, 24, MAX_HALF_LIFE_H);
  expect(out.empty_at).not.toBeNull();
});

test('residual caffeine from a slow metabolizer is not truncated at the left edge', () => {
  const now = Date.now();
  // 40 h back is beyond the old 36 h lookback but still ~4% of the dose at 9.5 h.
  const out = buildEnergy([{ logged_at: now - 40 * HOUR, caffeine_mg: 200 }], now, 24, MAX_HALF_LIFE_H);
  expect(out.series[0].active_mg).toBeGreaterThan(0);
});
