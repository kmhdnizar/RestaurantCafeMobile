import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { fetchConfig } from '@/api/menu';
import type { OrderSummary } from '@/api/orders';
import type { OutboxEntry } from '@/offline/outbox';
import { tableName } from '@/lib/format';
import { buildTicketBytes, groupByCategory, type Ticket } from '@/print/escpos';
import { buildReceiptBytes, type Receipt } from '@/print/receipt';
import { sendToPrinter } from '@/print/printer-client';

type TicketBody = Omit<Ticket, 'timestamp'>;

export function ticketFromOutboxEntry(entry: OutboxEntry): TicketBody {
  return {
    orderNumber: null,
    label: entry.display.label,
    waiter: entry.display.waiter ?? null,
    isParcel: entry.payload.type === 'TAKEAWAY',
    categories: groupByCategory(
      entry.payload.items.map((it, i) => ({
        qty: it.quantity,
        name: entry.display.lines[i]?.name ?? 'Item',
        notes: it.notes,
        category: entry.display.lines[i]?.category ?? 'Other',
      }))
    ),
  };
}

export function ticketFromServerOrder(order: OrderSummary): TicketBody {
  return {
    orderNumber: order.orderNumber,
    waiter: order.waiter?.name ?? null,
    label: order.type === 'DINE_IN' ? (order.table?.name?.trim() || `Table ${order.table?.number ?? '?'}`) : (order.customerName ?? 'Takeaway'),
    isParcel: order.type === 'TAKEAWAY',
    categories: groupByCategory(
      order.items.map((it) => ({ qty: it.quantity, name: it.menuItem.name, notes: it.notes, category: it.menuItem.category?.name ?? 'Other' }))
    ),
  };
}

/** Builds a customer-facing copy for an order — the real bill's numbers once
 * it's been completed (a true reprint, matching what was actually charged),
 * or a provisional one straight from the current items before then (no
 * discount or payment yet, so it prints as a "BILL" rather than a
 * "RECEIPT") — e.g. to show a customer their tally at the table before they
 * ask to pay. */
export function receiptFromServerOrder(order: OrderSummary, restaurantName: string, formatMoney: (n: number) => string): Omit<Receipt, 'timestamp'> {
  const label = order.type === 'DINE_IN' ? (order.table ? tableName(order.table) : 'Table') : (order.customerName ?? 'Takeaway');
  const items = order.items.map((it) => ({ qty: it.quantity, name: it.menuItem.name, unitPrice: Number(it.unitPrice) }));
  if (order.bill) {
    return {
      restaurantName,
      orderNumber: order.orderNumber,
      label,
      waiter: order.waiter?.name,
      items,
      subtotal: Number(order.bill.subtotal),
      discount: Number(order.bill.discount),
      total: Number(order.bill.total),
      paymentMethod: order.bill.paymentMethod,
      formatMoney,
    };
  }
  const subtotal = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);
  return {
    restaurantName,
    orderNumber: order.orderNumber,
    label,
    waiter: order.waiter?.name,
    items,
    subtotal,
    discount: 0,
    total: subtotal,
    formatMoney,
  };
}

/** Prints kitchen tickets straight to the restaurant's printer over WiFi.
 * `enabled` is false until the restaurant has turned on kitchen tickets and
 * set the printer's IP address in the web app's Settings. */
export function useKitchenPrinter() {
  const config = useQuery({ queryKey: ['config'], queryFn: fetchConfig }).data;
  const address = config?.kitchenPrinterAddress ?? null;
  const enabled = Boolean(config?.printOrdersByCategory && address);
  // Receipts are gated only on a printer address being configured — not on
  // the kitchen-ticket-by-category toggle, since billing is a separate
  // concern from how kitchen tickets are grouped.
  const canPrintReceipts = Boolean(address);
  const timezone = config?.timezone ?? 'UTC';
  const [printing, setPrinting] = useState(false);

  const print = useCallback(
    async (body: TicketBody): Promise<boolean> => {
      if (!enabled || !address) return false;
      setPrinting(true);
      try {
        const timestamp = new Date().toLocaleString('en-US', { timeZone: timezone });
        await sendToPrinter(address, buildTicketBytes({ ...body, timestamp }));
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown printer error.';
        Alert.alert('Kitchen ticket did not print', message, [
          { text: 'Close', style: 'cancel' },
          { text: 'Try again', onPress: () => void print(body) },
        ]);
        return false;
      } finally {
        setPrinting(false);
      }
    },
    [enabled, address, timezone]
  );

  const printReceipt = useCallback(
    async (body: Omit<Receipt, 'timestamp'>): Promise<boolean> => {
      if (!canPrintReceipts || !address) return false;
      setPrinting(true);
      try {
        const timestamp = new Date().toLocaleString('en-US', { timeZone: timezone });
        await sendToPrinter(address, buildReceiptBytes({ ...body, timestamp }));
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown printer error.';
        Alert.alert('Receipt did not print', message, [
          { text: 'Close', style: 'cancel' },
          { text: 'Try again', onPress: () => void printReceipt(body) },
        ]);
        return false;
      } finally {
        setPrinting(false);
      }
    },
    [canPrintReceipts, address, timezone]
  );

  return { enabled, canPrintReceipts, printing, print, printReceipt };
}
