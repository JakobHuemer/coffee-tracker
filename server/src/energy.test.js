import { test, expect } from 'bun:test';

const {
  HALF_LIFE_H, FULL_MG, MAX_POINTS,
  activeFromDose, activeMgAt, levelFromMg, emptyAt, stepMsFor, buildEnergy,
} = require('./energy');

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
