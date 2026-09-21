// EXPO_PUBLIC_ vars are inlined into the app bundle at build time — never
// put a real secret here. The bypass secret, if set, is a Vercel
// "Protection Bypass for Automation" value; it's meant to be shared with
// automated/trusted clients, not a user credential.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export const VERCEL_BYPASS_SECRET = process.env.EXPO_PUBLIC_VERCEL_BYPASS_SECRET || null;

if (!API_BASE_URL) {
  throw new Error("EXPO_PUBLIC_API_BASE_URL is not set — check your .env file");
}
