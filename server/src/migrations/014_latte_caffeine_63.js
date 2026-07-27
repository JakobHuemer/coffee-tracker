// Raise the two lattes from 25mg to 63mg, catalog and history alike.
//
// caffeine_mg is copied onto an entry at log time and never re-read from the
// catalog (server/src/routes/coffees.js POST /entries), so bumping ./data/
// coffees.js alone would leave every previously logged latte reading 25mg in
// the feed while new ones read 63mg. This rewrites the existing rows so the
// value is consistent across the whole history.
//
// Competition scores are unaffected: they resolve mg through
// ./data/coffee-scores.js, which pins both lattes to 25mg regardless of what
// is stored here.
exports.up = (db) => {
  db.prepare(
    "UPDATE coffee_entries SET caffeine_mg = 63 WHERE coffee_id IN ('latte', 'latte_macchiato')"
  ).run();
};
