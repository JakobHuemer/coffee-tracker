import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { UnlockToast } from '../components/UnlockToast';
import type { CompareUserProfile, CompareUserStats, UnlockNotification } from '../types';

interface CompareResponse {
  me: CompareUserProfile;
  them: CompareUserProfile;
  unlocked: UnlockNotification[];
}

const STAT_DEFS: { key: keyof CompareUserStats; label: string; suffix?: string }[] = [
  { key: 'total_cups', label: 'Total Cups' },
  { key: 'total_caffeine', label: 'Total Caffeine', suffix: ' mg' },
  { key: 'today_cups', label: "Today's Cups" },
  { key: 'today_caffeine', label: "Today's Caffeine", suffix: ' mg' },
  { key: 'seven_day_avg', label: '7-Day Avg / Day' },
  { key: 'unique_types', label: 'Types Tried' },
  { key: 'current_streak', label: 'Current Streak' },
  { key: 'longest_streak', label: 'Best Streak' },
  { key: 'achievements_count', label: 'Achievements' },
  { key: 'badges_count', label: 'Badges' },
];

const fmt = (n: number, suffix = '') =>
  `${Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)}${suffix}`;

function StatBar({ label, mine, theirs, suffix }: { label: string; mine: number; theirs: number; suffix?: string }) {
  const total = mine + theirs;
  const minePct = total > 0 ? (mine / total) * 100 : 50;
  const state = mine > theirs ? 'me' : theirs > mine ? 'them' : 'tie';
  return (
    <div className="vs-stat">
      <div className="vs-stat-top">
        <div className={`vs-stat-val ${state === 'me' ? 'win' : ''}`}>{fmt(mine, suffix)}</div>
        <div className="vs-stat-label">{label}</div>
        <div className={`vs-stat-val right ${state === 'them' ? 'win' : ''}`}>{fmt(theirs, suffix)}</div>
      </div>
      <div className="vs-track">
        <div className={`vs-fill-me ${state}`} style={{ width: `${minePct}%` }} />
        <div className={`vs-fill-them ${state}`} style={{ width: `${100 - minePct}%` }} />
      </div>
    </div>
  );
}

export function Compare() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<UnlockNotification[]>([]);
  const [searchInput, setSearchInput] = useState(username || '');

  const { data, isLoading, error } = useQuery<CompareResponse>({
    queryKey: ['compare', username],
    queryFn: () => api.get<CompareResponse>(`/compare/${username}`).then(d => {
      if (d.unlocked?.length) setNotifications(d.unlocked);
      return d;
    }),
    enabled: !!username,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) navigate(`/compare/${searchInput.trim()}`);
  }

  const tally = data
    ? STAT_DEFS.reduce(
        (acc, d) => {
          const mine = Number(data.me.stats[d.key]);
          const theirs = Number(data.them.stats[d.key]);
          if (mine > theirs) acc.me++;
          else if (theirs > mine) acc.them++;
          else acc.tie++;
          return acc;
        },
        { me: 0, them: 0, tie: 0 },
      )
    : null;

  const verdict = tally
    ? tally.me > tally.them
      ? { text: 'You’re on top ☕', cls: 'win' }
      : tally.them > tally.me
        ? { text: 'They’ve got the edge', cls: 'lose' }
        : { text: 'Neck and neck', cls: 'tie' }
    : null;

  return (
    <div className="page">
      <UnlockToast notifications={notifications} onClear={() => setNotifications([])} />

      <div className="page-header">
        <h2>Coffee Comparison</h2>
        <p className="page-sub">How do you stack up?</p>
      </div>

      <main>
        <div className="card">
          <div className="section-label">Find a user</div>
          <form onSubmit={handleSearch} className="search-row">
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Enter username…"
              className="search-input"
            />
            <button type="submit" className="btn-primary" style={{ flexShrink: 0, width: 'auto' }}>Compare</button>
          </form>
        </div>

        {isLoading && <div className="page-loading">Comparing…</div>}
        {error && <div className="card error-card">User not found or error: {(error as Error).message}</div>}

        {data && tally && verdict && (
          <div className="card compare-card">
            <div className="vs-header">
              <div className="vs-player me">
                <div className="vs-avatar">{data.me.avatar}</div>
                <div className="vs-name">{data.me.username}</div>
                <div className="vs-tag">You</div>
              </div>
              <div className="vs-badge">VS</div>
              <div className="vs-player them">
                <div className="vs-avatar">{data.them.avatar}</div>
                <div className="vs-name">{data.them.username}</div>
                <div className="vs-tag">Them</div>
              </div>
            </div>

            <div className="vs-score">
              <span className={`vs-score-num me ${tally.me >= tally.them ? '' : 'dim'}`}>{tally.me}</span>
              <span className="vs-score-dash">–</span>
              <span className={`vs-score-num them ${tally.them >= tally.me ? '' : 'dim'}`}>{tally.them}</span>
            </div>
            <div className={`vs-verdict ${verdict.cls}`}>{verdict.text}</div>

            <div className="vs-stats">
              {STAT_DEFS.map(d => (
                <StatBar
                  key={d.key}
                  label={d.label}
                  suffix={d.suffix}
                  mine={Number(data.me.stats[d.key])}
                  theirs={Number(data.them.stats[d.key])}
                />
              ))}
            </div>

            <div className="vs-favs">
              <div className="vs-fav">
                <div className="vs-fav-label">Your Favourite</div>
                <div className="vs-fav-coffee">
                  {data.me.stats.favourite_coffee
                    ? `${data.me.stats.favourite_coffee.icon} ${data.me.stats.favourite_coffee.name}`
                    : '—'}
                </div>
              </div>
              <div className="vs-fav">
                <div className="vs-fav-label">Their Favourite</div>
                <div className="vs-fav-coffee">
                  {data.them.stats.favourite_coffee
                    ? `${data.them.stats.favourite_coffee.icon} ${data.them.stats.favourite_coffee.name}`
                    : '—'}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
