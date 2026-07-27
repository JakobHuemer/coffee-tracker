import { useThemeStore } from '../store/theme';
import { AppLogo } from './AppLogo';
import { Icon } from './Icon';

// Single app header shared by every main page so the top bar looks identical
// everywhere: brand on the left, theme toggle on the right. Profile lives in the
// bottom nav.
export function AppHeader() {
  const { isDark, toggleDark } = useThemeStore();

  return (
    <header className="app-header">
      <div className="header-brand">
        <AppLogo className="logo" alt="Coffee Tracker" />
        <div>
          <h1>Coffee Tracker</h1>
          <div className="date">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
      </div>
      <div className="header-actions">
        <a
          className="header-btn"
          href="https://github.com/JakobHuemer/coffee-tracker"
          target="_blank"
          rel="noopener noreferrer"
          title="View on GitHub"
          aria-label="View project on GitHub"
        >
          <Icon name="github" />
        </a>
        <button
          className="header-btn"
          onClick={toggleDark}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          {isDark ? <Icon name="sun" /> : <Icon name="moon" />}
        </button>
      </div>
    </header>
  );
}
