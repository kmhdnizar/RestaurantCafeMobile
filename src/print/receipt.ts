// Customer receipt, printed on the same printer as kitchen tickets (per
// restaurant setup) — plain-width text since, unlike a kitchen ticket, it
// doesn't need to be readable from across a busy kitchen.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const LINE_WIDTH = 48;

const PAYMENT_LABEL: Record<string, string> = { CASH: 'Cash', QR: 'QR Pay', STAFF_FOOD: 'Staff Food' };

function toPrinterText(text: string): string {
  return text
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** "2x Fried Chicken Thai Sos" left, "RM 14.00" right, on one 48-char line —
 * or two lines if the name is too long to leave room for the price. */
function priceLine(left: string, right: string): string {
  const gap = LINE_WIDTH - left.length - right.length;
  if (gap >= 1) return left + ' '.repeat(gap) + right;
  return `${left}\n${' '.repeat(Math.max(0, LINE_WIDTH - right.length))}${right}`;
}

export interface ReceiptItem {
  qty: number;
  name: string;
  unitPrice: number;
}

export interface Receipt {
  restaurantName: string;
  orderNumber: number;
  label: string;
  waiter?: string | null;
  timestamp: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  formatMoney: (amount: number) => string;
}

export function buildReceiptBytes(receipt: Receipt): Uint8Array {
  const out: number[] = [];
  const encoder = new TextEncoder();
  const bytes = (...b: number[]) => out.push(...b);
  const line = (text: string) => out.push(...encoder.encode(toPrinterText(text)), LF);
  const dashed = () => line('-'.repeat(LINE_WIDTH));
  const center = () => bytes(ESC, 0x61, 0x01);
  const left = () => bytes(ESC, 0x61, 0x00);
  const bold = (on: boolean) => bytes(ESC, 0x45, on ? 0x01 : 0x00);
  const doubleWidth = (on: boolean) => bytes(GS, 0x21, on ? 0x11 : 0x00);

  bytes(ESC, 0x40); // initialize

  center();
  bold(true);
  doubleWidth(true);
  line(receipt.restaurantName);
  doubleWidth(false);
  bold(false);
  line('RECEIPT');
  dashed();

  left();
  line(`Order #${receipt.orderNumber} - ${receipt.label}`);
  if (receipt.waiter) line(`Served by: ${receipt.waiter}`);
  line(receipt.timestamp);
  dashed();

  for (const item of receipt.items) {
    const l = `${item.qty}x ${item.name}`;
    const r = receipt.formatMoney(item.unitPrice * item.qty);
    for (const row of priceLine(l, r).split('\n')) line(row);
  }
  dashed();

  line(priceLine('Subtotal', receipt.formatMoney(receipt.subtotal)));
  if (receipt.discount > 0) line(priceLine('Discount', `-${receipt.formatMoney(receipt.discount)}`));
  bold(true);
  doubleWidth(true);
  for (const row of priceLine('TOTAL', receipt.formatMoney(receipt.total)).split('\n')) line(row);
  doubleWidth(false);
  bold(false);
  line(`Payment: ${PAYMENT_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod}`);
  dashed();

  center();
  line('Thank you!');

  for (let i = 0; i < 3; i++) out.push(LF);
  bytes(GS, 0x56, 0x00); // full cut

  return Uint8Array.from(out);
}
