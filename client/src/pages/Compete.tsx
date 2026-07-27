import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, uploadUrl } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { TimezonePicker } from '../components/TimezonePicker';
import { useAuthStore } from '../store/auth';
import type {
  CompeteScope, CompetitionsResponse, CompetitionHistoryResponse, GroupsResponse, GroupDetailResponse,
  LeaderboardEntry, LeaderboardResponse, Match, MatchMode, MatchParticipant, PersonalHistoryEntry, User,
} from '../types';

// Global vs Group is the top-level split (issue #53): it scopes WHICH matches,
// players and history the page is about. Rating itself is one global number and
// is deliberately identical in both scopes.
type Section = 'matches' | 'ranking' | 'history' | 'preferences';

const SECTIONS: Record<CompeteScope, { id: Section; label: string }[]> = {
  global: [
    { id: 'matches', label: 'Matches' },
    { id: 'ranking', label: 'Ranking' },
    { id: 'history', label: 'History' },
  ],
  // Auto-join and the group's own settings are the only preferences that exist,
  // and both are group-scoped — hence no Preferences section under Global.
  group: [
    { id: 'matches', label: 'Matches' },
    { id: 'ranking', label: 'Ranking' },
    { id: 'history', label: 'History' },
    { id: 'preferences', label: 'Preferences' },
  ],
};

const MODE_LABEL: Record<MatchMode, string> = {
  daily: 'Daily', weekly: 'Weekly', ondemand: 'Free-for-all', '1v1': '1v1', team: 'Team',
};

const MODE_ICON: Record<MatchMode, string> = {
  daily: 'calendar', weekly: 'calendar', ondemand: 'bolt', '1v1': 'scale', team: 'users',
};

// Modes a player can open themselves. daily and weekly are opened by the server
// for the whole group, on its own schedule.
const USER_MODES: MatchMode[] = ['1v1', 'ondemand', 'team'];

const HOUR = 3600000;

function fmtDateTime(ts: number) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Coarse "in 3h" / "2d ago". Duration arithmetic only — no timezone involved.
function fmtRelative(ts: number, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  let value: string;
  if (mins < 1) value = 'less than a minute';
  else if (mins < 60) value = `${mins}m`;
  else if (abs < 48 * HOUR) value = `${Math.round(abs / HOUR)}h`;
  else value = `${Math.round(abs / (24 * HOUR))}d`;
  return diff >= 0 ? `in ${value}` : `${value} ago`;
}

function fmtRating(rating: number) {
  return Math.round(rating);
}

function fmtDelta(delta: number | null) {
  if (delta === null || delta === undefined) return '—';
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function deltaClass(delta: number | null) {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.05) return 'cmp-delta';
  return delta > 0 ? 'cmp-delta up' : 'cmp-delta down';
}

// datetime-local speaks the device's wall clock, which is exactly what the user
// means when they type a start time. Convert at the edge; the API only ever
// sees epoch ms.
function toLocalInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Visibility switch for a group. Same control as everything else in the app.
function PublicToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleRow
      label="Listed publicly"
      sub="Anyone can find and join"
      value={value}
      onChange={onChange}
    />
  );
}

