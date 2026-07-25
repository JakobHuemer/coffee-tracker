# Time & timezone handling (spec)

> **Read the sources, don't trust your memory.** This spec was written from web
> research, not recall. If you are about to design, review, or change anything
> touching time, **fetch the linked sources first** (WebFetch) and re-derive the
> decision — assume your recalled knowledge of this topic is ~1% and wrong the
> rest. The links are at the bottom.

## The two time domains

Every time value in this app belongs to exactly one of two domains. Keep them
in separate code. The **only** thing that bridges them is a timezone, used in
one direction: `instant + IANA zone → civil`.

### 1. Instant domain (UTC, absolute)

An absolute point on the timeline = **epoch milliseconds, UTC**.

- Examples: `created_at`, `logged_at`, feed post ages ("just now", "3m ago").
- Timezone-**irrelevant**. "Time ago" is just `now − then`, a duration — never
  needs a zone, never touches civil code.
- Rule: store as UTC epoch ms. Past instants are immutable and correct forever,
  regardless of where the user is.

### 2. Civil domain (zoned, calendar)

A wall-clock/calendar construct that only means something relative to a
timezone.

- Examples: "did the user log **today**", "before 10:00 AM", daily goals,
  streaks, challenge day/week boundaries.
- Rule: these are **calendar constructs** and require timezone context to
  evaluate. You cannot do them in UTC alone.

## Storage rules

- **Instants → UTC epoch ms. Always.** ("Not optional.")
- **User timezone → IANA name** (e.g. `Europe/Vienna`), stored on the user row.
  - **Never** store a fixed offset (`+1`) or abbreviation (`CET`). An offset is
    a snapshot; the IANA name is the *living DST ruleset* (+1 in winter, +2 in
    summer, derived automatically per-instant). Offsets are the classic DST bug.
  - Update it on each interaction (lazy) — the client sends
    `Intl.DateTimeFormat().resolvedOptions().timeZone`. HTTP carries no timezone,
    so it must be sent explicitly. Do **not** infer from IP (wrong for VPNs,
    stale when travelling).
- **Do NOT snapshot a local date per record.** The specialist consensus is to
  compute the local day at evaluation time (below), not to freeze it.

## Evaluating civil logic (streaks, "today", goals)

Compute the local day **at evaluation time**, then compare **calendar-date
strings**:

```
todayLocal    = toLocalDate(now,           userTz)   // "2026-07-25"
activityLocal = toLocalDate(lastActivityAt, userTz)  // "2026-07-25"
sameDay = todayLocal === activityLocal
```

- **DST is handled for free.** Comparing local date *strings* (not durations)
  means a 23-hour (spring-forward) or 25-hour (fall-back) day never changes
  whether two dates differ. No offset math anywhere.
- **Timezone change applies going forward only.** When the stored tz updates,
  the new zone is used from the next interaction. **No retroactive
  recomputation** of past streak history.

## Future events

- We do **not** create future events. A logged coffee's `logged_at` must satisfy
  `instant <= serverNow` (UTC), full stop — no skew tolerance. The picker takes a
  *civil* time in the user's zone, the translation layer converts it to an
  instant, and the server rejects anything `> now`. This is the fix for the
  "post stuck at 'just now'" bug (a future `logged_at` gave a negative age).
- (For the record: storing *scheduled* future civil times is a harder problem —
  tz rules can change before the date arrives, so you'd store wall-clock + IANA
  + UTC + tzdb version. **We deliberately avoid that entirely** by forbidding
  future events.)

## Tooling

- **Translation layer:** `date-fns-tz` (takes IANA zones, applies DST), or
  `Intl.DateTimeFormat({ timeZone })` for read-only formatting with zero deps.
- **Temporal:** reached Stage 4 / ES2026 and ships in Firefox & Chrome, but
  **Node/Bun support is "expected in a future release"** — do not rely on it
  server-side yet. Revisit later.
- Never use `Date.setHours()` / `Date.getHours()` for civil logic: they operate
  in the *runtime's* zone, not the user's. That was the original bug source.

## Code layering (how this maps to our code)

- **UTC-only modules:** storage, feed post ages, the `instant <= now`
  future-guard. Never import a tz here.
- **One translation boundary:** a single function `(instant, userTz) → { localDate,
  localHour, ... }`. This is the *only* place both domains meet.
- **Civil-only modules:** goals, streaks, "before 10am". They receive
  pre-translated civil values and compare them as strings. **No inline
  `toLocal()` calls scattered through civil code, no offsets, no snapshots.**

## Sources (fetch these before changing time code — do not rely on recall)

- Trophy — Streak Timezone & DST Handling (data model, compute-at-eval,
  no retroactive recompute, DST via date strings):
  https://trophy.so/blog/streak-timezone-dst-handling
- Trophy — How to Build a Streaks Feature:
  https://trophy.so/blog/how-to-build-a-streaks-feature
- CodeOpinion — "Just store UTC? Not so fast" (when UTC alone fails; future
  civil times): https://codeopinion.com/just-store-utc-not-so-fast-handling-time-zones-is-complicated/
- DEV — IANA vs Offset-Based Time Zones:
  https://dev.to/kulikboxx/iana-vs-offset-based-time-zones-what-every-developer-should-know-53ih
- Database Star — How to Handle Database Timezones:
  https://www.databasestar.com/database-timezones/
- Tinybird — 10 best practices for timestamps and time zones in databases:
  https://www.tinybird.co/blog/database-timestamps-timezones
- Bryntum — JavaScript Temporal in 2026:
  https://bryntum.com/blog/javascript-temporal-is-it-finally-here/
- Socket — TC39 Advances Temporal to Stage 4:
  https://socket.dev/blog/tc39-advances-temporal-to-stage-4
