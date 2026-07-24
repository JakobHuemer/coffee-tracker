import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import type { User, Badge } from '../types';

interface PhotoEntry {
  id: string;
  coffee_id: string;
  logged_at: number;
  photo_url: string;
  description: string | null;
}

function GalleryCard() {
  const [lightbox, setLightbox] = useState<PhotoEntry | null>(null);
  const { data: photos = [], isLoading } = useQuery<PhotoEntry[]>({
    queryKey: ['my-photos'],
    queryFn: () => api.get('/coffees/photos'),
  });

  return (
    <>
      <div className="card">
        <div className="section-label">Gallery</div>
        {isLoading && <div className="gallery-loading">Loading…</div>}
        {!isLoading && photos.length === 0 && (
          <div className="profile-placeholder-body">No photos yet — snap one when logging your next coffee.</div>
        )}
        {photos.length > 0 && (
          <div className="gallery-grid">
            {photos.map(p => (
              <button key={p.id} className="gallery-thumb" onClick={() => setLightbox(p)} aria-label={p.coffee_id}>
                <img src={p.photo_url} alt={p.coffee_id} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="gallery-lightbox" onClick={() => setLightbox(null)}>
          <div className="gallery-lightbox-inner" onClick={e => e.stopPropagation()}>
            <img src={lightbox.photo_url} alt={lightbox.coffee_id} className="gallery-lightbox-img" />
            <div className="gallery-lightbox-meta">
              <span className="gallery-lightbox-coffee">{lightbox.coffee_id.replace(/_/g, ' ')}</span>
              <span className="gallery-lightbox-date">{new Date(lightbox.logged_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
            {lightbox.description && <p className="gallery-lightbox-desc">{lightbox.description}</p>}
            <button className="gallery-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close">✕</button>
          </div>
        </div>
      )}
    </>
  );
}

function ChangePasswordCard() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (password: string) => api.patch('/auth/me', { password }),
    onSuccess: () => {
      setSuccess(true);
      setNewPassword('');
      setConfirm('');
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (newPassword.length === 0) { setError('Password cannot be empty.'); return; }
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    mutation.mutate(newPassword);
  }

  return (
    <div className="card">
      <div className="section-label">Change Password</div>
      <form onSubmit={handleSubmit} className="create-form">
        <div className="field">
          <label>New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="New password"
          />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="Repeat new password"
          />
        </div>
        {error && <div className="auth-error">{error}</div>}
        {success && <div className="pw-success">Password updated successfully.</div>}
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}

function DeleteAccountSection({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.delete('/auth/me'),
    onSuccess: onDeleted,
    onError: (e: Error) => setError(e.message),
  });

  if (!confirming) {
    return (
      <button className="btn-danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
        Delete Account
      </button>
    );
  }

  return (
    <div className="delete-confirm">
      <p className="delete-confirm-msg">This will permanently delete your account and all your data. This cannot be undone.</p>
      {error && <div className="auth-error">{error}</div>}
      <div className="delete-confirm-actions">
        <button className="btn-danger" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Deleting…' : 'Yes, delete my account'}
        </button>
        <button className="btn-secondary" onClick={() => { setConfirming(false); setError(''); }}>Cancel</button>
      </div>
    </div>
  );
}

const AVATARS = ['☕', '🥛', '🧋', '🍫', '🍨', '⚡', '🔥', '💀', '🏆', '🎯', '👑', '🤖'];

const RARITY_COLORS: Record<string, string> = {
  common: '#9E9E9E', uncommon: '#4CAF50', rare: '#2196F3',
  epic: '#9C27B0', legendary: '#FF9800', secret: '#FF1744',
};

export function Profile() {
  const { user, setAuth, logout } = useAuthStore();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar || '☕');
  const [featuredBadges, setFeaturedBadges] = useState<string[]>(user?.featured_badges ?? []);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: badges = [] } = useQuery<Badge[]>({ queryKey: ['badges'], queryFn: () => api.get('/badges') });
  const unlockedBadges = badges.filter(b => b.unlocked);

  const updateMutation = useMutation({
    mutationFn: (body: { username?: string; avatar?: string; featured_badges?: string[] }) =>
      api.patch<User>('/auth/me', body),
    onSuccess: (updated) => {
      setAuth(updated, localStorage.getItem('token')!);
      setFeaturedBadges(updated.featured_badges ?? []);
      setEditMode(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const photoMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('photo', file);
      return api.patchForm<User>('/auth/me/photo', form);
    },
    onSuccess: (updated) => {
      setAuth(updated, localStorage.getItem('token')!);
      setPhotoError('');
    },
    onError: (e: Error) => setPhotoError(e.message),
  });

  const removePhotoMutation = useMutation({
    mutationFn: () => api.delete<User>('/auth/me/photo'),
    onSuccess: (updated) => {
      setAuth(updated, localStorage.getItem('token')!);
      setPhotoError('');
    },
    onError: (e: Error) => setPhotoError(e.message),
  });

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) photoMutation.mutate(file);
    e.target.value = '';
  }

  function handleSave() {
    setError('');
    const body: { username?: string; avatar?: string; featured_badges?: string[] } = {};
    if (newUsername !== user?.username) body.username = newUsername;
    if (selectedAvatar !== user?.avatar) body.avatar = selectedAvatar;
    const currentFeatured = user?.featured_badges ?? [];
    if (JSON.stringify(featuredBadges) !== JSON.stringify(currentFeatured)) body.featured_badges = featuredBadges;
    if (Object.keys(body).length === 0) { setEditMode(false); return; }
    updateMutation.mutate(body);
  }

  function toggleBadge(id: string) {
    setFeaturedBadges(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  }

  const displayedBadges = (user?.featured_badges ?? [])
    .map(id => badges.find(b => b.id === id))
    .filter(Boolean) as Badge[];

  return (
    <div className="page">
      <div className="page-header">
        <h2>Profile</h2>
        <p className="page-sub">Your account</p>
      </div>

      <main>
        <div className="card profile-card">
          <div className="profile-photo-area">
            <div className="profile-avatar-wrap">
              {user?.profile_photo_url
                ? <img src={user.profile_photo_url} alt="Profile" className="profile-avatar-img" />
                : <div className="profile-avatar">{user?.avatar}</div>}
              <button
                className="profile-avatar-upload-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Change photo"
                disabled={photoMutation.isPending}
              >📷</button>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoChange} />
            </div>
            {user?.profile_photo_url && (
              <button
                className="profile-remove-photo"
                onClick={() => removePhotoMutation.mutate()}
                disabled={removePhotoMutation.isPending}
              >{removePhotoMutation.isPending ? 'Removing…' : 'Remove photo'}</button>
            )}
            {photoError && <div className="auth-error" style={{ fontSize: '0.75rem', marginTop: 2 }}>{photoError}</div>}
          </div>

          {editMode ? (
            <div className="edit-section">
              <div className="avatar-picker">
                {AVATARS.map(a => (
                  <button key={a} className={`avatar-opt${selectedAvatar === a ? ' selected' : ''}`} onClick={() => setSelectedAvatar(a)}>
                    {a}
                  </button>
                ))}
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Username</label>
                <input value={newUsername} onChange={e => setNewUsername(e.target.value)} />
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label>Featured Badges <span className="field-hint">({featuredBadges.length}/3)</span></label>
                {unlockedBadges.length === 0 ? (
                  <div className="badge-picker-empty">Unlock badges to feature them here</div>
                ) : (
                  <div className="badge-picker">
                    {unlockedBadges.map(b => {
                      const selected = featuredBadges.includes(b.id);
                      const disabled = !selected && featuredBadges.length >= 3;
                      return (
                        <button
                          key={b.id}
                          className={`badge-pick-opt${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                          onClick={() => !disabled && toggleBadge(b.id)}
                          title={b.description}
                          style={{ borderColor: selected ? RARITY_COLORS[b.rarity] : undefined }}
                        >
                          <span className="bpo-icon">{b.icon}</span>
                          <span className="bpo-name">{b.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {error && <div className="auth-error">{error}</div>}
              <div className="edit-actions">
                <button className="btn-primary" onClick={handleSave} disabled={updateMutation.isPending}>Save</button>
                <button className="btn-secondary" onClick={() => setEditMode(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="profile-username">{user?.username}</div>
              <div className="profile-since">Member since {user ? new Date(user.created_at).toLocaleDateString() : '—'}</div>
              {displayedBadges.length > 0 && (
                <div className="profile-featured-badges">
                  {displayedBadges.map(b => (
                    <div key={b.id} className="pfb-item" title={b.description} style={{ borderColor: RARITY_COLORS[b.rarity] }}>
                      <span className="pfb-icon">{b.icon}</span>
                      <span className="pfb-name">{b.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setEditMode(true)}>
                Edit Profile
              </button>
            </>
          )}
        </div>

        <GalleryCard />

        <div className="card profile-section-placeholder">
          <div className="section-label">Liked Posts</div>
          <div className="profile-placeholder-body">Posts you've liked will appear here.</div>
        </div>

        <ChangePasswordCard />

        <div className="card account-actions-card">
          <button className="btn-secondary" onClick={() => { logout(); navigate('/auth'); }}>Sign Out</button>
          <DeleteAccountSection onDeleted={() => { logout(); navigate('/auth'); }} />
        </div>
      </main>
    </div>
  );
}
