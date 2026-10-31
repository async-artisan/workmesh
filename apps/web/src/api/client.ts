import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth';

export const SESSION_EXPIRED_EVENT = 'reqflow:session-expired';

export const client = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const isAuthRequest = (url?: string) => Boolean(url && /\/auth\/(login|register|refresh)/.test(url));

const endSession = () => {
  const { user, clearAuth } = useAuthStore.getState();
  clearAuth();
  if (user) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
};

let refreshPromise: Promise<string> | null = null;

const readServerMessage = (body: unknown) => {
  const raw = (body as { message?: unknown } | undefined)?.message;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === 'string').join('；');
  if (raw && typeof raw === 'object') {
    const nested = (raw as { message?: unknown }).message;
    if (typeof nested === 'string') return nested;
    if (Array.isArray(nested)) return nested.filter((item) => typeof item === 'string').join('；');
  }
  return '';
};

const refreshAccessToken = () => {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return Promise.reject(new Error('no refresh token'));
  refreshPromise ??= client
    .post('/auth/refresh', { refreshToken })
    .then((raw) => {
      const payload = raw as unknown as { accessToken: string };
      const current = useAuthStore.getState();
      if (!current.user) throw new Error('no user');
      current.setAuth(current.user, payload.accessToken, refreshToken);
      return payload.accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};

client.interceptors.response.use(
  (response) => response.data?.data ?? response.data,
  async (error) => {
    const message = readServerMessage(error.response?.data);
    if (message) error.message = message;

    const original = error.config as RetryConfig | undefined;
    if (error.response?.status !== 401 || !original) throw error;

    if (isAuthRequest(original.url)) throw error;

    if (original._retry) {
      endSession();
      throw error;
    }

    original._retry = true;
    try {
      const token = await refreshAccessToken();
      original.headers.Authorization = `Bearer ${token}`;
      return client(original);
    } catch (refreshError) {
      endSession();
      throw refreshError;
    }
  },
);
