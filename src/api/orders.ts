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
}

export async function fetchMyOrders(): Promise<OrderSummary[]> {
  return apiFetch<OrderSummary[]>("/api/orders?mine=true");
}

export interface CreateOrderInput {
  type: "DINE_IN" | "TAKEAWAY";
  tableId?: string;
  customerName?: string;
  notes?: string;
  items: { menuItemId: string; quantity: number; notes?: string }[];
  /** Idempotency key: the server returns the existing order instead of creating a duplicate. */
  clientRef?: string;
}

export async function createOrder(input: CreateOrderInput): Promise<OrderSummary> {
  return apiFetch<OrderSummary>("/api/orders", { method: "POST", body: input });
}

// Item-level edits on an order that already exists on the server. These match
// what the web dashboard does: quantity is set absolutely, and adding an item
// that is already on the order increases its quantity.
export async function setItemQuantity(orderId: string, itemId: string, quantity: number): Promise<void> {
  await apiFetch(`/api/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: { quantity } });
}

export async function removeItem(orderId: string, itemId: string): Promise<void> {
  await apiFetch(`/api/orders/${orderId}/items/${itemId}`, { method: "DELETE" });
}

export async function addItem(orderId: string, menuItemId: string, quantity: number): Promise<void> {
  await apiFetch(`/api/orders/${orderId}/items`, { method: "POST", body: { menuItemId, quantity } });
}
