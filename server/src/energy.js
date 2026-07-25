// Buzz — the derived caffeine energy score.
//
// Nothing here is stored. The score is a pure function of a user's coffee
// entries (dose + instant) evaluated at a given instant, so it can never drift
// from the log and needs no migration. See docs/energy-score.md for the model.
//
// PURELY INSTANT DOMAIN (docs/time-and-timezones.md): every input and output is
// epoch milliseconds UTC. A duration is `now - then`; no timezone is involved,
// so this module must never import ../time.

// ── Pharmacokinetics ─────────────────────────────────────────────────────────
// One-compartment model with first-order absorption (Bateman function). Both
// constants come from measured caffeine PK, not from taste:
//
//   - Elimination half-life ~5 h in healthy adults (range 1.5–9.5 h).
//   - ~99% of an oral dose is absorbed within 45 min.
//
// Sources: Alsabri et al., "Kinetic and Dynamic Description of Caffeine"
// (J. Caffeine Adenosine Res., 2018); ISSN position stand on caffeine
// (J. Int. Soc. Sports Nutr., 2024).
const HALF_LIFE_H = 5;
const KE = Math.LN2 / HALF_LIFE_H;              // elimination rate constant, /h
const ABSORPTION_H = 0.75;                      // time to 99% absorbed
const KA = Math.log(100) / ABSORPTION_H;        // absorption rate constant, /h

// 100% Buzz. EFSA judges single doses up to 200 mg of caffeine to raise no
// safety concern for adults, which makes it the natural "full battery" mark.
// Source: EFSA Scientific Opinion on the safety of caffeine (EFSA Journal 2015;13(5):4102).
const FULL_MG = 200;

const HOUR_MS = 3600000;

// Caffeine still active in the body from a single dose, `elapsedH` hours after
// drinking it. Rises during absorption (a coffee does not hit instantly, same
// as a charger does not fill a battery instantly), peaks at ~38 min at ~92% of
// the dose, then decays with the elimination half-life.
function activeFromDose(doseMg, elapsedH) {
  if (!(elapsedH > 0) || !(doseMg > 0)) return 0;
  const f = (KA / (KA - KE)) * (Math.exp(-KE * elapsedH) - Math.exp(-KA * elapsedH));
  return doseMg * Math.max(0, f);
}

// Total active caffeine (mg) at instant `at`, summing every dose taken before it.
// `doses` is [{ logged_at, caffeine_mg }] — order does not matter.
function activeMgAt(doses, at) {
  let total = 0;
  for (const d of doses) {
    if (d.logged_at >= at) continue;
    total += activeFromDose(d.caffeine_mg, (at - d.logged_at) / HOUR_MS);
  }
  return total;
}

// Battery reading for `mg`: 0–100, capped like a real battery indicator.
function levelFromMg(mg) {
  return Math.min(100, Math.round((mg / FULL_MG) * 100));
}

// After this many hours a dose contributes < 1% of itself and is irrelevant to
// the current reading (7+ half-lives). Used to bound how far back doses are
// loaded for a window.
const DOSE_LIFETIME_H = 36;

// How far ahead the "runs empty at" estimate is allowed to look. Beyond this
// the answer stops being useful, so it is reported as unknown instead.
const FORECAST_MAX_H = 48;

// The instant the battery first drops below `threshold` percent, searching
// forward from `from`. Returns null if it is already below, or if it stays
// above for the whole forecast horizon (e.g. a dose still absorbing).
function emptyAt(doses, from, threshold = 1) {
  if (levelFromMg(activeMgAt(doses, from)) < threshold) return null;
  const step = 5 * 60000;
  for (let t = from + step; t <= from + FORECAST_MAX_H * HOUR_MS; t += step) {
    if (levelFromMg(activeMgAt(doses, t)) < threshold) return t;
  }
  return null;
}

// Sample every ~5 min at 24 h, coarsening for longer windows so the payload and
// the SVG path stay bounded regardless of the requested range.
const MAX_POINTS = 288;
function stepMsFor(windowMs) {
  return Math.max(60000, Math.ceil(windowMs / MAX_POINTS / 60000) * 60000);
}

// The full widget payload for a user's doses over the `hours` before `now`.
//
// `doses` must already include everything from `now - (hours + DOSE_LIFETIME_H)`
// onward, so caffeine drunk before the window still shows as a residual level at
// the window's left edge instead of the chart starting from a false zero.
function buildEnergy(doses, now, hours) {
  const windowMs = hours * HOUR_MS;
  const start = now - windowMs;
  const step = stepMsFor(windowMs);

  const series = [];
  let peak = { t: start, level: 0, active_mg: 0 };
  for (let t = start; t < now; t += step) {
    const mg = activeMgAt(doses, t);
    const point = { t, level: levelFromMg(mg), active_mg: +mg.toFixed(1) };
    series.push(point);
    if (point.active_mg > peak.active_mg) peak = point;
  }
  const nowMg = activeMgAt(doses, now);
  const nowPoint = { t: now, level: levelFromMg(nowMg), active_mg: +nowMg.toFixed(1) };
  series.push(nowPoint);
  if (nowPoint.active_mg > peak.active_mg) peak = nowPoint;

  // Charging vs draining is the slope at `now`, read one minute ahead. A coffee
  // logged in the last ~38 min is still being absorbed, so the level is rising.
  const aheadMg = activeMgAt(doses, now + 60000);
  const state = nowMg < 0.5 ? 'empty' : aheadMg > nowMg ? 'charging' : 'draining';

  return {
    level: nowPoint.level,
    active_mg: nowPoint.active_mg,
    full_mg: FULL_MG,
    state,
    half_life_h: HALF_LIFE_H,
    window_hours: hours,
    step_ms: step,
    now,
    peak,
    empty_at: emptyAt(doses, now),
    series,
    doses: doses
      .filter(d => d.logged_at >= start && d.logged_at <= now)
      .sort((a, b) => a.logged_at - b.logged_at),
  };
}

module.exports = {
  HALF_LIFE_H, KE, KA, FULL_MG, DOSE_LIFETIME_H, FORECAST_MAX_H, MAX_POINTS,
  activeFromDose, activeMgAt, levelFromMg, emptyAt, stepMsFor, buildEnergy,
};
