import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { UnlockToast } from '../components/UnlockToast';
import { CompareContent } from './Compare';
import type {
  Achievement, Badge, Challenge, GoalsResponse,
  RankingEntry, Stats as StatsData, Streak, Task, UnlockNotification,
} from '../types';

// ── Shared helpers ────────────────────────────────────────────────────────────

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'secret'];
const RARITY_COLORS: Record<string, string> = {
  common: '#9E9E9E', uncommon: '#4CAF50', rare: '#2196F3',
  epic: '#9C27B0', legendary: '#FF9800', secret: '#FF1744',
};
function rarityLabel(r: string) {
  return { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', secret: '???' }[r] || r;
}

const METRICS = [
  { value: 'total_cups', label: 'Total Cups' },
  { value: 'caffeine', label: 'Total Caffeine (mg)' },
  { value: 'espresso_cups', label: 'Espresso Cups' },
  { value: 'unique_types', label: 'Unique Coffee Types' },
];
function metricLabel(m: string) { return METRICS.find(x => x.value === m)?.label || m; }
function progressPct(current: number, target: number) { return Math.min(100, Math.round((current / target) * 100)); }

interface RankingsResponse { rankings: RankingEntry[]; my_rank: RankingEntry | null; }

type Tab = 'goals' | 'badges' | 'rankings' | 'challenges' | 'compare';

// ── Tab: Goals ────────────────────────────────────────────────────────────────

function GoalsTab({ setNotifications }: { setNotifications: (n: UnlockNotification[]) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<GoalsResponse>({
    queryKey: ['goals'], queryFn: () => api.get('/goals/today'), refetchInterval: 30000,
  });
  const completeMutation = useMutation({
    mutationFn: () => api.post<{ tasks: Task[]; allDone: boolean; unlocked: UnlockNotification[]; streak: Streak }>('/goals/complete'),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['streaks'] });
      if (result.unlocked?.length) setNotifications(result.unlocked);
    },
  });

  if (isLoading) return <div className="page-loading">Loading goals…</div>;
  if (!data) return null;
  const allDone = data.tasks.every(t => t.completed);
  const doneCount = data.tasks.filter(t => t.completed).length;
  const pct = data.tasks.length ? (doneCount / data.tasks.length) * 100 : 0;

  return (
    <div className="stats-tab-body">
      <div className="card">
        <div className="section-label">Today's Goals — {doneCount}/{data.tasks.length}</div>
        <div className="progress-bar-wrap">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="task-list">
          {data.tasks.map(task => (
            <div key={task.id} className={`task-item${task.completed ? ' done' : ''}`}>
              <div className="task-check">{task.completed ? '✅' : '⬜'}</div>
              <span className="task-icon">{task.icon}</span>
              <span className="task-label">{task.label}</span>
            </div>
          ))}
        </div>
        {allDone ? (
          <div className="goals-complete-banner">🎉 All goals completed! Streak extended!</div>
        ) : (
          <button className="btn-primary" style={{ marginTop: 16 }}
            onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending}>
            {completeMutation.isPending ? 'Checking…' : 'Check Progress'}
          </button>
        )}
      </div>
      <div className="card">
        <div className="section-label">How goals work</div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-sec)', lineHeight: 1.6 }}>
          You get 2 compatible tasks each day. Complete them both to extend your streak. Tasks
          evaluate automatically based on today's coffee log — just log your coffees and check back!
        </p>
      </div>
    </div>
  );
}

// ── Tab: Badges & Achievements ────────────────────────────────────────────────

