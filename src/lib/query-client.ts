import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

const DAY_MS = 24 * 60 * 60 * 1000;

// Shared so non-React code (the sync engine) can invalidate cached queries.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Kept long enough that the menu, tables and settings stay available
      // when the phone is offline or the app is restarted without a connection.
      gcTime: DAY_MS,
      staleTime: 60_000,
      // Show cached data and retry later instead of pausing/erroring when offline.
      networkMode: 'offlineFirst',
      retry: 1,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'restaurantcafe-query-cache' });
export const PERSIST_MAX_AGE = DAY_MS;
