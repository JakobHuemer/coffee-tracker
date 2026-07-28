// Competitions — groups, matches, per-participant results and the rating cache.
// Spec: docs/competitions-elo.md.
//
// The table is `competition_groups`, not `groups`: GROUPS is a SQLite keyword
// (window frame clause), and an unquoted keyword as a table name is a parse
// error waiting to happen in some future query.
//
// A user belongs to at most one group at a time (clan-style), enforced by the
// UNIQUE on group_members.user_id rather than by application code.
exports.up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS competition_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      -- One IANA zone for the WHOLE group. Every member shares this day/week
      -- boundary, so a group spanning zones still competes as one match
      -- instead of splitting into per-member windows nobody can win against.
      timezone    TEXT NOT NULL,
      is_public   INTEGER NOT NULL DEFAULT 1,
      -- Private groups are reachable only through this code; public ones are
      -- listed and joinable directly, and still carry a code for sharing.
      join_code   TEXT NOT NULL UNIQUE,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id        TEXT PRIMARY KEY,
      group_id  TEXT NOT NULL REFERENCES competition_groups(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

    CREATE TABLE IF NOT EXISTS matches (
      id          TEXT PRIMARY KEY,
      group_id    TEXT NOT NULL REFERENCES competition_groups(id) ON DELETE CASCADE,
      mode        TEXT NOT NULL,   -- daily | weekly | ondemand | 1v1 | team
      -- Civil period this recurring match covers, in the group's zone: the
      -- local date for daily, the local date of that week's Monday for weekly
      -- (a plain date, not an ISO week number, so there is no year-boundary
      -- numbering edge case to get wrong). NULL for user-created
      -- modes, which have no recurring window. SQLite treats NULLs as distinct
      -- in a UNIQUE index, so the constraint below makes automatic creation
      -- idempotent without restricting user-created matches at all.
      period_key  TEXT,
      title       TEXT,
      creator_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
      scope_start INTEGER NOT NULL,  -- UTC epoch ms
      scope_end   INTEGER NOT NULL,  -- UTC epoch ms, inclusive
      -- open      : lobby, players may still join (user-created only)
      -- pending   : running, roster locked
      -- settled   : deltas written to match_participants
      -- cancelled : never reached a legal roster, no rating changed hands
      state       TEXT NOT NULL DEFAULT 'pending',
      k_factor    REAL NOT NULL,
      team_size   INTEGER,           -- team mode: required members per side
      created_at  INTEGER NOT NULL,
      settled_at  INTEGER,
      UNIQUE(group_id, mode, period_key)
    );

    CREATE INDEX IF NOT EXISTS idx_matches_group_state ON matches(group_id, state);
    CREATE INDEX IF NOT EXISTS idx_matches_state_end ON matches(state, scope_end);

    CREATE TABLE IF NOT EXISTS match_participants (
      id                 TEXT PRIMARY KEY,
      match_id           TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      side               TEXT,   -- 'A' | 'B' for team mode, NULL for FFA/1v1
      joined_at          INTEGER NOT NULL,
      -- Everything below is written at settlement: this is the ledger the
      -- rating cache is derived from. It is treated as immutable in normal
      -- operation; the one exception is a settlement-rule change, which
      -- re-evaluates the whole history in a migration (see 015).
      score              REAL,
      contribution_share REAL,
      rating_before      REAL,
      rating_after       REAL,
      delta              REAL,
      UNIQUE(match_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_match_participants_user ON match_participants(user_id);

    -- Derived cache, not the source of truth: a user's rating history can be
    -- replayed from match_participants ordered by the match settled_at.
    CREATE TABLE IF NOT EXISTS user_ratings (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      rating     REAL NOT NULL DEFAULT 1000,
      matches    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
};
