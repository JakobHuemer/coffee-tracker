---
topics: [issue-32-notifications, notif-swipe-read-bug, notif-debug-harness, concept-md-nudge]
---

# 2026-08-02 — notifications phase 1 + swipe-read bug

## Status of issue #32 (phase 1)
Spec fully implemented and committed (f5b5b0a spec, aa8b754 impl, 88c09ca toasts).
Nothing from the spec is left to build. Server: migration 019, `notifications.js`
writer + `TYPES` allowlist, emit sites in `achievements.js` + `competitions.js`
(`settleMatch`, one row/participant), `routes/notifications.js`, retention in
ticker. Client: `useNotifications.ts` (60s poll), bell in `AppHeader`,
`pages/Notifications.tsx`, `notifications/catalog.tsx`, `NotificationToaster.tsx`.
Old `UnlockToast` + per-page `unlocked[]` wiring removed.

## Uncommitted debug harness — NEVER commit
`client/src/components/NotificationDebug.tsx` + `server/src/routes/notifications.debug.js`,
wired in `App.tsx` + `index.js`, both marked `// DEBUG — remove before commit`.
Standing rule: keep uncommitted, stash before feature work, pop after.

## Swipe-to-read bug (fixing this session)
Marking unread cards read bottom-to-top in fast succession: after swiping card
#2, swiping #1 immediately does nothing — the touch drives #2's "Read" pane
instead, and #1 only responds once #2's snap animation finishes.
Mechanism: each `.ntf` row is its own native scroll-snap track (chosen to keep
card corners clean — see notifications-client.md); an in-progress snap animation
on one row captures the next touch that lands during it.
Interaction spec lives in docs/notifications-client.md (authoritative, supersedes
notifications.md §6). Update it there when the fix changes behaviour.

Fix (final, rebuilt from scratch): dropped native scroll-snap entirely — it
moves/commits the card under the finger and fires on `scrollend`, which is what
captured the next card's touch. Now a custom pointer-drag: card follows finger
1:1, read state untouched mid-drag, ONLY release decides. Pane (grey→green +
check pop) is the over-threshold cue (34% card width). Release past threshold →
JS spring back to centre + fade unread tint→read; under → spring back unchanged.
Snap-back is a real damped-harmonic-oscillator spring (springHome in
Notifications.tsx), seeded with release velocity — duration emergent, not fixed.
Mark optimistic (`onMutate`). Pane is also a focusable button (mouse/keyboard).
Two dead ends first: (1) fire-on-threshold + instant collapse killed the whole
animation; (2) inert CSS-confirm-slide container — user found each iteration
worse. Rebuild-from-scratch was the ask, not another patch.

## CONCEPT.md
Still missing. AGENTS.md asks for a one-line nudge each new session about
starting it via back-and-forth while coding.
