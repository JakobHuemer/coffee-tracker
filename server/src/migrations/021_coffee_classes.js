// Make drink categories data-driven too (follow-up to issue #77's coffee work).
//
// A coffee's `class` (see migration 020) used to be a bare key whose only human
// label lived in the client's hardcoded CLASS_LABEL map, and whose group order
// on the log screen was just "whatever order the classes first appeared in the
// menu". That meant a new category couldn't be created with a real display name
// or a deliberate position without a code change. This table gives each
// category a name and an explicit order, editable through the admin routes.
//
//   id          the key stored in coffees.class (constrained to ID_RE on write).
//   name        display label (was the client's CLASS_LABEL value).
//   sort_order  group order on the log screen; lower shows first.
//
// The coffee↔category link is enforced in the application layer (admin routes
// reject a coffee whose class isn't a real category, and block deleting a
// category still in use), not with a SQL foreign key — adding one to the
// existing `coffees` table would need a full table rebuild, and coffee_entries
// already models the same "self-contained, no FK" contract. Idempotent.
//
// Seed order mirrors what the log screen showed before this change: coffee,
// milk, chocolate, tea, energy (the order those classes first appear in the
// 020 seed).
exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS coffee_classes (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);

  const seed = [
    ['coffee',    'Coffee'],
    ['milk',      'Milk'],
    ['chocolate', 'Chocolate'],
    ['tea',       'Tea'],
    ['energy',    'Energy'],
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO coffee_classes (id, name, sort_order) VALUES (?, ?, ?)');
  seed.forEach(([id, name], i) => insert.run(id, name, i));
};
