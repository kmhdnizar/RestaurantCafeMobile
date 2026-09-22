import { create } from "zustand";
import { sanitizePriceText } from "@/lib/format";

export interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  /** Raw text backing the market-price input — kept separate from `price`
   * so a trailing decimal point isn't lost while the user is still typing. */
  priceText: string;
  /** True when the menu lists this item at RM0 — a "market price" item
   * (e.g. daily fish) where staff enter the real price at order time. */
  variablePrice: boolean;
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
  setLineNotes: (menuItemId: string, notes: string) => void;
  setLinePrice: (menuItemId: string, text: string) => void;
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
      const listedPrice = Number(item.price);
      return {
        lines: [
          ...state.lines,
          { menuItemId: item.id, name: item.name, price: listedPrice, priceText: listedPrice === 0 ? "" : String(listedPrice), variablePrice: listedPrice === 0, category: item.category.name, quantity: 1, notes: "" },
        ],
      };
    }),

  updateQuantity: (menuItemId, delta) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)),
    })),

  setLineNotes: (menuItemId, notes) => set((state) => ({ lines: state.lines.map((l) => (l.menuItemId === menuItemId ? { ...l, notes } : l)) })),

  setLinePrice: (menuItemId, text) =>
    set((state) => ({
      lines: state.lines.map((l) => {
        if (l.menuItemId !== menuItemId) return l;
        const priceText = sanitizePriceText(text);
        return { ...l, priceText, price: parseFloat(priceText) || 0 };
      }),
    })),

  removeItem: (menuItemId) => set((state) => ({ lines: state.lines.filter((l) => l.menuItemId !== menuItemId) })),

  reset: () => set({ ...initial, lines: [] }),
}));

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
