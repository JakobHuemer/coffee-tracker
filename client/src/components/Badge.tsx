import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { rarityColor, rarityLabel } from '../rarity';
import type { Badge as BadgeT, ProfileBadge } from '../types';

// One badge, Discord-style: an icon on a tier-tinted disc, not a boxed card
// (issue #80). The tier colour drives the ring + glow, so rarity reads at a
// glance without a text label. `title` gives the name on hover / long-press.
//
// This is THE badge glyph — every surface that shows a profile (feed post,
// compare, competition roster, the public profile) renders badges through here
// so they never drift apart. See AGENTS.md "Badges travel with the profile".
export function BadgeChip({ badge, size = 30 }: { badge: ProfileBadge; size?: number }) {
  const color = rarityColor(badge.rarity);
  return (
    <span
      className="badge-chip"
      style={{ width: size, height: size, borderColor: color, color, ['--badge-color' as string]: color }}
      title={`${badge.name} · ${rarityLabel(badge.rarity)}`}
      role="img"
      aria-label={`${badge.name}, ${rarityLabel(badge.rarity)} badge`}
    >
      <Icon name={badge.icon} size={Math.round(size * 0.52)} />
    </span>
  );
}

// A badge chip that reveals an info popover — name, rarity, description — on
// hover (mouse) or tap/click (touch). Used ONLY on the public profile page
// (issue #80): a feed post or a match roster shows badges but not this popover,
// so BadgeRow keeps it behind the `withInfo` flag.
function InfoBadge({ badge, size }: { badge: ProfileBadge; size?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Pending hover-open timer (mouse only). Held in a ref so a quick mouse-out
  // can cancel it before the 1s is up.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = undefined; } };

  // A tap elsewhere, or Escape, closes it. Without this a touch user, who has no
  // hover, could never dismiss the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Cancel a pending timer if the chip unmounts mid-hover.
  useEffect(() => clearTimer, []);

  // Hover is a MOUSE-only affordance, gated on pointerType. On touch the browser
  // also fires enter/leave synthetically; letting those through was what made a
  // tap open-then-immediately-close (enter opened it, the click toggled it back
  // off), so touch is ignored here and handled by the click below instead.
  function handleEnter(e: React.PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), 300); // appear after 300ms hover
  }
  function handleLeave(e: React.PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimer();
    setOpen(false);
  }
  // Tap (touch) or click (mouse) toggles immediately — this is the touch path.
  function handleClick() {
    clearTimer();
    setOpen(o => !o);
  }

  return (
    <span
      className="badge-info"
      ref={ref}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <button
        type="button"
        className="badge-info-trigger"
        onClick={handleClick}
        aria-expanded={open}
        aria-label={`${badge.name} badge — details`}
      >
        <BadgeChip badge={badge} size={size} />
      </button>
      {open && (
        <span className="badge-popover" role="tooltip">
          <span className="badge-popover-title">{badge.name}</span>
          <span className="badge-popover-rarity" style={{ color: rarityColor(badge.rarity) }}>
            {rarityLabel(badge.rarity)}
          </span>
          {badge.description && <span className="badge-popover-desc">{badge.description}</span>}
        </span>
      )}
    </span>
  );
}

// A horizontal run of a user's earned badges. Renders nothing when the list is
// empty, so callers can drop it in unconditionally next to a name/avatar. Pass
// `withInfo` (public profile only) to make each chip pop an info tooltip on
// hover/tap; without it the chips are display-only.
export function BadgeRow({ badges, size, className, withInfo = false }: { badges: ProfileBadge[] | undefined; size?: number; className?: string; withInfo?: boolean }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className={`badge-row${className ? ' ' + className : ''}`}>
      {badges.map(b => withInfo
        ? <InfoBadge key={b.id} badge={b} size={size} />
        : <BadgeChip key={b.id} badge={b} size={size} />)}
    </span>
  );
}

// The collection-page medallion (issue #80): a larger tier-ringed disc with the
// name and rarity beneath, and a locked/grayscale state. Replaces the old
// `.badge-card` box.
export function BadgeMedal({ badge }: { badge: BadgeT }) {
  const color = rarityColor(badge.rarity);
  return (
    <div
      className={`badge-medal${badge.unlocked ? ' unlocked' : ' locked'}`}
      title={badge.description || undefined}
      style={{ ['--badge-color' as string]: color }}
    >
      <div className="badge-medal-disc">
        <Icon name={badge.icon} size={26} />
      </div>
      <div className="badge-medal-name">{badge.name}</div>
      <div className="badge-medal-rarity" style={{ color: badge.unlocked ? color : undefined }}>
        {rarityLabel(badge.rarity)}
      </div>
      {badge.unlocked && badge.unlocked_at && (
        <div className="badge-medal-date">{new Date(badge.unlocked_at).toLocaleDateString()}</div>
      )}
    </div>
  );
}
