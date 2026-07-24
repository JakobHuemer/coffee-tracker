import type { JSX } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { useAuthStore } from './store/auth';
import { useThemeStore } from './store/theme';
import { BgCanvas } from './components/BgCanvas';
import { BottomNav } from './components/BottomNav';
import { Auth } from './pages/Auth';
import { Feed } from './pages/Feed';
import { LogCoffee } from './pages/LogCoffee';
import { Stats } from './pages/Stats';
import { Compare } from './pages/Compare';
import { Profile } from './pages/Profile';
import type { User } from './types';

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = useAuthStore(s => s.token);
  if (!token) return <Navigate to="/auth" replace />;
  return children;
}

export function App() {
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const setAuth = useAuthStore(s => s.setAuth);
  const levelIndex = useThemeStore(s => s.levelIndex);
  const isDark = useThemeStore(s => s.isDark);
  const toggleDark = useThemeStore(s => s.toggleDark);
  const location = useLocation();
  const navigate = useNavigate();

  useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/auth/me').then(u => { setAuth(u, token!); return u; }),
    enabled: !!token && !user,
    retry: false,
  });

  const isAuth = location.pathname === '/auth';
  // Feed (/) and Log (/log) manage their own top-right area.
  const hasOwnTopRight = location.pathname === '/' || location.pathname === '/log';

  return (
    <>
      <BgCanvas level={levelIndex} />
      {!isAuth && !hasOwnTopRight && (
        <div className="top-right-actions">
          <button
            className="dark-toggle-inline"
            onClick={toggleDark}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
          <button
            className="profile-icon-btn"
            onClick={() => navigate('/profile')}
            title="Profile"
            aria-label="Go to profile"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
            </svg>
          </button>
        </div>
      )}
      <div id="app-wrap">
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<RequireAuth><Feed /></RequireAuth>} />
          <Route path="/log" element={<RequireAuth><LogCoffee /></RequireAuth>} />
          <Route path="/stats" element={<RequireAuth><Stats /></RequireAuth>} />
          <Route path="/compare" element={<RequireAuth><Compare /></RequireAuth>} />
          <Route path="/compare/:username" element={<RequireAuth><Compare /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/goals" element={<Navigate to="/stats" replace />} />
          <Route path="/achievements" element={<Navigate to="/stats" replace />} />
          <Route path="/rankings" element={<Navigate to="/stats" replace />} />
          <Route path="/challenges" element={<Navigate to="/stats" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {token && !isAuth && <BottomNav />}
      </div>
    </>
  );
}

export default App;
