import { createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveImage } from './ResponsiveImage';
import { BadgeRow } from './Badge';
import type { ImageField, ProfileBadge } from '../types';

/**
 * <Profile> — a COMPOUND component for showing a user's identity.
 *
 * The idea (this is the pattern you asked about): instead of one fixed layout
 * baked into `<Profile>`, `<Profile>` only *provides the user's data* to its
 * children through React context. The visible pieces are separate slot
 * components — `<Profile.Avatar>`, `<Profile.Name>`, `<Profile.Badges>`,
 * `<Profile.Meta>` — and YOU arrange them in whatever markup you want. Each slot
 * pulls what it needs from context, so none of them take a `user` prop.
 *
 * That means adding a section (like badges) is just dropping a slot in wherever
 * you like — even inside your own extra <div>:
 *
 *   <Profile user={u}>
 *     <div className="my-row">
 *       <Profile.Avatar size={48} />
 *       <div className="my-col">
 *         <Profile.Name />
 *         <div className="my-badges-box">
 *           <Profile.Badges />          // the badge slot, placed freely
 *         </div>
 *       </div>
 *     </div>
 *     <Profile.Meta>Member since 2024</Profile.Meta>
 *   </Profile>
 *
 * Reorder them, wrap them, leave some out — the layout is yours. See
 * client/src/pages/UserProfile.tsx and FeedList.tsx for real uses, and
 * AGENTS.md "Badges travel with the profile" for the rule that every profile
 * surface must include <Profile.Badges>.
 */

// The minimum a profile surface needs. Every profile-bearing API row (feed post,
// compare side, competition participant, public profile) is a superset of this.
export interface ProfileData {
  id: string;
  username: string;
  avatar: string;
  profile_photo_url?: string | null;
  profile_image?: ImageField | null;
  badges?: ProfileBadge[];
}

const ProfileContext = createContext<ProfileData | null>(null);

function useProfileContext(): ProfileData {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('<Profile.*> slots must be rendered inside a <Profile>');
  return ctx;
}

// The root. Holds the user data in context and renders a wrapper element. Pass
// `linkToProfile` to make the whole block navigate to the user's public profile
// on click/Enter (used in feed post headers); pass your own `onClick` for
// anything else.
export function Profile({
  user, children, className, linkToProfile = false, onClick,
}: {
  user: ProfileData;
  children: ReactNode;
  className?: string;
  linkToProfile?: boolean;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  const handler = onClick ?? (linkToProfile ? () => navigate(`/u/${user.username}`) : undefined);

  return (
    <ProfileContext.Provider value={user}>
      {handler ? (
        <div
          className={className}
          role="button"
          tabIndex={0}
          onClick={handler}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } }}
        >
          {children}
        </div>
      ) : (
        <div className={className}>{children}</div>
      )}
    </ProfileContext.Provider>
  );
}

// ── Slots ────────────────────────────────────────────────────────────────────

function Avatar({ size = 48, className }: { size?: number; className?: string }) {
  const u = useProfileContext();
  const cls = className ?? 'profile-slot-avatar';
  return u.profile_image || u.profile_photo_url
    ? <ResponsiveImage image={u.profile_image} fallback={u.profile_photo_url} alt={u.username} className={`${cls}-img`} sizes={`${size}px`} />
    : <span className={cls} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>{u.avatar}</span>;
}

// `handle` renders the name as an @handle (e.g. @her) — used where the name is
// itself the page's identity, so a separate "Profile" title would be redundant.
function Name({ className, handle = false }: { className?: string; handle?: boolean }) {
  const u = useProfileContext();
  return <span className={className ?? 'profile-slot-name'}>{handle ? `@${u.username}` : u.username}</span>;
}

// The badge slot — the whole point of #80: it can be dropped anywhere in the
// composition and shows all the badges the user has earned (nothing when none).
// `withInfo` turns on the hover/tap info popover — used on the public profile
// page, left off on inline surfaces like feed headers.
function Badges({ size, className, withInfo }: { size?: number; className?: string; withInfo?: boolean }) {
  const u = useProfileContext();
  return <BadgeRow badges={u.badges} size={size} className={className} withInfo={withInfo} />;
}

function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className ?? 'profile-slot-meta'}>{children}</span>;
}

Profile.Avatar = Avatar;
Profile.Name = Name;
Profile.Badges = Badges;
Profile.Meta = Meta;
