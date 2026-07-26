---
topics: [own-posts-section, feed-privacy, post-content-rule, bottom-nav]
---

# Own posts section (issue #20)

- `GET /feed/mine` is the only list that returns `is_public = 0` rows. It reuses
  `POST_COLUMNS`, which takes `req.user.id` twice (liked_by_me, bookmarked_by_me)
  before the route's own params — three bindings total, easy to miscount.
- Content rule ("photo or description") now applies to public posts only, so
  `is_public` has to be computed *before* the validation block, not next to the
  INSERT. Private entries need just the coffee type.
- The photo-cleanup `fs.unlink` is deliberately absent on that 400: the branch
  can only fire when `!req.file`.
- Likes stay public-only; the like control is hidden entirely on private posts.
  Bookmarks now accept `is_public = 1 OR user_id = <caller>`, so you can save
  your own private entries — `GET /feed/saved` carries the same OR, otherwise
  they would be saved but invisible. Someone else's private post still 404s on
  bookmark (verified with a second account). A private post therefore has no
  actions row at all — its save button floats right inside `.feed-post-body`
  (`display: flow-root` to contain the float), which is what keeps the card from
  ending in an empty band.
- Nav swap: Saved lost its bottom-nav slot to "Yours" (`/mine`) and is reachable
  only from the Profile page now. `/saved` route itself is unchanged.
- Post photos: the old fixed `aspect-ratio: 4/3` cropped nearly everything. The
  cap is now `max-height: 110cqw` on the img with `container-type: inline-size`
  on the wrapper — a ratio-relative cap is not expressible in plain CSS without
  a size container. Measured in chromium at a 300px card: 1:3 → 330px (capped),
  1:1.2 → 330px (capped), 4:3 → 225px (full). No container-query support just
  means no crop.
- `components/PhotoLightbox.tsx` is shared by the feed and the Profile gallery;
  it kept the older `.gallery-lightbox-*` class names on purpose.
- Delete lives on every own card (feed, yours, saved — decided with the user) and
  reuses the existing `DELETE /coffees/entries/:id`; no new endpoint. Removal is
  *not* optimistic, so a failed delete can never look like it worked. Pending and
  error state come off the one mutation, keyed by `mutation.variables === post.id`
  so only the card whose dialog is open shows them, and `mutation.reset()` on
  cancel keeps a stale error out of the next dialog.
