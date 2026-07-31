import { uploadUrl } from '../api/client';
import type { ImageField } from '../types';

// One place that turns the server's variant list (issue #15) into a responsive
// <picture>. Centralising it means every render site — feed, gallery, lightbox,
// avatars — negotiates format (AVIF, then WebP) and size natively and routes
// every URL through uploadUrl() (which appends the auth token the /uploads route
// requires).
//
// Phase 3: the server encodes each size to AVIF and WebP. We emit one <source>
// per format (AVIF first, so a supporting browser picks the smaller file) plus a
// WebP <img> fallback. Size negotiation within a format stays on srcset/sizes.

// Format preference, best-ratio first. A browser uses the first <source> whose
// type it can decode; the <img> is the last-ditch fallback.
const FORMAT_ORDER = ['avif', 'webp'];
const FORMAT_MIME: Record<string, string> = { avif: 'image/avif', webp: 'image/webp' };

export interface ResponsiveImageProps {
  // Preferred source: the responsive variant payload.
  image?: ImageField | null;
  // Legacy single-file URL, used when there is no variant list (older rows the
  // backfill hasn't reached, or the API shape without an image field).
  fallback?: string | null;
  alt: string;
  className?: string;
  // The `sizes` hint so the browser can pick the right variant. Defaults to the
  // full viewport width; pass a fixed size for avatars/thumbs (e.g. "64px").
  sizes?: string;
  loading?: 'lazy' | 'eager';
  onClick?: () => void;
}

// Build a "url Nw, url Nw" srcset for one format's sized variants, or undefined
// when that format has no width-tagged variants.
function srcSetFor(sized: { url: string; width: number | null }[]): string | undefined {
  if (sized.length === 0) return undefined;
  return sized.map((v) => `${uploadUrl(v.url)} ${v.width}w`).join(', ');
}

export function ResponsiveImage({ image, fallback, alt, className, sizes, loading, onClick }: ResponsiveImageProps) {
  const variants = image?.variants ?? [];
  const sized = variants.filter((v) => v.width != null);

  // The <img> element (fallback for any browser that decodes none of the
  // <source> types) uses WebP, which is universally supported, then any other
  // sized variant, then a legacy single file / plain fallback URL.
  const webpSized = sized.filter((v) => v.format === 'webp');
  const imgVariants = webpSized.length > 0 ? webpSized : sized;

  let src: string | undefined;
  let imgSrcSet: string | undefined;

  if (imgVariants.length > 0) {
    // Default src is the largest (best quality if a browser ignores srcset);
    // srcset lets it choose a smaller one for the render size / DPR.
    src = uploadUrl(imgVariants[imgVariants.length - 1].url);
    imgSrcSet = srcSetFor(imgVariants);
  } else if (variants.length > 0) {
    // Single variant of unknown width (legacy, pre-backfill) — plain src.
    src = uploadUrl(variants[0].url);
  } else if (fallback) {
    src = uploadUrl(fallback);
  }

  // Mirrors the old bare <img src={uploadUrl(...)}> behaviour: render nothing
  // rather than a broken request when there is no image.
  if (!src) return null;

  const sizesAttr = imgSrcSet ? (sizes ?? '100vw') : undefined;

  // One <source> per format that has sized variants, best-ratio format first.
  // The <img> below is both the WebP fallback and the no-<source>-matched path.
  const sources = FORMAT_ORDER.map((fmt) => {
    const fmtSized = sized.filter((v) => v.format === fmt);
    const set = srcSetFor(fmtSized);
    if (!set) return null;
    return <source key={fmt} type={FORMAT_MIME[fmt]} srcSet={set} sizes={sizesAttr} />;
  }).filter(Boolean);

  const img = (
    <img
      src={src}
      srcSet={imgSrcSet}
      sizes={sizesAttr}
      alt={alt}
      className={className}
      loading={loading}
      onClick={onClick}
    />
  );

  // No format sources (legacy single file, or only the <img>'s own format) —
  // render the bare <img> so we don't wrap it in a pointless <picture>.
  if (sources.length === 0) return img;

  return (
    <picture>
      {sources}
      {img}
    </picture>
  );
}
