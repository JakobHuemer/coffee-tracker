import type { ReactNode } from 'react';

/**
 * The shared profile *card* — the boxed, centered identity block used by both
 * the public profile (`/u/:username`) and your own profile. It owns the card
 * shell, the centered column, and the vertical rhythm, so the two pages read as
 * the same component even though their contents differ a lot.
 *
 * It is deliberately NOT configured with a pile of booleans. Each region is a
 * SLOT (a `ReactNode`), so a caller drops in exactly what it needs:
 *
 *   - public profile: a plain avatar, an `@handle` name, a Compare button.
 *   - own profile:    an avatar with photo upload/remove, a plain name, an Edit
 *     button — and in edit mode the page renders its own form instead.
 *
 * Order is fixed (avatar → name → badges → meta → actions) so the two never
 * drift apart. `badges`, `meta` and `actions` are optional; omit a slot and its
 * row simply isn't rendered.
 */
export function ProfileCard({ avatar, name, badges, meta, actions }: {
  avatar: ReactNode;
  name: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card profile-card">
      <div className="profile-card-body">
        <div className="profile-card-avatar">{avatar}</div>
        <div className="profile-card-name">{name}</div>
        {badges && <div className="profile-card-badges">{badges}</div>}
        {meta && <div className="profile-card-meta">{meta}</div>}
        {actions && <div className="profile-card-actions">{actions}</div>}
      </div>
    </div>
  );
}
