// Badge rarity presentation, in one place. These were previously copy-pasted
// into four pages; identical copies are exactly how a menu count ends up saying
// 13 when the menu holds 15 (issue #30), so the tiers live here instead.
//
// The tier names themselves are the server's — see the `rarity` field in
// server/src/data/badges.js. This module only decides how they look and sort.

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'secret'];

// Both tables stay private: callers go through the accessors below so an
// unknown tier gets the fallback everywhere instead of only where someone
// remembered to write `|| '#999'`.
const RARITY_COLORS: Record<string, string> = {
  common: '#9E9E9E', uncommon: '#4CAF50', rare: '#2196F3',
  epic: '#9C27B0', legendary: '#FF9800', secret: '#FF1744',
};

const RARITY_LABELS: Record<string, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare',
  epic: 'Epic', legendary: 'Legendary', secret: '???',
};

// Unknown tiers fall through to the raw value rather than rendering blank, so a
// rarity added server-side is still legible before the client catches up.
export function rarityLabel(r: string) {
  return RARITY_LABELS[r] || r;
}

export function rarityColor(r: string) {
  return RARITY_COLORS[r] || '#999';
}

// Unlocked first. Within the unlocked group, rarest first (show off the best).
// Within the locked group, ascending rarity — common → legendary — so the list
// reads as the ladder still to climb. Shared so every badge grid agrees.
export function byUnlockedThenRarity(
  a: { unlocked: boolean; rarity: string },
  b: { unlocked: boolean; rarity: string },
) {
  const byUnlocked = (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0);
  if (byUnlocked) return byUnlocked;
  const ra = RARITY_ORDER.indexOf(a.rarity), rb = RARITY_ORDER.indexOf(b.rarity);
  return a.unlocked ? rb - ra : ra - rb;
}