// Generic toggle row, matching the log form and the Profile debug card.
function ToggleRow({ label, sub, value, onChange, disabled }: {
  label: string; sub: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="log-share-row">
      <div>
        <div className="log-share-label">{label}</div>
        <div className="log-share-sub">{sub}</div>
      </div>
      <button
        className={`log-toggle${value ? ' on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
        aria-label={label}
        disabled={disabled}
      >
        <span className="log-toggle-knob" />
      </button>
    </div>
  );
}

// The only mechanism that puts a player on a recurring roster without them
// pressing join. Off by default, per user, and it only affects matches opened
// after it is switched on — an already-open lobby still has to be joined.
function AutoJoinCard() {
  const user = useAuthStore(s => s.user);
  const token = useAuthStore(s => s.token);
  const setAuth = useAuthStore(s => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { auto_join_daily?: boolean; auto_join_weekly?: boolean }) =>
      api.patch<User>('/auth/me', body),
    onSuccess: (updated) => { if (token) setAuth(updated, token); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="card cmp-form">
      <div className="section-label">Auto-join</div>
      <ToggleRow
        label="Daily matches"
        sub="Join every daily automatically"
        value={user?.auto_join_daily === 1}
        disabled={save.isPending}
        onChange={v => { setError(null); save.mutate({ auto_join_daily: v }); }}
      />
      <ToggleRow
        label="Weekly matches"
        sub="Join every weekly automatically"
        value={user?.auto_join_weekly === 1}
        disabled={save.isPending}
        onChange={v => { setError(null); save.mutate({ auto_join_weekly: v }); }}
      />
      <div className="field-hint">Applies to matches opened from now on.</div>
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}

// Copy `text`, reporting whether it actually worked.
//
// navigator.clipboard only exists in a SECURE CONTEXT. Served over plain http
// on a LAN address — which is how this app gets opened on a phone during
// development — it is undefined, so it cannot be the only path. The deprecated
// execCommand route still works there and is the fallback.
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* blocked or unavailable — try the fallback */ }
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    // Off-screen but still focusable: display:none or visibility:hidden would
    // make the selection (and so the copy) fail.
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length); // iOS ignores select() alone
    const ok = document.execCommand('copy');
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

function selectElementText(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// The invite code, with a copy button. State is never assumed: the tick only
// appears once a copy actually succeeded, and if both routes fail the code is
// selected instead so it can still be copied by hand.
function InviteCode({ code }: { code: string }) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    const ok = await copyText(code);
    if (!ok && valueRef.current) selectElementText(valueRef.current);
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2500);
  }

  return (
    <>
      <div className="cmp-code">
        <span className="cmp-code-label">Invite code</span>
        <span className="cmp-code-value" ref={valueRef}>{code}</span>
        <button
          className="cmp-copy-btn"
          onClick={copy}
          aria-label={state === 'copied' ? 'Copied' : 'Copy invite code'}
        >
          <Icon name={state === 'copied' ? 'check' : 'copy'} size={15} />
        </button>
      </div>
      {state === 'failed' && <div className="field-hint">Selected — long-press to copy.</div>}
    </>
  );
}

function Avatar({ p }: { p: { avatar: string; profile_photo_url: string | null; username: string } }) {
  const url = uploadUrl(p.profile_photo_url);
  return url
    ? <img className="cmp-avatar-img" src={url} alt="" />
    : <span className="cmp-avatar">{p.avatar}</span>;
}

/* ── standings ─────────────────────────────────────────────────────────────── */

function Standing({ p, settled, rank }: { p: MatchParticipant; settled: boolean; rank: number }) {
  return (
    <div className="cmp-standing">
      <span className="cmp-standing-rank">{rank}</span>
      <Avatar p={p} />
      <span className="cmp-standing-name">{p.username}</span>
      <span className="cmp-standing-points">{p.points} pts</span>
      {settled
        ? <span className={deltaClass(p.delta)}>{fmtDelta(p.delta)}</span>
        : <span className="cmp-standing-rating">{fmtRating(p.current_rating)}</span>}
    </div>
  );
}

function MatchStandings({ match }: { match: Match }) {
  const settled = match.state === 'settled';

  if (match.mode !== 'team') {
    return (
      <div className="cmp-standings">
        {match.participants.map((p, i) => (
          <Standing key={p.user_id} p={p} settled={settled} rank={i + 1} />
        ))}
        {/* A lobby nobody has joined would otherwise render an empty gap. */}
        {match.participants.length === 0 && (
          <div className="cmp-side-empty">No players yet — be the first.</div>
        )}
      </div>
    );
  }

  // Team matches are two rosters facing each other, so showing one flat ranking
  // would hide the thing that actually decided the match.
  const sides: Array<'A' | 'B'> = ['A', 'B'];
  return (
    <div className="cmp-sides">
      {sides.map(side => {
        const members = match.participants.filter(p => p.side === side);
        return (
          <div key={side} className="cmp-side">
            <div className="cmp-side-head">Side {side}</div>
            <div className="cmp-standings">
              {members.map((p, i) => (
                <Standing key={p.user_id} p={p} settled={settled} rank={i + 1} />
              ))}
              {members.length === 0 && <div className="cmp-side-empty">No players yet</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── one match card ────────────────────────────────────────────────────────── */

function MatchCard({ match, onJoin, onLeave, busy }: {
  match: Match;
  onJoin?: (side: 'A' | 'B' | null) => void;
  onLeave?: () => void;
  busy?: boolean;
}) {
  const userId = useAuthStore(s => s.user?.id);
  const inMatch = match.participants.some(p => p.user_id === userId);
  const isLobby = match.state === 'open';
  // The window has started and the match is neither settled nor cancelled — it
  // is running, whether it is locked ('pending') or still an open weekly lobby
  // on its first day (issue #44). Drives the "live" badge and the "Ends …" line
  // together, so a running match never shows an "open" badge or a "Starts …"
  // time while it sits in the Live now section.
  const isRunning = (match.state === 'pending' || match.state === 'open') && match.scope_start <= Date.now();
  const isDone = match.state === 'settled' || match.state === 'cancelled';
  const sideCount = (side: 'A' | 'B') => match.participants.filter(p => p.side === side).length;

  return (
    <div className="card cmp-match">
      <div className="cmp-match-head">
        <span className="cmp-mode">
          <Icon name={MODE_ICON[match.mode]} size={13} /> {MODE_LABEL[match.mode]}
        </span>
        {match.title && <span className="cmp-match-title">{match.title}</span>}
        <span className={`cmp-state ${isRunning ? 'pending' : match.state}`}>
          {isRunning ? 'live' : match.state}
        </span>
      </div>

      <div className="cmp-match-when">
        {isDone
          ? <>{fmtDateTime(match.scope_start)} — {fmtDateTime(match.scope_end)}</>
          : isRunning
            ? <>Ends {fmtRelative(match.scope_end)} · {fmtDateTime(match.scope_end)}</>
            : <>Starts {fmtRelative(match.scope_start)} · {fmtDateTime(match.scope_start)}</>}
      </div>

      {match.state === 'cancelled' ? (
        <div className="cmp-cancelled">Cancelled — too few players. No rating moved.</div>
      ) : (
        <MatchStandings match={match} />
      )}

      {isLobby && (
        <div className="cmp-lobby-actions">
          {inMatch ? (
            <button className="btn-secondary" disabled={busy} onClick={() => onLeave && onLeave()}>
              Leave match
            </button>
          ) : match.mode === 'team' ? (
            <>
              <button
                className="btn-secondary"
                disabled={busy || sideCount('A') >= (match.team_size ?? 0)}
                onClick={() => onJoin && onJoin('A')}
              >
                Join A ({sideCount('A')}/{match.team_size})
              </button>
              <button
                className="btn-secondary"
                disabled={busy || sideCount('B') >= (match.team_size ?? 0)}
                onClick={() => onJoin && onJoin('B')}
              >
                Join B ({sideCount('B')}/{match.team_size})
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              disabled={busy || (match.mode === '1v1' && match.participant_count >= 2)}
              onClick={() => onJoin && onJoin(null)}
            >
              {match.mode === '1v1' && match.participant_count >= 2 ? 'Match is full' : 'Join match'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── new match form ────────────────────────────────────────────────────────── */

function NewMatchForm({ onDone, global = false }: { onDone: () => void; global?: boolean }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<MatchMode>('1v1');
  const [title, setTitle] = useState('');
  const [teamSize, setTeamSize] = useState(2);
  const [side, setSide] = useState<'A' | 'B'>('A');
  // Default to a match that opens in an hour and runs for a day: long enough
  // for people to actually see the lobby and join it.
  const [start, setStart] = useState(() => toLocalInput(Date.now() + HOUR));
  const [end, setEnd] = useState(() => toLocalInput(Date.now() + 25 * HOUR));
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ match: Match }>('/competitions', {
      mode,
      title: title.trim() || null,
      scope_start: new Date(start).getTime(),
      scope_end: new Date(end).getTime(),
      ...(global ? { global: true } : {}),
      ...(mode === 'team' ? { team_size: teamSize, side } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="card cmp-form">
      <div className="section-label">New match</div>

      <div className="cmp-mode-picker">
        {USER_MODES.map(m => (
          <button
            key={m}
            className={`cmp-mode-opt${mode === m ? ' active' : ''}`}
            onClick={() => setMode(m)}
          >
            <Icon name={MODE_ICON[m]} size={14} /> {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="cmp-title">Title (optional)</label>
        <input
          id="cmp-title" className="search-input" value={title} maxLength={60}
          placeholder="Friday showdown" onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="cmp-start">Starts</label>
        <input id="cmp-start" className="search-input" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
        <div className="field-hint">Open to join until it starts.</div>
      </div>

      <div className="field">
        <label htmlFor="cmp-end">Ends</label>
        <input id="cmp-end" className="search-input" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
        <div className="field-hint">Max 90 days. Settles when it ends.</div>
      </div>

      {mode === 'team' && (
        <>
          <div className="field">
            <label htmlFor="cmp-size">Players per side</label>
            <input
              id="cmp-size" className="search-input" type="number" min={2} max={10} value={teamSize}
              onChange={e => setTeamSize(Number(e.target.value))}
            />
            <div className="field-hint">Min 2 per side.</div>
          </div>
          <div className="field">
            <label>Your side</label>
            <div className="cmp-mode-picker">
              {(['A', 'B'] as const).map(s => (
                <button key={s} className={`cmp-mode-opt${side === s ? ' active' : ''}`} onClick={() => setSide(s)}>
                  Side {s}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <div className="auth-error">{error}</div>}

      <div className="cmp-form-actions">
        <button className="btn-primary" disabled={create.isPending} onClick={() => { setError(null); create.mutate(); }}>
          {create.isPending ? 'Creating…' : 'Create match'}
        </button>
        <button className="btn-secondary" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/* ── tabs ──────────────────────────────────────────────────────────────────── */

function RatingCard({ rating, matches }: { rating: number; matches: number }) {
  return (
    <div className="cmp-rating-card card">
      <div className="cmp-rating-num">{fmtRating(rating)}</div>
      <div className="cmp-rating-label">
        Your rating · {matches} {matches === 1 ? 'match' : 'matches'} settled
      </div>
    </div>
  );
}

// The open/live/settled match columns, shared by the group tab and the global
// tab. `global` only changes the creation flag and the empty-state copy —
// join/leave and the rating cache are the same for both (issue #35).
//
// `finished` shows the settled column. The group tab turns it off because its
// finished matches live in the History tab instead (issue #34); the global tab
// has no history pill, so it keeps its own finished list inline.
function MatchList({ open, live, settled, global = false, finished = true }: {
  open: Match[]; live: Match[]; settled: Match[]; global?: boolean; finished?: boolean;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['competitions'] });

  const join = useMutation({
    mutationFn: ({ id, side }: { id: string; side: 'A' | 'B' | null }) =>
      api.post(`/competitions/${id}/join`, side ? { side } : {}),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const leave = useMutation({
    mutationFn: (id: string) => api.post(`/competitions/${id}/leave`),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const busy = join.isPending || leave.isPending;

  // A match whose window has already started is live — even while it is still an
  // open, joinable lobby (a weekly stays joinable through its first day, issue
  // #44). Only matches that have not started yet are "waiting to start".
  const now = Date.now();
  const openStarted = [...open].filter(m => m.scope_start <= now).sort((a, b) => a.scope_start - b.scope_start);
  const upcoming = [...open].filter(m => m.scope_start > now).sort((a, b) => a.scope_start - b.scope_start);
  const joinCard = (m: Match) => (
    <MatchCard
      key={m.id} match={m} busy={busy}
      onJoin={side => { setError(null); join.mutate({ id: m.id, side }); }}
      onLeave={() => { setError(null); leave.mutate(m.id); }}
    />
  );

  return (
    <>
      {error && <div className="auth-error">{error}</div>}

      {creating
        ? <NewMatchForm global={global} onDone={() => setCreating(false)} />
        : (
          <button className="btn-primary cmp-new-btn" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New match
          </button>
        )}

      <div className="section-label">Live now</div>
      {live.length === 0 && openStarted.length === 0
        ? <div className="cmp-empty">{global ? 'No global matches running.' : 'Nothing running yet.'}</div>
        /* Running matches: locked ones (pending) first, then any still-joinable
           lobby whose window has already started. */
        : <>{live.map(m => <MatchCard key={m.id} match={m} />)}{openStarted.map(joinCard)}</>}

      <div className="section-label">{global ? 'Open lobbies' : 'Waiting to start'}</div>
      {upcoming.length === 0
        ? <div className="cmp-empty">{global ? 'No open global matches — create one.' : 'Nothing waiting. Daily opens a day ahead, weekly two.'}</div>
        /* Soonest first. */
        : upcoming.map(joinCard)}

      {finished && (
        <>
          <div className="section-label">Finished</div>
          {settled.length === 0
            ? <div className="cmp-empty">Nothing settled yet.</div>
            : settled.map(m => <MatchCard key={m.id} match={m} />)}
        </>
      )}
    </>
  );
}

// Both scopes render the same rating card, because the rating IS the same
// number — only the pool of matches below it changes (issue #53). Finished
// matches live in the History section (issue #34), not here.
function MatchesSection({ scope, data }: { scope: CompeteScope; data: CompetitionsResponse }) {
  const global = scope === 'global';
  const buckets = global ? data.global : data;

  return (
    <>
      <RatingCard rating={data.my_rating} matches={data.my_matches} />
      {global && <div className="field-hint">Open to anyone — no group needed.</div>}
      <MatchList
        open={buckets.open} live={buckets.live} settled={buckets.settled}
        global={global} finished={false}
      />
    </>
  );
}

function LeaderboardRow({ r, me }: { r: LeaderboardEntry; me: boolean }) {
  return (
    <div className={`lb-row${me ? ' me' : ''}`}>
      <span className="lb-rank">{r.matches === 0 ? '—' : `#${r.rank}`}</span>
      <Avatar p={r} />
      <span className="lb-user">
        <span className="lb-username">{r.username}</span>
        <span className="lb-stats">
          {r.matches === 0 ? 'no matches yet' : `${r.matches} ${r.matches === 1 ? 'match' : 'matches'}`}
        </span>
      </span>
      <span className="lb-caf">{fmtRating(r.rating)}</span>
    </div>
  );
}

// One board, two windows onto it. The rank shown is the player's global rank in
// both scopes; Group only narrows the list down to the people in it.
function RankingSection({ scope }: { scope: CompeteScope }) {
  const userId = useAuthStore(s => s.user?.id);

  const { data, isLoading } = useQuery<LeaderboardResponse>({
    queryKey: ['competitions', 'leaderboard', scope],
    queryFn: () => api.get(`/competitions/leaderboard?scope=${scope}`),
  });

  if (isLoading) return <div className="page-loading">Loading…</div>;
  const rows = data?.leaderboard ?? [];
  // The global board ships a page, so a player below the cut would otherwise
  // not appear on their own leaderboard at all.
  const me = data?.me ?? null;
  const meListed = !!me && rows.some(r => r.id === me.id);

  return (
    <>
      {/* The one thing that is not self-evident: a group's ranks are the global
          ones, so they are not 1..n. */}
      {scope === 'group' && <div className="field-hint">Global rank, group members only.</div>}

      {rows.length === 0
        ? <div className="cmp-empty">{scope === 'global' ? 'No players yet.' : 'No members yet.'}</div>
        : (
          <div className="leaderboard">
            {rows.map(r => <LeaderboardRow key={r.id} r={r} me={r.id === userId} />)}
          </div>
        )}

      {me && !meListed && (
        <>
          <div className="section-label">Your standing</div>
          <div className="leaderboard"><LeaderboardRow r={me} me /></div>
        </>
      )}
    </>
  );
}

/* ── history (issue #34) ─────────────────────────────────────────────────────── */

const HISTORY_WINDOWS = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
];

