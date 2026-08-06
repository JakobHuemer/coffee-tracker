# Web Push notifications (issue #87)

OS-level push to a user's device, so a notification lands even when the app is
closed. Built on the **Web Push API + a service worker + a web app manifest**,
which fits the existing architecture with no new service and no CORS surface
(single container, same-origin SPA + Bun/Express).

**Scope: Android.** Android Chrome/Edge deliver Web Push from an ordinary
browser tab — no install. iOS is deliberately out of scope (see the bottom).

This is a **delivery channel bolted onto the existing notification system**
([notifications.md](./notifications.md)), not a second notification model. Every
in-app notification row already flows through one writer,
`createNotification`; that single choke point now also fires a push, so
`achievement`, `badge`, and `match_end` all reach the phone for free, and any
future type does too with no extra wiring.

## Optional by design (config)

Push is **off unless configured**. This keeps the single-container promise and
local dev zero-config: with no VAPID keys the app boots and behaves exactly as
before, the client hides the opt-in toggle, and `/api/push/subscribe` returns
503. A **partial or invalid** key pair, however, is a config mistake and the
server **fails fast at boot** (VALUES.md #7) rather than serving a push path
that can only ever silently fail to deliver.

Env (`.env.example`):

| var | meaning |
|-----|---------|
| `VAPID_PUBLIC_KEY`  | applicationServerKey; ships to the client |
| `VAPID_PRIVATE_KEY` | signing key; server-only |
| `VAPID_SUBJECT`     | contact URL (`mailto:`/`https`); defaults to a `mailto:` |

Generate a pair once: `cd server && bun x web-push generate-vapid-keys`.

## Server

- **Migration `024_add_push_subscriptions.js`** — a `push_subscriptions` table
  (`endpoint` UNIQUE, `p256dh`/`auth` keys, `user_id` FK `ON DELETE CASCADE`).
  One row per subscribed browser; a user may have several. Additive + idempotent
  like the surrounding migrations. Notification `type`/`payload` still need no
  migration — this table is only the delivery address book.
- **`push.js`** — the only place that talks to push services (via the `web-push`
  dependency). `init(env)` validates config and arms web-push; `sendToUser`
  fans a committed notification out to every one of the user's subscriptions.
  It is **fire-and-forget**: called on `setImmediate` *after* the notification
  row's transaction commits (so a push never reflects an uncommitted row nor
  runs inside a DB transaction), and it swallows every error. A subscription the
  push service reports as **gone (404/410)** is pruned; a transient error is
  left alone.
- **`routes/push.js`** (`/api/push`, scoped to `req.user.id`):
  `GET /vapid-public-key` → `{ enabled, key }`; `POST /subscribe`
  `{ endpoint, keys:{p256dh,auth} }` (UPSERT on endpoint); `POST /unsubscribe`
  `{ endpoint }`.

The server **never writes a sentence** — same principle as the in-app system.
`sendToUser` ships only the frozen `{ id, type, payload }`; the service worker
builds the human text.

## Client

- **`public/manifest.json`** + `<link rel="manifest">` — makes the app a PWA
  (needed for the install-based iOS path later; harmless on Android).
- **`public/sw.js`** — a **push-only** service worker: it registers *no* fetch
  handler, so it never intercepts requests and can never serve a stale build.
  `push` → `showNotification` (text built here, mirroring
  `src/notifications/catalog.tsx`); `notificationclick` → focus an open tab or
  open `/notifications`.
- **`main.tsx`** registers the worker on load.
- **`hooks/usePush.ts`** — owns the per-device subscription lifecycle
  (supported? configured? permission? subscribed?) and exposes
  `subscribe`/`unsubscribe`.
- **Opt-in toggle** on the Notifications page, rendered only when the browser
  supports push *and* the deployment has it configured.

## Relationship to live data (#54)

Web Push covers **app-closed** delivery. The in-app bell still polls (issue #32
§7) and will move to a live connection when #54 lands. The two are complementary:
push wakes the phone; the live connection updates an open app.

## iOS — out of scope

iOS/iPadOS (16.4+) only delivers Web Push if the user first installs the web app
to the Home Screen (Share → "Add to Home Screen"); a plain Safari tab receives
nothing, and this cannot be bypassed in code. The manifest shipped here is the
groundwork, but the install flow and the 2-step permission prompt are a separate
issue. On iOS Safari today, `usePush().supported` is false and the toggle stays
hidden.
