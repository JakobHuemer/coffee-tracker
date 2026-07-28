import { useEffect, type JSX } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { useAuthStore } from './store/auth';
// Animated caffeine background disabled for now — kept in the tree for later.
// import { BgCanvas } from './components/BgCanvas';
import { BottomNav } from './components/BottomNav';
import { Auth } from './pages/Auth';
import { Feed } from './pages/Feed';
import { Saved } from './pages/Saved';
import { MyPosts } from './pages/MyPosts';
import { LogCoffee } from './pages/LogCoffee';
import { Stats } from './pages/Stats';
import { Compete } from './pages/Compete';
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
  const logout = useAuthStore(s => s.logout);
  const location = useLocation();

  const { data: meData, isError: meError } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/auth/me'),
    enabled: !!token && !user,
    retry: false,
  });

  // Adopt the fetched user; on any failure (invalid/expired token, deleted user)
  // clear the session so the app can't render half-logged-in. RequireAuth then
  // redirects to /auth.
  useEffect(() => {
    if (meData && token) setAuth(meData, token);
  }, [meData, token, setAuth]);
  useEffect(() => {
    if (meError) logout(); // logout() clears the query cache itself.
  }, [meError, logout]);

  // Keep the stored IANA timezone in sync with the current browser zone (the
  // user may have travelled). Fire-and-forget on the next interaction; the
  // server evaluates civil-time logic in this zone. See docs/time-and-timezones.md.
  useEffect(() => {
    if (!user || !token) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && user.timezone && user.timezone !== tz) {
      api.patch<User>('/auth/me', { timezone: tz }).then(u => setAuth(u, token)).catch(() => {});
    }
  }, [user, token, setAuth]);

  const isAuth = location.pathname === '/auth';

  return (
    <>
      {/* Animated caffeine background disabled for now — see BgCanvas. */}
      <div id="app-wrap">
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<RequireAuth><Feed /></RequireAuth>} />
          <Route path="/mine" element={<RequireAuth><MyPosts /></RequireAuth>} />
          {/* Saved lost its nav slot to /mine and now lives under Profile. */}
          <Route path="/saved" element={<RequireAuth><Saved /></RequireAuth>} />
          <Route path="/log" element={<RequireAuth><LogCoffee /></RequireAuth>} />
          {/* Stats lost its bottom-nav slot to Compete; Profile links here. */}
          <Route path="/stats" element={<RequireAuth><Stats /></RequireAuth>} />
          {/* Scope + section live in the path (/compete/group/ranking) so a
              refresh or shared link lands on the same tab. Bare /compete
              canonicalises to the resolved default once data loads. */}
          <Route path="/compete" element={<RequireAuth><Compete /></RequireAuth>} />
          <Route path="/compete/:scope" element={<RequireAuth><Compete /></RequireAuth>} />
          <Route path="/compete/:scope/:section" element={<RequireAuth><Compete /></RequireAuth>} />
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
