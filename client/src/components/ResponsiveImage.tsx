import { uploadUrl } from '../api/client';
import type { ImageField } from '../types';

// One place that turns the server's variant list (issue #15) into a responsive
// <img srcset>. Centralising it means every render site — feed, gallery,
// lightbox, avatars — negotiates size natively and routes every URL through
// uploadUrl() (which appends the auth token the /uploads route requires).
//
// Format negotiation via <picture type> is deliberately not here yet: phase 2
// serves WebP only. AVIF + <picture> is phase 3, and lands in this one file.
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

export function ResponsiveImage({ image, fallback, alt, className, sizes, loading, onClick }: ResponsiveImageProps) {
  const variants = image?.variants ?? [];
  const sized = variants.filter((v) => v.width != null);

  let src: string | undefined;
  let srcSet: string | undefined;

  if (sized.length > 0) {
    // Default src is the largest (best quality if a browser ignores srcset);
    // srcset lets it choose a smaller one for the render size / DPR.
    src = uploadUrl(sized[sized.length - 1].url);
    srcSet = sized.map((v) => `${uploadUrl(v.url)} ${v.width}w`).join(', ');
  } else if (variants.length > 0) {
    // Single variant of unknown width (legacy, pre-backfill) — plain src.
    src = uploadUrl(variants[0].url);
  } else if (fallback) {
    src = uploadUrl(fallback);
  }

  // Mirrors the old bare <img src={uploadUrl(...)}> behaviour: render nothing
  // rather than a broken request when there is no image.
  if (!src) return null;

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? (sizes ?? '100vw') : undefined}
      alt={alt}
      className={className}
      loading={loading}
      onClick={onClick}
    />
  );
}
