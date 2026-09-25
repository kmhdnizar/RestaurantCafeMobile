import { apiFetch } from "@/api/client";

export interface Bill {
  id: string;
  subtotal: string;
  discount: string;
  total: string;
  paymentMethod: "CASH" | "QR" | "STAFF_FOOD";
  paidAt: string | null;
  order: {
    id: string;
    orderNumber: number;
    type: "DINE_IN" | "TAKEAWAY";
    customerName: string | null;
    table: { number: number; name: string | null } | null;
    waiter: { id: string; name: string } | null;
    items: { id: string; quantity: number; unitPrice: string; menuItem: { id: string; name: string } }[];
  };
}

/** Marks an order paid and served. Only allowed for staff whose role has the
 * "/billing" "create_bill" permission — same rule as the web dashboard.
 * `discount` is already supported server-side (used by the web billing
 * page) — this was just never wired up from the mobile app. Ignored (forced
 * to 100%) when paymentMethod is STAFF_FOOD. */
export async function createBill(orderId: string, paymentMethod: Bill["paymentMethod"], discount?: number): Promise<Bill> {
  return apiFetch<Bill>("/api/bills", { method: "POST", body: { orderId, paymentMethod, discount } });
}
