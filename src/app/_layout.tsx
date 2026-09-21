import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { ThemedView } from '@/components/themed-view';
import { useSessionStore, forceLogout } from '@/state/session-store';
import { setUnauthorizedHandler } from '@/api/client';
import { queryClient, queryPersister, PERSIST_MAX_AGE } from '@/lib/query-client';


setUnauthorizedHandler(() => {
  void forceLogout();
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const status = useSessionStore((s) => s.status);
  const hydrate = useSessionStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {status === 'loading' ? (
          <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" />
          </ThemedView>
        ) : (
          <Stack screenOptions={{ headerShown: false }} />
        )}
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
