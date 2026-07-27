# Image handling — plan (issue #15)

Status: **plan only, nothing implemented yet.** Issue #15 is `effort:large`
("multi-session, needs a plan first"), so this doc is that plan. It records the
decisions and the phasing; the code lands in follow-up PRs, each its own
numbered migration where schema is touched.

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

`coffee_entries` and `users` gain an `image_id` FK **alongside** the existing
`photo_path`, which stays until every reader is migrated. A backfill step wraps
each existing `photo_path`/`profile_photo` file as an `images` row with a single
`webp`? — no: it is whatever format it already is — a single variant of its
actual format at its actual size. Existing files are never rewritten
(stability, VALUES 1); they just become a one-variant image that still serves.

Migration is **additive and idempotent**, next number after the current head
(currently 013 → `014_add_image_variants.js`). Never edit a shipped migration.

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

## Phasing (each phase is a shippable PR)

1. **Client downscale + WebP master, server stores it.** Immediate bandwidth
   win, no schema change beyond storing format/size. Single variant.
2. **Multi-size + `srcset`.** Server derives thumb/medium/large; introduce
   `images`/`image_variants` + the `014` migration + `<ResponsiveImage>`.
3. **AVIF variants** via server WASM encode + `<picture type>` negotiation.
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
- Cleanup: deleting an entry must delete every variant file, not just one path
  — the `image_variants` rows make that a single query, but wire it into the
  existing `fs.unlink` paths in `coffees.js` / `auth.js`.
