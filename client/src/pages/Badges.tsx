import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { rarityColor, rarityLabel, byUnlockedThenRarity } from '../rarity';
import type { Achievement, Badge } from '../types';

// Badges + achievements, lifted out of the old Stats "Badges" tab and reached
// from a Profile button now (issue #51).
export function Badges() {
  const { data: achievements = [] } = useQuery<Achievement[]>({
    queryKey: ['achievements'], queryFn: () => api.get('/achievements'),
  });
  const { data: badges = [] } = useQuery<Badge[]>({
    queryKey: ['badges'], queryFn: () => api.get('/badges'),
  });
  const categories = [...new Set(achievements.map(a => a.category))];

  return (
    <div className="page">
      <AppHeader />
      <div className="page-header">
        <h2>Badges</h2>
        <p className="page-sub">Everything you've unlocked</p>
      </div>

      <main className="stats-tab-body">
        <div className="card">
          <div className="section-label">Badges</div>
          <div className="badges-grid">
            {badges
              .slice()
              .sort(byUnlockedThenRarity)
              .map(b => (
                <div key={b.id} className={`badge-card${b.unlocked ? ' unlocked' : ' locked'}`} title={b.description}>
                  <div className="badge-icon"><Icon name={b.icon} size={28} /></div>
                  <div className="badge-name">{b.name}</div>
                  <div className="badge-rarity" style={{ color: rarityColor(b.rarity) }}>{rarityLabel(b.rarity)}</div>
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
                    <div className="ach-icon"><Icon name={a.icon} size={24} /></div>
                    <div className="ach-body">
                      <div className="ach-name">{a.name}</div>
                      <div className="ach-desc">{a.description}</div>
                      {a.unlocked && a.unlocked_at && <div className="ach-date">Unlocked {new Date(a.unlocked_at).toLocaleDateString()}</div>}
                    </div>
                    {a.unlocked && <div className="ach-check"><Icon name="check-circle" /></div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
