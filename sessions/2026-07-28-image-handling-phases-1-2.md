---
topics: [issue-15, image-handling, migration-016, jsquash-webp, backfill-images, responsive-image, wal-durability]
---

# Issue #15 — image handling, phases 1 + 2

Client downscale→WebP master + server-derived responsive variants. Plan:
`docs/image-handling.md` (updated: status + the two decisions below).

## Decisions that override the original plan draft

- Migration is **016**, not 014 — head had moved to 015. Eventual photo_path
  drop = 017.
- Client encodes WebP via **`canvas.toBlob`** (no WASM shipped to browser).
  Server uses **`@jsquash/webp` + `@jsquash/resize`** — confirmed to run under
  `oven/bun:1` (open question #1 resolved). AVIF still deferred to phase 3.

## Gotchas / non-obvious findings

- **`process.exit(0)` in a WAL script loses just-written rows.** The backfill
  originally force-exited after `run()`; cross-process the derived variants
  vanished (only the source-width row survived) even though in-process they
  wrote fine. Fix: `PRAGMA wal_checkpoint(TRUNCATE)` + `db.close()` then let the
  process exit naturally (no `process.exit`). Applies to any one-shot bun:sqlite
  script — never force-exit before the WAL is checkpointed (VALUES 2).
- **`pfp_` prefix is load-bearing for serving auth.** New profile-photo variants
  are named `pfp_<id>_<w>.webp` so `index.js`'s filename-prefix public/owned
  split keeps working unchanged. Coffee variants (`<id>_<w>.webp`) resolve
  ownership via `images.coffeeAccessForFile` (image_variants → coffee_entries),
  which also still handles legacy `photo_path` files.
- New uploads set `image_id` and leave `photo_path`/`profile_photo` **NULL**;
  legacy rows keep both (016 wraps every legacy file into a single-variant
  image, dims NULL until backfill). Every API image payload carries both an
  `image`/`profile_image` variant field AND the legacy `*_url` fallback, so
  `<ResponsiveImage>` reads one shape everywhere.
- Multer switched disk→**memoryStorage** on both upload routes; `images.js`
  owns every disk write, so the old validation-failure `fs.unlink` cleanups are
  gone (nothing on disk until variants are derived post-validation).
- `targetWidths` never upscales: a 900px master yields 320/800/900, a 4000px one
  is capped at 320/800/1600.
