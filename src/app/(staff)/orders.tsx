import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { tableName } from '@/lib/format';
import { useOrderableMenu } from '@/hooks/use-orderable-menu';
import { fetchMyOrders, type OrderSummary } from '@/api/orders';
import { flushOutbox } from '@/offline/sync-engine';
import { useOutboxStore } from '@/state/outbox-store';
import type { OutboxEntry } from '@/offline/outbox';
import { ticketFromOutboxEntry, ticketFromServerOrder, useKitchenPrinter } from '@/print/use-kitchen-printer';
import { createBill, type Bill } from '@/api/bills';
import { ApiError } from '@/api/client';
import { useSessionStore } from '@/state/session-store';

const PAYMENT_METHODS: { value: Bill['paymentMethod']; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'QR', label: 'QR Pay' },
  { value: 'STAFF_FOOD', label: 'Staff Food' },
];

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
  const router = useRouter();
  const kitchen = useKitchenPrinter();
  const { fmt } = useOrderableMenu();
  const restaurantName = useSessionStore((s) => s.user?.restaurantName ?? null);
  const query = useQuery({ queryKey: ['orders', 'mine'], queryFn: fetchMyOrders });
  const outbox = useOutboxStore((s) => s.entries);
  const [completingOrder, setCompletingOrder] = useState<OrderSummary | null>(null);
  const [completing, setCompleting] = useState(false);

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

  async function completeOrder(order: OrderSummary, paymentMethod: Bill['paymentMethod']) {
    setCompleting(true);
    try {
      const bill = await createBill(order.id, paymentMethod);
      setCompletingOrder(null);
      await queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
      if (kitchen.canPrintReceipts) {
        void kitchen.printReceipt({
          restaurantName: restaurantName ?? '',
          orderNumber: bill.order.orderNumber,
          label: bill.order.type === 'DINE_IN' ? (bill.order.table ? tableName(bill.order.table) : 'Table') : (bill.order.customerName ?? 'Takeaway'),
          waiter: bill.order.waiter?.name,
          items: bill.order.items.map((it) => ({ qty: it.quantity, name: it.menuItem.name, unitPrice: Number(it.unitPrice) })),
          subtotal: Number(bill.subtotal),
          discount: Number(bill.discount),
          total: Number(bill.total),
          paymentMethod: bill.paymentMethod,
          formatMoney: fmt,
        });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        Alert.alert('Not allowed', "You don't have permission to complete orders. Ask a manager to do it, or to grant you access in Permissions.");
      } else if (e instanceof ApiError && e.status === 400) {
        Alert.alert("Can't complete order", e.message);
      } else {
        Alert.alert('Something went wrong', e instanceof ApiError ? e.message : 'Please check your connection and try again.');
      }
    } finally {
      setCompleting(false);
    }
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
                <Pressable onPress={() => router.push({ pathname: '/edit-order', params: { kind: 'local', ref: entry.clientRef } })}>
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
                  {entry.display.waiter ? (
                    <ThemedText themeColor="textSecondary" type="small">
                      Taken by {entry.display.waiter}
                    </ThemedText>
                  ) : null}
                  {entry.display.lines.every((l) => l.price !== undefined) && (
                    <ThemedText type="smallBold">Total: {fmt(entry.display.lines.reduce((sum, l) => sum + (l.price ?? 0) * l.quantity, 0))}</ThemedText>
                  )}
                  {failed ? (
                    <ThemedText style={styles.failedText} type="small">
                      The server refused this order: {entry.lastError}. Please tell a manager.
                    </ThemedText>
                  ) : (
                    <ThemedText themeColor="textSecondary" type="small">
                      Saved on this phone. It will send automatically when there&apos;s a connection. Tap to edit.
                    </ThemedText>
                  )}
                  {kitchen.enabled && !failed && (
                    <Pressable onPress={() => void kitchen.print(ticketFromOutboxEntry(entry))} disabled={kitchen.printing} style={styles.printButton}>
                      <ThemedText style={styles.printText}>{kitchen.printing ? 'Printing…' : 'Print ticket'}</ThemedText>
                    </Pressable>
                  )}
                </ThemedView>
                </Pressable>
              );
            }
            const { order } = row;
            const editable = order.status !== 'SERVED' && order.status !== 'CANCELLED';
            return (
              <Pressable disabled={!editable} onPress={() => router.push({ pathname: '/edit-order', params: { kind: 'server', ref: order.id } })}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedView type="backgroundElement" style={styles.cardHeader}>
                  <ThemedText type="smallBold">
                    #{order.orderNumber} — {order.type === 'DINE_IN' ? (order.table ? tableName(order.table) : 'Table') : (order.customerName ?? 'Takeaway')}
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
                {order.waiter && (
                  <ThemedText themeColor="textSecondary" type="small">
                    Taken by {order.waiter.name}
                  </ThemedText>
                )}
                <ThemedText type="smallBold">Total: {fmt(order.items.reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0))}</ThemedText>
                {editable && (
                  <ThemedText themeColor="textSecondary" type="small">
                    Tap to edit
                  </ThemedText>
                )}
                {editable && (
                  <Pressable onPress={() => setCompletingOrder(order)} style={styles.completeButton}>
                    <ThemedText style={styles.completeText}>Complete order</ThemedText>
                  </Pressable>
                )}
                {kitchen.enabled && (
                  <Pressable onPress={() => void kitchen.print(ticketFromServerOrder(order))} disabled={kitchen.printing} style={styles.printButton}>
                    <ThemedText style={styles.printText}>{kitchen.printing ? 'Printing…' : 'Print ticket'}</ThemedText>
                  </Pressable>
                )}
              </ThemedView>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>

      <Modal visible={completingOrder !== null} transparent animationType="fade" onRequestClose={() => !completing && setCompletingOrder(null)}>
        <ThemedView style={styles.modalBackdrop}>
          <ThemedView type="backgroundElement" style={styles.modalCard}>
            <ThemedText type="smallBold" style={styles.modalTitle}>
              Complete order {completingOrder ? `#${completingOrder.orderNumber}` : ''}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.modalSubtitle}>
              How was this paid?
            </ThemedText>
            {completing ? (
              <ActivityIndicator style={styles.modalLoading} />
            ) : (
              <>
                {PAYMENT_METHODS.map((m) => (
                  <Pressable key={m.value} onPress={() => completingOrder && void completeOrder(completingOrder, m.value)} style={styles.paymentOption}>
                    <ThemedText style={styles.paymentOptionText}>{m.label}</ThemedText>
                  </Pressable>
                ))}
                <Pressable onPress={() => setCompletingOrder(null)} style={styles.modalCancel}>
                  <ThemedText themeColor="textSecondary">Cancel</ThemedText>
                </Pressable>
              </>
            )}
          </ThemedView>
        </ThemedView>
      </Modal>
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
  printButton: { alignSelf: 'flex-start', marginTop: Spacing.one, borderWidth: 1, borderColor: '#ea580c', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  printText: { color: '#ea580c', fontWeight: '600', fontSize: 13 },
  completeButton: { alignSelf: 'flex-start', marginTop: Spacing.one, backgroundColor: '#16a34a', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  completeText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '85%', borderRadius: Spacing.three, padding: Spacing.four, gap: Spacing.two },
  modalTitle: { textAlign: 'center' },
  modalSubtitle: { textAlign: 'center', marginBottom: Spacing.two },
  modalLoading: { marginVertical: Spacing.four },
  paymentOption: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  paymentOptionText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  modalCancel: { alignItems: 'center', paddingVertical: Spacing.two, marginTop: Spacing.one },
});
