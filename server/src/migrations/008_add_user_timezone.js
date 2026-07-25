// User IANA timezone (e.g. "Europe/Vienna"), used to evaluate civil-time logic
// (daily goals, streaks, "today") in the user's local day rather than UTC.
// Stored as the IANA name, never an offset — the name carries DST rules.
// See docs/time-and-timezones.md.
exports.up = (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('timezone')) {
    db.exec("ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'");
  }
};
