// Client-side debug switches. These are conveniences only — every one of them
// is also gated server-side (a server without DEV_OVERRIDES=1 ignores the
// request flag entirely), so flipping the localStorage value by hand against a
// production server does nothing.
//
// The toggle UI lives in the Profile page's Debug card and is only rendered
// when GET /api/coffees/dev-flags reports the server honours the override.

const SKIP_SPACING_KEY = 'dev:skip-spacing';

export function getSkipSpacing(): boolean {
  return localStorage.getItem(SKIP_SPACING_KEY) === '1';
}

export function setSkipSpacing(on: boolean) {
  if (on) localStorage.setItem(SKIP_SPACING_KEY, '1');
  else localStorage.removeItem(SKIP_SPACING_KEY);
}
