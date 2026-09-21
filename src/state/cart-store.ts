import { create } from "zustand";

export interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  category: string;
  quantity: number;
  notes: string;
}

interface CartState {
  orderType: "DINE_IN" | "TAKEAWAY";
  tableId: string;
  customerName: string;
  notes: string;
  lines: CartLine[];
  setOrderType: (t: "DINE_IN" | "TAKEAWAY") => void;
  setTableId: (id: string) => void;
  setCustomerName: (name: string) => void;
  setNotes: (notes: string) => void;
  addItem: (item: { id: string; name: string; price: string; category: { name: string } }) => void;
  updateQuantity: (menuItemId: string, delta: number) => void;
  removeItem: (menuItemId: string) => void;
  reset: () => void;
}

const initial = {
  orderType: "DINE_IN" as const,
  tableId: "",
  customerName: "",
  notes: "",
  lines: [] as CartLine[],
};

export const useCartStore = create<CartState>((set) => ({
  ...initial,

  setOrderType: (orderType) => set({ orderType }),
  setTableId: (tableId) => set({ tableId }),
  setCustomerName: (customerName) => set({ customerName }),
  setNotes: (notes) => set({ notes }),

  addItem: (item) =>
    set((state) => {
      const existing = state.lines.find((l) => l.menuItemId === item.id);
      if (existing) {
        return { lines: state.lines.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l)) };
      }
      return { lines: [...state.lines, { menuItemId: item.id, name: item.name, price: Number(item.price), category: item.category.name, quantity: 1, notes: "" }] };
    }),

  updateQuantity: (menuItemId, delta) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)),
    })),

  removeItem: (menuItemId) => set((state) => ({ lines: state.lines.filter((l) => l.menuItemId !== menuItemId) })),

  reset: () => set({ ...initial, lines: [] }),
}));

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
