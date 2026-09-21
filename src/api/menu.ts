import { apiFetch } from "@/api/client";
import type { ServingPeriod } from "@/lib/serving-period";

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
  available: boolean;
  active: boolean;
  availableFrom: string | null;
  category: { id: string; name: string };
  servingPeriods: { servingPeriod: ServingPeriod }[];
}

export interface Table {
  id: string;
  number: number;
  name: string | null;
  capacity: number;
  active: boolean;
}

export interface RestaurantConfig {
  currencyCode: string;
  timezone: string;
  printOrdersByCategory: boolean;
  kitchenPrinterBridgeUrl: string | null;
  kitchenPrinterAddress: string | null;
}

export async function fetchMenuItems(): Promise<MenuItem[]> {
  return apiFetch<MenuItem[]>("/api/menu-items");
}

export async function fetchTables(): Promise<Table[]> {
  return apiFetch<Table[]>("/api/tables");
}

export async function fetchServingPeriods(): Promise<ServingPeriod[]> {
  return apiFetch<ServingPeriod[]>("/api/serving-periods");
}

export async function fetchConfig(): Promise<RestaurantConfig> {
  return apiFetch<RestaurantConfig>("/api/mobile/config");
}
