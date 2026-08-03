// The coffee catalog, read from the database (issue #77). This replaces the two
// static modules that used to live under data/ — data/coffees.js (the menu) and
// data/coffee-scores.js (the competition score overrides) — so the catalog can
// be edited at runtime through the admin routes instead of needing a redeploy.
// The rows are seeded by migration 020; this module is only the reader/engine.
const db = require('./db');

// A coffee id is interpolated straight into a SQL CASE by scoreMgSql(), and is
// the value stored on every coffee_entries.coffee_id. Keep it to a strict
// slug so there is no injection surface and no id the client can't round-trip.
// Enforced on every admin write (routes/admin.js) and re-checked here defensively.
const ID_RE = /^[a-z0-9_]+$/;

// Public catalog fields, in the hand-tuned display order. Deliberately omits
// score_caffeine: the override is competition-internal and only scoreMgSql()
// (SQL-side) needs it — see the note in data/coffee-scores.js's old home.
function listCoffees() {
  return db.prepare(
    'SELECT id, name, caffeine, icon, class FROM coffees ORDER BY sort_order, name'
  ).all();
}

// One catalog row, public fields only (the log path needs `caffeine`; nothing
// server-side needs score_caffeine outside the scoring SQL). undefined if absent.
function getCoffee(id) {
  return db.prepare(
    'SELECT id, name, caffeine, icon, class FROM coffees WHERE id = ?'
  ).get(id);
}

// Every column, for the admin catalog view (which must show/edit the override).
function listCoffeesAdmin() {
  return db.prepare(
    'SELECT id, name, caffeine, icon, class, score_caffeine, sort_order FROM coffees ORDER BY sort_order, name'
  ).all();
}

// How many drink types the menu currently holds. Used by the two "try every
// type" targets (data/achievements.js variety_all, the Variety Show community
// challenge) so they track the live catalog instead of a hardcoded literal.
function coffeeCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM coffees').get().n;
}

// A SQL expression yielding the per-row mg a competition should count. Built
// live from the score_caffeine overrides so drink ids never get hardcoded into
// a query and an admin edit takes effect immediately.
//
// `alias` is the table alias the caller gave coffee_entries ('' for the bare
// table). Ids are re-validated against ID_RE before interpolation and the mg
// values are coerced to numbers, so there is no user input in the string.
function scoreMgSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  const rows = db.prepare(
    'SELECT id, score_caffeine FROM coffees WHERE score_caffeine IS NOT NULL'
  ).all();
  const cases = rows
    .filter((r) => ID_RE.test(r.id))
    .map((r) => `WHEN '${r.id}' THEN ${Number(r.score_caffeine)}`)
    .join(' ');
  if (!cases) return `${p}caffeine_mg`;
  return `CASE ${p}coffee_id ${cases} ELSE ${p}caffeine_mg END`;
}

module.exports = { ID_RE, listCoffees, getCoffee, listCoffeesAdmin, coffeeCount, scoreMgSql };
