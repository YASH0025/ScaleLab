import { create } from 'zustand';

export interface Toast {
  id: number;
  tone: 'info' | 'error' | 'success';
  message: string;
}

interface UiState {
  selectedNodeId: string | undefined;
  toasts: Toast[];
  celebrating: boolean;
  /** Set while viewing a design opened from a share link. */
  sharedBanner: { name: string; canRestore: boolean; kind?: 'shared' | 'imported' } | undefined;
  /** Bumped to ask the canvas to fit everything in view (after loading a design). */
  fitRequest: number;
  requestFit: () => void;
  select: (id: string | undefined) => void;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
  celebrate: () => void;
  setSharedBanner: (banner: UiState['sharedBanner']) => void;
}

let nextToast = 1;

export const useUi = create<UiState>((set) => ({
  selectedNodeId: undefined,
  toasts: [],
  celebrating: false,
  sharedBanner: undefined,
  fitRequest: 0,
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  select: (id) => set({ selectedNodeId: id }),
  toast: (message, tone = 'info') => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, tone, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  celebrate: () => {
    set({ celebrating: true });
    setTimeout(() => set({ celebrating: false }), 2600);
  },
  setSharedBanner: (sharedBanner) => set({ sharedBanner }),
}));
