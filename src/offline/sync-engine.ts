import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { ApiError, UnauthorizedError } from '@/api/client';
import { createOrder } from '@/api/orders';
import { queryClient } from '@/lib/query-client';
import { listPending, markFailed, markPending, markSyncing, removeEntry, resetStuckSyncing } from '@/offline/outbox';
import { getPrintSnapshot, localOrderKey, serverOrderKey, setPrintSnapshot } from '@/offline/print-snapshot';
import { useOutboxStore } from '@/state/outbox-store';

let currentUserId: string | null = null;
let flushing = false;

/** Sends queued orders to the server, oldest first, one at a time.
 * Safe to call from anywhere, any number of times — overlapping calls are ignored. */
export async function flushOutbox(): Promise<void> {
  const userId = currentUserId;
  if (!userId || flushing) return;
  flushing = true;
  const store = useOutboxStore.getState();
  store.setSyncing(true);

  try {
    for (;;) {
      const [next] = await listPending(userId);
      if (!next) break;

      await markSyncing(next.clientRef);
      await store.refresh(userId);

      try {
        const order = await createOrder({ ...next.payload, clientRef: next.clientRef });
        // Carry the "what's been printed" record over to the order's real
        // server id, so an edit after this point still only prints the change.
        const snapshot = await getPrintSnapshot(localOrderKey(next.clientRef));
        if (snapshot.length) await setPrintSnapshot(serverOrderKey(order.id), snapshot);
        await removeEntry(next.clientRef);
        void queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          // Session is no longer valid — the client already signed the user
          // out. Keep the order queued; it sends after they sign back in.
          await markPending(next.clientRef, null);
          break;
        }
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          // The server understood and refused this order (e.g. a menu item
          // no longer exists). Retrying can't help — surface it and move on
          // so it doesn't block the orders behind it.
          await markFailed(next.clientRef, e.message);
          continue;
        }
        // No connection, timeout, or a server error: transient. Stop and
        // retry the whole queue later, preserving order.
        await markPending(next.clientRef, e instanceof Error ? e.message : 'Network error');
        break;
      }
    }
  } finally {
    flushing = false;
    store.setSyncing(false);
    await store.refresh(userId);
  }
}

/** Starts background syncing for a signed-in user: on launch, when the phone
 * regains connectivity, when the app returns to the foreground, and on a
 * slow timer as a safety net. Returns a cleanup function. */
export function startSyncEngine(userId: string): () => void {
  currentUserId = userId;

  void (async () => {
    await resetStuckSyncing();
    await useOutboxStore.getState().refresh(userId);
    await flushOutbox();
  })();

  const unsubscribeNet = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) void flushOutbox();
  });
  const appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void flushOutbox();
  });
  const timer = setInterval(() => void flushOutbox(), 30_000);

  return () => {
    unsubscribeNet();
    appStateSub.remove();
    clearInterval(timer);
    if (currentUserId === userId) currentUserId = null;
  };
}
