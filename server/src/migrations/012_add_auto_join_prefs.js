// Opt-in auto-join for the recurring competition matches.
//
// Recurring matches are lobbies now: nobody is ever placed on a roster by the
// server. These two flags are the ONLY way a user ends up in a daily/weekly
// match without pressing join, and they default to 0 — opt in, never opt out.
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('auto_join_daily')) {
    db.prepare('ALTER TABLE users ADD COLUMN auto_join_daily INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!cols.includes('auto_join_weekly')) {
    db.prepare('ALTER TABLE users ADD COLUMN auto_join_weekly INTEGER NOT NULL DEFAULT 0').run();
  }
};
