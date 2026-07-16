import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Achievement, Badge } from '../types';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'secret'];
const RARITY_COLORS: Record<string, string> = {
  common: '#9E9E9E', uncommon: '#4CAF50', rare: '#2196F3',
  epic: '#9C27B0', legendary: '#FF9800', secret: '#FF1744',
};

function rarityLabel(r: string) {
  return { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', secret: '???' }[r] || r;
}

export function Achievements() {
  const { data: achievements = [] } = useQuery<Achievement[]>({
    queryKey: ['achievements'], queryFn: () => api.get('/achievements'),
  });
  const { data: badges = [] } = useQuery<Badge[]>({
    queryKey: ['badges'], queryFn: () => api.get('/badges'),
  });

  const unlockedAch = achievements.filter(a => a.unlocked).length;
  const unlockedBadge = badges.filter(b => b.unlocked).length;
  const categories = [...new Set(achievements.map(a => a.category))];

  return (
    <div className="page">
      <div className="page-header">
        <h2>Achievements & Badges</h2>
        <p className="page-sub">{unlockedAch}/{achievements.length} achievements · {unlockedBadge}/{badges.length} badges</p>
      </div>

      <main>
        <div className="card">
          <div className="section-label">Badges</div>
          <div className="badges-grid">
            {badges
              .slice()
              .sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) || RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity))
              .map(b => (
                <div key={b.id} className={`badge-card ${b.unlocked ? 'unlocked' : 'locked'}`} title={b.description}>
                  <div className="badge-icon">{b.icon}</div>
                  <div className="badge-name">{b.name}</div>
                  <div className="badge-rarity" style={{ color: RARITY_COLORS[b.rarity] || '#999' }}>
                    {rarityLabel(b.rarity)}
                  </div>
                  {b.unlocked && b.unlocked_at && (
                    <div className="badge-date">{new Date(b.unlocked_at).toLocaleDateString()}</div>
                  )}
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
                  <div key={a.id} className={`ach-item ${a.unlocked ? 'unlocked' : 'locked'}`}>
                    <div className="ach-icon">{a.icon}</div>
                    <div className="ach-body">
                      <div className="ach-name">{a.name}</div>
                      <div className="ach-desc">{a.description}</div>
                      {a.unlocked && a.unlocked_at && (
                        <div className="ach-date">Unlocked {new Date(a.unlocked_at).toLocaleDateString()}</div>
                      )}
                    </div>
                    {a.unlocked && <div className="ach-check">✅</div>}
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
