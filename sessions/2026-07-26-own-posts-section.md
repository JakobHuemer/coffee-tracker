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
- Bookmarks/likes are public-only server-side, so `FeedList` hides the bookmark
  button when `is_public !== 1` — a visible button there would always 404.
- Nav swap: Saved lost its bottom-nav slot to "Yours" (`/mine`) and is reachable
  only from the Profile page now. `/saved` route itself is unchanged.
- Post photos: the old fixed `aspect-ratio: 4/3` cropped nearly everything. The
  cap is now `max-height: 150cqw` on the img with `container-type: inline-size`
  on the wrapper — a ratio-relative cap is not expressible in plain CSS without
  a size container. Measured in chromium at a 300px card: 1:3 → 450px (capped),
  1:1.2 → 360px (full), 4:3 → 225px (full). No container-query support just
  means no crop.
- `components/PhotoLightbox.tsx` is shared by the feed and the Profile gallery;
  it kept the older `.gallery-lightbox-*` class names on purpose.