function BadgesTab() {
  const { data: achievements = [] } = useQuery<Achievement[]>({
    queryKey: ['achievements'], queryFn: () => api.get('/achievements'),
  });
  const { data: badges = [] } = useQuery<Badge[]>({
    queryKey: ['badges'], queryFn: () => api.get('/badges'),
  });
  const categories = [...new Set(achievements.map(a => a.category))];

  return (
    <div className="stats-tab-body">
      <div className="card">
        <div className="section-label">Badges</div>
        <div className="badges-grid">
          {badges
            .slice()
            .sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) || RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity))
            .map(b => (
              <div key={b.id} className={`badge-card${b.unlocked ? ' unlocked' : ' locked'}`} title={b.description}>
                <div className="badge-icon">{b.icon}</div>
                <div className="badge-name">{b.name}</div>
                <div className="badge-rarity" style={{ color: RARITY_COLORS[b.rarity] || '#999' }}>{rarityLabel(b.rarity)}</div>
                {b.unlocked && b.unlocked_at && <div className="badge-date">{new Date(b.unlocked_at).toLocaleDateString()}</div>}
              </div>
            ))}
        </div>
      </div>

      {categories.map(cat => {
        const catAchs = achievements.filter(a => a.category === cat);
        return (
          <div key={cat} className="card">
            <div className="section-label">{cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
            <div className="ach-list">
              {catAchs.map(a => (
                <div key={a.id} className={`ach-item${a.unlocked ? ' unlocked' : ' locked'}`}>
                  <div className="ach-icon">{a.icon}</div>
                  <div className="ach-body">
                    <div className="ach-name">{a.name}</div>
                    <div className="ach-desc">{a.description}</div>
                    {a.unlocked && a.unlocked_at && <div className="ach-date">Unlocked {new Date(a.unlocked_at).toLocaleDateString()}</div>}
                  </div>
                  {a.unlocked && <div className="ach-check">✅</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab: Rankings ─────────────────────────────────────────────────────────────

function RankingsTab() {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'alltime'>('weekly');
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery<RankingsResponse>({
    queryKey: ['rankings', period],
    queryFn: () => api.get(`/rankings?period=${period}`),
    refetchInterval: 60000,
  });

  const { data: casualties } = useQuery({
    queryKey: ['casualties'], queryFn: () => api.get<{ global_count: number; heart_attack_risk: number; disclaimer: string }>('/casualties'), refetchInterval: 30000,
  });
  const risk = (casualties as any)?.heart_attack_risk ?? 0;
  const riskColor = risk < 20 ? '#4CAF50' : risk < 45 ? '#FF9800' : risk < 70 ? '#FF5722' : '#E53935';

  return (
    <div className="stats-tab-body">
      <div className="card casualties-card">
        <div className="section-label">☠️ Coffee Casualties This Month</div>
        <div className="casualties-count">{((casualties as any)?.global_count ?? 0).toLocaleString()}</div>
        <div className="casualties-sub">fellow caffeine enthusiasts who crossed the 400mg threshold</div>
        <div className="casualties-disclaimer">⚠️ Entertainment only. Not real medical data.</div>
        <div className="risk-section">
          <div className="risk-label">Your Heart Attack Risk Today™</div>
          <div className="risk-bar-wrap">
            <div className="risk-bar" style={{ width: `${risk}%`, backgroundColor: riskColor }} />
          </div>
          <div className="risk-value" style={{ color: riskColor }}>
            {risk}% — {risk < 10 ? 'Your heart is fine 💚' : risk < 30 ? 'Getting caffeinated ☕' : risk < 50 ? 'Heart says slow down ⚠️' : risk < 75 ? 'Doctor on speed dial 🚨' : 'Please drink water 💀'}
          </div>
          <div className="risk-disclaimer">(For entertainment only. Please do not call an ambulance.)</div>
        </div>
      </div>

      <div className="tab-row">
        {(['daily', 'weekly', 'alltime'] as const).map(p => (
          <button key={p} className={`tab-btn${period === p ? ' active' : ''}`} onClick={() => setPeriod(p)}>
            {p === 'daily' ? 'Today' : p === 'weekly' ? 'This Week' : 'All Time'}
          </button>
        ))}
      </div>

      {data?.my_rank && (
        <div className="card my-rank-card">
          <div className="my-rank-label">Your rank</div>
          <div className="my-rank-row">
            <div className="rank-num">#{data.my_rank.rank}</div>
            <div className="rank-user">
              <span className="rank-avatar">{data.my_rank.avatar}</span>
              <span className="rank-username">{data.my_rank.username}</span>
            </div>
            <div className="rank-stats">
              <span>{data.my_rank.cups} cups</span>
              <span className="rank-caf">{data.my_rank.total_caffeine}mg</span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-label">Top Brewers</div>
        {isLoading ? <div className="load-text">Loading…</div> : (
          <div className="leaderboard">
            {(data?.rankings ?? []).map((r, i) => (
              <div key={r.id} className={`lb-row${r.id === user?.id ? ' me' : ''}`}
                onClick={() => r.id !== user?.id && navigate(`/compare/${r.username}`)}
                style={{ cursor: r.id !== user?.id ? 'pointer' : 'default' }}>
                <div className="lb-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${r.rank}`}</div>
                <div className="lb-user">
                  <span className="lb-avatar">{r.avatar}</span>
                  <span className="lb-username">{r.username}</span>
                </div>
                <div className="lb-stats">
                  <span>{r.cups} cups</span>
                  <span className="lb-caf">{r.total_caffeine}mg</span>
                </div>
              </div>
            ))}
            {(data?.rankings ?? []).length === 0 && <div className="load-text">No data yet. Be the first to brew!</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Challenges ───────────────────────────────────────────────────────────

const MILESTONE_DEFS = [
  { id: 'ten_cups',          label: 'Drink 10 coffees',          key: 'cups'    as const, target: 10 },
  { id: 'fifty_cups',        label: 'Drink 50 coffees',          key: 'cups'    as const, target: 50 },
  { id: 'hundred_cups',      label: 'Drink 100 coffees',         key: 'cups'    as const, target: 100 },
  { id: 'five_hundred_cups', label: 'Drink 500 coffees',         key: 'cups'    as const, target: 500 },
  { id: 'caffeine_1000',     label: 'Consume 1,000mg caffeine',  key: 'caf'     as const, target: 1000 },
  { id: 'caffeine_10000',    label: 'Consume 10,000mg caffeine', key: 'caf'     as const, target: 10000 },
  { id: 'variety_3',         label: 'Try 3 coffee types',        key: 'variety' as const, target: 3 },
  { id: 'variety_7',         label: 'Try 7 coffee types',        key: 'variety' as const, target: 7 },
  { id: 'variety_all',       label: 'Try all 13 coffee types',   key: 'variety' as const, target: 13 },
  { id: 'streak_3',          label: '3-day goal streak',         key: 'streak'  as const, target: 3 },
  { id: 'streak_7',          label: '7-day goal streak',         key: 'streak'  as const, target: 7 },
  { id: 'streak_30',         label: '30-day goal streak',        key: 'streak'  as const, target: 30 },
];

function ChallengesTab({ setNotifications }: { setNotifications: (n: UnlockNotification[]) => void }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', metric: 'total_cups', target: 10, endDate: '' });

  const { data: challenges = [] } = useQuery<Challenge[]>({
    queryKey: ['challenges'], queryFn: () => api.get('/challenges'), refetchInterval: 60000,
  });
  const { data: stats } = useQuery<StatsData>({
    queryKey: ['stats'], queryFn: () => api.get('/coffees/stats'),
  });
  const { data: streaks } = useQuery<{ current_streak: number; longest_streak: number }>({
    queryKey: ['streaks'], queryFn: () => api.get('/streaks'),
  });
  const { data: achievements = [] } = useQuery<Achievement[]>({
    queryKey: ['achievements'], queryFn: () => api.get('/achievements'),
  });

  const uniqueTypes = Object.keys(stats?.by_type ?? {}).length;
  const cupsTotal = stats?.total_cups ?? 0;
  const cafTotal = stats?.total_caffeine ?? 0;
  const streak = streaks?.current_streak ?? 0;

  const milestones = MILESTONE_DEFS.map(m => {
    const current = m.key === 'cups' ? cupsTotal : m.key === 'caf' ? cafTotal : m.key === 'variety' ? uniqueTypes : streak;
    const unlocked = achievements.find(a => a.id === m.id)?.unlocked ?? false;
    const pct = Math.min(100, Math.round((current / m.target) * 100));
    return { ...m, current, unlocked, pct };
  });

  const joinMutation = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; unlocked: UnlockNotification[] }>(`/challenges/${id}/join`),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['challenges'] }); if (data.unlocked?.length) setNotifications(data.unlocked); },
  });
  const createMutation = useMutation({
    mutationFn: (body: typeof form) => api.post('/challenges', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['challenges'] }); setShowCreate(false); },
  });

  const community = challenges.filter(c => c.type === 'community');
  const personal  = challenges.filter(c => c.type === 'personal');
  const minDate = new Date(); minDate.setDate(minDate.getDate() + 1);
  const minDateStr = minDate.toISOString().slice(0, 10);

  return (
    <div className="stats-tab-body">
      <div className="section-header">
        <div className="section-label" style={{ marginBottom: 0 }}>Milestones</div>
        <span className="section-tag">Personal progress</span>
      </div>

      <div className="card">
        <div className="milestone-list">
          {milestones.map(m => (
            <div key={m.id} className={`milestone-item${m.unlocked ? ' done' : ''}`}>
              <div className="milestone-label-row">
                <span className="milestone-label">{m.label}</span>
                <span className="milestone-count">
                  {m.unlocked
                    ? '✅ Done'
                    : `${m.current.toLocaleString()} / ${m.target.toLocaleString()}`}
                </span>
              </div>
              <div className="ch-progress-wrap" style={{ marginBottom: 0 }}>
                <div
                  className={`ch-progress-bar${m.unlocked ? ' milestone-done' : ''}`}
                  style={{ width: `${m.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-header">
        <div className="section-label" style={{ marginBottom: 0 }}>Community Challenges</div>
        <span className="section-tag">Everyone together</span>
      </div>

      {community.map(c => {
        const pct = progressPct(c.community_progress, c.target);
        return (
          <div key={c.id} className="card">
            <div className="ch-header">
              <div><div className="ch-name">{c.name}</div><div className="ch-desc">{c.description}</div></div>
              <div className="ch-badge community">Community</div>
            </div>
            <div className="ch-progress-label">
              <span>{metricLabel(c.metric)}</span>
              <span>{c.community_progress.toLocaleString()} / {c.target.toLocaleString()}</span>
            </div>
            <div className="ch-progress-wrap"><div className="ch-progress-bar" style={{ width: `${pct}%` }} /></div>
            <div className="ch-meta">
              <span>👥 {c.participants_count} participants</span>
              <span>📅 Ends {new Date(c.end_date).toLocaleDateString()}</span>
            </div>
            {c.joined ? (
              <div className="ch-joined">✅ Joined · Your contribution: {c.my_progress?.toLocaleString() ?? 0}</div>
            ) : (
              <button className="btn-primary" onClick={() => joinMutation.mutate(c.id)} disabled={joinMutation.isPending}>Join Challenge</button>
            )}
          </div>
        );
      })}

      <div className="section-header">
        <div className="section-label" style={{ marginBottom: 0 }}>Personal Challenges</div>
        <button className="btn-secondary" onClick={() => setShowCreate(!showCreate)}>{showCreate ? 'Cancel' : '+ Create'}</button>
      </div>

      {showCreate && (
        <div className="card">
          <div className="section-label">New Personal Challenge</div>
          <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="create-form">
            <div className="field"><label>Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g. Espresso Month" /></div>
            <div className="field"><label>Description</label><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" /></div>
            <div className="field"><label>Track</label>
              <select value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))}>
                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Target</label><input type="number" value={form.target} min={1} onChange={e => setForm(f => ({ ...f, target: +e.target.value }))} required /></div>
            <div className="field"><label>End Date</label><input type="date" value={form.endDate} min={minDateStr} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required /></div>
            <button type="submit" className="btn-primary" disabled={createMutation.isPending}>{createMutation.isPending ? 'Creating…' : 'Create Challenge'}</button>
          </form>
        </div>
      )}

      {personal.length === 0 && !showCreate && (
        <div className="card empty-state"><div>No personal challenges yet. Create one to track your own goals!</div></div>
      )}

      {personal.map(c => {
        const pct = c.my_progress !== null ? progressPct(c.my_progress, c.target) : 0;
        return (
          <div key={c.id} className="card">
            <div className="ch-header">
              <div><div className="ch-name">{c.name}</div>{c.description && <div className="ch-desc">{c.description}</div>}</div>
              <div className="ch-badge personal">Personal</div>
            </div>
            <div className="ch-progress-label">
              <span>{metricLabel(c.metric)}</span>
              <span>{(c.my_progress ?? 0).toLocaleString()} / {c.target.toLocaleString()}</span>
            </div>
            <div className="ch-progress-wrap"><div className="ch-progress-bar personal" style={{ width: `${pct}%` }} /></div>
            <div className="ch-meta">
              <span>📅 Ends {new Date(c.end_date).toLocaleDateString()}</span>
              <span>{pct >= 100 ? '🎉 Completed!' : `${pct}%`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Stats page ───────────────────────────────────────────────────────────

export function Stats() {
  const [activeTab, setActiveTab] = useState<Tab>('goals');
  const [notifications, setNotifications] = useState<UnlockNotification[]>([]);

  const { data: stats } = useQuery<StatsData>({
    queryKey: ['stats'], queryFn: () => api.get('/coffees/stats'), refetchInterval: 30000,
  });
  const { data: streaks } = useQuery<{ current_streak: number; longest_streak: number }>({
    queryKey: ['streaks'], queryFn: () => api.get('/streaks'),
  });
  const { data: alltimeRank } = useQuery<RankingsResponse>({
    queryKey: ['rankings', 'alltime'], queryFn: () => api.get('/rankings?period=alltime'),
  });

  const todayCaf = stats?.today_caffeine || 0;
  const pct = todayCaf / 400;
  const safeColor = !todayCaf ? 'var(--text-muted)' : pct < 0.75 ? '#4CAF50' : pct < 1 ? '#FF9800' : '#E53935';

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'goals',      label: 'Goals',      icon: '🎯' },
    { id: 'badges',     label: 'Badges',     icon: '🏅' },
    { id: 'rankings',   label: 'Rankings',   icon: '🏆' },
    { id: 'challenges', label: 'Challenges', icon: '⚡' },
    { id: 'compare',    label: 'Compare',    icon: '⚔️' },
  ];

  return (
    <div className="page">
      <UnlockToast notifications={notifications} onClear={() => setNotifications([])} />

      <div className="page-header">
        <h2>Stats</h2>
        <p className="page-sub">Your coffee journey at a glance</p>
      </div>

      {/* Top hero — global rank, streak, daily stats */}
      <div className="stats-hero">
        <div className="stats-hero-top">
          <div className="stats-rank-tile">
            <div className="stats-rank-num">
              {alltimeRank?.my_rank ? `#${alltimeRank.my_rank.rank}` : '—'}
            </div>
            <div className="stats-rank-label">Global Rank</div>
          </div>
          <div className="stats-streak-tile">
            <div className="stats-streak-num">{streaks?.current_streak ?? 0} 🔥</div>
            <div className="stats-streak-label">Day Streak</div>
          </div>
        </div>

        <div className="hero-row" style={{ margin: 0 }}>
          <div className="hero-tile">
            <div className="hero-value">{stats?.today_cups ?? 0}</div>
            <div className="hero-label">Today's cups</div>
          </div>
          <div className="hero-tile">
            <div className="hero-value" style={{ color: safeColor }}>{todayCaf}mg</div>
            <div className="hero-label">Caffeine today</div>
          </div>
          <div className="hero-tile">
            <div className="hero-value">{stats?.seven_day_avg ?? '0.0'}</div>
            <div className="hero-label">7-day avg</div>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="stats-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`stats-tab-btn${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'goals'      && <GoalsTab setNotifications={setNotifications} />}
      {activeTab === 'badges'     && <BadgesTab />}
      {activeTab === 'rankings'   && <RankingsTab />}
      {activeTab === 'challenges' && <ChallengesTab setNotifications={setNotifications} />}
      {activeTab === 'compare'    && <div className="stats-tab-body"><CompareContent /></div>}
    </div>
  );
}
