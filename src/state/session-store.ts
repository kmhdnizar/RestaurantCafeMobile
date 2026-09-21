import { create } from "zustand";
import { login as loginRequest, type MobileUser } from "@/api/auth";
import { queryClient } from "@/lib/query-client";
import { getStoredToken, getStoredUser, setStoredSession, clearStoredSession } from "@/auth/token-storage";

interface SessionState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: MobileUser | null;
  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "loading",
  user: null,

  async hydrate() {
    const [token, user] = await Promise.all([getStoredToken(), getStoredUser()]);
    if (token && user) {
      set({ status: "authenticated", user });
    } else {
      set({ status: "unauthenticated", user: null });
    }
  },

  async login(username, password) {
    const { accessToken, user } = await loginRequest(username, password);
    await setStoredSession(accessToken, user);
    set({ status: "authenticated", user });
  },

  async logout() {
    await clearStoredSession();
    queryClient.clear();
    set({ status: "unauthenticated", user: null });
  },
}));

/** Called by the API client on any 401 — the token is no longer valid
 * (revoked account, expired, tampered), so drop the local session and let
 * the root layout's redirect send the user back to login. */
export async function forceLogout(): Promise<void> {
  await clearStoredSession();
  queryClient.clear();
  useSessionStore.setState({ status: "unauthenticated", user: null });
}
