import type { JSX } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { useAuthStore } from './store/auth';
// Animated caffeine background disabled for now — kept in the tree for later.
// import { BgCanvas } from './components/BgCanvas';
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
  const location = useLocation();

  useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/auth/me').then(u => { setAuth(u, token!); return u; }),
    enabled: !!token && !user,
    retry: false,
  });

  const isAuth = location.pathname === '/auth';

  return (
    <>
      {/* Animated caffeine background disabled for now — see BgCanvas. */}
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
