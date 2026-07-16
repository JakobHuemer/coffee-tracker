import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Challenge, UnlockNotification } from '../types';
import { UnlockToast } from '../components/UnlockToast';

const METRICS = [
  { value: 'total_cups', label: 'Total Cups' },
  { value: 'caffeine', label: 'Total Caffeine (mg)' },
  { value: 'espresso_cups', label: 'Espresso Cups' },
  { value: 'unique_types', label: 'Unique Coffee Types' },
];

function metricLabel(m: string) { return METRICS.find(x => x.value === m)?.label || m; }
function progressPct(current: number, target: number) { return Math.min(100, Math.round((current / target) * 100)); }

export function Challenges() {
  const qc = useQueryClient();
  const [notifications, setNotifications] = useState<UnlockNotification[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', metric: 'total_cups', target: 10, endDate: '' });

  const { data: challenges = [] } = useQuery<Challenge[]>({
    queryKey: ['challenges'], queryFn: () => api.get('/challenges'), refetchInterval: 60000,
  });

  const joinMutation = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; unlocked: UnlockNotification[] }>(`/challenges/${id}/join`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['challenges'] });
      if (data.unlocked?.length) setNotifications(data.unlocked);
    },
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
    <div className="page">
      <UnlockToast notifications={notifications} onClear={() => setNotifications([])} />

      <div className="page-header">
        <h2>Challenges</h2>
        <p className="page-sub">Push your limits together</p>
      </div>

      <main>
        <div className="section-header">
          <div className="section-label" style={{ marginBottom: 0 }}>Community Challenges</div>
          <span className="section-tag">Everyone together</span>
        </div>

        {community.map(c => {
          const pct = progressPct(c.community_progress, c.target);
          return (
            <div key={c.id} className="card challenge-card">
              <div className="ch-header">
                <div>
                  <div className="ch-name">{c.name}</div>
                  <div className="ch-desc">{c.description}</div>
                </div>
                <div className="ch-badge community">Community</div>
              </div>
              <div className="ch-progress-label">
                <span>{metricLabel(c.metric)}</span>
                <span>{c.community_progress.toLocaleString()} / {c.target.toLocaleString()}</span>
              </div>
              <div className="ch-progress-wrap">
                <div className="ch-progress-bar" style={{ width: `${pct}%` }} />
              </div>
              <div className="ch-meta">
                <span>👥 {c.participants_count} participants</span>
                <span>📅 Ends {new Date(c.end_date).toLocaleDateString()}</span>
              </div>
              {c.joined ? (
                <div className="ch-joined">✅ Joined · Your contribution: {c.my_progress?.toLocaleString() ?? 0}</div>
              ) : (
                <button className="btn-primary" onClick={() => joinMutation.mutate(c.id)} disabled={joinMutation.isPending}>
                  Join Challenge
                </button>
              )}
            </div>
          );
        })}

        <div className="section-header">
          <div className="section-label" style={{ marginBottom: 0 }}>Personal Challenges</div>
          <button className="btn-secondary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancel' : '+ Create'}
          </button>
        </div>

        {showCreate && (
          <div className="card">
            <div className="section-label">New Personal Challenge</div>
            <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="create-form">
              <div className="field">
                <label>Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g. Espresso Month" />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="field">
                <label>Track</label>
                <select value={form.metric} onChange={e => setForm(f => ({ ...f, metric: e.target.value }))}>
                  {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Target</label>
                <input type="number" value={form.target} min={1} onChange={e => setForm(f => ({ ...f, target: +e.target.value }))} required />
              </div>
              <div className="field">
                <label>End Date</label>
                <input type="date" value={form.endDate} min={minDateStr} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required />
              </div>
              <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create Challenge'}
              </button>
            </form>
          </div>
        )}

        {personal.length === 0 && !showCreate && (
          <div className="card empty-state">
            <div>No personal challenges yet. Create one to track your own goals!</div>
          </div>
        )}

        {personal.map(c => {
          const pct = c.my_progress !== null ? progressPct(c.my_progress, c.target) : 0;
          return (
            <div key={c.id} className="card challenge-card">
              <div className="ch-header">
                <div>
                  <div className="ch-name">{c.name}</div>
                  {c.description && <div className="ch-desc">{c.description}</div>}
                </div>
                <div className="ch-badge personal">Personal</div>
              </div>
              <div className="ch-progress-label">
                <span>{metricLabel(c.metric)}</span>
                <span>{(c.my_progress ?? 0).toLocaleString()} / {c.target.toLocaleString()}</span>
              </div>
              <div className="ch-progress-wrap">
                <div className="ch-progress-bar personal" style={{ width: `${pct}%` }} />
              </div>
              <div className="ch-meta">
                <span>📅 Ends {new Date(c.end_date).toLocaleDateString()}</span>
                <span>{pct >= 100 ? '🎉 Completed!' : `${pct}%`}</span>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
