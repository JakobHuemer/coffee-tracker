---
topics: [post-marking, mentions, at-mention, post-marks, migration-023, feed-highlight, marked-me, comparison-link, mention-text]
---

# Post @-mention marking (feat/post-marking)

Type `@username` in a coffee post's description to **mark** that user. A marked
user's feed highlights the post to them, their own mention shows their handle
with a "You've been marked" hover tooltip (no link — nothing to compare against
yourself), and everyone else sees the mention as a link to the **comparison**
page (`/compare/:username`).

## Shape (mirrors likes/bookmarks)
- **Migration 023** `post_marks(id, entry_id, user_id, created_at)`, UNIQUE(entry,
  user), both FKs `ON DELETE CASCADE`. No extra index — the UNIQUE composite
  (entry-first) already serves the `marked_me` EXISTS and the batch lookup.
- **server/src/mentions.js** — the whole mention concern in one place:
  - `extractMentions(text)` — pure parse. Regex `/(?<![A-Za-z0-9_-])@([A-Za-z0-9_-]{2,20})/g`
    (the account rule from USERNAME_RE; the lookbehind means `foo@bar` is not a
    mention). Client mirrors this regex by hand in components/MentionText.tsx.
  - `syncPostMentions(entryId, desc, authorId)` — resolve to real users, skip the
    author, replace the entry's marks in one transaction. Called from the coffee
    create route after the entry is inserted.
  - `marksForMany(entryIds)` — batched `Map<entryId, usernames>`, the
    profile.badgesForMany pattern, so a feed page resolves marks in one query.
- **routes/feed.js** — `marked_me` is a per-row `EXISTS(post_marks …)` added to
  POST_COLUMNS (a 3rd viewer-id bind in each of `/`, `/saved`, `/mine`); `marks`
  comes from `marksForMany`. Both ride on every feed shape.

## Non-obvious notes
- **The mention list is authoritative for linkifying.** The client only turns an
  `@token` into a control when it's in the post's server-sent `marks`, so an
  `@word` that isn't a real user stays plain text and can't produce a broken
  compare link. The client regex only *locates* tokens; `marks` decides which
  are real.
- **Author is never marked on their own post** (`syncPostMentions` skips
  `authorId`), so a self-mention renders as plain text and the card isn't
  highlighted to the author.
- **Rename degradation is accepted.** Marks store `user_id`, so `marked_me`
  (highlight) survives a marked user renaming. The frozen `@oldname` text just
  won't match their new username, so that one token degrades to plain text.
  Fine for a for-fun app; noted rather than solved.
- **Private posts:** mentions are still parsed/stored, but a private post never
  enters anyone else's feed, so a mark on it is simply never surfaced. No special
  case needed.
- **Number clash:** `018` was already taken on main (018_add_image_variants),
  and main now runs through `022`. The migration is `023`.
- Verified live (isolated server on :8791, seeded scratch DB, SPA from
  server/public): marked user sees the accent-framed card + their own `@handle`
  with the "You've been marked" tooltip (non-link, no hover underline); a second
  marked user sees the first as an `@name` link that navigates to `/compare/:name`.
  `bun run check` green (308 server tests).
