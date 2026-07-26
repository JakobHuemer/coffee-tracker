import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

// Full-view overlay for a single photo: the image is contained, never cropped,
// so this is the one place a post's or gallery entry's whole frame is visible.
// Styling still lives under the .gallery-lightbox-* classes it started as.
export function PhotoLightbox({
  src, alt, onClose, children,
}: {
  // Undefined mirrors uploadUrl()'s return for a missing path — the <img>
  // simply renders nothing rather than a broken request.
  src: string | undefined;
  alt: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  // Escape closes it — the overlay covers the page, so there is no other way
  // out for keyboard users.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="gallery-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <div className="gallery-lightbox-inner" onClick={e => e.stopPropagation()}>
        <img src={src} alt={alt} className="gallery-lightbox-img" />
        {children}
        <button className="gallery-lightbox-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
    </div>
  );
}
