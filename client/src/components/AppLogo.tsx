// The one place the app logo is rendered. Two forms, one source of truth:
//
//   default      — the full-colour artwork from /favicon.svg, served as an <img>
//                  so the browser caches the single asset the manifest already
//                  points at.
//   monochrome   — an inline silhouette in a caller-supplied colour.
//
// The silhouette is the *same geometry* the colour file uses for its `#cup`
// mask (cup body, handle, three drops); it deliberately drops the blurred
// colour blobs and gradient highlights. Those blurs run 3.5–8.5 in a 48-unit
// viewBox, so at the sizes monochrome is used for (22px nav, 1.6rem header)
// they smear wider than the glyph and, reduced to a single hue, flatten into
// mud anyway. Solid reads; shaded does not.
//
// Only the monochrome branch is inlined. The colour artwork carries a mask,
// seven filters and six gradients, all with fixed ids — inlining it would make
// two mounted logos collide on those ids.

const VIEW_BOX = '0 0 48 46';
// Centres the artwork in the viewBox; lifted verbatim from favicon.svg.
const FIT = 'translate(-0.383 0.842) scale(1.0718)';

type Props = {
  /** Render a flat silhouette in this colour instead of the artwork. Accepts
   *  anything CSS does, including `currentColor`. */
  monochrome?: string;
  className?: string;
  /** Accessible name. Omit for decorative logos sitting next to a text label. */
  alt?: string;
};

export function AppLogo({ monochrome, className, alt }: Props) {
  if (!monochrome) {
    return <img className={className} src="/favicon.svg" alt={alt ?? ''} />;
  }

  return (
    <svg
      className={className}
      viewBox={VIEW_BOX}
      fill={monochrome}
      role={alt ? 'img' : undefined}
      aria-label={alt}
      aria-hidden={alt ? undefined : true}
    >
      <g transform={FIT}>
        <path d="M10 16h24l-2.4 21.2A4 4 0 0 1 27.63 41H16.37a4 4 0 0 1-3.97-3.8L10 16Z" />
        <path fillRule="evenodd" d="M30.5 24.5a5 6.7 0 1 0 10 0 5 6.7 0 1 0-10 0ZM32.2 24.5a2.6 4.2 0 1 0 5.2 0 2.6 4.2 0 1 0-5.2 0Z" />
        <ellipse cx="18" cy="8" rx="2.4" ry="6.4" transform="rotate(-18 18 8)" />
        <ellipse cx="24.5" cy="5.8" rx="2.2" ry="5.7" transform="rotate(-8 24.5 5.8)" />
        <ellipse cx="30.5" cy="8.5" rx="2.2" ry="6" transform="rotate(14 30.5 8.5)" />
      </g>
    </svg>
  );
}
