import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { AppHeader } from '../components/AppHeader';
import { Icon, ICON_KEYS } from '../components/Icon';
import { SuggestInput } from '../components/SuggestInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { AdminCoffee } from '../types';

// The known drink classes. Free text is allowed (the field is a SuggestInput),
// but an unknown class has no label in LogCoffee's CLASS_LABEL and would group
// under its raw key — so these are offered as the safe choices. Kept in sync
// with LogCoffee CLASS_LABEL and the seed in migration 020.
const CLASS_SUGGESTIONS = ['coffee', 'milk', 'chocolate', 'tea', 'energy'];

const BLANK = { id: '', name: '', caffeine: '', icon: 'coffee', class: 'coffee', score_caffeine: '' };
type FormState = typeof BLANK;

function toForm(c: AdminCoffee): FormState {
  return {
    id: c.id,
    name: c.name,
    caffeine: String(c.caffeine),
    icon: c.icon,
    class: c.class,
    score_caffeine: c.score_caffeine == null ? '' : String(c.score_caffeine),
  };
}

// Add or edit a single coffee. `editing` holds the row being edited, or null for
// a new one — the id is only editable when creating (it's the primary key and is
// embedded in logged entries, so the server rejects a rename).
function CoffeeForm({ editing, onDone }: { editing: AdminCoffee | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(editing ? toForm(editing) : BLANK);
  const [error, setError] = useState('');

  useEffect(() => { setForm(editing ? toForm(editing) : BLANK); setError(''); }, [editing]);

  const set = (k: keyof FormState) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        caffeine: Number(form.caffeine),
        icon: form.icon.trim(),
        class: form.class.trim(),
        // Empty → null clears the competition override server-side.
        score_caffeine: form.score_caffeine === '' ? null : Number(form.score_caffeine),
      };
      return editing
        ? api.patch(`/admin/coffees/${editing.id}`, body)
        : api.post('/admin/coffees', { id: form.id.trim(), ...body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-coffees'] }); qc.invalidateQueries({ queryKey: ['coffees'] }); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing && !/^[a-z0-9_]+$/.test(form.id.trim())) {
      setError('id must be lowercase letters, numbers and underscores');
      return;
    }
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!Number.isInteger(Number(form.caffeine)) || Number(form.caffeine) < 0) {
      setError('Caffeine must be a non-negative whole number');
      return;
    }
    save.mutate();
  }

  return (
    <form className="card admin-coffee-form" onSubmit={submit}>
      <div className="section-label">{editing ? `Edit ${editing.name}` : 'Add a coffee'}</div>

      {!editing && (
        <label className="admin-field">
          <span>ID</span>
          <input className="search-input" value={form.id} onChange={e => set('id')(e.target.value)}
            placeholder="flat_white" autoComplete="off" spellCheck={false} />
        </label>
      )}

      <label className="admin-field">
        <span>Name</span>
        <input className="search-input" value={form.name} onChange={e => set('name')(e.target.value)}
          placeholder="Flat White" autoComplete="off" />
      </label>

      <label className="admin-field">
        <span>Caffeine (mg)</span>
        <input className="search-input" type="number" min="0" step="1" inputMode="numeric"
          value={form.caffeine} onChange={e => set('caffeine')(e.target.value)} placeholder="95" />
      </label>

      <label className="admin-field">
        <span>Icon</span>
        <div className="admin-field-with-preview">
          <SuggestInput value={form.icon} onChange={set('icon')} options={ICON_KEYS} placeholder="coffee" />
          <Icon name={form.icon} size={20} />
        </div>
      </label>

      <label className="admin-field">
        <span>Class</span>
        <SuggestInput value={form.class} onChange={set('class')} options={CLASS_SUGGESTIONS} placeholder="coffee" />
      </label>

      <label className="admin-field">
        <span>Score override (mg)</span>
        <input className="search-input" type="number" min="0" step="1" inputMode="numeric"
          value={form.score_caffeine} onChange={e => set('score_caffeine')(e.target.value)}
          placeholder="Default: same as caffeine" />
      </label>
      <p className="admin-field-hint">Competition-only. Blank scores at the displayed caffeine.</p>

      {error && <div className="auth-error" style={{ marginTop: 8 }}>{error}</div>}
      <div className="confirm-actions" style={{ marginTop: 12 }}>
        <button type="submit" className="btn-primary" style={{ width: 'auto' }} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : editing ? 'Save' : 'Add'}
        </button>
        {editing && <button type="button" className="btn-secondary" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

export function AdminCoffees() {
  const navigate = useNavigate();
  // `user` is null for a moment on a hard load / refresh while App fetches
  // /auth/me. Only bounce once we KNOW the loaded user isn't an admin — bouncing
  // on the null gap would kick an admin off their own deep link. The API still
  // enforces admin on every write regardless.
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.is_admin === 1;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminCoffee | null>(null);
  const [deleting, setDeleting] = useState<AdminCoffee | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (user && !isAdmin) navigate('/profile', { replace: true });
  }, [user, isAdmin, navigate]);

  const { data: coffees = [], isLoading, error } = useQuery<AdminCoffee[]>({
    queryKey: ['admin-coffees'],
    queryFn: () => api.get<AdminCoffee[]>('/admin/coffees'),
    enabled: isAdmin,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/coffees/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-coffees'] });
      qc.invalidateQueries({ queryKey: ['coffees'] });
      setDeleting(null); setDeleteError('');
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  // While the user is still loading, or a non-admin is mid-bounce, render the
  // shell so there's no flash of the full page.
  if (!isAdmin) {
    return (
      <div className="page">
        <AppHeader />
        {!user && <div className="page-loading">Loading…</div>}
      </div>
    );
  }

  return (
    <div className="page">
      <AppHeader />
      <div className="page-header">
        <h2>Coffee Catalog</h2>
        <p className="page-sub">Add, edit or retire drinks. Changes apply to future logs.</p>
      </div>

      <main className="stats-tab-body">
        <CoffeeForm editing={editing} onDone={() => setEditing(null)} />

        {isLoading && <div className="page-loading">Loading…</div>}
        {error && <div className="card error-card">{(error as Error).message}</div>}

        <div className="card">
          <div className="section-label">Menu ({coffees.length})</div>
          <div className="admin-coffee-list">
            {coffees.map(c => (
              <div key={c.id} className={`admin-coffee-row${editing?.id === c.id ? ' editing' : ''}`}>
                <Icon name={c.icon} size={20} className="admin-coffee-icon" />
                <div className="admin-coffee-meta">
                  <span className="admin-coffee-name">{c.name}</span>
                  <span className="admin-coffee-sub">
                    {c.id} · {c.class} · {c.caffeine}mg
                    {c.score_caffeine != null && ` · scores ${c.score_caffeine}mg`}
                  </span>
                </div>
                <button className="btn-secondary admin-coffee-btn" onClick={() => setEditing(c)}>Edit</button>
                <button className="icon-btn admin-coffee-del" aria-label={`Delete ${c.name}`}
                  onClick={() => { setDeleteError(''); setDeleting(c); }}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
            {!isLoading && coffees.length === 0 && <div className="empty-state">No coffees yet.</div>}
          </div>
        </div>
      </main>

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Removed from the menu. Logged entries keep their recorded caffeine."
          confirmLabel="Delete"
          busy={del.isPending}
          error={deleteError || undefined}
          onConfirm={() => del.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
