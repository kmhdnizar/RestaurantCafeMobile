import * as SecureStore from "expo-secure-store";
import type { MobileUser } from "@/api/auth";

// Keychain on iOS, encrypted SharedPreferences on Android — appropriate for
// a long-lived (7-day) bearer token, unlike AsyncStorage which is plaintext.
const ACCESS_TOKEN_KEY = "mobile_access_token";
// Cached alongside the token so the app can show "logged in as X" and gate
// role-appropriate UI immediately on launch, before any network call —
// there's no separate "who am I" endpoint to refetch this from.
const USER_KEY = "mobile_user";

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function getStoredUser(): Promise<MobileUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileUser;
  } catch {
    return null;
  }
}

export async function setStoredSession(token: string, user: MobileUser): Promise<void> {
  await Promise.all([SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token), SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))]);
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY), SecureStore.deleteItemAsync(USER_KEY)]);
}
