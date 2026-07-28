// Competition-only caffeine overrides.
//
// READ THIS BEFORE DEBUGGING A LEADERBOARD: for the drinks listed below, the mg
// that counts toward a competition score is deliberately NOT the mg the app
// displays. A latte shows 63mg everywhere in the UI (catalog value, see
// ./coffees.js) but scores as 25mg inside a match. This is intentional, not a
// rounding bug and not stale data.
//
// The divergence is confined to the ELO input — competitions.js metricsStmt()
// and scoresForMany(), the two queries feeding points(). Everything else (Buzz,
// stats, streaks, achievements, casualties, the rankings page's total_caffeine
// column, community challenges) sums the stored caffeine_mg and therefore agrees
// with what the user sees.
//
// Those same two queries are also the only ones that filter on is_public — a
// competition scores public entries only (docs/competitions-rating-v2.md).
//
// Under v2's linear points the override bites harder than it used to: a latte is
// a flat 38-point gap against its displayed 63mg, where the old saturating curve
// absorbed most of it. That is known and intended, not a reason to change this.
//
// Any coffee id absent from this map scores at its stored caffeine_mg, so the
// default is "score what you show" and only listed ids diverge.
const SCORE_CAFFEINE = {
  latte: 25,
  latte_macchiato: 25,
};

// A SQL expression yielding the per-row mg a competition should count. Built
// from the map above so drink ids never get hardcoded into a query — adding an
// override is a one-line edit here and no query changes.
//
// `alias` is the table alias the query gave coffee_entries ('' when it selects
// from the bare table). The ids are interpolated from this file's own keys and
// the values are numbers, so there is no user input anywhere in the string.
function scoreMgSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  const cases = Object.entries(SCORE_CAFFEINE)
    .map(([id, mg]) => `WHEN '${id}' THEN ${Number(mg)}`)
    .join(' ');
  if (!cases) return `${p}caffeine_mg`;
  return `CASE ${p}coffee_id ${cases} ELSE ${p}caffeine_mg END`;
}

module.exports = { SCORE_CAFFEINE, scoreMgSql };
