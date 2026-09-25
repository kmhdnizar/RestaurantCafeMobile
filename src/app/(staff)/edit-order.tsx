import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
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
import { addItem, fetchOrders, removeItem, updateOrderItem, updateOrderTable } from '@/api/orders';
import { updateQueuedOrderItems, updateQueuedOrderTable } from '@/offline/outbox';
import { useOutboxStore } from '@/state/outbox-store';
import { useSessionStore } from '@/state/session-store';
import { tableName, sanitizePriceText } from '@/lib/format';
import { useKitchenPrinter } from '@/print/use-kitchen-printer';
import { groupByCategory } from '@/print/escpos';
import { diffAgainstSnapshot, getPrintSnapshot, localOrderKey, serverOrderKey, setPrintSnapshot, type SnapshotLine } from '@/offline/print-snapshot';
import { useT, type TKey } from '@/lib/i18n';

const STATUS_KEY: Partial<Record<'SERVED' | 'CANCELLED', TKey>> = {
  SERVED: 'myOrders.statusServed',
  CANCELLED: 'myOrders.statusCancelled',
};

interface Line {
  menuItemId: string;
  name: string;
  quantity: number;
  category?: string;
  price?: number;
  /** Raw text backing the market-price input — kept separate from `price`
   * so a trailing decimal point isn't lost while the user is still typing. */
  priceText?: string;
  notes?: string;
  /** True when the menu currently lists this item at RM0 — its price was/is
   * entered by staff rather than fixed, so it stays editable here too. */
  variablePrice?: boolean;
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
  const t = useT();
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const userName = useSessionStore((s) => s.user?.name ?? null);
  const outbox = useOutboxStore((s) => s.entries);
  // Independent of the Orders tab's own (filtered) query — this one is
  // unfiltered by date so editing still finds the order even if it falls
  // outside whatever date filter happens to be selected on that tab.
  const ordersQuery = useQuery({ queryKey: ['orders', 'lookup'], queryFn: () => fetchOrders() });
  const { items: menuItems, tables, fmt } = useOrderableMenu();
  const kitchen = useKitchenPrinter();

  const localEntry = kind === 'local' ? outbox.find((e) => e.clientRef === ref) : undefined;
  const serverOrder = kind === 'server' ? ordersQuery.data?.find((o) => o.id === ref) : undefined;
  const orderType = localEntry ? localEntry.payload.type : serverOrder?.type;
  const isParcel = orderType === 'TAKEAWAY';
  const currentTableId = localEntry ? localEntry.payload.tableId : serverOrder?.table?.id;

