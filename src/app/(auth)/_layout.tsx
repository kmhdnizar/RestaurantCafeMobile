import { Redirect, Stack } from 'expo-router';

import { useSessionStore } from '@/state/session-store';

export default function AuthLayout() {
  const status = useSessionStore((s) => s.status);

  if (status === 'authenticated') return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
