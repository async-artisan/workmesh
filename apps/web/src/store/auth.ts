import { create } from 'zustand';

/** WebSession 只暴露 id/email；没有任何 bearer token 进入浏览器存储。 */
export interface SessionUser {
  id: string;
  email: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: SessionUser | null;
  status: AuthStatus;
  setSession: (user: SessionUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  setSession: (user) => set({ user, status: 'authenticated' }),
  clearAuth: () => set({ user: null, status: 'anonymous' }),
}));
