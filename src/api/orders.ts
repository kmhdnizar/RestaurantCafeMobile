import { apiFetch } from "@/api/client";

export interface OrderSummary {
  id: string;
  orderNumber: number;
  type: "DINE_IN" | "TAKEAWAY";
  status: "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
  customerName: string | null;
  table: { number: number; name: string | null } | null;
  waiter: { id: string; name: string } | null;
  items: { id: string; quantity: number; unitPrice: string; notes: string | null; menuItem: { id: string; name: string; category?: { id: string; name: string } } }[];
  createdAt: string;
  // Already included by the server response — was just untyped here.
  // Present once the order has been completed (see api/bills.ts).
  bill: { id: string; subtotal: string; discount: string; total: string; paymentMethod: "CASH" | "QR" | "STAFF_FOOD"; paidAt: string | null } | null;
}

export interface FetchOrdersParams {
  /** Force "just my own orders" even for a role that can otherwise see the
   * whole restaurant (Manager/Cashier/Admin) — always true for Waiter. */
  mine?: boolean;
  /** Restrict to one local calendar date (YYYY-MM-DD), interpreted in `tz`. */
  date?: string;
  tz?: string;
}

export async function fetchOrders(params: FetchOrdersParams = {}): Promise<OrderSummary[]> {
  const qs = new URLSearchParams();
  if (params.mine) qs.set("mine", "true");
  if (params.date) qs.set("date", params.date);
  if (params.tz) qs.set("tz", params.tz);
  const query = qs.toString();
  return apiFetch<OrderSummary[]>(`/api/orders${query ? `?${query}` : ""}`);
}

export interface CreateOrderInput {
  type: "DINE_IN" | "TAKEAWAY";
  tableId?: string;
  customerName?: string;
  notes?: string;
  items: {
    menuItemId: string;
    quantity: number;
    notes?: string;
    /** Only honored server-side when the menu item's own listed price is RM0. */
    unitPrice?: number;
  }[];
  /** Idempotency key: the server returns the existing order instead of creating a duplicate. */
  clientRef?: string;
}

export async function createOrder(input: CreateOrderInput): Promise<OrderSummary> {
  return apiFetch<OrderSummary>("/api/orders", { method: "POST", body: input });
}

// Item-level edits on an order that already exists on the server. These match
// what the web dashboard does: quantity is set absolutely, and adding an item
// that is already on the order increases its quantity.
export async function updateOrderItem(orderId: string, itemId: string, changes: { quantity?: number; notes?: string; unitPrice?: number }): Promise<void> {
  await apiFetch(`/api/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: changes });
}

export async function removeItem(orderId: string, itemId: string): Promise<void> {
  await apiFetch(`/api/orders/${orderId}/items/${itemId}`, { method: "DELETE" });
}

export async function addItem(orderId: string, input: { menuItemId: string; quantity: number; notes?: string; unitPrice?: number }): Promise<void> {
  await apiFetch(`/api/orders/${orderId}/items`, { method: "POST", body: input });
}
