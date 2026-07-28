# Image handling — plan (issue #15)

Status: **phases 1 + 2 + 3 implemented.** Client downscales to a WebP master
before upload; the server derives thumb/medium/large variants in **both AVIF and
WebP** (`images` + `image_variants`, migration `016`), delivers them via a
`<picture>` with per-format `<source>` + `srcset` through the `<ResponsiveImage>`
component, and a resumable backfill (`server/scripts/backfill-images.js`)
re-encodes legacy files (re-run it after phase 3 to add AVIF to existing images).
Phase 4 (tagging) is not started.

Three decisions differ from the original draft below and supersede it:

- **Migration number.** The draft says `014`; the head had moved on, so the
  real migration is `016_add_image_variants.js` and the eventual `photo_path`
  drop will be `017`. Numbers below are left as first written for history.
- **Client encodes WebP with `canvas.toBlob`, not `@jsquash`.** Open question #1
  is resolved: `@jsquash/webp`, `@jsquash/resize` **and `@jsquash/avif`** run
  clean under the container's Bun, so the **server** uses them (no native
  libvips). The client stays codec-free — `canvas.toBlob('image/webp')` is
  reliable everywhere and avoids shipping WASM to the browser. AVIF is
  server-only.
- **AVIF encode is synchronous and CPU-bound (phase 3).** `@jsquash/avif`
  encodes on the single JS thread, so a large image briefly blocks the event
  loop (`AVIF_SPEED = 8` keeps this to well under a second on real photos, a few
  seconds worst case on a 1600px noise image). Acceptable at this app's
  concurrency; if that changes, move encoding to a worker thread. Two related
  fixes: the `/uploads` route sets `Content-Type: image/avif` explicitly
  (Express's mime table doesn't know `.avif`, and the `nosniff` header would
  otherwise stop the browser decoding it), and the backfill script holds the
  event loop open across its awaits (Bun would otherwise exit mid-run).

## The goal, restated

From issue #15:

- Downscale to a base quality **on the client** before upload.
- Keep **multiple qualities per image** so a slow client can fetch a small one.
- Use **first-class / native** responsive delivery (browser picks the variant)
  and formats with good mobile + bad-internet behaviour.
- Prefer **client compute**, fall back to the server. Do not send the original
  up if it can be avoided, and **never serve the original** back down.
- Optional: image scanning / tagging / classification for metadata (coffee
  type, drink type, …).

## Where we are today (so the plan is grounded, not guessed)

- Uploads are single files written by **multer diskStorage** into `UPLOAD_DIR`
  (`DB_DIR`, default `/app/data`, the persisted volume). See
  `server/src/routes/coffees.js` (coffee-entry photos) and
  `server/src/routes/auth.js` (profile photos).
- The DB stores **one path per image**: `coffee_entries.photo_path`
  (migration 004) and `users.profile_photo` (migration 006). No dimensions, no
  variants, no format column.
- Serving is one **auth-gated** route: `GET /uploads/:filename` in
  `server/src/index.js`, which checks ownership / `is_public` before
  `res.sendFile`. The client wraps URLs through `uploadUrl()`
  (`client/src/api/client.ts`), appending the JWT as `?token=` for `<img>` tags
  that can't send an auth header.
- Render sites for images: `FeedList`, `PhotoLightbox`, the profile gallery,
  `Compare`, `Compete` avatars — every one is a bare `<img src=…>`.
- The whole app is **one Bun/Express container** serving `/` and `/api`
  (VALUES 4, 5). Any image library must work under Bun with **no native
  toolchain** assumptions and **no second lockfile**.

So this is not a greenfield feature — it is a migration of an existing
single-file scheme to a multi-variant one, touching the DB, the upload flow,
the serving route, and every `<img>` site. That is why it is `effort:large`.

## Decisions

### Formats and their order

Serve, in this preference order, letting the browser choose natively:

1. **AVIF** — best ratio, ideal for bad connections; decode support is now
   broad (Safari 16+, all evergreen).
2. **WebP** — universal fallback, near-universal decode.
3. **JPEG** — last-ditch for anything ancient.

Delivered with `<picture><source type=…>` (format negotiation) combined with
`srcset`/`sizes` (size negotiation) — both are native, no JS decision needed.

**Encoding reality check (verify at build time, do not trust this from
memory):** browsers can `canvas.toBlob('image/webp')` reliably but
`image/avif` encode support is **not** dependable. So AVIF is produced
**server-side**, WebP can be produced **client-side**. Recommended encoder:
the **`@jsquash/*` WASM codecs** (`@jsquash/avif`, `@jsquash/webp`,
`@jsquash/resize`) — the same WASM runs in the browser *and* under Bun, so
there is one code path and **no native/libvips/node-gyp dependency** to fight
with in the container. (`sharp` is the obvious alternative but pulls a native
libvips build; confirm Bun support before considering it — the WASM route
avoids the question entirely.)

### Where compute happens

