import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, uploadUrl } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { useAuthStore } from '../store/auth';
import type {
  CompetitionsResponse, GroupsResponse, GroupDetailResponse, LeaderboardResponse,
  Match, MatchMode, MatchParticipant,
} from '../types';

type Tab = 'matches' | 'ranking' | 'group';

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

// Visibility switch for a group. Uses the app's existing toggle (the one on the
// log form and the Profile debug card) rather than a bare checkbox, so a
// boolean looks the same everywhere in the app.
function PublicToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="log-share-row">
      <div>
        <div className="log-share-label">Listed publicly</div>
        <div className="log-share-sub">Anyone can find this group and join it</div>
      </div>
      <button
        className={`log-toggle${value ? ' on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
        aria-label="Listed publicly"
      >
        <span className="log-toggle-knob" />
      </button>
    </div>
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
  const sideCount = (side: 'A' | 'B') => match.participants.filter(p => p.side === side).length;

  return (
    <div className="card cmp-match">
      <div className="cmp-match-head">
        <span className="cmp-mode">
          <Icon name={MODE_ICON[match.mode]} size={13} /> {MODE_LABEL[match.mode]}
        </span>
        {match.title && <span className="cmp-match-title">{match.title}</span>}
        <span className={`cmp-state ${match.state}`}>
          {match.state === 'pending' ? 'live' : match.state}
        </span>
      </div>

      <div className="cmp-match-when">
        {isLobby
          ? <>Starts {fmtRelative(match.scope_start)} · {fmtDateTime(match.scope_start)}</>
          : match.state === 'pending'
            ? <>Ends {fmtRelative(match.scope_end)} · {fmtDateTime(match.scope_end)}</>
            : <>{fmtDateTime(match.scope_start)} — {fmtDateTime(match.scope_end)}</>}
      </div>

      {match.state === 'cancelled' ? (
        <div className="cmp-cancelled">
          Cancelled — the roster was never complete, so no rating changed hands.
        </div>
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

function NewMatchForm({ onDone }: { onDone: () => void }) {
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
        <div className="field-hint">Players can join until the match starts.</div>
      </div>

      <div className="field">
        <label htmlFor="cmp-end">Ends</label>
        <input id="cmp-end" className="search-input" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
        <div className="field-hint">At most 90 days. Rating settles the moment it ends.</div>
      </div>

      {mode === 'team' && (
        <>
          <div className="field">
            <label htmlFor="cmp-size">Players per side</label>
            <input
              id="cmp-size" className="search-input" type="number" min={2} max={10} value={teamSize}
              onChange={e => setTeamSize(Number(e.target.value))}
            />
            <div className="field-hint">
              At least 2 — a side of one is a 1v1, not a team.
            </div>
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

function MatchesTab({ data }: { data: CompetitionsResponse }) {
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

  return (
    <>
      <div className="cmp-rating-card card">
        <div className="cmp-rating-num">{fmtRating(data.my_rating)}</div>
        <div className="cmp-rating-label">
          Your rating · {data.my_matches} {data.my_matches === 1 ? 'match' : 'matches'} settled
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {creating
        ? <NewMatchForm onDone={() => setCreating(false)} />
        : (
          <button className="btn-primary cmp-new-btn" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New match
          </button>
        )}

      <div className="section-label">Live now</div>
      {data.live.length === 0
        ? <div className="cmp-empty">No match running. The daily and weekly ones open automatically once your group has two members.</div>
        : data.live.map(m => <MatchCard key={m.id} match={m} />)}

      <div className="section-label">Waiting to start</div>
      {data.open.length === 0
        ? <div className="cmp-empty">No open lobbies. Start one with “New match” above.</div>
        : data.open.map(m => (
          <MatchCard
            key={m.id} match={m} busy={busy}
            onJoin={side => { setError(null); join.mutate({ id: m.id, side }); }}
            onLeave={() => { setError(null); leave.mutate(m.id); }}
          />
        ))}

      <div className="section-label">Finished</div>
      {data.settled.length === 0
        ? <div className="cmp-empty">Nothing settled yet.</div>
        : data.settled.map(m => <MatchCard key={m.id} match={m} />)}
    </>
  );
}

function RankingTab() {
  const { data, isLoading } = useQuery<LeaderboardResponse>({
    queryKey: ['competitions', 'leaderboard'],
    queryFn: () => api.get('/competitions/leaderboard'),
  });

  if (isLoading) return <div className="page-loading">Loading…</div>;
  const rows = data?.leaderboard ?? [];

  return (
    <div className="leaderboard">
      {rows.map(r => (
        <div key={r.id} className="lb-row">
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
      ))}
      {rows.length === 0 && <div className="cmp-empty">No members yet.</div>}
    </div>
  );
}

function GroupTab() {
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

  return (
    <>
      <div className="card cmp-group-card">
        <div className="cmp-group-name">{group.name}</div>
        {group.description && <div className="cmp-group-desc">{group.description}</div>}
        <div className="cmp-group-meta">
          <span><Icon name="users" size={12} /> {group.member_count} members</span>
          <span><Icon name="clock" size={12} /> {group.timezone}</span>
          <span>{group.is_public ? 'Public' : <><Icon name="lock" size={12} /> Private</>}</span>
        </div>
        {group.join_code && (
          <div className="cmp-code">
            <span className="cmp-code-label">Invite code</span>
            <span className="cmp-code-value">{group.join_code}</span>
          </div>
        )}
        <div className="field-hint">
          Every day and week boundary in this group is measured in {group.timezone}, so
          everyone competes over the exact same window.
        </div>
        <div className="field-hint">
          You can only be in one group at a time — joining another one leaves this one.
        </div>
      </div>

      {isOwner && <GroupSettings group={group} />}

      <div className="section-label">Members</div>
      <div className="leaderboard">
        {(data?.members ?? []).map(m => (
          <div key={m.id} className="lb-row">
            <Avatar p={m} />
            <span className="lb-user">
              <span className="lb-username">
                {m.username}{m.id === group.owner_id && <span className="cmp-owner-tag">owner</span>}
              </span>
              <span className="lb-stats">{m.matches} settled</span>
            </span>
            <span className="lb-caf">{fmtRating(m.rating)}</span>
          </div>
        ))}
      </div>

      {error && <div className="auth-error">{error}</div>}

      <button className="btn-danger cmp-leave-btn" onClick={() => setConfirmLeave(true)}>
        Leave group
      </button>

      {confirmLeave && (
        <ConfirmDialog
          title={`Leave ${group.name}?`}
          message={
            <>
              You will stop being added to new daily and weekly matches. Matches that are
              already running keep you on their roster and still settle normally — your
              rating is yours and follows you out either way.
            </>
          }
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
      <button className="btn-secondary cmp-settings-btn" onClick={() => setOpen(true)}>
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
        <input id="cmp-gtz" className="search-input" value={timezone} onChange={e => setTimezone(e.target.value)} />
        <div className="field-hint">
          An IANA name like Europe/Vienna. Matches already running keep the window they
          started with; a new zone applies from the next day and week.
        </div>
      </div>

      <PublicToggle value={isPublic} onChange={setIsPublic} />

      {error && <div className="auth-error">{error}</div>}

      <div className="cmp-form-actions">
        <button className="btn-primary" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
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
      <div className="empty-state">
        Competitions run inside a group. Join one and you are in its daily and weekly
        matches from the next window — nobody is ever entered automatically.
      </div>

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
        <div className="field-hint">
          The group uses your timezone for its day and week boundaries. You can change it later.
        </div>
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

export function Compete() {
  const [tab, setTab] = useState<Tab>('matches');

  const { data, isLoading } = useQuery<CompetitionsResponse>({
    queryKey: ['competitions'],
    queryFn: () => api.get('/competitions'),
    // Matches are opened and settled by the server on a wall-clock schedule, so
    // an open page has to re-read rather than wait for an interaction.
    refetchInterval: 60000,
  });

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'matches', label: 'Matches', icon: 'trophy' },
    { id: 'ranking', label: 'Ranking', icon: 'medal' },
    { id: 'group', label: 'Group', icon: 'users' },
  ];

  return (
    <div className="page">
      <AppHeader />

      <div className="page-header">
        <h2>Compete</h2>
        <p className="page-sub">
          {data?.group ? data.group.name : 'Group matches, rated'}
        </p>
      </div>

      {isLoading ? (
        <div className="page-loading">Loading…</div>
      ) : !data?.group ? (
        <div className="stats-tab-body cmp-body"><GroupGate /></div>
      ) : (
        <>
          <div className="stats-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`stats-tab-btn${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span><Icon name={t.icon} /></span> {t.label}
              </button>
            ))}
          </div>

          <div className="stats-tab-body cmp-body">
            {tab === 'matches' && <MatchesTab data={data} />}
            {tab === 'ranking' && <RankingTab />}
            {tab === 'group' && <GroupTab />}
          </div>
        </>
      )}
    </div>
  );
}
