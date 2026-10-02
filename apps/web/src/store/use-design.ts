import { create } from 'zustand';
import { type DesignSnapshot, snapshot, subscribe } from './design-doc';

interface DesignState extends DesignSnapshot {
  ready: boolean;
  setReady: () => void;
}

/** React view of the Yjs document. Components read from here; edits go through design-doc. */
export const useDesign = create<DesignState>((set) => ({
  ...snapshot(),
  ready: false,
  setReady: () => set({ ready: true }),
}));

subscribe(() => useDesign.setState(snapshot()));
