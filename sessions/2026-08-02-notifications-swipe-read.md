---
topics: [issue-32-notifications, notif-swipe-read-bug, notif-debug-harness, concept-md-nudge, notif-fullscreen-reveals]
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

## Fullscreen reveals (new spec: docs/notifications-reveals.md)
Big match_end events get a fullscreen "scoreboard assemble" reveal, NOT a box
(a match isn't a box). Locked decisions (all from user Q&A):
- Scope: match_end only. Rank-up/level-up = future new events (none exist yet).
- match_end is TWO-STAGE: generic card/toast until revealed, full details after.
  Revealed == READ — reuse existing read_at, NO new column/migration. Showing the
  reveal marks read; swiping to read also discloses (skips ceremony).
- Trigger: in-app = generic tappable toast/card → tap plays reveal (no auto
  interrupt). On return/fresh-open = auto-play queued reveals, drain BEFORE any
  toast. "Fresh open" on a website = SPA boot (new JS runtime) OR Page Visibility
  hidden→visible return; active-visible the whole time = no auto-play.
- Choreography staggered: result → placing → rating count-up (the payoff).
- Tone split: win = tasteful energy (light sweep + small spark, no confetti
  storm); loss = somber, no particles, heavier easing (NOT win-in-red); tie
  neutral. Reveal scale is choreography, not the banned basic-interaction pop.
- Playback: 1st tap skips build-up, 2nd tap advances; no auto-advance.
- No new deps (CSS/JS only), reduced-motion = static fully-formed, no sound.
Not yet implemented — spec only. notifications-client.md + notifications.md
updated to reference it (match_end toast/card/no-nav sections reconciled).
Design approved via interactive prototype (artifact URL in the reveals doc).
Final design in doc: delta is the HERO (big, counted from 0, own beat), final
Elo is a quiet decoupled resting value (NOT one coupled equation); label-light
(no "rating change"/"new rating" captions — layout carries it); loss = EQUAL
weight to win, opposite direction (win rises light, loss falls heavy — shockwave
/shards-down/bigger-shake), never tamer; count-up ~1.2s. "View match →" CTA is
DESIGNED but OUT OF SCOPE for #32 — needs a future match page (/matches/:id);
ships only once that route exists.

IMPLEMENTED (client-only, no server change — reveal state = read_at):
- notifications/MatchReveal.tsx (visual) + .nr-* CSS in index.css (dark cinematic
  scrim in BOTH themes by design; tone colours from success/danger tokens).
- notifications/RevealProvider.tsx: queue + overlay + mark-read on advance +
  presence auto-play (boot via booted ref; return via Page Visibility
  hidden→visible); playOne for taps; `revealing` flag. Mounted in App.tsx
  (active={token && !isAuth}); useNotifications gained an `enabled` arg.
- catalog: match render carries ratingBefore/After; generic (unread) vs detailed
  (read) card in Notifications.tsx; generic card tap → playOne (tap vs swipe
  split in onUp). Toaster: generic tappable match toast + holds all toasts while
  `revealing` (drain-first). Debug panel samples got rating_before/after + a tie.
Build/lint/typecheck green. NOT yet driven live by me (needs a logged-in session)
— test via debug panel: fire Match win/loss/tie → generic toast/card → tap to
reveal; reload with an unread match auto-plays (boot).

## CONCEPT.md
Still missing. AGENTS.md asks for a one-line nudge each new session about
starting it via back-and-forth while coding.
