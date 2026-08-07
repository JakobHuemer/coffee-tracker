---
topics: [push-notifications, web-push, vapid, service-worker, pwa, manifest, migration-024, issue-87, android, stacked-pr, push-subscriptions]
---

# Web Push notifications — Android (feat/push-notifications-87, issue #87)

OS-level push to a phone even with the app closed. Web Push + service worker +
manifest — no new service, no CORS. Full design in
[docs/notifications-push.md](../docs/notifications-push.md).

## Stacked on PR #86 (feat/post-marking) — why

Issue #87 needs a new migration. PR #86 already added **023**
(`023_add_post_marks.js`), and `migrate.js` hard-fails on a duplicate version
number, so #87 and #86 both taking the "next" slot is a real conflict — plus
both touch `client/src/types/index.ts` and `index.css`. Fix per the request:
branch off `origin/feat/post-marking`, number the migration **024**. Base has
#86's changes, so zero merge conflict against it. PR #89
(feat/tried-coffee-types) only touches client CSS/LogCoffee — no hard conflict,
not stacked on.

## Bolted onto the existing notification system, not a new one

The elegant part: every in-app notification already flows through the single
writer `createNotification` (server/src/notifications.js). That one choke point
now also fires a push, so `achievement`/`badge`/`match_end` all reach the phone
for free and any future type does too. No per-trigger wiring.

## Shape

- **Migration 024** `push_subscriptions(id, user_id, endpoint UNIQUE, p256dh,
  auth, created_at)`, FK `ON DELETE CASCADE`. `endpoint` UNIQUE → a re-subscribe
  (or a device switching accounts) UPSERTs, never duplicates.
- **server/src/push.js** — the only place that talks to push services (dep:
  `web-push`). `init(env)` validates VAPID + arms web-push; `sendToUser` fans out.
- **server/src/routes/push.js** (`/api/push`) — `vapid-public-key`,
  `subscribe`, `unsubscribe`, all scoped to `req.user.id`.
- **Client** — `public/manifest.json`, push-only `public/sw.js`, SW registration
  in `main.tsx`, `hooks/usePush.ts`, opt-in toggle on the Notifications page.

## Non-obvious notes

- **Optional, but fail-fast on a half config.** No VAPID keys → push disabled,
  app boots normally, UI hides the toggle, `/subscribe` → 503. Exactly one key of
  the pair, or an invalid pair → `push.init()` throws and index.js exits
  (VALUES.md #7). Mandatory keys would have broken every non-push deploy + local
  dev, so "off by default, fail-fast on partial" was the call.
- **Push fires on `setImmediate`, after the row commits.** `createNotification`
  runs inside settlement transactions (competitions.js). Deferring guarantees the
  push reflects a COMMITTED row and never runs inside — or rolls back — that txn.
  Fire-and-forget: every send error is swallowed; a 404/410 prunes the dead
  endpoint, a transient error is left alone.
- **Text is built in the service worker, not the server.** Same principle as the
  in-app catalog: the server ships only frozen `{id,type,payload}`; `sw.js`
  builds the sentence (a small `present()` mirroring catalog.tsx). Keep them in
  step when either changes.
- **sw.js registers NO fetch handler** — push-only, so it can never intercept
  requests or serve a stale SPA build. Deliberate; do not add caching here
  without a versioning story.
- **Test seam** `push.__setSender(fn)` swaps the real web-push network call so
  push.test.js drives the fan-out/prune offline and deterministically.
- **`usePush` return type** needed `Uint8Array<ArrayBuffer>` (not bare
  `Uint8Array`) or tsc rejects it as the `applicationServerKey` BufferSource.
- **iOS is out of scope** — needs Home-Screen install first; can't be bypassed.
  The manifest is the groundwork; on iOS Safari `usePush().supported` is false.

## Verify

- `cd server && bun test` → 325 pass (adds routes.push + push module tests).
- `cd client && bun run build` → clean (`tsc -b && vite build`); `manifest.json`
  + `sw.js` emitted to `dist/`.
