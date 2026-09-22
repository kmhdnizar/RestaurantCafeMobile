import { getDb } from '@/offline/db';

export interface SnapshotLine {
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  notes?: string | null;
}

interface Row {
  order_key: string;
  items: string;
}

/** Local-only key: distinguishes an order still queued on the phone from
 * one already on the server, since they're edited through different paths. */
export function localOrderKey(clientRef: string): string {
  return `local:${clientRef}`;
}
export function serverOrderKey(orderId: string): string {
  return `server:${orderId}`;
}

export async function getPrintSnapshot(orderKey: string): Promise<SnapshotLine[]> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM print_snapshot WHERE order_key = ?', [orderKey]);
  if (!row) return [];
  try {
    return JSON.parse(row.items) as SnapshotLine[];
  } catch {
    return [];
  }
}

export async function setPrintSnapshot(orderKey: string, items: SnapshotLine[]): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO print_snapshot (order_key, items, updated_at) VALUES (?, ?, ?)', [orderKey, JSON.stringify(items), Date.now()]);
}

export interface PrintDelta {
  added: SnapshotLine[];
  removed: SnapshotLine[];
}

/** Compares the order's current items against what was last sent to the
 * kitchen. Used after an edit so only the *change* prints — a new item, or
 * more of one already on the ticket — instead of the whole order again,
 * which would look like a duplicate to kitchen staff. A dropped or reduced
 * item comes back as a "removed" line so the kitchen knows to stop it. */
export function diffAgainstSnapshot(current: SnapshotLine[], snapshot: SnapshotLine[]): PrintDelta {
  const prevByItem = new Map(snapshot.map((l) => [l.menuItemId, l]));
  const currByItem = new Map(current.map((l) => [l.menuItemId, l]));

  const added: SnapshotLine[] = [];
  const removed: SnapshotLine[] = [];

  for (const line of current) {
    const prevQty = prevByItem.get(line.menuItemId)?.quantity ?? 0;
    if (line.quantity > prevQty) added.push({ ...line, quantity: line.quantity - prevQty });
  }
  for (const line of snapshot) {
    const currQty = currByItem.get(line.menuItemId)?.quantity ?? 0;
    if (line.quantity > currQty) removed.push({ ...line, quantity: line.quantity - currQty });
  }

  return { added, removed };
}