- **Client**: downscale the picked file to a bounded master (longest edge
  ~1600px) and encode it to WebP. This is the only thing that leaves the
  device — the **full-resolution original never gets uploaded**, which is the
  cheapest possible answer to "don't even send the original" and "never serve
  the original."
- **Server**: from that master, derive the smaller sizes and the AVIF variants
  (WASM encode). The master WebP itself can also be re-encoded to AVIF here.
- **Fallback**: if the client can't encode (very old browser, no canvas), it
  uploads the file as-is and the server does the full downscale+encode. The
  server path must exist regardless, so this is not extra surface, just the
  same server pipeline fed a different source.

### Sizes

Three widths cover phone → retina-desktop without ceremony:

| name   | max width | used for                          |
|--------|-----------|-----------------------------------|
| thumb  | 320px     | feed grid, avatars, list rows     |
| medium | 800px     | single post view                  |
| large  | 1600px    | lightbox / full view              |

`sizes` is set per render site so the browser fetches the right one.

### Schema (a numbered migration, VALUES 3)

Do **not** overload `photo_path` with a convention. Add real rows so the set of
variants is queryable and deletable:

```
images
  id, owner_id, created_at,
  orig_width, orig_height          -- of the client master, for aspect ratio

image_variants
  image_id, format ('avif'|'webp'|'jpeg'), width, path, bytes
  UNIQUE(image_id, format, width)
```

