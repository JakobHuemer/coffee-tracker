// `icon` is a semantic key resolved to a real icon on the client (see
// client/src/components/Icon.tsx) — never an emoji. VALUES.md rule 0.5.
//
// `class` groups drinks by kind so the app stops treating everything as coffee
// (issue #11): 'coffee' | 'tea' | 'energy' | 'chocolate'. It is a semantic key
// like `icon` — the client owns the display label per class (see
// client/src/pages/LogCoffee.tsx CLASS_LABEL).
//
// `caffeine` is the single displayed value: the picker shows it, and it is
// copied onto an entry at log time (server/src/routes/coffees.js POST /entries)
// for the feed, Buzz, and every stat to read back. Changing a value here only
// affects drinks logged afterwards — existing entries keep their copy.
//
// Competitions are the one exception: they score through
// ./coffee-scores.js, which pins both lattes to 25mg no matter what this
// catalog says. See that file before reconciling a leaderboard against a feed.
const COFFEES = [
  { id: 'espresso',        name: 'Espresso',       caffeine: 63,  icon: 'coffee',    class: 'coffee' },
  { id: 'espresso_mac',    name: 'Espresso Mac.',  caffeine: 63,  icon: 'coffee',    class: 'coffee' },
  { id: 'doppio',          name: 'Doppio',          caffeine: 128, icon: 'coffee',    class: 'coffee' },
  { id: 'lungo',           name: 'Lungo',           caffeine: 60,  icon: 'coffee',    class: 'coffee' },
  { id: 'americano',       name: 'Americano',       caffeine: 95,  icon: 'coffee',    class: 'coffee' },
  { id: 'cappuccino',      name: 'Cappuccino',      caffeine: 75,  icon: 'coffee',    class: 'coffee' },
  { id: 'flat_white',      name: 'Flat White',      caffeine: 130, icon: 'coffee',    class: 'coffee' },
  { id: 'latte',           name: 'Latte',           caffeine: 63,  icon: 'milk',      class: 'coffee' },
  { id: 'latte_macchiato', name: 'Latte Macchiato', caffeine: 63,  icon: 'milk',      class: 'coffee' },
  { id: 'affogato',        name: 'Affogato',        caffeine: 63,  icon: 'ice-cream', class: 'coffee' },
  { id: 'frappuccino',     name: 'Frappuccino',     caffeine: 95,  icon: 'blended',   class: 'coffee' },
  { id: 'chocochino',      name: 'Chocochino',      caffeine: 30,  icon: 'chocolate', class: 'chocolate' },
  { id: 'hot_chocolate',   name: 'Hot Chocolate',   caffeine: 0,   icon: 'chocolate', class: 'chocolate' },
  { id: 'tea',             name: 'Tea',             caffeine: 5,   icon: 'tea',       class: 'tea' },
  { id: 'black_tea',       name: 'Black Tea',       caffeine: 7,   icon: 'tea',       class: 'tea' },
  { id: 'fruit_tea',       name: 'Fruit Tea',       caffeine: 6,   icon: 'tea',       class: 'tea' },
  { id: 'monster_white',   name: 'Monster White',   caffeine: 150, icon: 'energy',    class: 'energy' },
];

module.exports = { COFFEES };
