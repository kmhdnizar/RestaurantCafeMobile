import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSessionStore } from '@/state/session-store';
import { useOutboxStore } from '@/state/outbox-store';
import { flushOutbox } from '@/offline/sync-engine';

export default function SettingsScreen() {
  const user = useSessionStore((s) => s.user);
  const logout = useSessionStore((s) => s.logout);
  const entries = useOutboxStore((s) => s.entries);
  const syncing = useOutboxStore((s) => s.syncing);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    return NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected && s.isInternetReachable !== false)));
  }, []);

  const waiting = entries.filter((e) => e.status !== 'failed').length;
  const failed = entries.filter((e) => e.status === 'failed').length;

  function handleLogout() {
    if (waiting + failed === 0) {
      void logout();
      return;
    }
    Alert.alert(
      'Unsent orders',
      `${waiting + failed} order(s) haven't been sent to the server yet. If you sign out now they stay on this phone and send after you sign back in, but they won't reach the kitchen until then.`,
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out anyway', style: 'destructive', onPress: () => void logout() },
      ]
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Settings</ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{user?.name}</ThemedText>
          <ThemedText themeColor="textSecondary">{user?.username}</ThemedText>
          <ThemedText themeColor="textSecondary">{user?.roles.join(', ')}</ThemedText>
          <ThemedText themeColor="textSecondary">{user?.restaurantName}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Connection</ThemedText>
          <ThemedText themeColor="textSecondary">{online === null ? 'Checking…' : online ? 'Online' : 'Offline — orders will be saved and sent later'}</ThemedText>
          <ThemedText themeColor="textSecondary">
            Waiting to send: {waiting}
            {failed > 0 ? ` · Not accepted: ${failed}` : ''}
          </ThemedText>
          <Pressable onPress={() => void flushOutbox()} disabled={syncing} style={[styles.syncButton, syncing && styles.disabled]}>
            <ThemedText style={styles.syncText}>{syncing ? 'Sending…' : 'Send now'}</ThemedText>
          </Pressable>
        </ThemedView>

        <Pressable onPress={handleLogout} style={styles.logoutButton}>
          <ThemedText style={styles.logoutText}>Sign out</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  syncButton: { backgroundColor: '#ea580c', borderRadius: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', marginTop: Spacing.two },
  syncText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.6 },
  logoutButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dc2626',
    marginTop: 'auto',
  },
  logoutText: { color: '#dc2626', fontWeight: '600' },
});
