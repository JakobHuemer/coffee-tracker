import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Chart, registerables } from 'chart.js';
import { api } from '../api/client';
import { useThemeStore } from '../store/theme';
import { UnlockToast } from '../components/UnlockToast';
import type { Coffee, CoffeeEntry, Stats, UnlockNotification } from '../types';

Chart.register(...registerables);

function todayStr() { return new Date().toISOString().slice(0, 10); }

export function Dashboard() {
  const qc = useQueryClient();
  const { applyTheme, levelIndex, label, isDark, toggleDark } = useThemeStore();
  const [notifications, setNotifications] = useState<UnlockNotification[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState('');
  const chartsRef = useRef<Record<string, Chart>>({});

  const { data: coffees = [] } = useQuery<Coffee[]>({ queryKey: ['coffees'], queryFn: () => api.get('/coffees') });
  const { data: stats } = useQuery<Stats>({ queryKey: ['stats'], queryFn: () => api.get('/coffees/stats') });
  const { data: entries = [] } = useQuery<CoffeeEntry[]>({
    queryKey: ['entries', 'today'],
    queryFn: () => api.get(`/coffees/entries?date=${todayStr()}`),
  });

  const logMutation = useMutation({
    mutationFn: (coffeeId: string) => api.post<{ entry: CoffeeEntry; unlocked: UnlockNotification[] }>('/coffees/entries', { coffeeId }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['streaks'] });
      qc.invalidateQueries({ queryKey: ['casualties'] });
      if (data.unlocked?.length) setNotifications(data.unlocked);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/coffees/entries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['casualties'] });
    },
  });

  const patchTimeMutation = useMutation({
    mutationFn: ({ id, timestamp }: { id: string; timestamp: number }) =>
      api.patch(`/coffees/entries/${id}`, { timestamp }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setEditingId(null);
    },
  });

  function startEdit(entry: CoffeeEntry) {
    const t = new Date(entry.logged_at);
    setEditingTime(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`);
    setEditingId(entry.id);
  }

  function commitEdit(entry: CoffeeEntry) {
    if (!editingTime) { setEditingId(null); return; }
    const [h, m] = editingTime.split(':').map(Number);
    const d = new Date(entry.logged_at);
    d.setHours(h, m, 0, 0);
    patchTimeMutation.mutate({ id: entry.id, timestamp: d.getTime() });
  }

  // Tick every 10 s so canLog re-evaluates as time passes without user interaction.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (stats) applyTheme(stats.today_caffeine);
  }, [stats?.today_caffeine, applyTheme]);

  useEffect(() => {
    if (!stats) return;
    renderCharts();
    // renderCharts also reads `entries` (hour chart), so re-run when they change.
  }, [stats, levelIndex, entries]);

  // Destroy any live charts when the page unmounts to avoid leaking canvases.
  useEffect(() => {
    const charts = chartsRef.current;
    return () => {
      Object.values(charts).forEach(c => c.destroy());
    };
  }, []);

  function renderCharts() {
    if (!stats) return;
    const s = getComputedStyle(document.documentElement);
    const g = (v: string) => s.getPropertyValue(v).trim();
    const cc = {
      bar: g('--chart-bar'), hover: g('--chart-hover'), grid: g('--grid'),
      tick: g('--text-muted'), ttBg: g('--tooltip-bg'), ttBd: g('--tooltip-bd'), ttTxt: g('--text-sec'),
    };

    const baseOpts = (labelFn?: (v: number) => string) => ({
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.ttBg, titleColor: cc.ttTxt, bodyColor: cc.ttTxt,
          borderColor: cc.ttBd, borderWidth: 1, padding: 8, cornerRadius: 6,
          callbacks: labelFn ? { label: (ctx: any) => labelFn(ctx.raw) } : {},
        },
      },
      scales: {
        x: { grid: { color: cc.grid }, ticks: { color: cc.tick, font: { size: 11 } }, border: { display: false } },
        y: { grid: { color: cc.grid }, ticks: { color: cc.tick, font: { size: 11 }, precision: 0 }, border: { display: false }, beginAtZero: true },
      },
    });

    const mkBar = (data: number[]) => ({
      data, backgroundColor: cc.bar, hoverBackgroundColor: cc.hover, borderRadius: 4, borderSkipped: false, borderWidth: 0,
    });

    ['ch-day', 'ch-hour', 'ch-caf'].forEach(id => {
      const existing = chartsRef.current[id];
      if (existing) { existing.destroy(); delete chartsRef.current[id]; }
    });

    const dl = stats.last14.map(d => {
      const dt = new Date(d.date + 'T12:00:00');
      return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });

    const dayEl = document.getElementById('ch-day') as HTMLCanvasElement;
    if (dayEl) chartsRef.current['ch-day'] = new Chart(dayEl, {
      type: 'bar',
      data: { labels: dl, datasets: [mkBar(stats.last14.map(d => d.cups))] },
      options: baseOpts(v => `${v} cup${v !== 1 ? 's' : ''}`),
    } as any);

    const hc = Array(24).fill(0);
    entries.forEach(e => { hc[new Date(e.logged_at).getHours()]++; });
    const hl = Array.from({ length: 24 }, (_, i) => i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`);
    const hourEl = document.getElementById('ch-hour') as HTMLCanvasElement;
    if (hourEl) chartsRef.current['ch-hour'] = new Chart(hourEl, {
      type: 'bar', data: { labels: hl, datasets: [mkBar(hc)] },
      options: baseOpts(v => `${v} cup${v !== 1 ? 's' : ''}`),
    } as any);

    const cafEl = document.getElementById('ch-caf') as HTMLCanvasElement;
    if (cafEl) chartsRef.current['ch-caf'] = new Chart(cafEl, {
      type: 'bar',
      data: { labels: dl, datasets: [mkBar(stats.last14.map(d => d.caffeine))] },
      options: baseOpts(v => `${v}mg caffeine`),
    } as any);
  }

  const lastLoggedAt = entries.reduce((max, e) => Math.max(max, e.logged_at), 0);
  const canLog = now - lastLoggedAt >= 5 * 60 * 1000;

  const todayCaf = stats?.today_caffeine || 0;
  const pct = todayCaf / 400;
  const safeText = !todayCaf ? '' : pct < 0.75 ? `✓ ${Math.round(pct * 100)}% of daily limit` : pct < 1 ? `⚠ ${Math.round(pct * 100)}% of daily limit` : '✕ Over 400mg limit';
  const safeColor = !todayCaf ? '' : pct < 0.75 ? '#4CAF50' : pct < 1 ? '#FF9800' : '#E53935';

  return (
    <div className="page">
      <UnlockToast notifications={notifications} onClear={() => setNotifications([])} />

      <header className="app-header">
        <div className="header-brand">
          <img className="logo" src="/favicon.svg" alt="Coffee Tracker" />
          <div>
            <h1>Coffee Tracker</h1>
            <div className="date">{new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="theme-badge">{label}</span>
          <button
            className="dark-toggle-inline"
            onClick={toggleDark}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <main>
        <div className="hero-row">
          <div className="hero-tile">
            <div className="hero-value">{stats?.today_cups ?? 0}</div>
            <div className="hero-label">Today's cups</div>
          </div>
          <div className="hero-tile">
            <div className="hero-value">{todayCaf}mg</div>
            <div className="hero-label">Caffeine today</div>
            {safeText && <div className="safe-indicator" style={{ color: safeColor }}>{safeText}</div>}
          </div>
          <div className="hero-tile">
            <div className="hero-value">{stats?.seven_day_avg ?? '0.0'}</div>
            <div className="hero-label">7-day avg / day</div>
          </div>
        </div>

        <div className="card">
          <div className="section-label">Log a coffee</div>
          <div className="coffee-grid">
            {coffees.map(c => (
              <button
                key={c.id}
                className="coffee-btn"
                onClick={() => logMutation.mutate(c.id)}
                disabled={logMutation.isPending || !canLog}
              >
                <span className="cb-icon">{c.icon}</span>
                <span className="cb-name">{c.name}</span>
                <span className="cb-mg">{c.caffeine}mg</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="log-header">
            <div className="section-label" style={{ marginBottom: 0 }}>Today's log</div>
            <span className="log-count-pill">{entries.length === 1 ? '1 cup' : `${entries.length} cups`}</span>
          </div>
          <div className="log-list">
            {entries.length === 0 ? (
              <div className="log-empty">No coffee logged yet today. Click a drink above to start.</div>
            ) : (
              entries.slice().sort((a, b) => b.logged_at - a.logged_at).map(e => {
                const c = coffees.find(x => x.id === e.coffee_id);
                const time = new Date(e.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={e.id} className="log-item">
                    {editingId === e.id ? (
                      <input
                        type="time"
                        className="li-time-input"
                        value={editingTime}
                        onChange={ev => setEditingTime(ev.target.value)}
                        onBlur={() => commitEdit(e)}
                        onKeyDown={ev => {
                          if (ev.key === 'Enter') commitEdit(e);
                          if (ev.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <span className="li-time li-time-editable" onClick={() => startEdit(e)} title="Click to edit time">{time}</span>
                    )}
                    <span className="li-dot" />
                    <span className="li-name">{c?.name ?? e.coffee_id}</span>
                    <span className="li-mg">{e.caffeine_mg}mg</span>
                    <button className="li-del" onClick={() => deleteMutation.mutate(e.id)}>✕</button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-card wide">
            <div className="chart-title">Coffees per day</div>
            <div className="chart-sub">Last 14 days</div>
            <div className="chart-wrap"><canvas id="ch-day" /></div>
          </div>
          <div className="chart-card">
            <div className="chart-title">Coffees by hour</div>
            <div className="chart-sub">All-time pattern</div>
            <div className="chart-wrap"><canvas id="ch-hour" /></div>
          </div>
          <div className="chart-card">
            <div className="chart-title">Caffeine per day</div>
            <div className="chart-sub">Last 14 days · mg</div>
            <div className="chart-wrap"><canvas id="ch-caf" /></div>
          </div>
        </div>

        <div className="card">
          <div className="section-label">All-time by type</div>
          <div className="breakdown-grid">
            {coffees.slice().sort((a, b) => (stats?.by_type[b.id] || 0) - (stats?.by_type[a.id] || 0)).map(c => (
              <div key={c.id} className="bd-item">
                <span className="bd-dot" />
                <span className="bd-name">{c.name}</span>
                <span className="bd-count">{stats?.by_type[c.id] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
