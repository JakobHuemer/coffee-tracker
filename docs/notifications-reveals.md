# Notification reveals — fullscreen match events (issue #32)

Some notifications are too big to land as a small toast. A settled competition
match is a *moment* — a win, a loss, a rating swing — and it gets a **fullscreen
reveal**: a short, staggered ceremony that discloses the result, the placing, and
the rating change one beat at a time.

This doc owns the **reveal surface** — when it fires, what it reveals, how it
animates, how it is dismissed, and how it coexists with toasts. The base notif
system (table, API, emit sites, types) stays in
[notifications.md](./notifications.md); the bell / page / toast interaction stays
in [notifications-client.md](./notifications-client.md). Where reveal behaviour
touches those docs, this one is authoritative for the reveal.

Phase-1 scope: **`match_end` only** (Won / Lost / Tied). Rank-up / level-up /
milestone reveals are **out of scope here** — there is no level/tier event in the
server yet; each would be a new emit with its own payload, specced and consulted
on separately (see AGENTS.md "Consult the user before adding any new
notification").

## Core model — `match_end` is a two-stage notification

A `match_end` notification has two visual lives, gated on its **read state**:

- **Generic (unread).** Before it is revealed, the card and any toast are
  deliberately vague — "Match result", a neutral icon, **no result word, no rank,
  no delta.** The outcome is hidden so the reveal has something to disclose.
- **Detailed (read).** After the reveal has played, the card shows the full
  result: Won/Lost/Tied, `1st of 6`, the rating delta, group/scope — the
  data-forward `match_end` card described in
  [notifications-client.md](./notifications-client.md#presentation--data-forward-per-type).

**Revealed == read. There is no new column or migration.** The existing `read_at`
is the single source of truth (per the user: "a notification is only read when
its screen event has been shown, or if it was swiped and marked as read — use the
existing column"). So:

- `read_at` null → generic + a pending reveal.
- Playing the reveal to completion marks it read (the existing
  `POST /api/notifications/read`, applied optimistically like every other mark).
- Swiping the generic card to mark read (or "mark all read") also flips it to
  detailed, **skipping** the ceremony — reading it any way discloses it.

This keeps reveal state synced across devices for free: reveal on the phone marks
it read, and the laptop shows the detailed card without replaying.

## Trigger — tap in-session, auto on return

The reveal never interrupts active use. It fires in exactly two situations:

- **In the app (tap to open).** A `match_end` that arrives while you are actively
  using the app shows as a **generic, tappable** toast (and a generic card in the
  list/bell). **Tapping the toast or the card plays the reveal.** Nothing
  auto-plays while you are heads-down in the app.
- **On return / fresh open (auto).** When you come back to the app after being
  away, all pending (unread) `match_end` reveals **auto-play**, queued and
  sequential, and **drain completely before any toast** (see Toast suppression).

### Detecting "freshly opened / came back" on a website

This is a web app, not an installed-only app, so "opened" is defined by two pure
browser signals (no dependency, works for a tab and an installed PWA alike):

1. **Fresh document load (SPA boot).** Every full page load is a new JS runtime
   with no in-memory "session active" flag. The first notifications fetch after
   boot counts as an "open" → auto-play pending reveals. Covers reopening the
   tab, reloading, or navigating back to the site.
2. **Return from background (same document).** The **Page Visibility API**
   (`visibilitychange` / `document.hidden`, plus window focus/blur). Record when
   the tab/PWA goes `hidden`; when it becomes `visible` again that is a "return"
   → auto-play pending reveals.
3. **Active use = no auto-play.** If the tab stayed visible+focused the whole
   time, a newly-arrived `match_end` does **not** take over — it is the generic
   tap-to-open toast/card. Auto-play happens only on boot (1) or a hidden→visible
   return (2).

## Toast suppression — reveals drain first

**A fullscreen reveal overshadows every toast.** While a reveal is on screen, no
toast is shown. When a batch of notification updates arrives, the client must
**play all queued fullscreen reveals in sequence first, then release toasts** for
the other new notifications (achievements, badges). This keeps a reveal from
being cluttered by toasts sliding in behind it.

## Choreography — scoreboard assemble, staggered

The reveal is a **scoreboard that assembles**, not a box that opens (a match is
not a box). The screen dims to a focused backdrop; rows arrive one beat at a
time, building up rather than dumping everything at once:

1. **Result** — the headline lands first: **WON / DEFEAT / TIE**, coloured
   (`--success-fg` win, `--danger-fg` loss, `--accent` tie).
2. **Placing** — a rank row slides/rolls in: `1st of 6`.
3. **Rating change (the hero)** — the payoff and the biggest figure on screen:
   the **delta** `+18` / `−12`, coloured, counting from `0`, on its own beat.
4. **Standing rating (quiet)** — the resulting `rating_after` as a small, muted
   resting value, on a **separate, later beat**. It counts from `rating_before`.

**Delta and final rating are decoupled** — the delta is the hero and the final is
secondary; they are two independent beats, not one linked `1240 → 1258 (+18)`
equation. Group / scope / mode are quiet context.

The count-up runs a hair longer than a reflex tick (~1.2s) so the climb is felt.

### Label-light — layout carries meaning, not captions

**Do not caption the obvious.** A big signed, coloured `+18` needs no "rating
change" label; a number resting under it needs no "new rating" label — that is
pointing at the sky and writing *sky*. Position and form do the work: the signed
colour says "change", the smaller number beneath (a hairline apart) reads as the
resulting standing. Keep the labels that actually add information (the league /
scope context, which is *not* obvious) and drop the ones that only restate what
the figure already shows. Not label-zero — label-*honest*.

### Tone split — a loss is not a reward

The skeleton is shared; the tone is opposite. **This is the whole reason the loss
is not just the win in red.** Crucially the loss is **not tamer** than the win —
it carries the *same amount* of effect, aimed the other way: win rises light,
loss falls heavy.

- **Win — rises, light.** A light sweep across the result, a shockwave ring, and
  a **short contained spark burst** flying **up** on the headline; a small shake.
  Delta ticks up green. Energy, not a full-screen confetti storm — the same
  "satisfying, not overwhelming" bar as the rest of the app.
- **Loss — falls, heavy (equal weight).** Same energy budget, opposite feel: a
  **heavier shockwave**, shards that fall **down** with gravity, a **bigger
  shake**, slower/weightier easing. "DEFEAT" lands hard; the delta ticks down red.
  Not celebratory, not muted-to-nothing — a real, weighty moment.
- **Tie — neutral.** `--accent`, no impact effects, even weight.

The two sides must feel **matched in intensity**. A loss that is quieter than the
win reads as the app shrugging off the defeat; equal-but-opposite respects it.

### Not a scale-pop

The reveal uses scale/transform as **choreography — the motion *is* the content**
of a deliberate fullscreen moment. That is distinct from, and not a violation of,
the AGENTS.md ban on `transform: scale()` as reflex feedback for basic
interactions (button/tap/toggle). No gratuitous bounce on controls.

## Playback controls — two taps, no auto-advance

- **First tap skips the build-up.** Tapping during the staggered assemble
  short-circuits it to the **fully-revealed** state at once (fast repeats — the
  loot-box lesson that people must be able to speed through).
- **A second tap advances** to the next queued reveal (or closes if it is the
  last). **Nothing auto-advances** — the user always taps to move on.
- Reveals in a queue play **one at a time** in arrival order (newest logic TBD in
  implementation; sequential regardless).

## "View match" action — designed, but OUT OF SCOPE here

The reveal's last beat is a **"View match →"** button (a ghost pill, tone-tinted
on hover, keyboard-focusable) that opens the match's own page. Tapping it must
**not** advance/close the reveal — it stops propagation and navigates; tapping
anywhere else still advances.

**This button is out of scope for issue #32 and does not ship in the final
product yet.** It depends on a **match detail page that does not exist** — a
future issue must add a route like `/matches/:id` first. Until that route exists,
the reveal ships **without** this button (there is nowhere to send the user). The
design is captured here so that, when the match page lands, wiring the button in
is a small, already-specced follow-up — not a redesign. The reveal is fully
usable without it: it is dismissed by the same taps.

## Accessibility / reduced motion

- `prefers-reduced-motion: reduce` → **no staggered assemble, no particles, no
  count-up.** The reveal appears fully-formed (a static result card) and is
  dismissed by the same taps. The information is identical; only the motion is
  dropped.
- The reveal is a focus-trapped modal surface with an accessible label and a
  reachable dismiss control; the count-up also writes its final value as text so
  a screen reader never depends on the animation.

## Constraints honoured

- **No new dependencies** (VALUES.md): the reveal is pure CSS + JS (the same
  rAF/spring toolkit already used for swipe-to-read, plus CSS keyframes and a
  JS count-up). No Rive/Lottie/canvas-confetti library.
- **No new schema:** reveal state reuses `read_at`; no migration, no new endpoint.
- No sound (no audio assets, no dependency). Haptics are out of phase-1 scope.

## Concept prototype

An interactive, tappable prototype of this reveal (real app palette, both themes,
win/loss/tie, skip/advance, reduced-motion) was built to approve the look and
feel before implementation:
<https://claude.ai/code/artifact/63f0033d-382b-4393-b206-50e73167b32a> (private
to the author). It is a concept mock — copy, timings, easing and particle counts
are all tunable; the final build is React + the app's own CSS/JS.

## Inspiration (research)

- Victory/Defeat *ceremony* tone-split — League of Legends
  ([Behance](https://www.behance.net/gallery/53065555/League-of-Legends-Victory-Defeat)),
  Valorant ([end-screen update](https://www.youtube.com/shorts/qxSRJgUFU-4)).
- Staggered score-summary + count-up ticker — Skillz
  ([score summary](https://docs.skillz.com/docs/29.2.22/score-summary/)),
  [Game UI Database results screens](https://www.gameuidatabase.com/index.php?scrn=53),
  [CSS-Tricks number counters](https://css-tricks.com/animating-number-counters/).
- Loot-box grammar (anticipation → reveal → payoff, and *let people skip*) —
  [Prototypr teardown](https://blog.prototypr.io/the-user-experience-of-lootboxes-fcfe92206a6b).
</content>
