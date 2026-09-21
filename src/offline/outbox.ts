import * as Crypto from 'expo-crypto';

import { getDb } from '@/offline/db';
import type { CreateOrderInput } from '@/api/orders';

export type OutboxStatus = 'pending' | 'syncing' | 'failed';

/** What My Orders shows for an order that hasn't reached the server yet —
 * captured at save time so no menu lookup is needed later. */
export interface OutboxDisplay {
  label: string;
  lines: { name: string; quantity: number; category?: string }[];
}

export interface OutboxEntry {
  clientRef: string;
  userId: string;
  payload: CreateOrderInput;
  display: OutboxDisplay;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

interface Row {
  client_ref: string;
  user_id: string;
  payload: string;
  display: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: number;
}

function fromRow(r: Row): OutboxEntry {
  return {
    clientRef: r.client_ref,
    userId: r.user_id,
    payload: JSON.parse(r.payload) as CreateOrderInput,
    display: JSON.parse(r.display) as OutboxDisplay,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

/** Saves an order locally. The clientRef is generated here, before any
 * network attempt, and sent to the server as an idempotency key — so a retry
 * after a lost response can never create a duplicate order. */
export async function enqueueOrder(userId: string, payload: CreateOrderInput, display: OutboxDisplay): Promise<string> {
  const db = await getDb();
  const clientRef = Crypto.randomUUID();
  await db.runAsync(
    'INSERT INTO outbox (client_ref, user_id, payload, display, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    [clientRef, userId, JSON.stringify(payload), JSON.stringify(display), 'pending', Date.now()]
  );
  return clientRef;
}

/** Only this user's entries — a different waiter signing in on the same
 * phone must never send (or see) someone else's queued orders. */
export async function listOutbox(userId: string): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM outbox WHERE user_id = ? ORDER BY created_at ASC', [userId]);
  return rows.map(fromRow);
}

export async function listPending(userId: string): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>("SELECT * FROM outbox WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC", [userId]);
  return rows.map(fromRow);
}

export async function markSyncing(clientRef: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE outbox SET status = 'syncing', attempts = attempts + 1 WHERE client_ref = ?", [clientRef]);
}

export async function markPending(clientRef: string, lastError: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE outbox SET status = 'pending', last_error = ? WHERE client_ref = ?", [lastError, clientRef]);
}

export async function markFailed(clientRef: string, lastError: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE outbox SET status = 'failed', last_error = ? WHERE client_ref = ?", [lastError, clientRef]);
}

export async function removeEntry(clientRef: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE client_ref = ?', [clientRef]);
}

/** If the app was killed mid-send, those entries are stuck as 'syncing'.
 * Putting them back to 'pending' is safe because the idempotency key makes
 * a resend a no-op if the server already received it. */
export async function resetStuckSyncing(): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE outbox SET status = 'pending' WHERE status = 'syncing'");
}

/** Edits the items of an order that is still queued on the phone. Only
 * works while the entry is 'pending' — once it is being sent or has been
 * refused it can't safely change, and the caller is told so. */
export async function updateQueuedOrderItems(clientRef: string, items: CreateOrderInput['items'], display: OutboxDisplay): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>("SELECT * FROM outbox WHERE client_ref = ? AND status = 'pending'", [clientRef]);
  if (!row) return false;
  const payload: CreateOrderInput = { ...(JSON.parse(row.payload) as CreateOrderInput), items };
  const result = await db.runAsync("UPDATE outbox SET payload = ?, display = ? WHERE client_ref = ? AND status = 'pending'", [
    JSON.stringify(payload),
    JSON.stringify(display),
    clientRef,
  ]);
  return result.changes > 0;
}
