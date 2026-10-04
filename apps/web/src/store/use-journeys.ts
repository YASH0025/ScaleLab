import { create } from 'zustand';

export type JourneyView = 'list' | 'edit' | 'results';

interface JourneysState {
  open: boolean;
  view: JourneyView;
  /** Journey being edited; undefined while creating a new one. */
  editingId: string | undefined;
  /** Users who start each journey per second, by journey id. */
  usersPerSec: Record<string, number>;
  /** Journeys left out of the next run. */
  skipped: Record<string, boolean>;
  withTraffic: boolean;

  show: (view?: JourneyView, editingId?: string) => void;
  close: () => void;
  setUsersPerSec: (journeyId: string, value: number) => void;
  toggleSkipped: (journeyId: string) => void;
  setWithTraffic: (value: boolean) => void;
}

export const DEFAULT_USERS_PER_SEC = 20;

export const useJourneys = create<JourneysState>((set, get) => ({
  open: false,
  view: 'list',
  editingId: undefined,
  usersPerSec: {},
  skipped: {},
  withTraffic: false,

  show: (view = 'list', editingId) => set({ open: true, view, editingId }),
  close: () => set({ open: false }),
  setUsersPerSec: (journeyId, value) => set({ usersPerSec: { ...get().usersPerSec, [journeyId]: value } }),
  toggleSkipped: (journeyId) => set({ skipped: { ...get().skipped, [journeyId]: !get().skipped[journeyId] } }),
  setWithTraffic: (withTraffic) => set({ withTraffic }),
}));
