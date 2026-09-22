import { useEffect } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/state/session-store';
import { useTheme } from '@/hooks/use-theme';
import { startSyncEngine } from '@/offline/sync-engine';
import { useT } from '@/lib/i18n';

export default function StaffLayout() {
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const theme = useTheme();
  const t = useT();

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    return startSyncEngine(userId);
  }, [status, userId]);

  if (status === 'unauthenticated') return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#ea580c',
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.newOrder'),
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('tabs.myOrders'),
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen name="edit-order" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
