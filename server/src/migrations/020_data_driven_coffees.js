// Move the coffee catalog out of code and into the database (issue #77).
//
// Until now the menu lived in server/src/data/coffees.js and the competition
// score overrides in server/src/data/coffee-scores.js, so changing either one
// meant a redeploy. This migration creates the `coffees` table and seeds it
// with exactly what those two files held, after which the code becomes the
// engine that reads/edits the data (server/src/coffees.js, the admin routes)
// rather than the place the data is defined.
//
// Columns:
//   id             stable semantic key, referenced by coffee_entries.coffee_id.
//                  Constrained to [a-z0-9_] on write (server/src/coffees.js
//                  ID_RE) because scoreMgSql() interpolates it into a SQL CASE.
//   name           display label.
//   caffeine       the single displayed mg, copied onto an entry at log time.
//   icon / class   semantic keys the client resolves to an icon / group label
//                  (client Icon.tsx, LogCoffee CLASS_LABEL). Never emojis.
//   score_caffeine competition-only mg override. NULL means "score what you
//                  show" — only listed drinks diverge (was SCORE_CAFFEINE, which
//                  pinned both lattes to 25 while they display 63mg). See
//                  docs/competitions-rating-v2.md and migration 014.
//   sort_order     preserves the hand-tuned catalog order the array had; the
//                  public menu and admin list read in this order.
//
// The seed is inlined (not imported from data/coffees.js) so this migration is
// frozen: editing the catalog later must never retroactively change what a
// fresh DB seeds here. Idempotent via IF NOT EXISTS + INSERT OR IGNORE.
exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coffees (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      caffeine       INTEGER NOT NULL,
      icon           TEXT NOT NULL,
      class          TEXT NOT NULL,
      score_caffeine INTEGER,
      sort_order     INTEGER NOT NULL
    );
  `);

  // [id, name, caffeine, icon, class, score_caffeine] — the exact contents of
  // the old data/coffees.js, with the two overrides from data/coffee-scores.js
  // folded into score_caffeine. Order here becomes sort_order.
  const seed = [
    ['espresso',        'Espresso',        63,  'coffee',    'coffee',    null],
    ['espresso_mac',    'Espresso Mac.',   63,  'coffee',    'coffee',    null],
    ['ristretto',       'Ristretto',       60,  'coffee',    'coffee',    null],
    ['doppio',          'Doppio',          128, 'coffee',    'coffee',    null],
    ['lungo',           'Lungo',           60,  'coffee',    'coffee',    null],
    ['americano',       'Americano',       95,  'coffee',    'coffee',    null],
    ['white_americano', 'White Americano', 60,  'coffee',    'coffee',    null],
    ['cappuccino',      'Cappuccino',      75,  'coffee',    'coffee',    null],
    ['flat_white',      'Flat White',      130, 'coffee',    'coffee',    null],
    ['melange',         'Melange',         70,  'milk',      'coffee',    null],
    ['latte',           'Latte',           63,  'milk',      'coffee',    25],
    ['latte_macchiato', 'Latte Macchiato', 63,  'milk',      'coffee',    25],
    ['affogato',        'Affogato',        63,  'ice-cream', 'coffee',    null],
    ['frappuccino',     'Frappuccino',     95,  'blended',   'coffee',    null],
    ['milk',            'Milk',            0,   'milk',      'milk',      null],
    ['chocochino',      'Chocochino',      30,  'chocolate', 'chocolate', null],
    ['hot_chocolate',   'Hot Chocolate',   0,   'chocolate', 'chocolate', null],
    ['tea',             'Tea',             5,   'tea',       'tea',       null],
    ['black_tea',       'Black Tea',       7,   'tea',       'tea',       null],
    ['fruit_tea',       'Fruit Tea',       6,   'tea',       'tea',       null],
    ['monster_white',   'Monster White',   150, 'energy',    'energy',    null],
    ['red_bull',        'Red Bull',        80,  'energy',    'energy',    null],
  ];

  const insert = db.prepare(
    'INSERT OR IGNORE INTO coffees (id, name, caffeine, icon, class, score_caffeine, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  seed.forEach((row, i) => insert.run(row[0], row[1], row[2], row[3], row[4], row[5], i));
};
