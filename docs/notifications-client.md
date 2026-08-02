# Notification client interaction (issue #32)

How notifications behave and read on the client. This is the living source of
truth for the **interaction and presentation** layer; when a fix is agreed, it
is written here first.

Implementation details — table, migration, emit sites, API contract, types,
query-hook config, file paths — stay in [notifications.md](./notifications.md).
Where this spec and notifications.md §6 disagree on behaviour, **this spec
wins** (it supersedes the original "marks all read on open" line).

## Surfaces

Two, both global:

- **Bell** in the app header, on every main page. Shows an unread count badge
  when there are unread notifications. Tapping it opens the notifications page.
- **Notifications page** (`/notifications`) — the full history, newest first.

## Read model

A notification is **unread until the user explicitly reads it.** Opening the
page does **not** mark anything read — the user must be able to see at a glance
which are new. The unread badge on the bell reflects the unread count and only
drops when notifications are actually marked read.

Two ways to mark read:

- **Swipe a card either way.** Unread cards only. The card can be swiped aside
  in either direction onto a "Read" action; releasing it there marks that one
  read. The revealed "Read" action is also a plain button, so a pointer that
  can't swipe (mouse) can click it. Read cards don't swipe.

  Built on native horizontal scroll-snap — the card and its action panes are
  real siblings in a scroll container. No transforms, no absolute overlays, and
  nothing rounded is clipped against a bordered parent, which is what keeps the
  card corners clean (the earlier hand-rolled version seamed at the corners).
- **"Mark all read" pill** at the top-right of the page header (mail-app style).
  Disabled when nothing is unread.

Unread cards are visually distinct from read ones (tinted background + accent
edge + a dot), so new vs. old is obvious without reading a word.

## No navigation

Notification cards are **display-only**. Tapping a card does nothing — it never
navigates anywhere. (An earlier click-to-jump behaviour was removed; it was
never a planned feature and it fought the swipe gesture.)

## Presentation — data-forward, per type

The backend never writes a sentence. All copy and layout live in a frontend
catalog keyed by `type`; changing wording or layout is a one-place edit that
applies to every row, past and present.

The catalog must **not** flatten every type into the same rigid
icon + title + description + time row. That layout buries the data: for a match
result, the placing and the rating change are the whole point and must read
instantly, not hide inside a sentence. Each type renders a layout built around
its own key figures, with eye-catching elements that communicate the data
before the words are read.

Per-type intent:

- **match_end** — the result is the headline: **Won / Lost / Tied**, coloured
  (green win, red loss). The two figures that matter get their own prominent
  elements, not prose:
  - **placing** as a rank element, e.g. `1st of 6`,
  - **rating change** as a coloured delta chip, e.g. `+18` (green) / `−12`
    (red).
  Group / scope is quiet context.
- **achievement / badge** — icon + name are the emphasis, with a small
  "Achievement" / "Badge" tag and the description as secondary text.
- **unknown type** (default renderer, required) — a server type shipped ahead
  of the frontend must still render: generic bell icon, the raw `type` as the
  title, and the payload shown as key/value lines. Never nothing.

### Copy rules

Plain and short. No em-dashes, no filler, no "this is X and it does Y"
phrasing. State the fact.

### Colour / tone

- gain / win → `--success-fg` (green)
- loss → `--danger-fg` (red)
- neutral → `--accent`

Always theme variables, never hard-coded hex, so light and dark both hold up.

## Refresh cadence (user-visible)

Notifications and the bell badge update within about a minute, and immediately
when the window regains focus. (The polling mechanism and its planned move to a
live connection under #54 are described in notifications.md §7.)
