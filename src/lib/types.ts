// Mirrors the backend's Role enum (prisma/schema.prisma in the RestaurantCafe
// web app repo) — kept in sync by hand since this is a separate project.
export type Role = "ADMIN" | "MANAGER" | "WAITER" | "COOK" | "CASHIER";
