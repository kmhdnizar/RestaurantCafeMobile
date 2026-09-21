// Ported from the Android bridge's EscPosTicketBuilder.kt
// (printer-app/.../EscPosTicketBuilder.kt in the web app repo) so mobile
// tickets look identical: one section per menu category, each ending in a
// real paper-cut command. Keep the two in sync by hand.

export interface TicketCategory {
  name: string;
  items: { qty: number; name: string; notes?: string | null }[];
}

export interface Ticket {
  /** Server-assigned number; null while the order is still only on this phone. */
  orderNumber: number | null;
  label: string;
  timestamp: string;
  categories: TicketCategory[];
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export function buildTicketBytes(ticket: Ticket): Uint8Array {
  const out: number[] = [];
  const encoder = new TextEncoder();

  const bytes = (...b: number[]) => out.push(...b);
  const line = (text: string) => {
    out.push(...encoder.encode(text), LF);
  };
  const dashed = () => line('-'.repeat(32));

  bytes(ESC, 0x40); // initialize printer

  for (const category of ticket.categories) {
    bytes(ESC, 0x61, 0x01); // center
    bytes(ESC, 0x45, 0x01); // bold on
    bytes(GS, 0x21, 0x11); // double size
    line(category.name);
    bytes(GS, 0x21, 0x00); // normal size
    bytes(ESC, 0x45, 0x00); // bold off
    line('KITCHEN COPY');
    dashed();

    bytes(ESC, 0x61, 0x00); // left align
    bytes(ESC, 0x45, 0x01);
    line(ticket.orderNumber !== null ? `Order #${ticket.orderNumber} — ${ticket.label}` : `NEW ORDER — ${ticket.label}`);
    bytes(ESC, 0x45, 0x00);
    line(ticket.timestamp);
    dashed();

    for (const item of category.items) {
      bytes(ESC, 0x45, 0x01);
      line(`${item.qty}x ${item.name}`);
      bytes(ESC, 0x45, 0x00);
      if (item.notes && item.notes.trim()) line(`  Note: ${item.notes}`);
    }

    for (let i = 0; i < 3; i++) out.push(LF); // feed
    bytes(GS, 0x56, 0x00); // full cut
  }

  return Uint8Array.from(out);
}

/** Groups flat order lines by menu category, sorted by category name —
 * matches groupKitchenTicketItems() in the web app. */
export function groupByCategory(lines: { qty: number; name: string; notes?: string | null; category: string }[]): TicketCategory[] {
  const groups = new Map<string, TicketCategory>();
  for (const l of lines) {
    if (!groups.has(l.category)) groups.set(l.category, { name: l.category, items: [] });
    groups.get(l.category)!.items.push({ qty: l.qty, name: l.name, notes: l.notes });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
