import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { tableName } from '@/lib/format';
import { useOrderableMenu } from '@/hooks/use-orderable-menu';
import { useCartStore, cartTotal } from '@/state/cart-store';
import { enqueueOrder } from '@/offline/outbox';
import { flushOutbox } from '@/offline/sync-engine';
import { useOutboxStore } from '@/state/outbox-store';
import { useSessionStore } from '@/state/session-store';
import { useKitchenPrinter } from '@/print/use-kitchen-printer';
import { groupByCategory } from '@/print/escpos';
import { localOrderKey, setPrintSnapshot } from '@/offline/print-snapshot';

export default function NewOrderScreen() {
  const theme = useTheme();
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const userName = useSessionStore((s) => s.user?.name ?? null);

  const { items: visibleItems, tables: activeTables, fmt, loading } = useOrderableMenu();

  const kitchen = useKitchenPrinter();
  const cart = useCartStore();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of visibleItems) seen.set(item.category.id, item.category.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [visibleItems]);

  const filteredItems = visibleItems.filter((item) => {
    if (activeCategory && item.category.id !== activeCategory) return false;
    if (search.trim() && !item.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  async function handleSubmit() {
    setError(null);
    if (cart.lines.length === 0) {
      setError('Add at least one item.');
      return;
    }
    if (cart.orderType === 'DINE_IN' && !cart.tableId) {
      setError('Select a table.');
      return;
    }
    if (cart.orderType === 'TAKEAWAY' && !cart.customerName.trim()) {
      setError('Enter a customer name.');
      return;
    }
    if (!userId) return;
    setSubmitting(true);
    try {
      // Always saved on the phone first, then sent in the background — one
      // code path whether or not there's a connection right now.
      const table = activeTables.find((t) => t.id === cart.tableId);
      const clientRef = await enqueueOrder(
        userId,
        {
          type: cart.orderType,
          tableId: cart.orderType === 'DINE_IN' ? cart.tableId : undefined,
          customerName: cart.orderType === 'TAKEAWAY' ? cart.customerName.trim() : undefined,
          notes: cart.notes || undefined,
          items: cart.lines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            notes: l.notes || undefined,
            unitPrice: l.variablePrice ? l.price : undefined,
          })),
        },
        {
          label: cart.orderType === 'DINE_IN' ? (table ? tableName(table) : 'Table') : cart.customerName.trim(),
          waiter: userName ?? undefined,
          lines: cart.lines.map((l) => ({ name: l.name, quantity: l.quantity, category: l.category, price: l.price })),
        }
      );
      // Built from the cart before it is cleared. Printed straight away from
      // this data — it doesn't wait for the order to reach the server, so
      // the kitchen gets the ticket even when the internet is down.
      const ticketBody = {
        orderNumber: null,
        waiter: userName,
        label: cart.orderType === 'DINE_IN' ? (table ? tableName(table) : 'Table') : cart.customerName.trim(),
        isParcel: cart.orderType === 'TAKEAWAY',
        categories: groupByCategory(cart.lines.map((l) => ({ qty: l.quantity, name: l.name, notes: l.notes || null, category: l.category }))),
      };
      // Record what's been sent so a later edit only prints the *change*,
      // not the whole order again.
      void setPrintSnapshot(
        localOrderKey(clientRef),
        cart.lines.map((l) => ({ menuItemId: l.menuItemId, name: l.name, category: l.category, quantity: l.quantity, notes: l.notes || null }))
      );
      cart.reset();
      await useOutboxStore.getState().refresh(userId);
      void flushOutbox();
      if (kitchen.enabled) void kitchen.print(ticketBody);
    } catch {
      setError('Could not save the order on this phone. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ThemedText type="subtitle" style={styles.title}>
          New Order
        </ThemedText>

        {/* Order type */}
        <ThemedView style={styles.segmented}>
          {(['DINE_IN', 'TAKEAWAY'] as const).map((t) => (
            <Pressable key={t} onPress={() => cart.setOrderType(t)} style={[styles.segment, cart.orderType === t && styles.segmentActive]}>
              <ThemedText style={cart.orderType === t ? styles.segmentTextActive : undefined}>{t === 'DINE_IN' ? 'Dine-in' : 'Takeaway'}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        {cart.orderType === 'DINE_IN' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
            {activeTables.map((table) => (
              <Pressable key={table.id} onPress={() => cart.setTableId(table.id)} style={[styles.chip, cart.tableId === table.id && styles.chipActive]}>
                <ThemedText style={cart.tableId === table.id ? styles.chipTextActive : undefined}>{table.name?.trim() || `Table ${table.number}`}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <TextInput
            value={cart.customerName}
            onChangeText={cart.setCustomerName}
            placeholder="Customer name"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        )}

        {error && (
          <ThemedView style={styles.errorBox}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </ThemedView>
        )}

        {cart.lines.length > 0 && (
          <>
            <ThemedText type="smallBold">
              Items in this order ({cart.lines.reduce((n, l) => n + l.quantity, 0)})
            </ThemedText>
            {/* Capped and independently scrollable — otherwise a long order
                pushes the "Add items" search and results off screen. */}
            <ScrollView style={styles.itemsScroll} nestedScrollEnabled contentContainerStyle={styles.itemsScrollContent}>
              {cart.lines.map((line) => (
                <ThemedView key={line.menuItemId} type="backgroundElement" style={styles.itemBlock}>
                  <ThemedView type="backgroundElement" style={styles.menuRow}>
                    <ThemedView type="backgroundElement" style={styles.menuRowInfo}>
                      <ThemedText type="smallBold">{line.name}</ThemedText>
                      {line.variablePrice ? (
                        <ThemedView type="backgroundElement" style={styles.priceEditRow}>
                          <ThemedText themeColor="textSecondary" type="small">
                            Market price:
                          </ThemedText>
                          <TextInput
                            value={line.priceText}
                            onChangeText={(v) => cart.setLinePrice(line.menuItemId, v)}
                            keyboardType="decimal-pad"
                            placeholder="0.00"
                            placeholderTextColor={theme.textSecondary}
                            style={[styles.priceInput, { color: theme.text, backgroundColor: theme.background }]}
                          />
                        </ThemedView>
                      ) : (
                        <ThemedText themeColor="textSecondary" type="small">
                          {fmt(line.price * line.quantity)}
                        </ThemedText>
                      )}
                    </ThemedView>
                    <ThemedView type="backgroundElement" style={styles.qtyControl}>
                      <Pressable onPress={() => cart.updateQuantity(line.menuItemId, -1)} style={styles.qtyButton}>
                        <ThemedText style={styles.qtyButtonText}>−</ThemedText>
                      </Pressable>
                      <ThemedText style={styles.qtyValue}>{line.quantity}</ThemedText>
                      <Pressable onPress={() => cart.updateQuantity(line.menuItemId, 1)} style={styles.qtyButton}>
                        <ThemedText style={styles.qtyButtonText}>+</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => cart.removeItem(line.menuItemId)}>
                        <ThemedText style={styles.removeText}>✕</ThemedText>
                      </Pressable>
                    </ThemedView>
                  </ThemedView>
                  <TextInput
                    value={line.notes}
                    onChangeText={(v) => cart.setLineNotes(line.menuItemId, v)}
                    placeholder="Note for this item (size, allergy, extra request…)"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.noteInput, { color: theme.text, backgroundColor: theme.background }]}
                  />
                </ThemedView>
              ))}
            </ScrollView>

            <TextInput
              value={cart.notes}
              onChangeText={cart.setNotes}
              placeholder="Order notes (optional)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            <ThemedView type="backgroundElement" style={styles.totalRow}>
              <ThemedText type="smallBold">Total</ThemedText>
              <ThemedText type="smallBold">{fmt(cartTotal(cart.lines))}</ThemedText>
            </ThemedView>
          </>
        )}

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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          <Pressable onPress={() => setActiveCategory(null)} style={[styles.chip, activeCategory === null && styles.chipActive]}>
            <ThemedText style={activeCategory === null ? styles.chipTextActive : undefined}>All</ThemedText>
          </Pressable>
          {categories.map((c) => (
            <Pressable key={c.id} onPress={() => setActiveCategory(c.id)} style={[styles.chip, activeCategory === c.id && styles.chipActive]}>
              <ThemedText style={activeCategory === c.id ? styles.chipTextActive : undefined}>{c.name}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {loading && <ActivityIndicator style={styles.loading} />}

        <FlatList
          style={styles.menuFlex}
          data={filteredItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.menuList}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const line = cart.lines.find((l) => l.menuItemId === item.id);
            return (
              <ThemedView type="backgroundElement" style={styles.menuRow}>
                <ThemedView type="backgroundElement" style={styles.menuRowInfo}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {Number(item.price) === 0 ? 'Market price' : fmt(Number(item.price))}
                  </ThemedText>
                </ThemedView>
                {line ? (
                  <ThemedView type="backgroundElement" style={styles.qtyControl}>
                    <Pressable onPress={() => cart.updateQuantity(item.id, -1)} style={styles.qtyButton}>
                      <ThemedText style={styles.qtyButtonText}>−</ThemedText>
                    </Pressable>
                    <ThemedText style={styles.qtyValue}>{line.quantity}</ThemedText>
                    <Pressable onPress={() => cart.updateQuantity(item.id, 1)} style={styles.qtyButton}>
                      <ThemedText style={styles.qtyButtonText}>+</ThemedText>
                    </Pressable>
                  </ThemedView>
                ) : (
                  <Pressable onPress={() => cart.addItem(item)} style={styles.addButton}>
                    <ThemedText style={styles.addButtonText}>Add</ThemedText>
                  </Pressable>
                )}
              </ThemedView>
            );
          }}
          ListEmptyComponent={!loading ? <ThemedText themeColor="textSecondary">No items match right now.</ThemedText> : null}
        />

        <Pressable onPress={handleSubmit} disabled={submitting || cart.lines.length === 0} style={[styles.submitButton, (submitting || cart.lines.length === 0) && styles.submitButtonDisabled]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.submitButtonText}>Place Order</ThemedText>}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three, gap: Spacing.two },
  title: { marginTop: Spacing.two },
  segmented: { flexDirection: 'row', gap: Spacing.two },
  segment: { flex: 1, paddingVertical: Spacing.two, borderRadius: Spacing.two, alignItems: 'center', backgroundColor: 'rgba(128,128,128,0.15)' },
  segmentActive: { backgroundColor: '#ea580c' },
  segmentTextActive: { color: '#fff', fontWeight: '600' },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  chipRow: { flexGrow: 0, flexShrink: 0, minHeight: 48 },
  chipRowContent: { gap: Spacing.two, paddingVertical: Spacing.one, alignItems: 'center' },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Spacing.four, backgroundColor: 'rgba(128,128,128,0.15)' },
  chipActive: { backgroundColor: '#ea580c' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  loading: { marginTop: Spacing.four },
  menuFlex: { flex: 1 },
  menuList: { gap: Spacing.two, paddingBottom: Spacing.four },
  menuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.three },
  menuRowInfo: { flex: 1 },
  itemBlock: { borderRadius: Spacing.three, overflow: 'hidden' },
  itemsScroll: { maxHeight: 220, flexGrow: 0 },
  itemsScrollContent: { gap: Spacing.two },
  priceEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: 2 },
  priceInput: { borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: 4, fontSize: 13, minWidth: 70 },
  noteInput: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, fontSize: 13 },
  addButton: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  addButtonText: { color: '#fff', fontWeight: '600' },
  qtyControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  qtyButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(128,128,128,0.2)', alignItems: 'center', justifyContent: 'center' },
  qtyButtonText: { fontSize: 18, lineHeight: 20 },
  qtyValue: { minWidth: 20, textAlign: 'center' },
  removeText: { color: '#dc2626', marginLeft: Spacing.two },
  sectionGap: { marginTop: Spacing.two },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  errorBox: { backgroundColor: '#fee2e2', borderRadius: Spacing.two, padding: Spacing.three },
  errorText: { color: '#dc2626' },
  submitButton: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
