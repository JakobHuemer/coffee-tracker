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

    // Suppress every transition for just the theme flip, then restore. Elements
    // that legitimately animate a color for interaction (e.g. the Stats filter
    // pills' selection state, which use `transition: all`) would otherwise also
    // animate on the theme change while plain elements snap — looking broken.
    // This is the standard `disableTransitionOnChange` trick: kill transitions,
    // apply the theme, force a synchronous reflow so the new colors paint
    // instantly, then remove the override so interactions animate again.
    const root = document.documentElement;
    const killer = document.createElement('style');
    killer.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.appendChild(killer);

    root.setAttribute('data-dark', String(next));
    set({ isDark: next });

    // Force reflow so the transition-less styles are committed, then re-enable.
    void root.offsetHeight;
    document.head.removeChild(killer);
  },

  // No-op: theme is a fixed light/dark pair, no longer driven by caffeine.
  applyTheme: () => {},
}));
