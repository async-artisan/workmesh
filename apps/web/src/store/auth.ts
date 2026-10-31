import { create } from 'zustand';
import type { User } from '@reqflow/shared';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
}
const saved = localStorage.getItem('reqflow.auth');
const initial = saved
  ? (JSON.parse(saved) as Pick<AuthState, 'user' | 'accessToken' | 'refreshToken'>)
  : { user: null, accessToken: null, refreshToken: null };

export const useAuthStore = create<AuthState>((set) => ({
  ...initial,
  setAuth: (user, accessToken, refreshToken) => {
    const value = { user, accessToken, refreshToken };
    localStorage.setItem('reqflow.auth', JSON.stringify(value));
    set(value);
  },
  clearAuth: () => {
    localStorage.removeItem('reqflow.auth');
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
