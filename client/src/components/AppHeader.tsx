import { useThemeStore } from '../store/theme';

// Single app header shared by every main page so the top bar looks identical
// everywhere: brand on the left, theme toggle on the right. Profile lives in the
// bottom nav.
export function AppHeader() {
  const { isDark, toggleDark } = useThemeStore();

  return (
    <header className="app-header">
      <div className="header-brand">
        <img className="logo" src="/favicon.svg" alt="Coffee Tracker" />
        <div>
          <h1>Coffee Tracker</h1>
          <div className="date">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="header-btn"
          onClick={toggleDark}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          {isDark ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  );
}
