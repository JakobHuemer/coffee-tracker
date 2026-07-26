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
//   - Elimination half-life ~5 h in healthy adults (range 1.5–9.5 h). This one
//     is per-user — see DEFAULT_HALF_LIFE_H below.
//   - ~99% of an oral dose is absorbed within 45 min.
//
// Sources: Alsabri et al., "Kinetic and Dynamic Description of Caffeine"
// (J. Caffeine Adenosine Res., 2018); ISSN position stand on caffeine
// (J. Int. Soc. Sports Nutr., 2024).
// The half-life is the one parameter that genuinely differs between people
// (CYP1A2 activity: ~2-3 h in fast metabolizers, ~9-12 h in slow ones), so it
// is per-user and passed in rather than fixed here. 5 h is the population mean,
// used for anyone who has not set their own. `ke` is derived per call from it.
const DEFAULT_HALF_LIFE_H = 5;
const MIN_HALF_LIFE_H = 1.5;
const MAX_HALF_LIFE_H = 9.5;
const ABSORPTION_H = 0.75;                      // time to 99% absorbed
const KA = Math.log(100) / ABSORPTION_H;        // absorption rate constant, /h

// Absorption is not meaningfully personal (it is gastric emptying, not enzyme
// activity), so KA stays fixed for everyone.

// Coerce anything — a NULL column, a stale client value, a string, NaN — into a
// usable half-life. Out-of-range numbers are clamped to the published 1.5-9.5 h
// span rather than rejected, so a bad value can never produce a nonsense curve.
function clampHalfLife(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HALF_LIFE_H;
  return Math.min(MAX_HALF_LIFE_H, Math.max(MIN_HALF_LIFE_H, n));
}

// 100% Buzz. EFSA judges single doses up to 200 mg of caffeine to raise no
// safety concern for adults, which makes it the natural "full battery" mark.
// Source: EFSA Scientific Opinion on the safety of caffeine (EFSA Journal 2015;13(5):4102).
const FULL_MG = 200;

const HOUR_MS = 3600000;

// Caffeine still active in the body from a single dose, `elapsedH` hours after
// drinking it. Rises during absorption (a coffee does not hit instantly, same
// as a charger does not fill a battery instantly), peaks at ~38 min at ~92% of
// the dose, then decays with the elimination half-life.
function activeFromDose(doseMg, elapsedH, halfLifeH = DEFAULT_HALF_LIFE_H) {
  if (!(elapsedH > 0) || !(doseMg > 0)) return 0;
  const ke = Math.LN2 / halfLifeH;
  const f = (KA / (KA - ke)) * (Math.exp(-ke * elapsedH) - Math.exp(-KA * elapsedH));
  return doseMg * Math.max(0, f);
}

// Total active caffeine (mg) at instant `at`, summing every dose taken before it.
// `doses` is [{ logged_at, caffeine_mg }] — order does not matter.
function activeMgAt(doses, at, halfLifeH = DEFAULT_HALF_LIFE_H) {
  let total = 0;
  for (const d of doses) {
    if (d.logged_at >= at) continue;
    total += activeFromDose(d.caffeine_mg, (at - d.logged_at) / HOUR_MS, halfLifeH);
  }
  return total;
}

// Battery reading for `mg`: 0–100, capped like a real battery indicator.
function levelFromMg(mg) {
  return Math.min(100, Math.round((mg / FULL_MG) * 100));
}

// After this many hours a dose contributes < 1% of itself and is irrelevant to
// the current reading. Used to bound how far back doses are loaded for a window.
// Sized for the SLOWEST metabolizer (MAX_HALF_LIFE_H), not the average — at 9.5 h
// this is 7.5 half-lives, where 36 h would have been under 4 and would have
// truncated real caffeine off the left edge of a slow user's chart.
const DOSE_LIFETIME_H = 72;

// How far ahead the "runs empty at" estimate is allowed to look. Also sized for
// the slowest metabolizer: a full 200 mg battery at a 9.5 h half-life needs
// ~63 h to fall under 1%, so a shorter horizon would report "—" to exactly the
// users who most want the answer. Beyond this it is reported as unknown.
const FORECAST_MAX_H = 72;

// The instant the battery first drops below `threshold` percent, searching
// forward from `from`. Returns null if it is already below, or if it stays
// above for the whole forecast horizon (e.g. a dose still absorbing).
function emptyAt(doses, from, halfLifeH = DEFAULT_HALF_LIFE_H, threshold = 1) {
  if (levelFromMg(activeMgAt(doses, from, halfLifeH)) < threshold) return null;
  const step = 5 * 60000;
  for (let t = from + step; t <= from + FORECAST_MAX_H * HOUR_MS; t += step) {
    if (levelFromMg(activeMgAt(doses, t, halfLifeH)) < threshold) return t;
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
//
// `rawHalfLifeH` is the user's stored value, which may be NULL — it is clamped
// here so every caller gets the same treatment and the returned `half_life_h`
// is always the value the curve was actually drawn with.
function buildEnergy(doses, now, hours, rawHalfLifeH) {
  const halfLifeH = clampHalfLife(rawHalfLifeH);
  const windowMs = hours * HOUR_MS;
  const start = now - windowMs;
  const step = stepMsFor(windowMs);

  const series = [];
  let peak = { t: start, level: 0, active_mg: 0 };
  for (let t = start; t < now; t += step) {
    const mg = activeMgAt(doses, t, halfLifeH);
    const point = { t, level: levelFromMg(mg), active_mg: +mg.toFixed(1) };
    series.push(point);
    if (point.active_mg > peak.active_mg) peak = point;
  }
  const nowMg = activeMgAt(doses, now, halfLifeH);
  const nowPoint = { t: now, level: levelFromMg(nowMg), active_mg: +nowMg.toFixed(1) };
  series.push(nowPoint);
  if (nowPoint.active_mg > peak.active_mg) peak = nowPoint;

  // Charging vs draining is the slope at `now`, read one minute ahead. A coffee
  // logged in the last ~38 min is still being absorbed, so the level is rising.
  const aheadMg = activeMgAt(doses, now + 60000, halfLifeH);
  const state = nowMg < 0.5 ? 'empty' : aheadMg > nowMg ? 'charging' : 'draining';

  return {
    level: nowPoint.level,
    active_mg: nowPoint.active_mg,
    full_mg: FULL_MG,
    state,
    half_life_h: halfLifeH,
    window_hours: hours,
    step_ms: step,
    now,
    peak,
    empty_at: emptyAt(doses, now, halfLifeH),
    series,
    doses: doses
      .filter(d => d.logged_at >= start && d.logged_at <= now)
      .sort((a, b) => a.logged_at - b.logged_at),
  };
}

module.exports = {
  DEFAULT_HALF_LIFE_H, MIN_HALF_LIFE_H, MAX_HALF_LIFE_H,
  KA, FULL_MG, DOSE_LIFETIME_H, FORECAST_MAX_H, MAX_POINTS,
  clampHalfLife, activeFromDose, activeMgAt, levelFromMg, emptyAt, stepMsFor, buildEnergy,
};
