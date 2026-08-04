import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Profile } from '../components/Profile';
import { CompareContent } from './Compare';
import type { PublicProfile, CompareUserStats } from '../types';

// The stats shown on a public profile, in display order. A subset of the Compare
// stat set — the head-to-head bars live in the inline Compare section below.
const STAT_DEFS: { key: keyof CompareUserStats; label: string; suffix?: string }[] = [
  { key: 'total_cups', label: 'Total Cups' },
  { key: 'total_caffeine', label: 'Total Caffeine', suffix: ' mg' },
  { key: 'current_streak', label: 'Current Streak' },
  { key: 'longest_streak', label: 'Best Streak' },
  { key: 'unique_types', label: 'Types Tried' },
  { key: 'seven_day_avg', label: '7-Day Avg / Day' },
  { key: 'achievements_count', label: 'Achievements' },
  { key: 'badges_count', label: 'Badges' },
];

const fmt = (n: number, suffix = '') =>
  `${Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)}${suffix}`;

// The public profile of any user (issue #73), reached by clicking their name or
// avatar anywhere in the app. Shows their identity + featured badges + headline
// stats, and — for someone other than yourself — folds the Compare view in
// inline behind a button, so comparing no longer needs its own detour.
export function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const [comparing, setComparing] = useState(false);
  const compareRef = useRef<HTMLDivElement>(null);

  // The comparison mounts below the fold, so opening it looked like nothing
  // happened. Scroll it into view — smoothly, unless the viewer asked for
  // reduced motion, in which case jump straight there.
  useEffect(() => {
    if (!comparing) return;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    compareRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [comparing]);

  const { data, isLoading, error } = useQuery<PublicProfile>({
    queryKey: ['user-profile', username],
    queryFn: () => api.get<PublicProfile>(`/users/${username}`),
    enabled: !!username,
    retry: false,
  });

  return (
    <div className="page">
      <AppHeader />
      {/* No "Profile" page title — the card below is obviously the profile, and
          the @handle sits on the name itself. */}
      <main>
        {isLoading && <div className="page-loading">Loading…</div>}
        {error && <div className="card error-card">User not found or error: {(error as Error).message}</div>}

        {data && (
          <>
            {/* The compound <Profile> in action: the pieces are composed here,
                not fixed inside the component. See components/Profile.tsx. */}
            <div className="card profile-card">
              <Profile user={data} className="pub-profile-head">
                <Profile.Avatar size={96} />
                <Profile.Name handle className="pub-profile-name" />
                <Profile.Badges size={34} className="profile-head-badges" withInfo />
                <Profile.Meta className="pub-profile-since">
                  Member since {new Date(data.created_at).toLocaleDateString()}
                </Profile.Meta>
              </Profile>

              {data.self ? (
                <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => navigate('/profile')}>
                  <Icon name="chart" size={14} /> This is you — edit profile
                </button>
              ) : (
                <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => setComparing(v => !v)}>
                  {comparing ? 'Hide comparison' : 'Compare with me'}
                </button>
              )}
            </div>

            <div className="card">
              <div className="section-label">Stats</div>
              <div className="pub-stat-grid">
                {STAT_DEFS.map(d => (
                  <div key={d.key} className="pub-stat">
                    <div className="pub-stat-val">{fmt(Number(data.stats[d.key]), d.suffix)}</div>
                    <div className="pub-stat-label">{d.label}</div>
                  </div>
                ))}
              </div>
              <div className="pub-fav">
                <span className="pub-fav-label">Favourite</span>
                <span className="pub-fav-coffee">
                  {data.stats.favourite_coffee
                    ? <>{data.stats.favourite_coffee.name}</>
                    : '—'}
                </span>
              </div>
            </div>

            {/* Compare moved onto the public profile (issue #73): the head-to-head
                runs inline against this one user, no search box. */}
            {comparing && !data.self && (
              <div ref={compareRef}>
                <CompareContent initialUsername={data.username} hideSearch />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
