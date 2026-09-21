import { create } from 'zustand';

import { listOutbox, type OutboxEntry } from '@/offline/outbox';

interface OutboxState {
  entries: OutboxEntry[];
  syncing: boolean;
  refresh: (userId: string | null) => Promise<void>;
  setSyncing: (syncing: boolean) => void;
}

/** In-memory mirror of the SQLite outbox so screens re-render when it changes. */
export const useOutboxStore = create<OutboxState>((set) => ({
  entries: [],
  syncing: false,
  async refresh(userId) {
    set({ entries: userId ? await listOutbox(userId) : [] });
  },
  setSyncing: (syncing) => set({ syncing }),
}));
