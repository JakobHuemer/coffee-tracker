import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import type { User } from '../types';

export function Auth() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = { username, password };
      const data = await api.post<{ token: string; user: User }>(`/auth/${mode}`, body);
      setAuth(data.user, data.token);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">☕</div>
        <h1 className="auth-title">Coffee Tracker</h1>
        <p className="auth-sub">{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</p>

        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign In</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>

        {mode === 'register' && (
          <div className="auth-warn" role="alert">
            <strong>☕ Just for fun — use a throwaway password.</strong>
            <span>Never reuse a password from anywhere else. Treat whatever you type
            here as public. A break-in does zero real damage, so keep it simple.</span>
          </div>
        )}

        <form onSubmit={submit} className="auth-form">
          <div className="field">
            <label htmlFor="auth-username">Username</label>
            <input id="auth-username" value={username} onChange={e => setUsername(e.target.value)} required placeholder="coffeeaddict" minLength={2} maxLength={20} />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Loading…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