  const [lines, setLines] = useState<Line[] | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [switchingTable, setSwitchingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Notes start collapsed so a line without one stays a single compact row.
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  function toggleNotes(menuItemId: string) {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(menuItemId)) next.delete(menuItemId);
      else next.add(menuItemId);
      return next;
    });
  }

  // Expo Router can reuse this same screen instance when navigating from one
  // order straight to another, so `lines` must be dropped whenever the order
  // being edited changes — otherwise the previous order's items stick around.
  useEffect(() => {
    setLines(null);
  }, [ref]);

  // Then load the starting lines for whichever order is now selected. Whether
  // an item's price is still editable depends on the menu's *current* listed
  // price, not what this order happened to store, so it's resolved here
  // against the live menu rather than carried in the order data.
  useEffect(() => {
    if (lines) return;
    if (localEntry) {
      setLines(
        localEntry.payload.items.map((it, i) => {
          const menuItem = menuItems.find((m) => m.id === it.menuItemId);
          const price = localEntry.display.lines[i]?.price ?? 0;
          return {
            menuItemId: it.menuItemId,
            name: localEntry.display.lines[i]?.name ?? 'Item',
            quantity: it.quantity,
            category: localEntry.display.lines[i]?.category,
            price,
            priceText: price === 0 ? '' : String(price),
            notes: it.notes ?? '',
            variablePrice: menuItem ? Number(menuItem.price) === 0 : false,
          };
        })
      );
    } else if (serverOrder) {
      setLines(
        serverOrder.items.map((it) => {
          const menuItem = menuItems.find((m) => m.id === it.menuItem.id);
          const price = Number(it.unitPrice);
          return {
            menuItemId: it.menuItem.id,
            name: it.menuItem.name,
            quantity: it.quantity,
            category: it.menuItem.category?.name,
            price,
            priceText: price === 0 ? '' : String(price),
            notes: it.notes ?? '',
            variablePrice: menuItem ? Number(menuItem.price) === 0 : false,
          };
        })
      );
    }
  }, [lines, localEntry, serverOrder, menuItems]);

  const notEditableReason =
    kind === 'local' && localEntry && localEntry.status !== 'pending'
      ? localEntry.status === 'failed'
        ? t('editOrder.notEditableFailed')
        : t('editOrder.notEditableSending')
      : kind === 'server' && serverOrder && (serverOrder.status === 'SERVED' || serverOrder.status === 'CANCELLED')
        ? t('editOrder.notEditableStatus', { status: t(STATUS_KEY[serverOrder.status]!) })
        : null;

  function changeQty(menuItemId: string, delta: number) {
    setLines((prev) => prev && prev.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)));
  }

  function changeNotes(menuItemId: string, notes: string) {
    setLines((prev) => prev && prev.map((l) => (l.menuItemId === menuItemId ? { ...l, notes } : l)));
  }

  function changePrice(menuItemId: string, text: string) {
    setLines((prev) =>
      prev &&
      prev.map((l) => {
        if (l.menuItemId !== menuItemId) return l;
        const priceText = sanitizePriceText(text);
        return { ...l, priceText, price: parseFloat(priceText) || 0 };
      })
    );
  }

  function removeLine(menuItemId: string) {
    setLines((prev) => {
      if (!prev) return prev;
      if (prev.length <= 1) {
        setError(t('editOrder.mustKeepOneItem'));
        return prev;
      }
      return prev.filter((l) => l.menuItemId !== menuItemId);
    });
  }

  function addLine(item: { id: string; name: string; price: string; category?: { name: string } }) {
    setLines((prev) => {
      if (!prev) return prev;
      const existing = prev.find((l) => l.menuItemId === item.id);
      if (existing) return prev.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      const listedPrice = Number(item.price);
      return [
        ...prev,
        { menuItemId: item.id, name: item.name, quantity: 1, category: item.category?.name, price: listedPrice, priceText: listedPrice === 0 ? '' : String(listedPrice), notes: '', variablePrice: listedPrice === 0 },
      ];
    });
  }

  async function switchTable(table: { id: string; number: number; name: string | null }) {
    const label = table.name?.trim() || `Table ${table.number}`;
    setError(null);
    setSwitchingTable(true);
    try {
      if (kind === 'local' && localEntry && userId) {
        const ok = await updateQueuedOrderTable(localEntry.clientRef, table.id, label);
        if (!ok) {
          setError(t('editOrder.couldNotChange'));
          return;
        }
        await useOutboxStore.getState().refresh(userId);
      } else if (kind === 'server' && serverOrder) {
        const net = await NetInfo.fetch();
        if (!net.isConnected || net.isInternetReachable === false) {
          setError(t('editOrder.needConnection'));
          return;
        }
        try {
          await updateOrderTable(serverOrder.id, table.id);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : t('myOrders.somethingWentWrongTitle'));
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['orders'] });
      }
    } finally {
      setSwitchingTable(false);
    }
  }

  function confirmSwitchTable(table: { id: string; number: number; name: string | null }) {
    const label = table.name?.trim() || `Table ${table.number}`;
    Alert.alert(t('editOrder.switchTableTitle'), t('editOrder.switchTableMessage', { table: label }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('editOrder.switchTableConfirm'), onPress: () => void switchTable(table) },
    ]);
  }

  async function save() {
    if (!lines || lines.length === 0) {
      setError(t('editOrder.mustKeepOneItem'));
      return;
    }
    // A blank market-price field silently saves as RM0 — force staff to
    // type something (even "0") so a skipped price can't slip through.
    const unpriced = lines.filter((l) => l.variablePrice && (l.priceText ?? '').trim() === '');
    if (unpriced.length > 0) {
      setError(t('common.marketPriceRequired', { items: unpriced.map((l) => l.name).join(', ') }));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (kind === 'local' && localEntry && userId) {
        const ok = await updateQueuedOrderItems(
          localEntry.clientRef,
          lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, notes: l.notes || undefined, unitPrice: l.variablePrice ? l.price : undefined })),
          { label: localEntry.display.label, waiter: localEntry.display.waiter, lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, category: l.category, price: l.price })) }
        );
        if (!ok) {
          setError(t('editOrder.couldNotChange'));
          return;
        }
        await useOutboxStore.getState().refresh(userId);
      } else if (kind === 'server' && serverOrder) {
        const net = await NetInfo.fetch();
        if (!net.isConnected || net.isInternetReachable === false) {
          setError(t('editOrder.needConnection'));
          return;
        }
        const original = new Map(serverOrder.items.map((it) => [it.menuItem.id, it]));
        const edited = new Map(lines.map((l) => [l.menuItemId, l]));
        try {
          // Adds first, then quantity/notes changes, then removals — so an
          // order never momentarily has zero items (the server forbids that).
          for (const l of lines) {
            if (!original.has(l.menuItemId)) {
              await addItem(serverOrder.id, { menuItemId: l.menuItemId, quantity: l.quantity, notes: l.notes || undefined, unitPrice: l.variablePrice ? l.price : undefined });
            }
          }
          for (const l of lines) {
            const orig = original.get(l.menuItemId);
            if (!orig) continue;
            const quantityChanged = orig.quantity !== l.quantity;
            const notesChanged = (orig.notes ?? '') !== (l.notes ?? '');
            const priceChanged = l.variablePrice && Number(orig.unitPrice) !== l.price;
            if (quantityChanged || notesChanged || priceChanged) {
              await updateOrderItem(serverOrder.id, orig.id, {
                ...(quantityChanged && { quantity: l.quantity }),
                ...(notesChanged && { notes: l.notes ?? '' }),
                ...(priceChanged && { unitPrice: l.price }),
              });
            }
          }
          for (const [menuItemId, orig] of original) if (!edited.has(menuItemId)) await removeItem(serverOrder.id, orig.id);
        } catch (e) {
          // Some changes may already have gone through — refresh so the list shows the truth.
          void queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
          setError(t('editOrder.someChangesNotSaved', { msg: e instanceof ApiError ? e.message : t('myOrders.somethingWentWrongTitle') }));
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['orders', 'mine'] });
      }

      // Print only what changed since the last time this order was sent to
      // the kitchen, not the whole order again — otherwise every edit would
      // look like a duplicate ticket for items already being cooked.
      const snapshotKey = kind === 'local' && localEntry ? localOrderKey(localEntry.clientRef) : kind === 'server' && serverOrder ? serverOrderKey(serverOrder.id) : null;
      if (snapshotKey) {
        const currentSnapshot: SnapshotLine[] = lines.map((l) => ({ menuItemId: l.menuItemId, name: l.name, category: l.category ?? 'Other', quantity: l.quantity, notes: l.notes || null }));
        const previous = await getPrintSnapshot(snapshotKey);
        const delta = diffAgainstSnapshot(currentSnapshot, previous);
        if (kitchen.enabled && (delta.added.length || delta.removed.length)) {
          const orderLabel = localEntry ? localEntry.display.label : serverOrder ? (serverOrder.type === 'DINE_IN' ? (serverOrder.table ? tableName(serverOrder.table) : 'Table') : (serverOrder.customerName ?? 'Takeaway')) : '';
          void kitchen.print({
            orderNumber: serverOrder?.orderNumber ?? null,
            waiter: localEntry?.display.waiter ?? serverOrder?.waiter?.name ?? userName,
            label: orderLabel,
            kind: 'update',
            isParcel,
            categories: groupByCategory([
              ...delta.added.map((l) => ({ qty: l.quantity, name: l.name, notes: l.notes, category: l.category })),
              ...delta.removed.map((l) => ({ qty: l.quantity, name: l.name, category: l.category, cancelled: true })),
            ]),
          });
        }
        await setPrintSnapshot(snapshotKey, currentSnapshot);
      }

      router.back();
    } finally {
      setSaving(false);
    }
  }

  const search_ = search.trim().toLowerCase();
  const results = menuItems.filter((m) => !search_ || m.name.toLowerCase().includes(search_)).slice(0, 30);
  const title = localEntry ? localEntry.display.label : serverOrder ? `Order #${serverOrder.orderNumber}` : t('editOrder.defaultTitle');
  const total = lines?.reduce((sum, l) => sum + (l.price ?? 0) * l.quantity, 0) ?? 0;

  if (!lines) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          {localEntry === undefined && serverOrder === undefined && !ordersQuery.isLoading ? (
            <>
              <ThemedText>{t('editOrder.orderNotFound')}</ThemedText>
              <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
                <ThemedText>{t('common.back')}</ThemedText>
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
              <ThemedText>{t('common.back')}</ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            {error && (
              <ThemedView style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </ThemedView>
            )}

            {orderType === 'DINE_IN' && (
              <>
                <ThemedText type="smallBold">{t('editOrder.tableSection')}</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
                  {tables.map((table) => {
                    const isCurrent = table.id === currentTableId;
                    const occupied = !!table.activeOrderId && !isCurrent;
                    return (
                      <Pressable
                        key={table.id}
                        onPress={() => !isCurrent && !occupied && confirmSwitchTable(table)}
                        disabled={isCurrent || occupied || switchingTable}
                        style={[styles.chip, isCurrent && styles.chipActive, occupied && styles.chipOccupied]}
                      >
                        <ThemedText style={isCurrent ? styles.chipTextActive : occupied ? styles.chipTextOccupied : undefined}>
                          {table.name?.trim() || `Table ${table.number}`}
                          {occupied ? ` · ${t('newOrder.tableOccupied')}` : ''}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <ThemedText type="smallBold">
              {t('editOrder.itemsOnOrder', { count: lines.length })}
            </ThemedText>
            {/* Capped and independently scrollable — otherwise a long order
                pushes the "Add items" search and results off screen. */}
            <ScrollView style={styles.itemsScroll} nestedScrollEnabled contentContainerStyle={styles.itemsScrollContent}>
              {lines.map((l) => {
                const noteOpen = openNotes.has(l.menuItemId) || !!l.notes;
                return (
                  <ThemedView key={l.menuItemId} type="backgroundElement" style={styles.itemBlock}>
                    <ThemedView type="backgroundElement" style={styles.row}>
                      <ThemedView type="backgroundElement" style={styles.rowName}>
                        <ThemedText>{l.name}</ThemedText>
                        {l.variablePrice && (
                          <ThemedView type="backgroundElement" style={styles.priceEditRow}>
                            <TextInput
                              value={l.priceText ?? ''}
                              onChangeText={(v) => changePrice(l.menuItemId, v)}
                              keyboardType="decimal-pad"
                              placeholder={t('common.marketPricePlaceholder')}
                              placeholderTextColor={theme.textSecondary}
                              style={[styles.priceInput, { color: theme.text, backgroundColor: theme.background }]}
                            />
                            <ThemedText themeColor="textSecondary" type="small">
                              = {fmt((l.price ?? 0) * l.quantity)}
                            </ThemedText>
                          </ThemedView>
                        )}
                      </ThemedView>
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
                    {noteOpen ? (
                      <TextInput
                        value={l.notes}
                        onChangeText={(v) => changeNotes(l.menuItemId, v)}
                        placeholder={t('common.notePlaceholder')}
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.noteInput, { color: theme.text, backgroundColor: theme.background }]}
                      />
                    ) : (
                      <Pressable onPress={() => toggleNotes(l.menuItemId)} style={styles.addNoteButton}>
                        <ThemedText themeColor="textSecondary" type="small">
                          {t('common.addNote')}
                        </ThemedText>
                      </Pressable>
                    )}
                  </ThemedView>
                );
              })}
            </ScrollView>

            <ThemedView type="backgroundElement" style={styles.totalRow}>
              <ThemedText type="smallBold">{t('common.total')}</ThemedText>
              <ThemedText type="smallBold">{fmt(total)}</ThemedText>
            </ThemedView>

            <ThemedText type="smallBold" style={styles.sectionGap}>
              {t('newOrder.addItemsSection')}
            </ThemedText>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('common.searchMenuPlaceholder')}
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
                      {Number(item.price) === 0 ? t('common.marketPricePlaceholder') : fmt(Number(item.price))}
                    </ThemedText>
                  </ThemedView>
                  <Pressable onPress={() => addLine(item)} style={styles.addButton}>
                    <ThemedText style={styles.addButtonText}>{t('common.add')}</ThemedText>
                  </Pressable>
                </ThemedView>
              )}
            />

            <Pressable onPress={save} disabled={saving} style={[styles.saveButton, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.saveText}>{t('editOrder.saveChanges')}</ThemedText>}
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <ThemedText themeColor="textSecondary">{t('common.cancel')}</ThemedText>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  rowName: { flex: 1 },
  chipRow: { flexGrow: 0, flexShrink: 0, minHeight: 48 },
  chipRowContent: { gap: Spacing.two, paddingVertical: Spacing.one, alignItems: 'center' },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Spacing.four, backgroundColor: 'rgba(128,128,128,0.15)' },
  chipActive: { backgroundColor: '#ea580c' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipOccupied: { opacity: 0.5 },
  chipTextOccupied: { fontStyle: 'italic' },
  itemBlock: { borderRadius: Spacing.three, overflow: 'hidden' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  priceEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: 2 },
  priceInput: { borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 4, fontSize: 13, minWidth: 70 },
  noteInput: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, fontSize: 13 },
  addNoteButton: { marginHorizontal: Spacing.three, marginBottom: Spacing.two },
  qtyControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  qtyButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(128,128,128,0.2)', alignItems: 'center', justifyContent: 'center' },
  qtyButtonText: { fontSize: 18, lineHeight: 20 },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  removeText: { color: '#dc2626', marginLeft: Spacing.two },
  sectionGap: { marginTop: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  itemsScroll: { maxHeight: 200, flexGrow: 0 },
  itemsScrollContent: { gap: Spacing.one },
  menuList: { flex: 1, minHeight: 180 },
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