// SVG user units, stretched to the card width — strokes use
// vector-effect="non-scaling-stroke" to stay even, same as the Buzz chart.
const GRAPH_VB_W = 300;
const GRAPH_VB_H = 100;

// A window's end labels: clock time inside a day, calendar date beyond it.
function fmtAxis(t: number, days: number) {
  const d = new Date(t);
  return days <= 1
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Rating over time for the selected window. The line runs from the rating the
// player carried INTO the window, through every settlement inside it, to the
// current rating at "now". The whole personal list is windowed here rather than
// on the server, so one payload feeds 24h/7d/30d.
function RatingGraph({ personal, currentRating }: {
  personal: PersonalHistoryEntry[]; currentRating: number;
}) {
  const [days, setDays] = useState(7);
  const now = Date.now();
  const start = now - days * 24 * HOUR;

  const asc = [...personal].sort((a, b) => a.settled_at - b.settled_at);
  const windowEntries = asc.filter(e => e.settled_at >= start);
  const prior = asc.filter(e => e.settled_at < start);

  // The rating entering the window: the last settlement before it, or — when the
  // window reaches back past the player's first ever match — the rating they took
  // into that first match (stored on the entry, so there is no 1000 literal to
  // drift from the server's BASE_RATING). With no matches at all it is just the
  // current rating, giving a flat line.
  const startRating = prior.length
    ? prior[prior.length - 1].rating_after
    : windowEntries.length
      ? windowEntries[0].rating_before
      : currentRating;

  const points = [
    { t: start, r: startRating },
    ...windowEntries.map(e => ({ t: e.settled_at, r: e.rating_after })),
    { t: now, r: currentRating },
  ];

  const ratings = points.map(p => p.r);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  // A flat line would divide by zero without a fixed pad; otherwise pad the range
  // so the curve never rides the top or bottom edge.
  const pad = max === min ? 10 : (max - min) * 0.15;
  const lo = min - pad;
  const hi = max + pad;

  const span = now - start;
  const x = (t: number) => ((t - start) / span) * GRAPH_VB_W;
  const y = (r: number) => GRAPH_VB_H - ((r - lo) / (hi - lo)) * GRAPH_VB_H;

  const line = points.map(p => `${x(p.t).toFixed(2)},${y(p.r).toFixed(2)}`).join(' ');
  const area = `${x(start).toFixed(2)},${GRAPH_VB_H} ${line} ${GRAPH_VB_W},${GRAPH_VB_H}`;

  const net = currentRating - startRating;
  const windowLabel = HISTORY_WINDOWS.find(w => w.days === days)!.label;

  return (
    <div className="card buzz-card">
      <div className="buzz-head">
        <div className="section-label">Rating</div>
        <div className="buzz-range">
          {HISTORY_WINDOWS.map(w => (
            <button key={w.days}
              className={`buzz-range-btn${days === w.days ? ' active' : ''}`}
              onClick={() => setDays(w.days)}>{w.label}</button>
          ))}
        </div>
      </div>

      <div className="cmp-hist-figure">
        <span className="cmp-hist-now">{fmtRating(currentRating)}</span>
        <span className={deltaClass(net)}>{fmtDelta(net)} · {windowLabel}</span>
      </div>

      <div className="buzz-chart">
        <div className="buzz-plot">
          <svg viewBox={`0 0 ${GRAPH_VB_W} ${GRAPH_VB_H}`} preserveAspectRatio="none" role="img"
            aria-label={`Rating over the last ${days === 1 ? '24 hours' : `${days} days`}`}>
            <defs>
              <linearGradient id="cmp-hist-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03" />
              </linearGradient>
            </defs>
            <polygon points={area} fill="url(#cmp-hist-fill)" />
            <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.5"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="buzz-axis">
          <span className="buzz-axis-label" style={{ left: 0 }}>{fmtAxis(start, days)}</span>
          <span className="buzz-axis-label" style={{ right: 0 }}>{fmtAxis(now, days)}</span>
        </div>
      </div>

      {windowEntries.length === 0 && <p className="buzz-note">No rated matches in this window.</p>}
    </div>
  );
}

// One settled match the caller played, as an elo-change row.
function HistoryRow({ e }: { e: PersonalHistoryEntry }) {
  return (
    <div className="cmp-hist-row">
      <span className="cmp-hist-mode"><Icon name={MODE_ICON[e.mode]} size={13} /></span>
      <div className="cmp-hist-main">
        <span className="cmp-hist-title">{e.title || MODE_LABEL[e.mode]}</span>
        <span className="cmp-hist-when">{fmtDateTime(e.settled_at)}</span>
      </div>
      <span className="cmp-hist-rating">{fmtRating(e.rating_after)}</span>
      <span className={deltaClass(e.delta)}>{fmtDelta(e.delta)}</span>
    </div>
  );
}

// Personal rating history (graph + elo-change list) and the scope's finished
// matches as end-match cards (issue #34).
//
// The graph is NOT scoped: it plots the one global rating, so it is the same
// curve under both tabs (issue #53). Only the lists below it are scoped — the
// elo changes to the matches of this scope, and the finished-match cards to the
// group's history or the caller's global matches.
function HistorySection({ scope, globalSettled }: { scope: CompeteScope; globalSettled: Match[] }) {
  const { data, isLoading } = useQuery<CompetitionHistoryResponse>({
    queryKey: ['competitions', 'history'],
    queryFn: () => api.get('/competitions/history'),
    refetchInterval: 60000,
  });

  if (isLoading || !data) return <div className="page-loading">Loading…</div>;

  const global = scope === 'global';
  // The two filters are complements, so every settled match the caller played
  // appears under exactly one tab. Matching on the CURRENT group id instead
  // would black-hole the matches they played in a group they have since left —
  // the rating those matches moved is still in the graph above.
  const changes = data.personal.filter(e => (e.group_id === null) === global);
  const finished = global ? globalSettled : data.group_history;

  return (
    <>
      <RatingGraph personal={data.personal} currentRating={data.my_rating} />

      <div className="section-label">Your elo changes</div>
      {changes.length === 0
        ? <div className="cmp-empty">{global ? 'No settled global matches yet.' : 'No settled group matches yet.'}</div>
        : <div className="cmp-hist-list">{changes.map(e => <HistoryRow key={e.match_id} e={e} />)}</div>}

      <div className="section-label">{global ? 'Your global matches' : 'Group history'}</div>
      {finished.length === 0
        ? <div className="cmp-empty">No finished matches yet.</div>
        : finished.map(m => <MatchCard key={m.id} match={m} />)}
    </>
  );
}

// The group itself: what it is, how to get into it, and the preferences that
// only mean anything inside one (auto-join, and the owner's group settings).
// The member list is not repeated here — Ranking is the member list now.
function PreferencesSection() {
  const qc = useQueryClient();
  const userId = useAuthStore(s => s.user?.id);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<GroupDetailResponse>({
    queryKey: ['groups', 'mine'],
    queryFn: () => api.get('/groups/mine'),
  });

  const leave = useMutation({
    mutationFn: () => api.post('/groups/leave'),
    onSuccess: () => {
      setConfirmLeave(false);
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['competitions'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading) return <div className="page-loading">Loading…</div>;
  const group = data?.group;
  if (!group) return <div className="cmp-empty">You are not in a group.</div>;

  const isOwner = group.owner_id === userId;
  // Ranking replaced the member list, and it has no notion of an owner — so the
  // group card is now the only place a non-owner can see whose group this is.
  const owner = (data?.members ?? []).find(m => m.id === group.owner_id);

  return (
    <>
      <div className="card cmp-group-card">
        <div className="cmp-group-name">{group.name}</div>
        {group.description && <div className="cmp-group-desc">{group.description}</div>}
        <div className="cmp-group-meta">
          <span><Icon name="users" size={12} /> {group.member_count} members</span>
          {owner && <span><Icon name="crown" size={12} /> {owner.username}</span>}
          <span><Icon name="clock" size={12} /> {group.timezone}</span>
          <span>{group.is_public ? 'Public' : <><Icon name="lock" size={12} /> Private</>}</span>
        </div>
        {group.join_code && (
          <InviteCode code={group.join_code} />
        )}
        <div className="field-hint">
          Days and weeks run on {group.timezone}. One group at a time — joining
          another leaves this one.
        </div>
      </div>

      <AutoJoinCard />

      {isOwner && <GroupSettings group={group} />}

      {error && <div className="auth-error">{error}</div>}

      <button className="btn-danger cmp-leave-btn" onClick={() => setConfirmLeave(true)}>
        Leave group
      </button>

      {confirmLeave && (
        <ConfirmDialog
          title={`Leave ${group.name}?`}
          message="Matches already running still settle. Your rating stays with you."
          confirmLabel="Leave group"
          error={error}
          onConfirm={() => { setError(null); leave.mutate(); }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </>
  );
}

function GroupSettings({ group }: { group: NonNullable<GroupDetailResponse['group']> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [timezone, setTimezone] = useState(group.timezone);
  const [isPublic, setIsPublic] = useState(group.is_public === 1);
  const [error, setError] = useState<string | null>(null);

  // The form stays mounted while closed, so its state outlives a cancel unless
  // it is put back deliberately. Called on cancel AND on open: the second one
  // also picks up a change made elsewhere (or by another member) while the form
  // sat closed, so what is shown is always what the server holds.
  function resetToServer() {
    setName(group.name);
    setDescription(group.description ?? '');
    setTimezone(group.timezone);
    setIsPublic(group.is_public === 1);
    setError(null);
  }

  const save = useMutation({
    mutationFn: () => api.patch<GroupDetailResponse>(`/groups/${group.id}`, {
      name, description: description.trim() || null, timezone, is_public: isPublic,
    }),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['groups'] });
      qc.invalidateQueries({ queryKey: ['competitions'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) {
    return (
      <button className="btn-secondary cmp-settings-btn" onClick={() => { resetToServer(); setOpen(true); }}>
        Group settings
      </button>
    );
  }

  return (
    <div className="card cmp-form">
      <div className="section-label">Group settings</div>

      <div className="field">
        <label htmlFor="cmp-gname">Name</label>
        <input id="cmp-gname" className="search-input" value={name} maxLength={31} onChange={e => setName(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="cmp-gdesc">Description</label>
        <input id="cmp-gdesc" className="search-input" value={description} maxLength={200} onChange={e => setDescription(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="cmp-gtz">Timezone</label>
        <TimezonePicker id="cmp-gtz" value={timezone} onChange={setTimezone} />
        <div className="field-hint">Applies from the next day and week.</div>
      </div>

      <PublicToggle value={isPublic} onChange={setIsPublic} />

      {error && <div className="auth-error">{error}</div>}

      <div className="cmp-form-actions">
        <button className="btn-primary" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={() => { resetToServer(); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}

/* ── no group yet ──────────────────────────────────────────────────────────── */

function GroupGate() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<GroupsResponse>({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups'),
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['groups'] });
    qc.invalidateQueries({ queryKey: ['competitions'] });
  };

  const create = useMutation({
    mutationFn: () => api.post<GroupDetailResponse>('/groups', {
      name, description: description.trim() || null, is_public: isPublic,
    }),
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });
  const join = useMutation({
    mutationFn: (body: { code?: string; group_id?: string }) =>
      api.post<GroupDetailResponse>('/groups/join', body),
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });

  const busy = create.isPending || join.isPending;

  return (
    <>
      <div className="empty-state">Competitions run inside a group. Join one to play.</div>

      {error && <div className="auth-error">{error}</div>}

      <div className="card cmp-form">
        <div className="section-label">Join with a code</div>
        <div className="field">
          <label htmlFor="cmp-code">Invite code</label>
          <input
            id="cmp-code" className="search-input" value={code} maxLength={6}
            placeholder="ABC123" onChange={e => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <button className="btn-primary" disabled={busy || !code.trim()} onClick={() => { setError(null); join.mutate({ code }); }}>
          Join group
        </button>
      </div>

      <div className="card cmp-form">
        <div className="section-label">Create a group</div>
        <div className="field">
          <label htmlFor="cmp-newname">Name</label>
          <input
            id="cmp-newname" className="search-input" value={name} maxLength={31}
            placeholder="Bean Team" onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="cmp-newdesc">Description (optional)</label>
          <input
            id="cmp-newdesc" className="search-input" value={description} maxLength={200}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
        <PublicToggle value={isPublic} onChange={setIsPublic} />
        <div className="field-hint">Uses your timezone. Changeable later.</div>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => { setError(null); create.mutate(); }}>
          Create group
        </button>
      </div>

      <div className="section-label">Public groups</div>
      {(data?.groups ?? []).length === 0
        ? <div className="cmp-empty">No public groups yet — make the first one.</div>
        : (data?.groups ?? []).map(g => (
          <div key={g.id} className="card cmp-group-row">
            <div>
              <div className="cmp-group-name">{g.name}</div>
              {g.description && <div className="cmp-group-desc">{g.description}</div>}
              <div className="cmp-group-meta">
                <span><Icon name="users" size={12} /> {g.member_count}</span>
                <span><Icon name="clock" size={12} /> {g.timezone}</span>
              </div>
            </div>
            <button className="btn-secondary" disabled={busy} onClick={() => { setError(null); join.mutate({ group_id: g.id }); }}>
              Join
            </button>
          </div>
        ))}
    </>
  );
}

/* ── page ──────────────────────────────────────────────────────────────────── */

const SCOPES: { id: CompeteScope; label: string; icon: string }[] = [
  { id: 'global', label: 'Global', icon: 'globe' },
  { id: 'group', label: 'Group', icon: 'users' },
];

export function Compete() {
  // Null until the user picks: the default depends on whether they are in a
  // group, which is only known once the page has loaded. Storing the choice
  // rather than deriving it keeps a deliberate pick from being overwritten.
  const [scope, setScope] = useState<CompeteScope | null>(null);
  const [section, setSection] = useState<Section>('matches');

  const { data, isLoading } = useQuery<CompetitionsResponse>({
    queryKey: ['competitions'],
    queryFn: () => api.get('/competitions'),
    // Matches are opened and settled by the server on a wall-clock schedule, so
    // an open page has to re-read rather than wait for an interaction.
    refetchInterval: 60000,
  });

  const hasGroup = !!data?.group;
  // Someone in a group is here for their group; someone without one has nothing
  // to show under Group but the invitation to join one, so Global leads.
  const activeScope = scope ?? (hasGroup ? 'group' : 'global');

  const sections = SECTIONS[activeScope];
  // `section` is user state and survives a scope switch, so it can name a
  // section the new scope does not have.
  const activeSection = sections.some(s => s.id === section) ? section : sections[0].id;

  // Keep the section when the new scope also has it, so switching scope
  // compares like with like. Otherwise normalise the state to what is actually
  // being rendered, so the two can never disagree.
  function pickScope(next: CompeteScope) {
    setScope(next);
    if (!SECTIONS[next].some(s => s.id === section)) setSection(SECTIONS[next][0].id);
  }

  return (
    <div className="page">
      <AppHeader />

      <div className="page-header">
        <h2>Compete</h2>
        <p className="page-sub">
          {activeScope === 'group' && data?.group ? data.group.name : 'Rated matches'}
        </p>
      </div>

      {isLoading || !data ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <>
          <div className="stats-tabs">
            {SCOPES.map(s => (
              <button
                key={s.id}
                className={`stats-tab-btn${activeScope === s.id ? ' active' : ''}`}
                onClick={() => pickScope(s.id)}
              >
                <span><Icon name={s.icon} /></span> {s.label}
              </button>
            ))}
          </div>

          <div className="stats-tab-body cmp-body">
            {/* Every group-scoped section needs a group. Without one the whole
                tab is the invitation to get into one. */}
            {activeScope === 'group' && !hasGroup ? <GroupGate /> : (
              <>
                <div className="tab-row">
                  {sections.map(s => (
                    <button
                      key={s.id}
                      className={`tab-btn${activeSection === s.id ? ' active' : ''}`}
                      onClick={() => setSection(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {activeSection === 'matches' && <MatchesSection scope={activeScope} data={data} />}
                {activeSection === 'ranking' && <RankingSection scope={activeScope} />}
                {activeSection === 'history' && (
                  <HistorySection scope={activeScope} globalSettled={data.global.settled} />
                )}
                {activeSection === 'preferences' && <PreferencesSection />}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
