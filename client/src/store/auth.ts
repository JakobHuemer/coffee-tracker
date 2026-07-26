import { create } from 'zustand';
import { queryClient } from '../queryClient';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    set({ user, token });
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, token: null });
    // Every cached response belongs to the account that just left. Dropping the
    // cache here (rather than at each call site) is what keeps the next sign-in
    // from rendering the previous account's data — callers used to have to
    // remember, and the Sign Out button didn't.
    queryClient.clear();
  },
}));
