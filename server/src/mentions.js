// @-mention marking. A post description may tag real users with @username; each
// tagged user is stored as a mark on the post (see migration 018), which lets
// the feed highlight the post to them and link the mention to a comparison.
const { randomUUID } = require('crypto');
const db = require('./db');

// A mention is `@username`, where username is the account rule ([A-Za-z0-9_-],
// 2–20 chars, see USERNAME_RE in routes/auth.js). The @ must not sit directly
// after another username character, so an email local part (`foo@bar`) is never
// read as a mention. The client mirrors this exactly in components/MentionText.tsx.
const MENTION_RE = /(?<![A-Za-z0-9_-])@([A-Za-z0-9_-]{2,20})/g;

// Distinct candidate usernames referenced by @mentions in `text`, first-seen
// order. Pure parsing — it does not check that any of them are real accounts.
function extractMentions(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(MENTION_RE)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

// Resolve the @mentions in `description` to real users and record each as a mark
// on `entryId`. The author is skipped — marking your own post is a no-op. Any
// existing marks for the entry are replaced first, so this is safe to re-run.
// Returns the number of marks written.
function syncPostMentions(entryId, description, authorId) {
  const names = extractMentions(description);
  const users = names.length
    ? db.prepare(
        `SELECT id FROM users WHERE username IN (${names.map(() => '?').join(',')})`
      ).all(...names)
    : [];
  const targets = users.filter((u) => u.id !== authorId);

  const now = Date.now();
  const write = db.transaction(() => {
    db.prepare('DELETE FROM post_marks WHERE entry_id = ?').run(entryId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO post_marks (id, entry_id, user_id, created_at) VALUES (?, ?, ?, ?)'
    );
    for (const u of targets) insert.run(randomUUID(), entryId, u.id, now);
  });
  write();
  return targets.length;
}

// Batched lookup of the marked usernames on many posts, mirroring
// profile.badgesForMany: one query for a whole feed page instead of one per
// post. Returns Map<entryId, string[]>, ordered by when each mark was made. A
// post with no marks is simply absent (callers default to []).
function marksForMany(entryIds) {
  const ids = [...new Set(entryIds)].filter(Boolean);
  const out = new Map();
  if (ids.length === 0) return out;

  const rows = db.prepare(
    `SELECT pm.entry_id, u.username
       FROM post_marks pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.entry_id IN (${ids.map(() => '?').join(',')})
      ORDER BY pm.created_at`
  ).all(...ids);

  for (const r of rows) {
    const list = out.get(r.entry_id) ?? [];
    list.push(r.username);
    out.set(r.entry_id, list);
  }
  return out;
}

module.exports = { extractMentions, syncPostMentions, marksForMany };
