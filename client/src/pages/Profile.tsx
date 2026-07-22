import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import type { User, Stats, Badge } from '../types';

const AVATARS = ['☕', '🥛', '🧋', '🍫', '🍨', '🍵', '⚡', '🔥', '💀', '🏆', '🎯', '👑', '🤖', '👍', '😎', '🐸', '🦊', '🐼', '🚀', '🌟'];

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

  const { data: stats } = useQuery<Stats>({ queryKey: ['stats'], queryFn: () => api.get('/coffees/stats') });
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

  function handleSave() {
    setError('');
    const body: { username?: string; avatar?: string; featured_badges?: string[] } = {};
    if (newUsername !== user?.username) body.username = newUsername;
    if (selectedAvatar !== user?.avatar) body.avatar = selectedAvatar;
    const currentFeatured = user?.featured_badges ?? [];
    if (JSON.stringify(featuredBadges) !== JSON.stringify(currentFeatured)) {
      body.featured_badges = featuredBadges;
    }
    if (Object.keys(body).length === 0) { setEditMode(false); return; }
    updateMutation.mutate(body);
  }

  function toggleBadge(id: string) {
    setFeaturedBadges(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  }

  function handleLogout() {
    logout();
    navigate('/auth');
  }

  const displayedBadges = (user?.featured_badges ?? [])
    .map(id => badges.find(b => b.id === id))
    .filter(Boolean) as Badge[];

  return (
    <div className="page">
      <div className="page-header">
        <h2>Profile</h2>
      </div>

      <main>
        <div className="card profile-card">
          <div className="profile-avatar">{user?.avatar}</div>
          {editMode ? (
            <div className="edit-section">
              <div className="avatar-picker">
                {AVATARS.map(a => (
                  <button
                    key={a}
                    className={`avatar-opt ${selectedAvatar === a ? 'selected' : ''}`}
                    onClick={() => setSelectedAvatar(a)}
                  >
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
                          className={`badge-pick-opt ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
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
              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setEditMode(true)}>Edit Profile</button>
            </>
          )}
        </div>

        {stats && (
          <div className="card">
            <div className="section-label">My Stats</div>
            <div className="profile-stats">
              <div className="ps-item"><div className="ps-val">{stats.total_cups}</div><div className="ps-lbl">Total Cups</div></div>
              <div className="ps-item"><div className="ps-val">{stats.total_caffeine}mg</div><div className="ps-lbl">Total Caffeine</div></div>
              <div className="ps-item"><div className="ps-val">{stats.seven_day_avg}</div><div className="ps-lbl">7-day avg</div></div>
              <div className="ps-item"><div className="ps-val">{Object.keys(stats.by_type).length}</div><div className="ps-lbl">Types Tried</div></div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="section-label">Compare with others</div>
          <button className="btn-secondary" onClick={() => navigate('/compare')} style={{ width: '100%' }}>
            ⚖️ Find a user to compare
          </button>
        </div>

        <div className="card">
          <button className="btn-danger" onClick={handleLogout}>Sign Out</button>
        </div>
      </main>
    </div>
  );
}
