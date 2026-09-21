import { apiFetch } from "@/api/client";
import type { Role } from "@/lib/types";

export interface MobileUser {
  id: string;
  name: string;
  username: string;
  roles: Role[];
  restaurantId: string;
  restaurantName: string | null;
}

interface LoginResponse {
  accessToken: string;
  user: MobileUser;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/mobile/auth/login", {
    method: "POST",
    body: { username, password },
    skipAuth: true,
  });
}
