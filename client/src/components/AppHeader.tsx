import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/theme';

// Single app header shared by every main page so the top bar looks identical
// everywhere: brand on the left, theme + profile actions on the right.
export function AppHeader() {
  const navigate = useNavigate();
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
        <button
          className="header-btn"
          onClick={() => navigate('/profile')}
          title="Profile"
          aria-label="Go to profile"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </button>
      </div>
    </header>
  );
}
