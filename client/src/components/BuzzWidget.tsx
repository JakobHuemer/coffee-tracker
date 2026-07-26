import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Icon } from './Icon';
import type { EnergyResponse, User } from '../types';

// Buzz — the caffeine battery. Everything shown here is derived server-side
// from the coffee log (GET /api/energy); nothing is stored, so it is always in
// sync with what the user actually posted.

const WINDOWS = [
  { hours: 24, label: '24h' },
  { hours: 168, label: '7d' },
];

// SVG user units. The viewBox is stretched to the card width, so strokes use
// vector-effect="non-scaling-stroke" to stay an even thickness.
const VB_W = 300;
const VB_H = 100;

function stateLabel(s: EnergyResponse['state']) {
  return { charging: 'Charging', draining: 'Draining', empty: 'Empty' }[s];
}

function timeLabel(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayTimeLabel(t: number) {
  return new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

// "in 4h 20m" / "in 35m" for the moment the battery runs flat.
function untilLabel(from: number, to: number) {
  const mins = Math.max(0, Math.round((to - from) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// How fast caffeine leaves the body differs a lot between people (CYP1A2
// activity), so the decay half-life is per-user. Presets are phrased by how it
// feels, with the hours shown, and there is a box for anyone who knows their
// actual number. Collapsed behind a button that doubles as the current value,
// so a setting most people never touch isn't sitting open in the card.
const HALF_LIFE_PRESETS = [
  { hours: 3.5, label: 'Fast', sub: 'gone by evening' },
  { hours: 5, label: 'Normal', sub: 'most people' },
  { hours: 7, label: 'Slow', sub: 'keeps me up' },
];
const HALF_LIFE_MIN = 1.5;
const HALF_LIFE_MAX = 9.5;

function HalfLifeControl({ current }: { current: number }) {
  const qc = useQueryClient();
  const { setAuth } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(current));

  const mutation = useMutation({
    mutationFn: (hours: number) => api.patch<User>('/auth/me', { caffeine_half_life_h: hours }),
    onSuccess: (updated) => {
      setAuth(updated, localStorage.getItem('token')!);
      // The curve, the level and "until flat" all move with the half-life.
      qc.invalidateQueries({ queryKey: ['energy'] });
    },
  });

  function save(hours: number) {
    const clamped = Math.min(HALF_LIFE_MAX, Math.max(HALF_LIFE_MIN, hours));
    setDraft(String(clamped));
    if (clamped !== current) mutation.mutate(clamped);
  }

  // Only commit a typed value once it is a usable number; a half-finished entry
  // ("3.") should leave the stored value alone.
  function commitDraft() {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) save(n);
    else setDraft(String(current));
  }

  return (
    <div className="buzz-hl">
      <button className="buzz-hl-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        Half-life · {current}h
        <Icon name={open ? 'chevron-up' : 'chevron-down'} />
      </button>

      {open && (
        <div className="buzz-hl-panel">
          <div className="buzz-hl-presets">
            {HALF_LIFE_PRESETS.map(p => (
              <button key={p.hours}
                className={`buzz-hl-preset${current === p.hours ? ' active' : ''}`}
                onClick={() => save(p.hours)}
                disabled={mutation.isPending}>
                <span className="buzz-hl-preset-label">{p.label} · {p.hours}h</span>
                <span className="buzz-hl-preset-sub">{p.sub}</span>
              </button>
            ))}
          </div>
          <label className="buzz-hl-exact">
            <span>Know yours?</span>
            <input type="number" step="0.5" min={HALF_LIFE_MIN} max={HALF_LIFE_MAX}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={mutation.isPending} />
            <span>h</span>
          </label>
          {mutation.isError && <div className="auth-error">{mutation.error.message}</div>}
        </div>
      )}
    </div>
  );
}

function Chart({ data }: { data: EnergyResponse }) {
  const { series, doses, now, window_hours } = data;
  const start = series[0].t;
  const span = Math.max(1, now - start);
  const x = (t: number) => ((t - start) / span) * VB_W;
  const y = (level: number) => VB_H - (level / 100) * VB_H;

  const line = series.map(p => `${x(p.t).toFixed(2)},${y(p.level).toFixed(2)}`).join(' ');
  const area = `${x(start).toFixed(2)},${VB_H} ${line} ${VB_W},${VB_H}`;

  const mid = start + span / 2;
  const fmt = window_hours > 24 ? dayTimeLabel : timeLabel;

  return (
    <div className="buzz-chart">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" role="img"
        aria-label={`Buzz level over the last ${window_hours} hours`}>
        <defs>
          <linearGradient id="buzz-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* 25 / 50 / 75% guides */}
        {[25, 50, 75].map(v => (
          <line key={v} x1="0" x2={VB_W} y1={y(v)} y2={y(v)}
            stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}

        {/* One tick per coffee, at the instant it was logged. */}
        {doses.map(d => (
          <line key={d.id} x1={x(d.logged_at)} x2={x(d.logged_at)} y1={VB_H} y2={VB_H - 10}
            stroke="var(--text-muted)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}

        <polygon points={area} fill="url(#buzz-fill)" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2"
          vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="buzz-axis">
        <span>{fmt(start)}</span>
        <span>{fmt(mid)}</span>
        <span>Now</span>
      </div>
    </div>
  );
}

export function BuzzWidget() {
  const [hours, setHours] = useState(24);
  const { data, isLoading, error } = useQuery<EnergyResponse>({
    queryKey: ['energy', hours],
    queryFn: () => api.get(`/energy?hours=${hours}`),
    refetchInterval: 60000,
  });

  return (
    <div className="card buzz-card">
      <div className="buzz-head">
        <div className="section-label">Buzz</div>
        <div className="buzz-range">
          {WINDOWS.map(w => (
            <button key={w.hours}
              className={`buzz-range-btn${hours === w.hours ? ' active' : ''}`}
              onClick={() => setHours(w.hours)}>{w.label}</button>
          ))}
        </div>
      </div>

      {isLoading && <div className="profile-placeholder-body">Loading…</div>}
      {error && <div className="auth-error">{error.message}</div>}

      {data && (
        <>
          <div className="buzz-readout">
            <div className="buzz-gauge">
              <div className={`buzz-gauge-fill buzz-${data.state}`} style={{ width: `${data.level}%` }} />
            </div>
            <div className="buzz-figure">
              <span className="buzz-level">{data.level}%</span>
              <span className={`buzz-state buzz-${data.state}`}>
                <Icon name={data.state === 'charging' ? 'bolt' : 'battery'} /> {stateLabel(data.state)}
              </span>
            </div>
          </div>

          <Chart data={data} />

          <div className="buzz-facts">
            <div className="buzz-fact">
              <span className="buzz-fact-val">{Math.round(data.active_mg)} mg</span>
              <span className="buzz-fact-key">active now</span>
            </div>
            <div className="buzz-fact">
              <span className="buzz-fact-val">{data.peak.level}%</span>
              <span className="buzz-fact-key">peak this window</span>
            </div>
            <div className="buzz-fact">
              <span className="buzz-fact-val">
                {data.empty_at ? untilLabel(data.now, data.empty_at) : '—'}
              </span>
              <span className="buzz-fact-key">until flat</span>
            </div>
          </div>

          <p className="buzz-note">
            100% = {data.full_mg} mg of caffeine active in your body, halving every{' '}
            {data.half_life_h} hours.
          </p>

          <HalfLifeControl current={data.half_life_h} />
        </>
      )}
    </div>
  );
}
