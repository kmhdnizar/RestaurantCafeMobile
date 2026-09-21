import { apiFetch } from "@/api/client";

export interface OrderSummary {
  id: string;
  orderNumber: number;
  type: "DINE_IN" | "TAKEAWAY";
  status: "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
  customerName: string | null;
  table: { number: number; name: string | null } | null;
  items: { id: string; quantity: number; menuItem: { name: string } }[];
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
