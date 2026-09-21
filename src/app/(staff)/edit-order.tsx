import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useOrderableMenu } from '@/hooks/use-orderable-menu';
import { Spacing } from '@/constants/theme';
import { ApiError } from '@/api/client';
import { addItem, fetchMyOrders, removeItem, setItemQuantity } from '@/api/orders';
import { updateQueuedOrderItems } from '@/offline/outbox';
import { useOutboxStore } from '@/state/outbox-store';
import { useSessionStore } from '@/state/session-store';

interface Line {
  menuItemId: string;
  name: string;
  quantity: number;
}

/**
 * Edit the items of one of the waiter's own orders.
 *  - kind=local:  the order is still queued on this phone — edit the queued copy (works offline).
 *  - kind=server: the order already reached the server — edit it there (needs a connection).
 */
export default function EditOrderScreen() {
  const { kind, ref } = useLocalSearchParams<{ kind: 'local' | 'server'; ref: string }>();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const outbox = useOutboxStore((s) => s.entries);
  const ordersQuery = useQuery({ queryKey: ['orders', 'mine'], queryFn: fetchMyOrders });
  const { items: menuItems, fmt } = useOrderableMenu();

  const localEntry = kind === 'local' ? outbox.find((e) => e.clientRef === ref) : undefined;
  const serverOrder = kind === 'server' ? ordersQuery.data?.find((o) => o.id === ref) : undefined;

  const [lines, setLines] = useState<Line[] | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the starting lines once, from whichever source applies.
  useEffect(() => {
    if (lines) return;
    if (localEntry) {
      setLines(localEntry.payload.items.map((it, i) => ({ menuItemId: it.menuItemId, name: localEntry.display.lines[i]?.name ?? 'Item', quantity: it.quantity })));
    } else if (serverOrder) {
      setLines(serverOrder.items.map((it) => ({ menuItemId: it.menuItem.id, name: it.menuItem.name, quantity: it.quantity })));
    }
  }, [lines, localEntry, serverOrder]);

  const notEditableReason =
    kind === 'local' && localEntry && localEntry.status !== 'pending'
      ? localEntry.status === 'failed'
        ? 'The server refused this order, so it can no longer be edited. Please tell a manager.'
        : 'This order is being sent right now. Go back and try again in a moment.'
      : kind === 'server' && serverOrder && (serverOrder.status === 'SERVED' || serverOrder.status === 'CANCELLED')
        ? `This order is ${serverOrder.status.toLowerCase()} and can no longer be edited.`
        : null;

  function changeQty(menuItemId: string, delta: number) {
    setLines((prev) => prev && prev.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)));
  }

  function removeLine(menuItemId: string) {
    setLines((prev) => {
      if (!prev) return prev;
      if (prev.length <= 1) {
        setError('An order must keep at least one item.');
        return prev;
      }
      return prev.filter((l) => l.menuItemId !== menuItemId);
    });
  }

  function addLine(item: { id: string; name: string }) {
    setLines((prev) => {
      if (!prev) return prev;
      const existing = prev.find((l) => l.menuItemId === item.id);
      if (existing) return prev.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { menuItemId: item.id, name: item.name, quantity: 1 }];
    });
  }

  async function save() {
    if (!lines || lines.length === 0) {
      setError('An order must keep at least one item.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (kind === 'local' && localEntry && userId) {
        const ok = await updateQueuedOrderItems(
          localEntry.clientRef,
          lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          { label: localEntry.display.label, lines: lines.map((l) => ({ name: l.name, quantity: l.quantity })) }
        );
        if (!ok) {
          setError('This order was just sent, so it can no longer be changed here. Go back and open it again.');
          return;
        }
        await useOutboxStore.getState().refresh(userId);
      } else if (kind === 'server' && serverOrder) {
        const net = await NetInfo.fetch();
        if (!net.isConnected || net.isInternetReachable === false) {
          setError('You need a connection to change an order that has already been sent.');
          return;
        }
        const original = new Map(serverOrder.items.map((it) => [it.menuItem.id, it]));
        const edited = new Map(lines.map((l) => [l.menuItemId, l]));
        try {
          // Adds first, then quantity changes, then removals — so an order
          // never momentarily has zero items (the server forbids that).
          for (const l of lines) if (!original.has(l.menuItemId)) await addItem(serverOrder.id, l.menuItemId, l.quantity);
          for (const l of lines) {
            const orig = original.get(l.menuItemId);
            if (orig && orig.quantity !== l.quantity) await setItemQuantity(serverOrder.id, orig.id, l.quantity);
          }
          for (const [menuItemId, orig] of original) if (!edited.has(menuItemId)) await removeItem(serverOrder.id, orig.id);
        } catch (e) {
          // Some changes may already have gone through — refresh so the list shows the truth.
          void queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
          setError(`${e instanceof ApiError ? e.message : 'Something went wrong'}. Some changes may not have been saved — check the order in My Orders.`);
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const search_ = search.trim().toLowerCase();
  const results = menuItems.filter((m) => !search_ || m.name.toLowerCase().includes(search_)).slice(0, 30);
  const title = localEntry ? localEntry.display.label : serverOrder ? `Order #${serverOrder.orderNumber}` : 'Edit order';

  if (!lines) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          {localEntry === undefined && serverOrder === undefined && !ordersQuery.isLoading ? (
            <>
              <ThemedText>This order could not be found — it may have just been sent.</ThemedText>
              <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
                <ThemedText>Back</ThemedText>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator />
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">{title}</ThemedText>

        {notEditableReason ? (
          <>
            <ThemedText themeColor="textSecondary">{notEditableReason}</ThemedText>
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <ThemedText>Back</ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            {error && (
              <ThemedView style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </ThemedView>
            )}

            <ThemedText type="smallBold">Items on this order</ThemedText>
            {lines.map((l) => (
              <ThemedView key={l.menuItemId} type="backgroundElement" style={styles.row}>
                <ThemedText style={styles.rowName}>{l.name}</ThemedText>
                <ThemedView type="backgroundElement" style={styles.qtyControl}>
                  <Pressable onPress={() => changeQty(l.menuItemId, -1)} style={styles.qtyButton}>
                    <ThemedText style={styles.qtyButtonText}>−</ThemedText>
                  </Pressable>
                  <ThemedText style={styles.qtyValue}>{l.quantity}</ThemedText>
                  <Pressable onPress={() => changeQty(l.menuItemId, 1)} style={styles.qtyButton}>
                    <ThemedText style={styles.qtyButtonText}>+</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => removeLine(l.menuItemId)}>
                    <ThemedText style={styles.removeText}>✕</ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            ))}

            <ThemedText type="smallBold" style={styles.sectionGap}>
              Add items
            </ThemedText>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search menu…"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <FlatList
              data={results}
              keyExtractor={(m) => m.id}
              style={styles.menuList}
              contentContainerStyle={styles.menuListContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <ThemedView type="backgroundElement" style={styles.row}>
                  <ThemedView type="backgroundElement" style={styles.rowName}>
                    <ThemedText type="smallBold">{item.name}</ThemedText>
                    <ThemedText themeColor="textSecondary" type="small">
                      {fmt(Number(item.price))}
                    </ThemedText>
                  </ThemedView>
                  <Pressable onPress={() => addLine(item)} style={styles.addButton}>
                    <ThemedText style={styles.addButtonText}>Add</ThemedText>
                  </Pressable>
                </ThemedView>
              )}
            />

            <Pressable onPress={save} disabled={saving} style={[styles.saveButton, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.saveText}>Save changes</ThemedText>}
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <ThemedText themeColor="textSecondary">Cancel</ThemedText>
            </Pressable>
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.three },
  rowName: { flex: 1 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  qtyButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(128,128,128,0.2)', alignItems: 'center', justifyContent: 'center' },
  qtyButtonText: { fontSize: 18, lineHeight: 20 },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  removeText: { color: '#dc2626', marginLeft: Spacing.two },
  sectionGap: { marginTop: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  menuList: { flex: 1 },
  menuListContent: { gap: Spacing.two },
  addButton: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  addButtonText: { color: '#fff', fontWeight: '600' },
  saveButton: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.6 },
  secondaryButton: { alignItems: 'center', paddingVertical: Spacing.two },
  errorBox: { backgroundColor: '#fee2e2', borderRadius: Spacing.two, padding: Spacing.three },
  errorText: { color: '#dc2626' },
});
