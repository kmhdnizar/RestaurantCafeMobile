import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchMyOrders, type OrderSummary } from '@/api/orders';
import { flushOutbox } from '@/offline/sync-engine';
import { useOutboxStore } from '@/state/outbox-store';
import type { OutboxEntry } from '@/offline/outbox';

const STATUS_LABEL: Record<OrderSummary['status'], string> = {
  PENDING: 'Pending',
  PREPARING: 'Preparing',
  READY: 'Ready',
  SERVED: 'Served',
  CANCELLED: 'Cancelled',
};

const STATUS_COLOR: Record<OrderSummary['status'], string> = {
  PENDING: '#ca8a04',
  PREPARING: '#2563eb',
  READY: '#16a34a',
  SERVED: '#6b7280',
  CANCELLED: '#dc2626',
};

type Row = { kind: 'local'; entry: OutboxEntry } | { kind: 'server'; order: OrderSummary };

export default function MyOrdersScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['orders', 'mine'], queryFn: fetchMyOrders });
  const outbox = useOutboxStore((s) => s.entries);

  // Orders still on this phone (waiting, sending, or refused) come first,
  // newest on top, followed by what the server already has.
  const rows: Row[] = [
    ...[...outbox].reverse().map((entry): Row => ({ kind: 'local', entry })),
    ...(query.data ?? []).map((order): Row => ({ kind: 'server', order })),
  ];

  function refresh() {
    void flushOutbox();
    return queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.title}>
          My Orders
        </ThemedText>

        {query.isLoading && rows.length === 0 && <ActivityIndicator style={styles.loading} />}
        {query.isError && <ThemedText themeColor="textSecondary">Can&apos;t reach the server right now — showing what&apos;s saved. Pull down to retry.</ThemedText>}

        <FlatList
          data={rows}
          keyExtractor={(r) => (r.kind === 'local' ? `local-${r.entry.clientRef}` : r.order.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={refresh} />}
          ListEmptyComponent={!query.isLoading ? <ThemedText themeColor="textSecondary">No orders yet — start one from the New Order tab.</ThemedText> : null}
          renderItem={({ item: row }) => {
            if (row.kind === 'local') {
              const { entry } = row;
              const failed = entry.status === 'failed';
              return (
                <ThemedView type="backgroundElement" style={[styles.card, failed && styles.cardFailed]}>
                  <ThemedView type="backgroundElement" style={styles.cardHeader}>
                    <ThemedText type="smallBold">{entry.display.label}</ThemedText>
                    <ThemedView style={[styles.statusPill, { backgroundColor: failed ? '#dc2626' : '#f97316' }]}>
                      <ThemedText style={styles.statusText}>{failed ? 'Not sent' : entry.status === 'syncing' ? 'Sending…' : 'Waiting to send'}</ThemedText>
                    </ThemedView>
                  </ThemedView>
                  {entry.display.lines.map((line, i) => (
                    <ThemedText key={i} themeColor="textSecondary" type="small">
                      {line.quantity}× {line.name}
                    </ThemedText>
                  ))}
                  {failed ? (
                    <ThemedText style={styles.failedText} type="small">
                      The server refused this order: {entry.lastError}. Please tell a manager.
                    </ThemedText>
                  ) : (
                    <ThemedText themeColor="textSecondary" type="small">
                      Saved on this phone. It will send automatically when there&apos;s a connection.
                    </ThemedText>
                  )}
                </ThemedView>
              );
            }
            const { order } = row;
            return (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedView type="backgroundElement" style={styles.cardHeader}>
                  <ThemedText type="smallBold">
                    #{order.orderNumber} — {order.type === 'DINE_IN' ? `Table ${order.table?.number ?? '?'}` : (order.customerName ?? 'Takeaway')}
                  </ThemedText>
                  <ThemedView style={[styles.statusPill, { backgroundColor: STATUS_COLOR[order.status] }]}>
                    <ThemedText style={styles.statusText}>{STATUS_LABEL[order.status]}</ThemedText>
                  </ThemedView>
                </ThemedView>
                {order.items.map((line) => (
                  <ThemedText key={line.id} themeColor="textSecondary" type="small">
                    {line.quantity}× {line.menuItem.name}
                  </ThemedText>
                ))}
              </ThemedView>
            );
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  title: { marginVertical: Spacing.three },
  loading: { marginTop: Spacing.four },
  list: { gap: Spacing.two, paddingBottom: Spacing.four },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  cardFailed: { borderWidth: 1, borderColor: '#dc2626' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.one },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Spacing.four },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  failedText: { color: '#dc2626', marginTop: Spacing.one },
});