`coffee_entries` and `users` gain a nullable `image_id` FK **alongside** the
existing `photo_path` / `profile_photo`, which stay until every reader is moved
over. The schema migration is **additive and idempotent**, next number after the
current head (currently 013 → `014_add_image_variants.js`); never edit a shipped
migration. How the existing single-file images become `images` + `image_variants`
rows — without re-encoding at boot and without losing a byte — is its own plan:
see [Migrating existing images](#migrating-existing-images) below.

### Serving

- Keep the single **auth-gated** `/uploads/:filename` route; ownership /
  `is_public` checks are unchanged and still per-file.
- The API returns, per image, an **explicit list of variant URLs** (format +
  width) instead of one `photo_url`. The client builds `<picture>`/`srcset`
  from that list. Explicit URLs (vs. server-side `Accept` negotiation) keep the
  auth-gated route dumb — it serves exactly the file named, and the original is
  simply never in any list.
- A new `<ResponsiveImage>` component centralises `<picture>` + `uploadUrl()` +
  `sizes`, and replaces the bare `<img>` at every render site in one pass
  (VALUES 0.4 — no half-migrated render path left behind).

### Original retention

The client master (≤1600px WebP) is the largest thing stored. The true camera
original is never uploaded. If a server-fed fallback did receive a full file,
the server keeps it only long enough to derive variants, then deletes it — it is
never written into `image_variants`, so no served URL can ever reference it.

## Migrating existing images

Two committed users of images exist today, both single files in `UPLOAD_DIR`:
`coffee_entries.photo_path` (named `<uuid>.<ext>`) and `users.profile_photo`
(named `pfp_<uuid>.<ext>`). `<ext>` comes from the upload MIME and is one of
`jpg|png|webp|gif|heic|heif` — so **the format is recoverable from the filename
alone**, no decode needed to classify a legacy file.

Goal: every existing file becomes one `images` row + one `image_variants` row,
linked by the new `image_id`, with **zero re-encoding at migration time and zero
data loss**. This splits into two mechanisms because they have opposite
constraints — one must be instant and infallible, the other is slow and
best-effort.

### Part 1 — schema + cheap wrap: numbered migration `014_add_image_variants.js`

Runs at boot, synchronously, before routes mount (`migrate.js`), so it must be
**fast, deterministic and DB-only**. A boot migration that decoded and
re-encoded every historical photo through a WASM codec would make startup
unbounded and could fail-fast the whole process (VALUES 7) over one malformed
file. So this step touches the database only — never the pixels.

1. **DDL** — create `images` and `image_variants`; add the nullable `image_id`
   column to `coffee_entries` and `users`. Guarded with `PRAGMA table_info`
   checks, exactly like `004`/`006`, so a re-run is a no-op.
2. **Wrap, DB-only** — for each row with a non-null `photo_path` /
   `profile_photo`:
   - insert an `images` row: `id` = new uuid, `owner_id` = that row's user,
     `created_at` = the entry's `created_at` (or `now` for profile photos),
     `orig_width`/`orig_height` = **NULL** (unknown without decoding — that is
     why they are nullable).
   - insert one `image_variants` row: `format` parsed from the filename
     extension (`heif`→`heic`, everything else 1:1), `width` = NULL (unknown),
     `path` = the **existing filename, unchanged**, `bytes` = NULL.
   - set the row's `image_id`.
3. **Idempotent** — guard each wrap on `image_id IS NULL`. Recorded atomically
   in `schema_migrations`, so it runs once; the guard just makes a
   crash-then-retry safe.

The files on disk are **never moved, renamed, or rewritten**. The original file
stays put and remains the served bytes — `photo_path` is **not** dropped here
(a later migration removes it once every reader uses `image_id`, the way `003`
dropped `email`).

> **"Never serve the original" vs. legacy files.** That rule targets *new*
> uploads, where a full-res camera master exists and is withheld. A legacy file
> is simply whatever the user uploaded through the old flow and was already the
> served image — there is no higher-res original to hold back, so serving it
> as-is is correct. Part 2 then produces smaller/modern variants around it.

### Part 2 — re-encode backfill: one-time resumable job (NOT a boot migration)

A maintenance script (`bun server/scripts/backfill-images.js`) run once after
`014` ships. All the heavy, failure-prone work lives here so boot stays fast and
fail-fast stays meaningful. For each `images` row that still has only its single
legacy variant:

- decode the legacy file **once**; backfill the real `orig_width`/`orig_height`
  onto the `images` row and `width`/`bytes` onto the legacy variant.
- generate the missing **sizes** (thumb/medium/large, **never upscaling** past
  the source) and **formats** (WebP, AVIF) with the WASM codecs, writing each as
  a new file + `image_variants` row.
- **HEIC/HEIF** legacy files (old Safari uploads) that browsers can't render are
  converted here — this is the moment an un-renderable legacy image becomes
  viewable.

Properties:

- **Resumable / idempotent** — keyed on "a variant with this
  `(image_id, format, width)` already exists", so an interrupted run only fills
  gaps and re-running is safe.
- **Never strands an image** — the legacy file is deleted only once at least one
  browser-renderable variant exists for that image; there is always ≥1 servable
  variant.
- **Throttled** — batched so it doesn't peg CPU on a live box. Nothing depends
  on it finishing: the legacy variant already serves throughout, so it can take
  as long as it needs.

### Reader coexistence during the transition

- API image payloads prefer the `image_id` variant list; if `image_id` is null
  they fall back to the single `photo_path`/`profile_photo` URL. The
  `<ResponsiveImage>` component accepts either shape, so no render site is left
  reading the old field directly (VALUES 0.4 — every dependent moves together).
- **Deletion must delete every variant file**, not just one path. The delete
  paths in `coffees.js` (DELETE entry), `auth.js` (delete profile photo, delete
  account) currently `fs.unlink` a single file; they must unlink every
  `image_variants.path` for the image. The FK's `ON DELETE CASCADE` clears the
  rows, but the **files** need explicit unlinks — a cascade does not touch disk.

### Verification (gate before dropping `photo_path`)

- Zero orphans: every row with a non-null legacy path has a non-null `image_id`.
- Every `image_variants.path` resolves to a file on disk; no `images` row has
  zero variants.
- `PRAGMA integrity_check` = `ok` after the migration, and after a hard kill
  mid-backfill (WAL replay leaves either the single-variant or the multi-variant
  state, never a torn row) — VALUES 2.
- Only once all pass does a later numbered migration (`015_drop_photo_path.js`,
  `manualTransaction` like `003`) remove `photo_path` / `profile_photo`.

## Phasing (each phase is a shippable PR)

1. **Client downscale + WebP master, server stores it.** Immediate bandwidth
   win, no schema change beyond storing format/size. Single variant.
2. **Multi-size + `srcset`.** Server derives thumb/medium/large; introduce
   `images`/`image_variants` + the `014` migration + `<ResponsiveImage>`. Ship
   the [existing-image migration](#migrating-existing-images): `014` wraps every
   legacy file (Part 1), then the backfill job (Part 2) re-encodes them into the
   new sizes.
3. **AVIF variants** via server WASM encode + `<picture type>` negotiation.
   *(Done.)* `deriveAndStore` encodes every size to AVIF and WebP;
   `<ResponsiveImage>` emits `<source type="image/avif">` before the WebP `<img>`
   fallback; the backfill job gained AVIF output, so legacy images pick it up on
   a re-run.
4. **(Optional) tagging/classification** — separate, own issue-sized effort;
   out of scope for the core delivery and only worth doing if a lightweight
   model can run in-container without violating VALUES 1/5.

## Must not break (VALUES check)

- Single container, `/` + `/api`, Bun only, no second lockfile (4, 5).
- Same-origin; variant URLs stay relative through `uploadUrl()` (6).
- `PRAGMA integrity_check` = ok after a hard kill; the migration is atomic and
  additive; existing committed photos keep serving unchanged (1, 2, 3).
- Fail-fast: a broken/oversized upload is a 400 as today, never a half-written
  image row (7).

## Open questions (resolve when phase 2 starts)

- Confirm `@jsquash` runs clean under the container's Bun version; if not, the
  fallback decision (native `sharp` vs. deferring AVIF) changes.
- Whether avatars need all three sizes or just `thumb` (likely just `thumb`).
- Whether to convert legacy HEIC/HEIF eagerly in the backfill or lazily on first
  request — the migration section assumes eager, which is simpler to reason about
  but front-loads the CPU.
