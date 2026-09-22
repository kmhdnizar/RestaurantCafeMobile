// Ported from the Android bridge's EscPosTicketBuilder.kt
// (printer-app/.../EscPosTicketBuilder.kt in the web app repo) so mobile
// tickets look similar: one section per menu category, each ending in a
// real paper-cut command. Keep the two in sync by hand.

import { toPrinterText } from '@/print/printer-text';

export interface TicketCategory {
  name: string;
  items: { qty: number; name: string; notes?: string | null; cancelled?: boolean }[];
}

export interface Ticket {
  /** Server-assigned number; null while the order is still only on this phone. */
  orderNumber: number | null;
  label: string;
  /** Who took the order. */
  waiter?: string | null;
  /** "new" (default) for a fresh order; "update" for a delta ticket printed
   * after editing an order the kitchen already has. */
  kind?: 'new' | 'update';
  /** True for a takeaway/parcel order — banner printed at the top of every
   * category slip so kitchen staff know to pack it, even if they only see
   * one slip out of the set. */
  isParcel?: boolean;
  timestamp: string;
  categories: TicketCategory[];
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// The kitchen printer's paper is 48 characters wide at normal size.
const LINE_WIDTH = 48;

export function buildTicketBytes(ticket: Ticket): Uint8Array {
  const out: number[] = [];
  const encoder = new TextEncoder();

  const bytes = (...b: number[]) => out.push(...b);
  const line = (text: string) => {
    out.push(...encoder.encode(toPrinterText(text)), LF);
  };
  const dashed = () => line('-'.repeat(LINE_WIDTH));

  bytes(ESC, 0x40); // initialize printer

  for (const category of ticket.categories) {
    bytes(ESC, 0x61, 0x01); // center
    if (ticket.isParcel) {
      bytes(ESC, 0x45, 0x01); // bold
      bytes(GS, 0x21, 0x11); // double size
      line('*** PARCEL ***');
      bytes(GS, 0x21, 0x00);
      bytes(ESC, 0x45, 0x00);
    }
    bytes(ESC, 0x45, 0x01); // bold on
    bytes(GS, 0x21, 0x11); // double size
    line(category.name);
    bytes(GS, 0x21, 0x00); // normal size
    bytes(ESC, 0x45, 0x00); // bold off
    line('KITCHEN COPY');
    dashed();

    bytes(ESC, 0x61, 0x00); // left align
    bytes(ESC, 0x45, 0x01);
    const heading = ticket.kind === 'update' ? 'ORDER UPDATE' : ticket.orderNumber !== null ? `Order #${ticket.orderNumber}` : 'NEW ORDER';
    line(`${heading} - ${ticket.label}`);
    bytes(ESC, 0x45, 0x00);
    if (ticket.waiter) line(`Waiter: ${ticket.waiter}`);
    line(ticket.timestamp);
    dashed();

    for (const item of category.items) {
      // Large, easy to read from a distance in a busy kitchen — but
      // double-width only fits 24 characters per line, and the printer
      // wraps mid-word rather than dropping text if a line runs over.
      // Long names fall back to double-height only, which keeps the full
      // 48-character width.
      const prefix = item.cancelled ? 'CANCEL ' : '';
      const itemLine = `${prefix}${item.qty}x ${item.name}`;
      const fitsDoubleWidth = itemLine.length <= LINE_WIDTH / 2;
      bytes(ESC, 0x45, 0x01); // bold
      bytes(GS, 0x21, fitsDoubleWidth ? 0x11 : 0x01); // double width+height, or height only
      line(itemLine);
      bytes(GS, 0x21, 0x00);
      bytes(ESC, 0x45, 0x00);
      if (item.notes && item.notes.trim()) {
        bytes(ESC, 0x45, 0x01);
        bytes(GS, 0x21, 0x01); // double height
        line(`  Note: ${item.notes}`);
        bytes(GS, 0x21, 0x00);
        bytes(ESC, 0x45, 0x00);
      }
    }

    // The cutter sits a fixed distance below the print head; 3 blank lines
    // wasn't enough clearance on the actual printer used for testing and
    // the cut landed on/through the last printed line. 8 gives a safe margin.
    for (let i = 0; i < 8; i++) out.push(LF); // feed
    bytes(GS, 0x56, 0x00); // full cut
  }

  return Uint8Array.from(out);
}

/** Groups flat order lines by menu category, sorted by category name —
 * matches groupKitchenTicketItems() in the web app. */
export function groupByCategory(
  lines: { qty: number; name: string; notes?: string | null; category: string; cancelled?: boolean }[]
): TicketCategory[] {
  const groups = new Map<string, TicketCategory>();
  for (const l of lines) {
    if (!groups.has(l.category)) groups.set(l.category, { name: l.category, items: [] });
    groups.get(l.category)!.items.push({ qty: l.qty, name: l.name, notes: l.notes, cancelled: l.cancelled });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
