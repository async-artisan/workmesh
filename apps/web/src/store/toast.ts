import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, tone: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
/** 上一条提示：1.5 秒内相同文案+语气不重复堆叠（并发 429 常见）。 */
let lastPush: { message: string; tone: ToastTone; at: number } | null = null;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, tone) => {
    const now = Date.now();
    if (
      lastPush &&
      lastPush.message === message &&
      lastPush.tone === tone &&
      now - lastPush.at < 1500
    ) {
      return;
    }
    lastPush = { message, tone, at: now };
    const id = nextId++;
    set((state) => ({ items: [...state.items, { id, message, tone }] }));
    window.setTimeout(() => {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    }, 3600);
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

export const toast = {
  success: (message: string) => useToastStore.getState().push(message, 'success'),
  error: (message: string) => useToastStore.getState().push(message, 'error'),
  info: (message: string) => useToastStore.getState().push(message, 'info'),
};
