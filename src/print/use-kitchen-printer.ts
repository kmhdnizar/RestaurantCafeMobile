import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { fetchConfig } from '@/api/menu';
import type { OrderSummary } from '@/api/orders';
import type { OutboxEntry } from '@/offline/outbox';
import { buildTicketBytes, groupByCategory, type Ticket } from '@/print/escpos';
import { sendToPrinter } from '@/print/printer-client';

type TicketBody = Omit<Ticket, 'timestamp'>;

export function ticketFromOutboxEntry(entry: OutboxEntry): TicketBody {
  return {
    orderNumber: null,
    label: entry.display.label,
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
    label: order.type === 'DINE_IN' ? (order.table?.name?.trim() || `Table ${order.table?.number ?? '?'}`) : (order.customerName ?? 'Takeaway'),
    categories: groupByCategory(
      order.items.map((it) => ({ qty: it.quantity, name: it.menuItem.name, notes: it.notes, category: it.menuItem.category?.name ?? 'Other' }))
    ),
  };
}

/** Prints kitchen tickets straight to the restaurant's printer over WiFi.
 * `enabled` is false until the restaurant has turned on kitchen tickets and
 * set the printer's IP address in the web app's Settings. */
export function useKitchenPrinter() {
  const config = useQuery({ queryKey: ['config'], queryFn: fetchConfig }).data;
  const address = config?.kitchenPrinterAddress ?? null;
  const enabled = Boolean(config?.printOrdersByCategory && address);
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

  return { enabled, printing, print };
}
