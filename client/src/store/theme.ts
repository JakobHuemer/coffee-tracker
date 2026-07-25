import { create } from 'zustand';

// NOTE: The caffeine-reactive theme palettes (Serene → Gone) and their dark
// overrides were removed for now. The app ships a single light/dark pair
// defined in index.css (:root = light, [data-dark="true"] = dark). The old
// palette tables live in git history if reactive theming is ever restored.

// Apply the saved dark preference immediately on module load to avoid a flash.
const _savedDark = localStorage.getItem('dark') === 'true';
if (_savedDark) document.documentElement.setAttribute('data-dark', 'true');

interface ThemeState {
  isDark: boolean;
  // Kept as inert stubs so any remaining caller of the old caffeine-theme API
  // still compiles without pulling reactive theming back in.
  levelIndex: number;
  label: string;
  toggleDark: () => void;
  applyTheme: (todayCaffeine?: number) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: _savedDark,
  levelIndex: 0,
  label: '',

  toggleDark: () => {
    const next = !get().isDark;
    localStorage.setItem('dark', String(next));
    document.documentElement.setAttribute('data-dark', String(next));
    set({ isDark: next });
  },

  // No-op: theme is a fixed light/dark pair, no longer driven by caffeine.
  applyTheme: () => {},
}));
