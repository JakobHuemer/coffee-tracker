// `icon` is a semantic key resolved to a real icon on the client (see
// client/src/components/Icon.tsx) — never an emoji. VALUES.md rule 0.5.
const COFFEES = [
  { id: 'espresso',        name: 'Espresso',       caffeine: 63,  icon: 'coffee' },
  { id: 'espresso_mac',    name: 'Espresso Mac.',  caffeine: 63,  icon: 'coffee' },
  { id: 'doppio',          name: 'Doppio',          caffeine: 128, icon: 'coffee' },
  { id: 'lungo',           name: 'Lungo',           caffeine: 60,  icon: 'coffee' },
  { id: 'americano',       name: 'Americano',       caffeine: 95,  icon: 'coffee' },
  { id: 'cappuccino',      name: 'Cappuccino',      caffeine: 75,  icon: 'coffee' },
  { id: 'flat_white',      name: 'Flat White',      caffeine: 130, icon: 'coffee' },
  { id: 'latte',           name: 'Latte',           caffeine: 75,  icon: 'milk' },
  { id: 'latte_macchiato', name: 'Latte Macchiato', caffeine: 75,  icon: 'milk' },
  { id: 'affogato',        name: 'Affogato',        caffeine: 63,  icon: 'ice-cream' },
  { id: 'frappuccino',     name: 'Frappuccino',     caffeine: 95,  icon: 'blended' },
  { id: 'chocochino',      name: 'Chocochino',      caffeine: 30,  icon: 'chocolate' },
  { id: 'hot_chocolate',   name: 'Hot Chocolate',   caffeine: 0,   icon: 'chocolate' },
  { id: 'tea',             name: 'Tea',             caffeine: 0,   icon: 'tea' },
  { id: 'monster_white',   name: 'Monster White',   caffeine: 150, icon: 'energy' },
];

module.exports = { COFFEES };
